import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';
import {duplicateRootExports} from './helpers/barrel-exports.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-global-type-names');
// Second pass of the same fixture with the other transport. Kept in its own
// directory so the `fetch` pass assertions above stay independent of it.
const HTTP_CLIENT_OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-global-type-names-http');
const FIXTURE = 'tests/fixtures/global-type-names.yml';

/**
 * Counts the module-scope bindings named `binding` introduced by `import`
 * statements (value or type). Used to prove that a renamed model never adds a
 * second binding next to the resource template's own import (TS2300).
 */
function countImportedBindings(content: string, binding: string): number {
  return [...content.matchAll(/import (?:type )?\{([^}]*)\}/g)]
    .flatMap((match) => match[1]!.split(','))
    .map((name) => name.replace(/^\s*type\s+/, '').trim())
    .filter((name) => name === binding).length;
}

/**
 * A schema named after a global type the generator emits would either make the
 * declaration itself invalid (`export type Record = Record<…>` → TS2456) or
 * shadow the built-in in every module that imports that model (`Promise<T>`,
 * `Blob`, `ReadableStream<Uint8Array>`). Declaration names are therefore
 * suffixed with `Model` (`Record` → `RecordModel`); `$ref`s resolve through the
 * same `buildModelNames()` map, so the rename is consistent.
 */
