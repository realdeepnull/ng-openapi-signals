import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, relative} from 'node:path';
import ts from 'typescript';
import {generate} from '../src/generate.js';
import {sanitizeTypeName, serviceNameFromTag} from '../src/codegen/naming.js';
import {declaredNames, duplicateRootExports, exportedNames} from './helpers/barrel-exports.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-root-barrel-exports');
const HTTP_CLIENT_OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-root-barrel-exports-http');
const FIXTURE = 'tests/fixtures/global-type-names.yml';

/**
 * Schemas named exactly like a module-level export of a generated runtime
 * module (`providers.ts`, `api-error.ts`, the client, `signal-utils.ts`,
 * `mutation-utils.ts`, `date-utils.ts`).
 *
 * Such a declaration is legal, and it collides with nothing *inside* a module,
 * so generation, Prettier, the CLI and even a `tsc` over the individual files all
 * succeed. The duplicate only exists at the package entry point: the generated
 * root `index.ts` re-exports the runtime module *and* `./models`, so
 * `export class ApiError` and `export interface ApiError` meet in one barrel —
 * `error TS2308: Module './models' has already exported a member named
 * 'ApiError'` for every consumer of the generated package.
 *
 * The fix renames the declaration through the same `Model` suffix path as the
 * other collision classes (`RESERVED_ROOT_EXPORT_NAMES`).
 */
describe('schema names that collide with a generated runtime export', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: FIXTURE,
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {signalMutations: true, dateTransformer: true},
    });
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('renames the declarations with the `Model` suffix', async () => {
    // One entry per runtime module the schema name collides with, so a missing
    // `RESERVED_ROOT_EXPORT_NAMES` entry fails here rather than only in a
    // consumer's build.
    for (const [file, declaration] of [
      ['api-error-model.ts', 'export interface ApiErrorModel {'],
      ['api-network-error-model.ts', 'export interface ApiNetworkErrorModel {'],
      ['api-request-options-model.ts', 'export interface ApiRequestOptionsModel {'],
      ['api-fetch-client-model.ts', 'export interface ApiFetchClientModel {'],
      ['query-param-options-model.ts', 'export interface QueryParamOptionsModel {'],
      ['maybe-signal-model.ts', 'export interface MaybeSignalModel {'],
      ['transform-dates-model.ts', 'export interface transformDatesModel {'],
      ['mutation-status-model.ts', 'export interface MutationStatusModel {'],
      ['provide-ng-openapi-signals-model.ts', 'export interface provideNgOpenapiSignalsModel {'],
      [
        'ng-openapi-signals-base-pathmodel.ts',
        'export interface NG_OPENAPI_SIGNALS_BASE_PATHModel {',
      ],
    ] as const) {
      expect(await readFile(join(OUTPUT_DIR, 'models', file), 'utf8'), file).toContain(declaration);
    }
  });

  it('binds `$ref`s to the renamed declarations', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'runtime-exports.api.ts'), 'utf8');

    expect(content).toContain('request<ApiErrorModel>');
    expect(content).toContain('request<ApiRequestOptionsModel>');
    expect(content).toContain('request<transformDatesModel>');
    expect(content).toContain('request<provideNgOpenapiSignalsModel>');
    expect(content).toContain('request<NG_OPENAPI_SIGNALS_BASE_PATHModel>');
    // The unrenamed runtime names must not reach the model import list; the
    // names that *are* bound by the template (`ApiFetchClient`, `MaybeSignal`) go
    // through `RESERVED_RESOURCE_BINDING_NAMES` and stay renamed too.
    expect(content).not.toMatch(/import type \{[^}]*\bApiError\b[^}]*\} from '\.\.\/models';/s);
  });

  it('re-exports the renamed declarations from the models barrel', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'index.ts'), 'utf8');

    expect(content).toContain("export * from './api-error-model';");
    expect(content).toContain("export * from './transform-dates-model';");
    expect(content).toContain("export * from './provide-ng-openapi-signals-model';");
  });

  it('exports no name twice from the root barrel', async () => {
    // The general guard for the whole family: resolve every `export *` of the
    // root `index.ts` (runtime modules, `./models`, `./resources`) and assert the
    // result is disjoint. Adding a new runtime export without listing it in
    // `RESERVED_ROOT_EXPORT_NAMES` — and a fixture schema of that name — shows up
    // here as `[name, [moduleA, moduleB]]`.
    expect(await duplicateRootExports(OUTPUT_DIR)).toEqual([]);

    // Guard against a vacuous pass: the resolved set must contain exports from
    // both a runtime module and the models barrel.
    const runtimeModels = await readFile(join(OUTPUT_DIR, 'models', 'index.ts'), 'utf8');
    expect(runtimeModels).toContain("export * from './api-error-model';");
    expect((await exportedNames(OUTPUT_DIR)).length).toBeGreaterThan(0);
  });

  it('keeps ordinary names in a document that also has runtime-named schemas', async () => {
    // The rename must stay targeted: a business schema in this same document
    // keeps its spelling, and `Error` (a runtime-only global) is untouched.
    expect(await readFile(join(OUTPUT_DIR, 'models', 'error.ts'), 'utf8')).toContain(
      'export interface Error {',
    );
    expect(await readFile(join(OUTPUT_DIR, 'models', 'record.ts'), 'utf8')).toContain(
      'export interface record {',
    );
  });
});

