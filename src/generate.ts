import {mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join, parse, resolve, sep} from 'node:path';
import {format, resolveConfig} from 'prettier';
import {loadOpenApi} from './openapi';
import type {GeneratorConfig} from './codegen/types';
import {DEFAULT_RUNTIME_CONFIG} from './config';
import {extractSchemas, generateModelFiles} from './codegen/generate-models';
import {extractOperations, generateApiFiles} from './codegen/generate-api';
import {generateRuntimeFiles} from './codegen/generate-runtime';
import {hoistInlineSchemas} from './codegen/inline-schemas';
import {buildModelNames} from './codegen/naming';

/** Ensures `config.runtime` is present, defaulting missing fields. */
function withRuntimeDefaults(config: GeneratorConfig): GeneratorConfig {
  return {
    ...config,
    runtime: {...DEFAULT_RUNTIME_CONFIG, ...config.runtime},
  };
}

/**
 * Generates the raw (unformatted) file map for the given config.
 *
 * Pure core: loads the OpenAPI document, hoists inline schemas and extracts
 * models/operations, returning a `Record<relativePath, unformattedContent>`.
 * Performs no disk I/O and no Prettier formatting. This is the shared base
 * used by `generate()`, `--dry-run` and `--check`.
 */
export async function generateFiles(config: GeneratorConfig): Promise<Record<string, string>> {
  const normalizedConfig = withRuntimeDefaults(config);
  const api = await loadOpenApi(normalizedConfig.input);

  // Hoist anonymous inline schemas into components.schemas before extraction.
  // The permissive document shape used by the codegen omits several
  // `openapi-types` members (e.g. `ReferenceObject` parameters), so the
  // loaded document is narrowed here in one place.
  const doc = api as unknown as Parameters<typeof hoistInlineSchemas>[0];

  hoistInlineSchemas(doc);

  // Resolve schema keys to emitted type names once. Both the declarations and
  // every `$ref` go through this map, so a renamed (`default` → `Default`) or
  // de-duplicated (`200Response`) schema is referenced consistently instead of
  // being re-derived — which could bind a `$ref` to the wrong declaration.
  const names = buildModelNames(Object.keys(doc.components?.schemas ?? {}));

  const schemas = extractSchemas(doc, names);
  const operations = extractOperations(doc, normalizedConfig, names);

  return {
    ...generateRuntimeFiles(normalizedConfig),
    ...generateModelFiles(schemas),
    ...generateApiFiles(operations, normalizedConfig, names),
    'index.ts': generateIndexFile(normalizedConfig),
  };
}

/**
 * Formats every generated file with Prettier and prepends the
 * auto-generated header. Pure function — no disk I/O beyond resolving the
 * project's Prettier configuration.
 *
 * The project's own Prettier configuration (resolved from `outputRoot`) is
 * merged over the generator defaults, so `npx prettier --check` on the output
 * directory does not report every generated file as misformatted. Without
 * this, a project using `printWidth: 100` / `trailingComma: 'all'` and the
 * generator's `80` / `'none'` rewrite each other's output on every run.
 *
 * Files are formatted in parallel; Prettier formatting is pure per file, so
 * parallel execution produces identical output to sequential formatting.
 */
export async function formatFiles(
  files: Record<string, string>,
  outputRoot?: string,
): Promise<Record<string, string>> {
  // A single resolution per run is enough: the generated tree is one flat
  // output directory, so the effective config cannot differ per file.
  const projectOptions = await resolvePrettierOptions(outputRoot);

  const entries = await Promise.all(
    Object.entries(files).map(async ([fileName, content]) => {
      const formatted = await format(withHeader(content), {
        ...DEFAULT_PRETTIER_OPTIONS,
        ...projectOptions,
        parser: 'typescript',
      });
      return [fileName, formatted] as const;
    }),
  );

  return Object.fromEntries(entries);
}

/** Generator defaults, used when the project has no Prettier configuration. */
const DEFAULT_PRETTIER_OPTIONS = {
  parser: 'typescript',
  singleQuote: true,
  trailingComma: 'none',
} as const;

/**
 * Resolves the project's Prettier configuration for the output directory.
 *
 * Returns an empty object when the project has no configuration (or when
 * resolution fails, e.g. an invalid `.prettierrc`) so generation never fails
 * because of an unrelated formatting config.
 *
 * Prettier's `resolveConfig()` expects a *file path*, not a directory: given a
 * directory it treats the last path segment as the file name and starts
 * resolving from the parent. A `.prettierrc` inside the output directory would
 * be skipped, and `overrides` (`files: '*.generated.ts'`) would never match.
 * Passing a representative file inside the directory fixes both.
 *
 * Results are memoized per directory: a single CLI run formats the whole
 * output tree, so re-walking the filesystem for every file (and for every
 * `--check`/`--dry-run` pass over the same tree) is pure overhead.
 */