describe('schema names that shadow global types', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: FIXTURE,
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      // `signalMutations` makes the resource template import `createMutation`
      // and `Mutation` from `../mutation-utils`, so the `Bindings` group (a GET
      // plus a mutation) exercises every import binding at once.
      // `dateTransformer` emits `date-utils.ts`, which the root barrel re-exports
      // next to `./models` — required to prove the `transformDates` rename.
      runtime: {signalMutations: true, dateTransformer: true},
    });
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('renames a `Record` schema and keeps the global Record usable', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'record-model.ts'), 'utf8');

    expect(content).toContain('export type RecordModel = Record<string, string>;');
    expect(content).not.toContain('export type Record =');
  });

  it('renames `Promise`, `Blob` and `ReadableStream` declarations', async () => {
    expect(await readFile(join(OUTPUT_DIR, 'models', 'promise-model.ts'), 'utf8')).toContain(
      'export interface PromiseModel {',
    );
    expect(await readFile(join(OUTPUT_DIR, 'models', 'blob-model.ts'), 'utf8')).toContain(
      'export interface BlobModel {',
    );
    expect(
      await readFile(join(OUTPUT_DIR, 'models', 'readable-stream-model.ts'), 'utf8'),
    ).toContain('export interface ReadableStreamModel {');
  });

  it('renames `Uint8Array` and `AbortSignal` declarations', async () => {
    // Both names occur in a *type expression the generator emits*:
    // `ReadableStream<Uint8Array>` (SSE response type) and `AbortSignal` (the
    // `signal` parameter of every Promise mutation method). Deleting either
    // entry from `RESERVED_GLOBAL_TYPE_NAMES` turns these assertions red.
    // `kebabCase()` splits on lower→upper only, so `Uint8ArrayModel` keeps its
    // digit run: `uint8array-model.ts`.
    expect(await readFile(join(OUTPUT_DIR, 'models', 'uint8array-model.ts'), 'utf8')).toContain(
      'export interface Uint8ArrayModel {',
    );
    expect(await readFile(join(OUTPUT_DIR, 'models', 'abort-signal-model.ts'), 'utf8')).toContain(
      'export interface AbortSignalModel {',
    );
  });

  it('imports the renamed type next to the global `Record<…>`', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'get-records-response.ts'), 'utf8');

    // `Record<string, RecordModel>` — the outer `Record` is the global, the
    // inner type is the renamed model.
    expect(content).toContain("import type {RecordModel} from './record-model';");
    expect(content).toContain(
      'export type GetRecordsResponse = {label?: string} & Record<string, RecordModel>;',
    );
  });

  it('binds `$ref`s to the renamed declaration', async () => {
    const holder = await readFile(join(OUTPUT_DIR, 'models', 'record-holder.ts'), 'utf8');

    expect(holder).toContain("import type {RecordModel} from './record-model';");
    expect(holder).toContain('record?: RecordModel;');
  });

  it('uses the renamed types in resource signatures that emit the globals', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'records.api.ts'), 'utf8');

    // The module imports the models, so a declaration named `Promise`/`Blob`/
    // `Uint8Array`/`AbortSignal` would shadow the globals used in these very
    // signatures. Prettier wraps the list at `printWidth: 100`, hence the
    // name-by-name assertions rather than one exact line.
    for (const imported of [
      'AbortSignalModel',
      'BlobModel',
      'GetRecordsResponse',
      'PromiseModel',
      'Uint8ArrayModel',
    ]) {
      expect(content, imported).toMatch(
        new RegExp(`import type \\{[^}]*\\b${imported}\\b[^}]*\\} from '\\.\\./models';`),
      );
    }

    expect(content).not.toMatch(/import type \{[^}]*\b(AbortSignal|Blob|Promise|Uint8Array)\b[^}]*\} from '\.\.\/models';/);
    expect(content).toContain('request<PromiseModel>');
    expect(content).toContain('request<BlobModel>');
    expect(content).toContain('request<Uint8ArrayModel>');
    expect(content).toContain('body: AbortSignalModel');
    expect(content).toContain('request<ReadableStream<Uint8Array> | null>');
    expect(content).toContain('signal?: AbortSignal');
    expect(content).toContain('): Promise<PromiseModel>');
    expect(content).toContain('): Promise<AbortSignalModel>');
  });

  it('imports models named `File` and `ArrayBuffer` instead of using the DOM globals', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'files.api.ts'), 'utf8');

    // Neither name is emitted by the generator (`format: binary` renders
    // `Blob`; there is no `arrayBuffer` parser for a schema), so both must be
    // imported. Suppressing the import while keeping the name binds
    // `request<File>` to the DOM `File` silently — and that still compiles.
    expect(content).toContain(
      "import type {ArrayBuffer, File, FormData, String, URLSearchParams} from '../models';",
    );
    expect(content).toContain('request<File>');
    expect(content).toContain('request<ArrayBuffer>');
    expect(content).toContain('params: {file?: MaybeSignal<File>}');
    expect(content).toContain('body: ArrayBuffer');
    // A model named after a global *value* is imported type-only too; that
    // does not shadow the value namespace used by `String(params.id)`.
    expect(content).toContain('encodeURIComponent(String(params.id))');
  });

  it('imports models named `FormData` and `URLSearchParams` instead of using the DOM globals', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'files.api.ts'), 'utf8');

    // `FormData` and `URLSearchParams` look like the runtime's form body
    // classes, but the generator never renders either as a schema type: the
    // runtime *builds* them from the `formData` option. They must therefore be
    // imported like any other model; otherwise `request<FormData>` binds to
    // the DOM class and the model silently becomes unreachable.
    expect(content).toContain('FormData');
    expect(content).toContain('URLSearchParams');
    expect(content).toMatch(/import type \{[^}]*FormData[^}]*\} from '\.\.\/models';/s);
    expect(content).toMatch(/import type \{[^}]*URLSearchParams[^}]*\} from '\.\.\/models';/s);
    expect(content).toContain('request<FormData>');
    expect(content).toContain('body: URLSearchParams');
    expect(content).toContain('form?: MaybeSignal<FormData>');
  });

  it('keeps the declarations for names the generator never emits', async () => {
    expect(await readFile(join(OUTPUT_DIR, 'models', 'file.ts'), 'utf8')).toContain(
      'export interface File {',
    );
    expect(await readFile(join(OUTPUT_DIR, 'models', 'array-buffer.ts'), 'utf8')).toContain(
      'export interface ArrayBuffer {',
    );
    expect(await readFile(join(OUTPUT_DIR, 'models', 'string.ts'), 'utf8')).toContain(
      'export interface String {',
    );
    expect(await readFile(join(OUTPUT_DIR, 'models', 'form-data.ts'), 'utf8')).toContain(
      'export interface FormData {',
    );
    expect(await readFile(join(OUTPUT_DIR, 'models', 'urlsearch-params.ts'), 'utf8')).toContain(
      'export interface URLSearchParams {',
    );
  });

  it('does not rename ordinary business names', async () => {
    // Only the exact global names are renamed; `record` is a different name and
    // `RecordHolder` merely contains the word.
    expect(await readFile(join(OUTPUT_DIR, 'models', 'record.ts'), 'utf8')).toContain(
      'export interface record {',
    );
    expect(await readFile(join(OUTPUT_DIR, 'models', 'record-holder.ts'), 'utf8')).toContain(
      'export interface RecordHolder {',
    );
  });

  it('renames schemas that collide with the resource template imports', async () => {
    // Every name in `RESERVED_RESOURCE_BINDING_NAMES` is declared by this
    // fixture and `$ref`'d from an operation in the `Bindings` group, so
    // dropping one from the set fails here (or in the import-count test
    // below) instead of passing green.
    for (const [file, name] of [
      ['service-model.ts', 'ServiceModel'],
      ['mutation-model.ts', 'MutationModel'],
      ['inject-model.ts', 'injectModel'],
      ['resource-model.ts', 'resourceModel'],
      ['api-fetch-client-model.ts', 'ApiFetchClientModel'],
      ['api-http-client-model.ts', 'ApiHttpClientModel'],
      ['read-signal-or-value-model.ts', 'readSignalOrValueModel'],
      ['maybe-signal-model.ts', 'MaybeSignalModel'],
      ['create-mutation-model.ts', 'createMutationModel'],
    ] as const) {
      expect(await readFile(join(OUTPUT_DIR, 'models', file), 'utf8'), file).toContain(
        `export interface ${name} {`,
      );
    }

    expect(await readFile(join(OUTPUT_DIR, 'models', 'index.ts'), 'utf8')).toContain(
      "export * from './service-model';",
    );
  });

  it('renames schemas that collide with a generated runtime export', async () => {
    // Every name in `RESERVED_ROOT_EXPORT_NAMES` is declared by this fixture.
    // Each is exported by a runtime module that the root `index.ts` re-exports
    // next to `./models`, so without the rename the package entry point exports
    // the name twice (TS2308) while every individual module still compiles.
    // `fileName` is the kebab-case of the *renamed* declaration; the acronym runs
    // of `NG_OPENAPI_SIGNALS_*` survive `kebabCase()` unsplit
    // (`ng-openapi-signals-base-pathmodel.ts`).
    for (const [file, name] of [
      ['api-error-model.ts', 'ApiErrorModel'],
      ['api-network-error-model.ts', 'ApiNetworkErrorModel'],
      ['to-api-error-model.ts', 'toApiErrorModel'],
      ['to-api-error-from-http-error-response-model.ts', 'toApiErrorFromHttpErrorResponseModel'],
      ['api-request-options-model.ts', 'ApiRequestOptionsModel'],
      ['query-param-options-model.ts', 'QueryParamOptionsModel'],
      ['transform-dates-model.ts', 'transformDatesModel'],
      ['provide-ng-openapi-signals-model.ts', 'provideNgOpenapiSignalsModel'],
      ['api-request-context-model.ts', 'ApiRequestContextModel'],
      ['api-error-mapper-model.ts', 'ApiErrorMapperModel'],
      ['api-auth-hook-model.ts', 'ApiAuthHookModel'],
      ['api-request-hook-model.ts', 'ApiRequestHookModel'],
      ['api-response-hook-model.ts', 'ApiResponseHookModel'],
      ['ng-openapi-signals-options-model.ts', 'NgOpenapiSignalsOptionsModel'],
      ['api-middleware-fn-model.ts', 'ApiMiddlewareFnModel'],
      ['api-middleware-model.ts', 'ApiMiddlewareModel'],
      ['api-middleware-entry-model.ts', 'ApiMiddlewareEntryModel'],
      ['ng-openapi-signals-base-pathmodel.ts', 'NG_OPENAPI_SIGNALS_BASE_PATHModel'],
      ['ng-openapi-signals-middlewaremodel.ts', 'NG_OPENAPI_SIGNALS_MIDDLEWAREModel'],
      ['ng-openapi-signals-authmodel.ts', 'NG_OPENAPI_SIGNALS_AUTHModel'],
      ['ng-openapi-signals-default-headersmodel.ts', 'NG_OPENAPI_SIGNALS_DEFAULT_HEADERSModel'],
      ['ng-openapi-signals-error-mappermodel.ts', 'NG_OPENAPI_SIGNALS_ERROR_MAPPERModel'],
      ['ng-openapi-signals-request-hookmodel.ts', 'NG_OPENAPI_SIGNALS_REQUEST_HOOKModel'],
      ['ng-openapi-signals-response-hookmodel.ts', 'NG_OPENAPI_SIGNALS_RESPONSE_HOOKModel'],
      ['ng-openapi-signals-timeoutmodel.ts', 'NG_OPENAPI_SIGNALS_TIMEOUTModel'],
      ['mutation-status-model.ts', 'MutationStatusModel'],
    ] as const) {
      expect(await readFile(join(OUTPUT_DIR, 'models', file), 'utf8'), file).toContain(
        `export interface ${name} {`,
      );
    }

    // `signal-utils`/`mutation-utils`/client exports are covered by
    // `RESERVED_RESOURCE_BINDING_NAMES` above (`MaybeSignal`, `Mutation`, …);
    // they live in the same file names.
    expect(await readFile(join(OUTPUT_DIR, 'models', 'index.ts'), 'utf8')).toContain(
      "export * from './api-error-model';",
    );
  });

  it('exports no name twice from the root barrel', async () => {
    // The general guard for the root-barrel family: resolve every `export *` of
    // `index.ts` — the runtime modules, `./models` and `./resources` — and assert
    // the resulting name set is disjoint. Every model/resource/class collision
    // fixed so far shows up here first if it regresses.
    expect(await duplicateRootExports(OUTPUT_DIR)).toEqual([]);

    const index = await readFile(join(OUTPUT_DIR, 'index.ts'), 'utf8');
    expect(index).toContain("export * from './date-utils';");
    expect(index).toContain("export * from './mutation-utils';");
    expect(index).toContain("export * from './models';");
  });

  it('imports exactly one binding per resource-template name', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'bindings.api.ts'), 'utf8');

    // The template imports `Service`, `inject`, `resource`, `ApiFetchClient`,
    // `readSignalOrValue`, `MaybeSignal`, `createMutation` and `Mutation`; the
    // models import must not add a second binding for any of them.
    expect(content).toContain("import {Service, inject, resource} from '@angular/core';");
    expect(content).toContain(
      "import {readSignalOrValue, type MaybeSignal} from '../signal-utils';",
    );
    expect(content).toContain("import {createMutation, type Mutation} from '../mutation-utils';");
    // Each of those names is *renamed* in the model import list, so the
    // template's own (unrenamed) specifier is the only one that appears.
    expect(content).not.toMatch(/import type \{[^}]*\binject\b[^}]*\} from '\.\.\/models';/s);
    // All nine renamed declarations are imported by this one resource file.
    const modelImport = /import type \{([^}]*)\} from '\.\.\/models';/s.exec(content)?.[1];
    expect(modelImport).toBeDefined();
    for (const renamed of [
      'ApiFetchClientModel',
      'ApiHttpClientModel',
      'MaybeSignalModel',
      'MutationModel',
      'ServiceModel',
      'createMutationModel',
      'injectModel',
      'readSignalOrValueModel',
      'resourceModel',
    ]) {
      expect(modelImport, renamed).toContain(renamed);
    }

    // Exactly one module-scope binding per name the template imports — and,
    // for the transport-bound `ApiHttpClient`, none at all in this `fetch`
    // pass. A second binding would be the TS2300 this fix prevents.
    for (const templateBinding of [
      'Service',
      'inject',
      'resource',
      'ApiFetchClient',
      'readSignalOrValue',
      'MaybeSignal',
      'createMutation',
      'Mutation',
    ]) {
      expect(countImportedBindings(content, templateBinding), templateBinding).toBe(1);
    }

    // The rename is configuration-independent, so the `ApiHttpClient` model is
    // still renamed even though this pass never imports the class.
    expect(countImportedBindings(content, 'ApiHttpClient')).toBe(0);
    expect(content).toContain('request<ApiHttpClientModel>');

    // The renamed declarations are what the signatures reference.
    expect(content).toContain('request<ServiceModel>');
    expect(content).toContain('body: MutationModel');
    expect(content).toContain('createMutation<MutationModel, ServiceModel>');
    expect(content).toContain('request<injectModel>');
    expect(content).toContain('request<resourceModel>');
    expect(content).toContain('request<ApiFetchClientModel>');
    expect(content).toContain('request<ApiHttpClientModel>');
    expect(content).toContain('request<readSignalOrValueModel>');
    expect(content).toContain('request<MaybeSignalModel>');
    expect(content).toContain('body: createMutationModel');
  });

  it('keeps a runtime-only global such as `Error` unrenamed', async () => {
    // `Error` is never rendered in a type position, so a schema with that name
    // must keep it (widening the reserved sets would break the public API).
    expect(await readFile(join(OUTPUT_DIR, 'models', 'error.ts'), 'utf8')).toContain(
      'export interface Error {',
    );
  });

  it('re-exports the renamed declarations from the barrel', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'index.ts'), 'utf8');

    expect(content).toContain("export * from './record-model';");
    expect(content).toContain("export * from './promise-model';");
    expect(content).toContain("export * from './blob-model';");
  });
});