/**
 * `RESERVED_ROOT_EXPORT_NAMES` is the union over all configurations, so the
 * renames must not depend on `runtime.transport`/`signalMutations`/
 * `dateTransformer`: the same spec has to emit the same declaration names in
 * every project, otherwise the generated package's public API would differ
 * per configuration.
 */
describe('root-barrel renames are configuration-independent', () => {
  beforeEach(async () => {
    await rm(HTTP_CLIENT_OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: FIXTURE,
      output: HTTP_CLIENT_OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      // The opposite of the first pass: the other transport and neither
      // optional runtime module. `mutation-utils.ts`/`date-utils.ts` are not
      // emitted at all, yet their names must still be renamed.
      runtime: {transport: 'httpClient'},
    });
  });

  afterEach(async () => {
    await rm(HTTP_CLIENT_OUTPUT_DIR, {recursive: true, force: true});
  });

  it('renames names whose runtime module is not emitted in this configuration', async () => {
    expect(
      await readFile(join(HTTP_CLIENT_OUTPUT_DIR, 'models', 'transform-dates-model.ts'), 'utf8'),
    ).toContain('export interface transformDatesModel {');
    expect(
      await readFile(join(HTTP_CLIENT_OUTPUT_DIR, 'models', 'mutation-status-model.ts'), 'utf8'),
    ).toContain('export interface MutationStatusModel {');
    // `providers-fetch.ts` is not used here, so `ApiMiddleware` has no runtime
    // counterpart — it is renamed anyway.
    expect(
      await readFile(join(HTTP_CLIENT_OUTPUT_DIR, 'models', 'api-middleware-model.ts'), 'utf8'),
    ).toContain('export interface ApiMiddlewareModel {');

    // `ApiMiddleware` exists only in the `fetch` providers module; in this pass
    // nothing exports it, so the name is disjoint by construction as well.
    expect(await duplicateRootExports(HTTP_CLIENT_OUTPUT_DIR)).toEqual([]);
  });
});

/**
 * Completeness of `RESERVED_ROOT_EXPORT_NAMES`.
 *
 * The set must list *every* module-level export of every generated runtime
 * module, in both transports and with/without the optional modules — the union.
 * Otherwise a schema named after a newly added export silently reappears as a
 * TS2308 at the package entry point.
 *
 * Rather than duplicating the list, this reads the names out of a real generated
 * tree and asserts the declaration sanitizer renames each one. `providers.ts` and
 * the client are transport-specific, so both passes' runtime files are
 * collected.
 */
describe('every runtime export is a reserved model name', () => {
  const FETCH_DIR = join(process.cwd(), 'tests', '.tmp-runtime-exports-fetch');
  const HTTP_DIR = join(process.cwd(), 'tests', '.tmp-runtime-exports-http');

  const RUNTIME_MODULES = [
    'providers.ts',
    'api-error.ts',
    'api-fetch-client.ts',
    'api-http-client.ts',
    'signal-utils.ts',
    'mutation-utils.ts',
    'date-utils.ts',
  ];

  afterEach(async () => {
    await rm(FETCH_DIR, {recursive: true, force: true});
    await rm(HTTP_DIR, {recursive: true, force: true});
  });

  it('renames a schema for every name a runtime module exports', async () => {
    // Both configurations, with every optional runtime module enabled, so the
    // collected set is the union the rename set documents.
    await generate({
      input: FIXTURE,
      output: FETCH_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {signalMutations: true, dateTransformer: true},
    });
    await generate({
      input: FIXTURE,
      output: HTTP_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {signalMutations: true, dateTransformer: true, transport: 'httpClient'},
    });

    const runtimeExports = new Set<string>();

    for (const directory of [FETCH_DIR, HTTP_DIR]) {
      for (const module of RUNTIME_MODULES) {
        const source = await readFile(join(directory, module), 'utf8').catch(() => undefined);
        for (const name of declaredNames(source ?? '')) {
          runtimeExports.add(name);
        }
      }
    }

    // Guard against a vacuous pass: both transports must have contributed.
    expect([...runtimeExports]).toEqual(
      expect.arrayContaining(['ApiFetchClient', 'ApiHttpClient']),
    );
    expect(runtimeExports.size).toBeGreaterThan(25);

    for (const name of runtimeExports) {
      expect(sanitizeTypeName(name), name).toBe(`${name}Model`);
    }

    // Resource classes need no entry in the set: `serviceNameFromTag()` always
    // appends `Api` (it PascalCases the tag, so it is not a verbatim
    // concatenation) and no runtime export ends in `Api`, so a derived class name
    // can never equal one. This is what lets the model rename alone keep
    // `./models` and `./resources` disjoint at the root barrel.
    for (const name of runtimeExports) {
      expect(name.endsWith('Api'), name).toBe(false);
      expect(serviceNameFromTag(name).endsWith('Api'), name).toBe(true);
      // A class name is never the runtime export itself, so this set leaves it
      // alone (it may still be suffixed by the document-wide model-name rule).
      expect(serviceNameFromTag(name), name).not.toBe(name);
      expect(sanitizeTypeName(name), name).toBe(`${name}Model`);
    }
  });
});