async function resolvePrettierOptions(outputRoot?: string): Promise<Record<string, unknown>> {
  const root = outputRoot ?? process.cwd();
  const cached = prettierOptionsCache.get(root);

  if (cached) {
    return cached;
  }

  let options: Record<string, unknown> = {};

  try {
    const resolved = await resolveConfig(join(root, 'index.ts'));

    if (resolved) {
      // `parser` is always ours: the generator emits TypeScript, and a project
      // config may only be resolvable per file extension otherwise.
      const {parser: _parser, ...rest} = resolved;

      options = rest as Record<string, unknown>;
    }
  } catch {
    options = {};
  }

  prettierOptionsCache.set(root, options);

  return options;
}

const prettierOptionsCache = new Map<string, Record<string, unknown>>();

/**
 * Writes the given (formatted) file map to the output directory.
 *
 * When `clean` is `true`, the output directory is removed first. Creates
 * parent directories as needed. Files are written in parallel — each file
 * has a unique path, so there are no write conflicts.
 *
 * Guards against pathological `output` values (empty, a drive root, the
 * current working directory or one of its ancestors): `rm(..., {recursive:
 * true})` on such a path would delete the user's project or the whole drive.
 */
export async function writeFiles(
  output: string,
  files: Record<string, string>,
  clean: boolean,
): Promise<void> {
  const outputRoot = resolve(output);

  if (clean) {
    assertSafeToClean(outputRoot);
    await rm(outputRoot, {recursive: true, force: true});
  }

  await mkdir(outputRoot, {recursive: true});

  await Promise.all(
    Object.entries(files).map(async ([fileName, content]) => {
      const outputPath = join(outputRoot, fileName);

      await mkdir(dirname(outputPath), {recursive: true});

      await writeFile(outputPath, content, 'utf8');
    }),
  );
}

/**
 * Rejects an output directory that is too broad to wipe recursively.
 *
 * Throws instead of silently skipping the clean step so a misconfigured
 * `output` surfaces immediately rather than leaving stale generated files
 * behind.
 */
function assertSafeToClean(outputRoot: string): void {
  const cwd = resolve(process.cwd());
  const root = parse(outputRoot).root;

  if (outputRoot === root) {
    throw new Error(
      `Refusing to clean '${outputRoot}': it is a filesystem root. Set a dedicated 'output' directory in your config.`,
    );
  }

  // `cwd` itself or any ancestor of it (`output: '..'`) would delete the
  // project the generator is being run from.
  if (cwd === outputRoot || cwd.startsWith(outputRoot + sep)) {
    throw new Error(
      `Refusing to clean '${outputRoot}': it contains the current working directory ('${cwd}'). Set a dedicated 'output' directory in your config.`,
    );
  }
}

/**
 * Generates the Angular API client from an OpenAPI specification.
 *
 * Thin wrapper around {@link generateFiles}, {@link formatFiles} and
 * {@link writeFiles}. Behaves identically to previous versions.
 */
export async function generate(config: GeneratorConfig): Promise<void> {
  const files = await generateFiles(config);
  const formatted = await formatFiles(files, config.output);
  await writeFiles(config.output, formatted, config.clean);
}

function generateIndexFile(config: GeneratorConfig): string {
  const transport = config.runtime?.transport ?? 'fetch';
  const signalMutations = config.runtime?.signalMutations === true;
  const dateTransformer = config.runtime?.dateTransformer === true;
  const clientExport =
    transport === 'httpClient'
      ? "export * from './api-http-client';"
      : "export * from './api-fetch-client';";
  const mutationExport = signalMutations ? "export * from './mutation-utils';\n" : '';
  const dateUtilsExport = dateTransformer ? "export * from './date-utils';\n" : '';

  return `export * from './providers';
export * from './api-error';
${clientExport}
export * from './signal-utils';
${mutationExport}${dateUtilsExport}export * from './models';
export * from './resources';
`;
}

function withHeader(content: string): string {
  const header = `// Auto-generated by ng-openapi-signals.
// Do not edit manually.`;

  // Idempotent: do not add the header twice if the content already has it.
  if (content.startsWith('// Auto-generated by ng-openapi-signals.')) {
    return content;
  }

  return `${header}

${content}`;
}
