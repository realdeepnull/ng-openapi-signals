import {mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join, parse, resolve, sep} from 'node:path';
import {format} from 'prettier';
import {loadOpenApi} from './openapi';
import type {GeneratorConfig} from './codegen/types';
import {DEFAULT_RUNTIME_CONFIG} from './config';
import {extractSchemas, generateModelFiles} from './codegen/generate-models';
import {extractOperations, generateApiFiles} from './codegen/generate-api';
import {generateRuntimeFiles} from './codegen/generate-runtime';
import {hoistInlineSchemas} from './codegen/inline-schemas';

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

  const schemas = extractSchemas(doc);
  const operations = extractOperations(doc, normalizedConfig);

  return {
    ...generateRuntimeFiles(normalizedConfig),
    ...generateModelFiles(schemas),
    ...generateApiFiles(operations, normalizedConfig),
    'index.ts': generateIndexFile(normalizedConfig),
  };
}

/**
 * Formats every generated file with Prettier and prepends the
 * auto-generated header. Pure function — no disk I/O.
 *
 * Files are formatted in parallel; Prettier formatting is pure per file, so
 * parallel execution produces identical output to sequential formatting.
 */
export async function formatFiles(files: Record<string, string>): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(files).map(async ([fileName, content]) => {
      const formatted = await format(withHeader(content), {
        parser: 'typescript',
        singleQuote: true,
        trailingComma: 'none',
      });
      return [fileName, formatted] as const;
    }),
  );

  return Object.fromEntries(entries);
}

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
  const formatted = await formatFiles(files);
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