/**
 * Negative control: the disjointness assertion must be able to fail.
 *
 * Without the rename, a schema named `ApiError` produces exactly the defect the
 * fix targets. This test compiles the pre-fix shape directly (a `models` barrel
 * that exports `ApiError` next to the generated `api-error.ts`) so the guard is
 * proven non-vacuous even on a machine where generation is fixed.
 */
describe('root-barrel disjointness guard (control)', () => {
  const CONTROL_DIR = join(process.cwd(), 'tests', '.tmp-root-barrel-control');

  afterEach(async () => {
    await rm(CONTROL_DIR, {recursive: true, force: true});
  });

  it('reports TS2308 when a model name equals a runtime export', async () => {
    await mkdir(join(CONTROL_DIR, 'models'), {recursive: true});
    await writeFile(
      join(CONTROL_DIR, 'api-error.ts'),
      'export class ApiError extends Error {}\n',
      'utf8',
    );
    await writeFile(
      join(CONTROL_DIR, 'models', 'index.ts'),
      "export * from './api-error';\n",
      'utf8',
    );
    await writeFile(
      join(CONTROL_DIR, 'models', 'api-error.ts'),
      'export interface ApiError {message?: string;}\n',
      'utf8',
    );
    await writeFile(
      join(CONTROL_DIR, 'index.ts'),
      "export * from './api-error';\nexport * from './models';\n",
      'utf8',
    );

    assertDuplicateNameDiagnostics(CONTROL_DIR, ['ApiError']);

    // The detector must be able to see the same collision through the barrel
    // resolver used by the positive test above.
    expect(await duplicateRootExports(CONTROL_DIR)).toEqual([
      [
        'ApiError',
        [join(CONTROL_DIR, 'api-error.ts'), join(CONTROL_DIR, 'models', 'api-error.ts')],
      ],
    ]);
  });
});

/**
 * Compiles `outputDir/index.ts` and asserts a TS2308 ("Module … has already
 * exported a member named 'X'") for every expected colliding name.
 */
function assertDuplicateNameDiagnostics(outputDir: string, names: string[]): void {
  const program = ts.createProgram([join(outputDir, 'index.ts')], {
    noEmit: true,
    skipLibCheck: true,
    types: [],
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  const duplicates = diagnostics
    .filter((diagnostic) => diagnostic.code === 2308)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
  const formatted = diagnostics.map(
    (diagnostic) =>
      `TS${diagnostic.code} ${relative(process.cwd(), diagnostic.file?.fileName ?? '')}: ${ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        ' ',
      )}`,
  );

  for (const name of names) {
    expect(
      duplicates.some((message) => message.includes(`'${name}'`)),
      `expected TS2308 for '${name}' in:\n${formatted.join('\n')}`,
    ).toBe(true);
  }
}

/** Guards the declaration scan the barrel helper relies on. */
describe('generated export scan', () => {
  it('recognises every declaration form the generator emits', () => {
    expect(
      declaredNames(
        [
          'export class UsersApi {}',
          'export interface User {',
          'export type Id = string;',
          'export const TOKEN = 1;',
          'export async function toApiError(): Promise<void> {}',
          'export function provideNgOpenapiSignals(): void {}',
          "export * from './user';",
        ].join('\n'),
      ),
    ).toEqual(['UsersApi', 'User', 'Id', 'TOKEN', 'toApiError', 'provideNgOpenapiSignals']);
  });
});