/**
 * `ApiHttpClient` and `ApiFetchClient` are the two transport-dependent entries
 * of `RESERVED_RESOURCE_BINDING_NAMES`: the resource template imports exactly
 * one of them. The rename must not depend on `runtime.transport` — otherwise
 * the same spec would emit a different public type name per project — so this
 * second pass runs the same fixture with the `httpClient` transport and asserts
 * the model is still renamed *and* that the template binding is not duplicated.
 */
describe('schema names that shadow globals (httpClient transport)', () => {
  beforeEach(async () => {
    await rm(HTTP_CLIENT_OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: FIXTURE,
      output: HTTP_CLIENT_OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {signalMutations: true, transport: 'httpClient'},
    });
  });

  afterEach(async () => {
    await rm(HTTP_CLIENT_OUTPUT_DIR, {recursive: true, force: true});
  });

  it('renames `ApiHttpClient` and imports it exactly once', async () => {
    const models = await readFile(join(HTTP_CLIENT_OUTPUT_DIR, 'models', 'index.ts'), 'utf8');
    const resource = await readFile(
      join(HTTP_CLIENT_OUTPUT_DIR, 'resources', 'bindings.api.ts'),
      'utf8',
    );

    expect(
      await readFile(join(HTTP_CLIENT_OUTPUT_DIR, 'models', 'api-http-client-model.ts'), 'utf8'),
    ).toContain('export interface ApiHttpClientModel {');
    // The rename is configuration-independent: `ApiFetchClient` stays renamed
    // as well, even though this pass does not import it.
    expect(
      await readFile(join(HTTP_CLIENT_OUTPUT_DIR, 'models', 'api-fetch-client-model.ts'), 'utf8'),
    ).toContain('export interface ApiFetchClientModel {');
    expect(models).toContain("export * from './api-http-client-model';");

    // One binding for `ApiHttpClient`: the template's `import {ApiHttpClient}
    // from '../api-http-client'`. A second one would be the TS2300 regression.
    expect(resource).toContain("import {ApiHttpClient} from '../api-http-client';");
    expect(countImportedBindings(resource, 'ApiHttpClient')).toBe(1);
    expect(resource).toContain('request<ApiHttpClientModel>');
    // `ApiFetchClient` is not imported by the template in this pass, so only
    // its renamed model reference remains.
    expect(countImportedBindings(resource, 'ApiFetchClient')).toBe(0);
    expect(resource).toContain('request<ApiFetchClientModel>');
  });
});
