# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Dependency updates**: `@apidevtools/swagger-parser` 13 (pulls JSON Schema Ref Parser 16 — ESM-only, RFC 6901 pointer encoding, prototype-pollution fix), `vitest` 5, `tsdown` 0.23, `publint` 0.3.25, plus minor bumps for `eslint`, `knip`, `globals`, `tsx`, `prettier`, `@types/node` and `typescript-eslint`. No API or generated-output changes.
- **Node.js 22.19 or newer required** (`engines: >=22.19.0`) — previously 22.0.0, mandated by `@apidevtools/swagger-parser@13`.

## [0.10.1] - 2026-09-02

### Fixed

- **Bare `type: object` schemas** (including `properties: {}`, as emitted by NestJS) now emit `Record<string, unknown>` instead of an empty interface — a schema named `Object` no longer shadows the global type.
- **`createMutation()` in-flight guards**: parallel `mutate()` calls no longer overwrite each other's state; only the latest call writes `result`/`error`/`status`. `reset()` invalidates in-flight calls.
- **Stream responses with null body**: `response.body` is `ReadableStream<Uint8Array> | null` per DOM types (null for 204/304/redirects) — the generated type and the runtime return value now reflect this honestly (`request<ReadableStream<Uint8Array> | null>`).
- **Runtime CLI flags** (`--transport`, `--default-query-style`, …) are collected into a single `runtime` object — previously they overwrote each other; only the last flag survived.
- **Double generation in `generate`** removed — ~25–30 % faster.
- **`runtime.defaultQueryStyle` / `defaultQueryExplode` / `preferContentType`** were never read by the codegen; spec-explicit values still win, configured defaults now apply otherwise.

### Changed

- **Parallel formatting and writing** via `Promise.all` — byte-identical output, test suite ~10.3 s → ~5.4 s.

### Added

- **Tests**: cli-options, query-defaults, mutation in-flight guards, bare `type: object` schemas (+ fixtures `multi-content-type.yml`, `empty-object.yml`).

## [0.10.0] - 2026-08-16

### Added

- **Resource idle-state**: `getXResource(params)` allows `params()` to return `undefined`, preserving Angular `resource()` idle-state and preventing premature HTTP requests / 401s. `params()` returns `undefined` when any **required** param resolves to `undefined`; optional-only operations always resolve. Loader's inline `params` type excludes `undefined` (`Exclude<R, undefined>`), so `params.id` stays directly accessible.
- **Class-based middleware with DI**: `NG_OPENAPI_SIGNALS_MIDDLEWARE` is now a multi-provider `InjectionToken` with factory fallback, enabling `{ provide, multi: true, useClass }` registration. Runtime emits `ApiMiddleware` interface (`handle(request, next)`) alongside `ApiMiddlewareFn`; `ApiMiddlewareEntry` is the union; `ApiFetchClient` dispatches via duck-typing. `provideNgOpenapiSignals({ middleware: [...] })` array syntax preserved as convenience wrapper.
- **Fixture-based generator tests**: Central `tests/fixtures.test.ts` dynamically discovers all `tests/fixtures/*.yml` and validates the full generated file structure (core runtime files, `models/index.ts`, `resources/index.ts` re-exports, auto-generated header) for every fixture.
- **Snapshot tests for generated output**: `tests/snapshot.test.ts` generates the example output and snapshots every file, catching codegen regressions early.
- **Runtime tests for generated `ApiFetchClient`**: `tests/api-fetch-client.runtime.test.ts` imports the real generated `examples/generated/api-fetch-client.ts` and tests it via Angular DI (`createEnvironmentInjector` + `runInInjectionContext`), covering URL building, query styles, response parsing, headers, auth, middleware (function + class), error handling, hooks, FormData/binary, and date transformer integration.
- **Release checks**: Added `publint`, `@arethetypeswrong/cli`, and `knip` as devDependencies with `check:publint`, `check:attw`, `check:knip`, and combined `check:release` npm scripts. Added `.attw.json` (ESM-only profile) and `knip.json`. CI workflow extended with a `release-checks` job.

### Changed

- **`package.json` exports**: `types` condition now precedes `import` in `exports["./config"]` (publint requirement).
- **`tsconfig.json`**: Added `experimentalDecorators: true` and `examples/generated/**/*.ts` to `include` so vitest can transform the generated `@Service()` decorator.
- **Removed unused `yaml` dependency**: `@apidevtools/swagger-parser` handles YAML parsing internally; the `yaml` package was not imported anywhere.

## [0.9.0] - 2026-07-16

### Fixed

- **Robust JSON response parsing**: `parseJson` returns raw text instead of throwing `SyntaxError` when the actual `Content-Type` isn't JSON or `JSON.parse` fails.

### Added

- **Date Transformer (`runtime.dateTransformer`)**: Opt-in toggle (default `false`, CLI `--date-transformer`) that emits a `date-utils.ts` runtime file with a recursive `transformDates()` function converting ISO-8601 date-time strings in JSON response bodies to `Date` instances; wired into both `fetch` and `httpClient` transports' JSON parsing paths; added `tests/date-transform.test.ts`.
- **Signal-based mutation layer (`runtime.signalMutations`)**: Opt-in toggle (default `false`, CLI `--signal-mutations`) generating `${operationId}Mutation()` methods for POST/PUT/PATCH/DELETE that return a `Mutation` with `result`/`error`/`status`/`isLoading` signals, `mutate(body)`, and `reset()`; emits `mutation-utils.ts` runtime file; added `examples/usage/mutation-signal-usage.ts` and `mutation-signal-params-usage.ts`.
- **`extractApiErrorMessage`**: Extracts a readable message from common error body shapes — NestJS `{message | message[]}`, FastAPI `{detail | detail[]}`, Express `{errors[]}`, RFC 7807 `{title, detail}`, generic `{error}`, strings, and `HTTP <status>: <statusText>` fallback.
- Error JSON detection now matches any `*+json` content type (e.g. `application/problem+json`).

### Changed

- **`ApiError` is now a real `Error` subclass**: Previously `toApiError` returned a plain object, causing Angular's `resource()` to wrap it with _"Resource returned an error that's not an Error instance: [object Object]"_. `ApiError` now extends `Error` with a readable `message` (via `extractApiErrorMessage`) while keeping `status`, `statusText`, `body`, and `headers` fields. Applies to `fetch` and `httpClient` transports.
- `withRuntimeDefaults` preserves all runtime fields via spread; codegen conditionally emits mutation utilities — existing Promise-based methods remain (strictly additive).
- **Stream responses use `ReadableStream` type**: `text/event-stream` (and other stream responses) now generate `request<ReadableStream>` instead of `request<string>`, matching the runtime value returned by `parseBody` (`response.body`).
- **2xx responses without schema use `unknown` instead of `void`**: Non-204 success responses without a declared schema now produce `Promise<unknown>` / `resource<unknown>` so consumers can access the response body; `204 No Content` remains `void`.
- **Named schemas with `additionalProperties` generate `Record<string, T>` type aliases**: A `components.schemas` entry with `type: object` and `additionalProperties` (no `properties`) now produces `export type X = Record<string, T>` instead of an empty `interface X {}`, matching the inline-schema behavior and avoiding global `Object` shadowing.

### Tests

- `tests/config.test.ts` and `tests/generated-api.test.ts` cover `signalMutations` default, overrides, validation, generated mutation methods, and absence by default.
- `tests/stream-download.test.ts` updated to assert `request<ReadableStream>` for event-stream responses.
- Added `tests/fixtures/response-no-schema.yml` + `tests/response-no-schema.test.ts` covering 200-without-schema (`unknown`) and 204 (`void`) return types.
- Added `tests/fixtures/named-records.yml` + `tests/named-records.test.ts` covering named schemas with `additionalProperties` (`Record<string, User>` / `Record<string, unknown>` type aliases).

## [0.8.0] - 2026-07-12

### Added

- **`--dry-run` CLI mode**: Generates the client in memory and prints the file list (path + line count) without writing to disk. Useful for previewing what a spec change would produce.
- **`--check` CLI mode**: Compares the in-memory generated output against the files on disk and exits with code 1 on outdated or missing files. Stale files (on disk but no longer in the spec) are reported as warnings. Intended for CI pipelines to verify the generated client is up to date.
- **`--verbose` CLI flag**: Shows detailed progress and the full file list on success. When not set, the CLI stays compact (success/error only) for deterministic CI logs. Stack traces are only shown in verbose mode.
- **`check:example` npm script**: Runs the generator in `--check` mode against the example output — a regression check that the generated example is current.
- **`examples/usage/` snippets**: Five standalone, commented `.ts` example files covering `resource()` GET usage, promise-based mutations, auth/middleware setup, `httpClient` transport setup, and multipart file upload. Not included in the npm package.

### Changed

- **`src/generate.ts` refactored** into three pure functions: `generateFiles()` (core generation, no I/O, no Prettier), `formatFiles()` (Prettier + auto-generated header, idempotent), and `writeFiles()` (disk I/O). `generate()` is now a thin wrapper — no breaking change. `generateFiles` and `formatFiles` are exported so `--dry-run` and `--check` reuse the same code path.
- **CLI output**: The CLI now uses a minimal logger (`src/logger.ts`) writing to `stderr` with optional ANSI colors (disabled when piped). Success, warning, error and detail (verbose-only) levels are supported.
- **Error messages** in `src/openapi.ts` and `src/config.ts` `validateConfig` now include clear prefixes and context: `OpenAPI input file not found: '<path>'`, `Failed to parse OpenAPI document '<path>': <reason>` (with `cause`), and `Configuration error: ...` for all config validation failures.
- **Node.js engine requirement lowered from 24 to 22**: The `engines.node` field in `package.json`, the build target in the bundler config, and the README requirements were updated from `>=24.0.0` to `>=22.0.0`. The codebase does not use any Node 24-specific APIs.
- **Bundler migrated from `tsup` to `tsdown`**: Replaced `tsup` with `tsdown` (v0.22.5), the Rolldown-powered library bundler. The config file was renamed from `tsup.config.ts` to `tsdown.config.ts` with equivalent options. Since `tsdown` emits `.mjs`/`.d.mts` extensions for ESM output (instead of `tsup`'s `.js`/`.d.ts`), the `bin`, `exports`, and npm script paths in `package.json` were updated accordingly. Build is now significantly faster.

### Tests

- **`tests/dry-run.test.ts`**: 3 tests for `generateFiles`/`formatFiles` — non-empty file map without disk access, header added and formatted, and `formatFiles` idempotency.
- **`tests/check.test.ts`**: 6 tests for `checkFiles` — all matched, outdated, missing, stale (non-failing), missing directory, and byte-level whitespace drift.
- **`tests/error-messages.test.ts`**: 7 tests for `loadOpenApi` and `validateConfig` error messages — missing input, invalid OpenAPI, missing `paths`, and `Configuration error:` prefixes for input/output/groupBy.
- **`tests/config.test.ts`**: Updated existing `validateConfig` assertions to match the new `Configuration error:` prefixed messages.

## [0.7.1] - 2026-07-10

### Fixed

- **Array-of-enum type parenthesization**: Inline enum arrays (e.g. a property `types: array<string, enum>`) were generated as `'A' | 'B' | 'C'[]` — the `[]` bound only to the last union member instead of the whole union. `arrayToTsType` in `codegen/schema-to-ts.ts` now wraps union/intersection inner types in parentheses before appending `[]`, producing `('A' | 'B' | 'C')[]`. `collectType` in `generate-models.ts` was updated to unwrap outer parentheses during import collection so parenthesized array-of-union types are recursed into correctly. Named enum refs (`UserStatus[]`) and tuples are unaffected.
- **`default` response as fallback return type**: Operations with only a `default` response (no explicit 2xx codes) — common in NestJS-generated specs — were generated as `Promise<void>` / `request<void>`, ignoring the schema defined under `default`. `extractResponseType` in `generate-api.ts` now evaluates the `default` response's schema as a fallback when no 2xx schema is collected, so endpoints like `POST /api/v1/auth/login` resolve to their concrete DTO. Endpoints with explicit 2xx codes are unaffected — `default` is never unioned into them.
- **`body: null` serialized as `"null"`**: `prepareBody` in the fetch and httpClient runtime templates treated `null` as a defined body, producing `JSON.stringify(null)` → the string `"null"` sent with `Content-Type: application/json`. The guard is now `body !== undefined && body !== null`, so a `null` body results in no body being sent (matching the existing `formData` branch behavior).
- **Empty 200 body with JSON content-type throws**: A `200` response with `Content-Type: application/json` and an empty body caused `response.json()` to throw a `SyntaxError`. The fetch runtime now uses a `parseJson` helper that reads the body as text first, returns `undefined` for empty bodies, and only calls `JSON.parse` on non-empty text. Both the explicit `responseType: 'json'` path and the content-type sniffing fallback use this safe method.
- **`onResponse` hook consuming the body**: The `onResponse` hook received the raw `Response` before `parseBody` ran; if the hook called `await response.json()` / `.text()` / `.blob()`, the subsequent `parseBody` failed with "body already consumed." The fetch runtime now passes `response.clone()` to the hook, so consumers can safely inspect the clone's body without interfering with the runtime's body parsing. The `ApiResponseHook` docstring in both `providers-fetch.ts` and `providers-http-client.ts` was updated to document that the hook receives a clone and warn about one-shot body consumption.

### Changed

- `collectType` in `generate-models.ts` now unwraps a single surrounding pair of parentheses before recursing, so array-of-union types like `('A' | 'B' | 'C')[]` are correctly split for import collection.
- `collectType` in `generate-api.ts` now unwraps a single surrounding pair of parentheses before recursing, so parenthesized array-of-union types in response/request/param types are correctly split for import collection.
- `extractResponseType` in `generate-api.ts` now inspects the `default` response as a fallback after the 2xx loop, preserving existing behavior for mixed endpoints (2xx types are preferred; `default` is only used when no 2xx schema is found).
- `ApiFetchClient.parseBody` (fetch transport) now delegates JSON parsing to a new `parseJson` helper instead of calling `response.json()` directly.
- `ApiFetchClient.request` (fetch transport) now passes `response.clone()` to `onResponse` instead of the original response.
- `prepareBody` in both `api-fetch-client.ts` and `api-http-client.ts` runtime templates now skips `null` bodies in addition to `undefined`.
- `ApiResponseHook` docstring updated in `providers-fetch.ts` (fetch transport) and `providers-http-client.ts` (httpClient transport) to document clone semantics and body-consumption caveats.

### Tests

- **`tests/enum.test.ts`** + **`tests/fixtures/enum.yml`**: Added inline enum array property (`tags`) to `StatusResponse` and a test asserting the generated type is parenthesized `('...')[]`, not `'...'[]`.
- **`tests/status-codes.test.ts`** + **`tests/fixtures/status-codes.yml`**: Added `/default-only`, `/default-and-204`, and `/default-no-content` paths with tests for default-response fallback (default-only → DTO, default+204 → DTO, default-no-content → void).
- **`tests/api-fetch-client.test.ts`**: Added 7 tests for `body: null` handling (no body sent, no Content-Type), empty 200 body with JSON content-type (returns `undefined`, no throw), and `onResponse` clone behavior (hook receives clone, hook can consume clone body without breaking `parseBody`). Updated test-local `prepareBody`, `parseBody`, and `request` to mirror the template fixes (`body !== null`, `parseJson`, `response.clone()`).
- **`tests/api-http-client.test.ts`**: Added `body: null` test asserting no body and no Content-Type. Updated test-local `prepareBody` to mirror the `body !== null` guard.

## [0.7.0] - 2026-07-10

### Added

- **Advanced query parameter serialization**: OpenAPI parameter `style` and `explode` are now supported for query parameters. The generated code wraps non-default style params with metadata (`{ value, style, explode }`) and the runtime `buildUrl` serializes them according to the OpenAPI specification. Supported styles: `form` (default), `spaceDelimited`, `pipeDelimited`, `deepObject`, with `explode: true/false` variants.
- **Header parameter support**: OpenAPI parameters with `in: header` are now generated as method arguments and merged into the request `headers` object. Header names with hyphens (e.g. `X-Request-Id`) are properly quoted in TypeScript property names and use bracket notation for access.
- **Multipart form data support**: Request bodies with `multipart/form-data` content type are now supported. The generator emits `formData: body` instead of `body:`, and the runtime builds a `FormData` object from the typed input. `Blob` values (binary parts) are appended directly without JSON serialization. The browser sets the `Content-Type` with the multipart boundary automatically.
- **`application/x-www-form-urlencoded` support**: Request bodies with `application/x-www-form-urlencoded` content type are serialized as `URLSearchParams` by the runtime.
- **File upload support**: Binary request body parts (`format: binary`) are typed as `Blob` and passed through without JSON serialization. Custom content types (e.g. `application/octet-stream`) are supported via the `contentType` field in `ApiRequestOptions`.
- **File download and stream support**: `text/event-stream` responses now map to `responseType: 'stream'`. The fetch transport returns `response.body` (`ReadableStream`); the httpClient transport maps `'stream'` to `'blob'` (Angular `HttpClient` has no native stream — call `.stream()` on the returned `Blob`).
- **Custom content types**: The generator emits a `contentType` field in `ApiRequestOptions` for non-JSON request bodies. The runtime uses this to set the `Content-Type` header and skips `JSON.stringify` for `FormData`, `Blob`, `ArrayBuffer`, and `URLSearchParams` bodies.
- **`RequestBodyModel` and `MultipartPartModel` types**: New types in `codegen/types.ts` capture request body content type, multipart metadata, and part schemas.
- **`QueryStyle` type**: New type in `codegen/types.ts` for OpenAPI parameter serialization styles.
- **`QueryParamOptions` interface**: Generated runtime interface for wrapping query param values with style/explode metadata.
- **Config options**: `RuntimeConfig` extended with `defaultQueryStyle` (default `'form'`), `defaultQueryExplode` (default `true`), and `preferContentType` (default `'application/json'`).
- **CLI flags**: `--default-query-style`, `--default-query-explode`, `--prefer-content-type` added to the CLI.
- **`isQueryStyle` type guard**: Exported from `config.ts` for validating the `defaultQueryStyle` option.
- **Test fixtures**: Added `tests/fixtures/query-styles.yml`, `tests/fixtures/multipart-upload.yml`, `tests/fixtures/header-params.yml`, `tests/fixtures/stream-download.yml`.
- **Tests**: Added `tests/query-styles.test.ts`, `tests/multipart.test.ts`, `tests/header-params.test.ts`, `tests/stream-download.test.ts`. Extended `tests/api-fetch-client.test.ts` and `tests/api-http-client.test.ts` with query style serialization, FormData/Blob body handling, and stream response tests. Extended `tests/config.test.ts` with new runtime config tests and `isQueryStyle` guard.
- **Example endpoints**: Added `searchUsersByTags` (spaceDelimited query + header param), `uploadUserAvatar` (multipart upload), `getUserEvents` (SSE stream) to `examples/openapi.json` and `examples/openapi.yml`.

### Changed

- `ParameterModel.location` type extended from `'path' | 'query'` to `'path' | 'query' | 'header'`. Cookie parameters are intentionally not supported.
- `ParameterModel` now includes optional `style` and `explode` fields.
- `OperationModel` now includes `headerParams`, `requestBody` (`RequestBodyModel`), and `responseParser` supports `'stream'`. The `requestBodyType` field is kept for backward compatibility.
- `extractRequestBody` replaces `extractRequestBodyType` in `generate-api.ts`, returning a `RequestBodyModel` with content type and multipart metadata.
- `toParameterModel` in `generate-api.ts` now parses `style` and `explode` from the OpenAPI parameter object.
- `generateQueryExpression` wraps non-default style params with `{ value, style, explode }` metadata; default style params remain plain values for backward compatibility.
- `generateMutationMethod` emits `formData: body` and `contentType:` for multipart/formUrlencoded request bodies.
- `generateResourceMethod` and `generateMutationMethod` now include header parameters in the params type and generate a `headers` object expression.
- `parserForContentType` in `generate-api.ts` now checks `text/event-stream` before the `text/` prefix to map to `'stream'`.
- `ApiRequestOptions` (both transports) extended with `formData`, `contentType`, and `'stream'` responseType.
- `buildUrl` (both `ApiFetchClient` and `ApiHttpClient`) rewritten to support OpenAPI style/explode serialization via `appendQueryParam` method.
- `ApiFetchClient.request` and `ApiHttpClient.request` now use `prepareBody` to handle `FormData`, `Blob`, `ArrayBuffer`, `URLSearchParams`, and custom content types.
- `ApiHttpClient.mapResponseType` now maps `'stream'` to `'blob'`.
- `DEFAULT_RUNTIME_CONFIG` extended with `defaultQueryStyle`, `defaultQueryExplode`, `preferContentType`.
- `mergeRuntime` and `validateConfig` in `config.ts` handle the new runtime config fields.

### Backwards Compatibility

- Without any new configuration, the generated runtime behaves identically to 0.6.x: query params use default `form` + `explode: true` (plain values, no metadata wrapper), request bodies are JSON-serialized with `Content-Type: application/json`, and no `formData`/`contentType` fields are emitted.
- Existing OpenAPI specs without `style`/`explode` on parameters, without `multipart/form-data` request bodies, and without header parameters produce identical generated output.
- The `requestBodyType` field on `OperationModel` is kept for backward compatibility (delegates to `requestBody.type`).
- The runtime codegen refactor is internal only — no generated output, CLI, or config changes.

### Fixed

- **Header params in mutation methods**: `generateHeaderExpression` now wraps header param values with `readSignalOrValue()` for mutation methods (POST/PUT/PATCH/DELETE). Header values passed as signals are unwrapped before being merged into the request `headers` object. GET resource methods remain unchanged (header values are already resolved in the `paramsFactory`).
- **Deprecated `statusText` in httpClient transport**: `toApiErrorFromHttpErrorResponse` no longer reads the deprecated `HttpErrorResponse.statusText` property, which Angular marks as `@deprecated` because it incorrectly remains `'OK'` with HTTP/2+. The generated `ApiError.statusText` is now set to an empty string for the `httpClient` transport; the reliable `status` (numeric status code) is preserved. The `fetch` transport is unaffected.
- **`onResponse` hook fired on error responses (fetch transport)**: The fetch transport `ApiFetchClient.request` invoked the `onResponse` hook before checking `response.ok`, causing the hook to fire on 4xx/5xx error responses. The documentation states the hook is "called after a successful response is received." The check order has been corrected: `!response.ok` is now evaluated first, and `onResponse` is only called for successful responses. The `httpClient` transport was already correct.
- **Wasted `FormData` construction in `prepareBody` (fetch transport)**: The fetch transport `prepareBody` always built a `FormData` object from `options.formData` before checking whether the content type was `application/x-www-form-urlencoded`. When the content type was form-urlencoded, the `FormData` was discarded and replaced with `URLSearchParams`. The content-type check now happens first, matching the `httpClient` transport and avoiding the wasted allocation.
- **Test fidelity gap for `stripUndefinedHeaders`**: The `api-fetch-client.test.ts` test helpers typed `headers` as `Record<string, string>` and spread values directly, while the generated runtime uses `Record<string, string | undefined>` with a `stripUndefinedHeaders` helper. The test helpers now mirror the runtime logic, ensuring optional header parameters that resolve to `undefined` are properly stripped.

## [0.6.2] - 2026-07-06

### Changed

- **`provideHttpClient()` no longer auto-included**: `provideNgOpenapiSignals()` no longer automatically includes `provideHttpClient()` when the `httpClient` transport is selected. Users must register `provideHttpClient()` themselves (e.g. `provideHttpClient(withInterceptors([...]))`) so they keep full control over interceptors and their order.

## [0.6.1] - 2026-07-06

### Fixed

- **`ApiHttpClient` type safety**: The `HttpClient.request` call in the generated httpClient transport now uses separate branches for each `responseType` (`'json'`, `'text'`, `'blob'`, `'arraybuffer'`) instead of a single call with a union type or `as any` cast. This resolves TypeScript overload errors caused by Angular's per-`responseType` overloads and preserves full type safety.

## [0.6.0] - 2026-07-06

### Added

- **HttpClient runtime transport**: An optional `httpClient` transport can be selected via `runtime.transport: 'httpClient'` in the config file or `--transport httpClient` on the CLI. When selected, the generator emits `ApiHttpClient` (wrapping Angular `HttpClient`) instead of `ApiFetchClient` (wrapping native `fetch()`). The `fetch` transport remains the default, preserving the zero-`HttpClient` guarantee.
- **`ApiHttpClient` service**: Generated `@Service()` class that wraps Angular `HttpClient`, injects the same DI tokens (`NG_OPENAPI_SIGNALS_BASE_PATH`, `NG_OPENAPI_SIGNALS_AUTH`, `NG_OPENAPI_SIGNALS_DEFAULT_HEADERS`, `NG_OPENAPI_SIGNALS_ERROR_MAPPER`, `NG_OPENAPI_SIGNALS_REQUEST_HOOK`, `NG_OPENAPI_SIGNALS_RESPONSE_HOOK`), and returns Promises via `firstValueFrom`.
- **`toApiErrorFromHttpErrorResponse`**: Generated error mapper for the httpClient transport that converts `HttpErrorResponse` to the shared `ApiError` interface.
- **`--transport` CLI flag**: New CLI option to select the HTTP transport (`fetch` or `httpClient`).
- **`isTransport` type guard**: Exported from `config.ts` for validating the `transport` option.
- **`HttpTransport` type**: Exported from `codegen/types.ts`.
- **Tests**: Added `tests/api-http-client.test.ts` with full runtime unit tests for the httpClient transport. Added transport coverage to `config.test.ts`, `generate.test.ts`, and `generated-api.test.ts`.

### Changed

- `RuntimeConfig` now includes a `transport` field (default `'fetch'`).
- `generateRuntimeFiles` branches on `transport` to emit either `api-fetch-client.ts` or `api-http-client.ts`.
- `generateApiError` branches on `transport` to emit either `toApiError` (fetch) or `toApiErrorFromHttpErrorResponse` (httpClient).
- `generateProviders` branches on `transport`: the httpClient variant omits `NG_OPENAPI_SIGNALS_MIDDLEWARE` and does not include `provideHttpClient()` (users register it themselves).
- `generateService` branches on `transport` to import and inject `ApiHttpClient` or `ApiFetchClient`.
- `generateIndexFile` branches on `transport` to export `./api-http-client` or `./api-fetch-client`.
- `mergeRuntime` and `validateConfig` now handle the `transport` field.

### Backwards Compatibility

- Without any new configuration, the generated runtime behaves identically to 0.5.x: `transport` defaults to `'fetch'`, `ApiFetchClient` is generated, and no `HttpClient` dependency is introduced.
- Existing tests continue to pass without modification.

### Migration

- To switch to the `httpClient` transport, set `runtime.transport: 'httpClient'` in your config file or pass `--transport httpClient` on the CLI.
- The httpClient transport uses Angular `HttpInterceptors` instead of fetch middleware. Configure interceptors via `provideHttpClient(withInterceptors([...]))`.
- The `NG_OPENAPI_SIGNALS_MIDDLEWARE` token is not emitted for the httpClient transport.

## [0.5.0] - 2026-07-05

### Added

- **Fetch middleware**: Onion-style middleware functions `(request, next) => Promise<Response>` can be registered via `provideNgOpenapiSignals({ middleware })`. Middleware can mutate requests, short-circuit, transform responses, or handle errors. Configured through the `NG_OPENAPI_SIGNALS_MIDDLEWARE` DI token.
- **Auth header hooks**: An optional `auth` hook (`() => Record<string, string> | Promise<...>`) merges auth headers into every request. Configured through the `NG_OPENAPI_SIGNALS_AUTH` DI token.
- **Custom default headers**: Static default headers can be set via `runtime.defaultHeaders` in the config file (baked into the `provideNgOpenapiSignals` defaults) and/or overridden at runtime via `provideNgOpenapiSignals({ defaultHeaders })`. Configured through the `NG_OPENAPI_SIGNALS_DEFAULT_HEADERS` DI token.
- **Custom error mapping**: A custom error mapper can replace the default `toApiError` via `provideNgOpenapiSignals({ errorMapper })`. Configured through the `NG_OPENAPI_SIGNALS_ERROR_MAPPER` DI token.
- **Request and response hooks**: `onRequest` and `onResponse` hooks allow pre/post-fetch interception. Configured through the `NG_OPENAPI_SIGNALS_REQUEST_HOOK` and `NG_OPENAPI_SIGNALS_RESPONSE_HOOK` DI tokens.
- **Non-JSON response parsing**: The generated `ApiFetchClient` now parses responses based on a spec-driven `responseType` hint (`'json' | 'text' | 'blob' | 'arrayBuffer'`) derived from the OpenAPI response `content` type, with content-type sniffing as a fallback.
- **`Blob`, `ArrayBuffer` and plain text responses**: OpenAPI `format: binary` schemas now map to `Blob`. Text content types map to `string`. Binary content types map to `Blob`. The runtime supports `responseType: 'arrayBuffer'` for explicit ArrayBuffer parsing.
- **`runtime` config section**: New `RuntimeConfig` (`defaultHeaders`, `responseTypeHints`) added to `GeneratorConfig` with deep-merge in `resolveConfig` and validation in `validateConfig`.
- **Fixture-based tests**: Added `tests/fixtures/response-types.yml` with a dedicated test suite for response type hints (json, text, blob, 204).

### Changed

- The generated `ApiFetchClient.request<T>` method has been refactored from a monolithic implementation into a middleware pipeline. Without middleware/hooks configured, behavior is backwards-compatible with 0.4.x.
- `extractResponseType` in `generate-api.ts` now returns both the TypeScript type and a `responseParser` hint derived from the success response content type.
- `extractSchemaFromResponse` in `generate-api.ts` now returns the content type alongside the schema.
- `schemaToTsType` now maps `format: binary` to `Blob` instead of `string`.
- Generated API methods now emit a `responseType` field in `ApiRequestOptions` when `runtime.responseTypeHints` is `true` (default).
- The generated `providers.ts` now defines six new DI tokens and the `provideNgOpenapiSignals` signature accepts the new optional options.

### Backwards Compatibility

- Without any new configuration, the generated runtime behaves identically to 0.4.x: no middleware, no auth hook, empty default headers, `toApiError` as the error mapper, and content-type sniffing for response parsing.
- Existing tests continue to pass without modification (except one assertion in `generate.test.ts` updated for the new multi-line import in `api-fetch-client.ts`).

## [0.4.0] - 2026-07-05

### Added

- **Enum generation**: Enum schemas in `components/schemas` are now extracted as named union types (`export type UserStatus = 'active' | 'invited' | 'disabled';`) with their own model files and barrel exports, instead of being inlined everywhere.
- **Nullable handling**: OpenAPI 3.0 `nullable: true` is now supported in addition to OpenAPI 3.1 `type: [x, 'null']`. Nullable properties, arrays, `$ref`s, and primitives correctly produce `T | null`.
- **Object schema composition**: `allOf` (intersection `A & B`), `oneOf`/`anyOf` (union `A | B`) are now supported in `schemaToTsType`. Composition-only schemas in `components/schemas` become type aliases.
- **Inline schema hoisting**: Anonymous inline object schemas in properties, request bodies, responses, and parameters are now automatically named (e.g. `UserAddress` from `User.address`) and hoisted to `components/schemas` before generation, producing named model files instead of `Record<string, unknown>`.
- **Record type generation**: `additionalProperties` with a typed schema now produces `Record<string, T>` instead of `Record<string, unknown>`. `additionalProperties: true` still produces `Record<string, unknown>`.
- **Tuple support**: OpenAPI 3.1 `prefixItems` produces TypeScript tuple types (`[A, B, C]`).
- **Fallback `operationId`**: Operations without `operationId` now get camelCase names derived from the HTTP method and path (e.g. `GET /users/{id}` → `getUsersById`, `POST /users` → `createUsers`), using the existing `camelCase`/`pascalCase` helpers from `naming.ts`.
- **Success response status codes**: All 2xx response codes (including OpenAPI 3.1 `2XX` ranges) are now collected and unioned (`Foo | Bar`). The dangerous fallback to `Object.values(responses)[0]` (which could pick an error response) has been removed. Content-type detection now accepts any JSON-like content type, not just `application/json`.
- **Fixture-based tests**: Added per-feature OpenAPI fixture specs under `tests/fixtures/` with dedicated test suites for enums, nullable, composition, records, inline schemas, tuples, fallback operationId, and status codes.

### Changed

- `extractSchemas` in `generate-models.ts` now dispatches on schema shape (enum / object / composition / primitive alias) instead of always generating an interface. Enum-only and primitive schemas no longer produce empty interfaces.
- `collectType` in both `generate-models.ts` and `generate-api.ts` now recognizes `Record<string, X>`, intersection types (`A & B`), tuple types (`[A, B]`), and inline object literals for import collection.
- `schemaToTsType` now handles `allOf`/`oneOf`/`anyOf`, `additionalProperties` (typed records), `prefixItems` (tuples), and inline object type literals as a fallback when hoisting is not applicable.

## [0.3.0] - 2026-07-05

### Changed

- Switched generated base URL configuration to the provider-based helper `provideNgOpenapiSignals({ basePath })`.

### BREAKING CHANGE

- The generated `API_BASE_URL` token approach has been replaced.
- Consumers must now register the base URL via `provideNgOpenapiSignals({ basePath: 'https://...' })` instead of providing `API_BASE_URL` manually.
- The `apiBaseUrlToken` config option and the `--api-base-url-token` CLI flag have been removed.

## [0.2.2] - 2026-07-05

### Fixed

- Reduced published package size by moving `prettier` from `devDependencies` to `dependencies`, so tsup externalizes it instead of bundling Prettier and all its parsers/plugins into `dist/`.
- Disabled source maps in the tsup build (`sourcemap: false`) to keep `*.js.map` files out of the published `dist/` bundle.

## [0.2.1] - 2026-07-04

### Fixed

- Fixed missing TypeScript declaration files (`.d.ts`) for the `ng-openapi-signals/config` export by enabling `dts` generation in tsup. Consumers no longer get "implicitly has an 'any' type" errors when importing the config module.
- Added `tsconfig.dts.json` to isolate the `ignoreDeprecations: "6.0"` workaround needed for tsup's internal DTS build under TypeScript 6, keeping the main `tsconfig.json` clean.

## [0.2.0] - 2026-07-04

### Added

- Added config file support via `ng-openapi-signals.config.ts` with `defineConfig()` helper.
- Added `--config <path>` CLI flag to specify a custom config file path.
- Added `--clean` / `--no-clean` CLI flags to control output directory cleaning.
- Added `--api-base-url-token <name>` CLI flag to customize the generated `InjectionToken` name.
- Added `--group-by <tag|path>` CLI flag to group generated APIs by tag or path segment.
- Added `jiti` as a runtime dependency for loading TypeScript config files.
- Added config tests covering loading, merging, validation, and defaults.
- Added generate tests for `clean: false`, custom token names, and path-based grouping.
- Added "Configuration" section to README with environment integration examples.

### Changed

- CLI flags `-i/--input` and `-o/--output` are now optional (can be provided via config file).
- CLI flags override config file values; config file values override defaults.
- `generate()` now accepts a `GeneratorConfig` object instead of `GenerateOptions`.
- `generateRuntimeFiles()` and `generateApiFiles()` now accept a `GeneratorConfig` parameter.
- The `API_BASE_URL` token name is now configurable via `config.apiBaseUrlToken`.
- API grouping can now be switched between tag-based and path-based via `config.groupBy`.
- Updated Angular Setup and `API_BASE_URL` documentation to reference environment files.
- Updated CLI options table in README with all new flags.
- Bumped CLI version to `0.2.0`.

## [0.1.2] - 2026-07-04

### Fixed

- Fixed missing model type references in generated API methods by switching from `SwaggerParser.dereference` to `SwaggerParser.bundle`, preserving `$ref` pointers so response and request body types resolve to model names (e.g. `User`) instead of `Record<string, unknown>`.
- Removed unnecessary `params: void` arguments from generated mutation methods when an operation has no path or query parameters.
- Removed `as any` casts from generated `readSignalOrValue` calls.
- Removed blank-line artifacts in generated request option objects from conditional template strings.
- Replaced unsafe `undefined as T` casts with `undefined as unknown as T` in `ApiFetchClient` for 204 and non-JSON responses.

### Changed

- Generated Angular service imports are now conditional: `resource`, `MaybeSignal` and `readSignalOrValue` are only imported when actually used.
- Generated model files now import referenced model types from `./index` when they have cross-model references.
- Empty model import lines are no longer emitted in generated API files.

### Added

- Added `tsconfig.test.json` for type-checking test files with Node and Vitest globals.
- Added generator tests verifying file output and auto-generated header.
- Added generated API tests verifying model imports, response types, method signatures and absence of `params: void` and `as any`.
- Added generated model tests verifying interface properties and re-exports.
- Added error-handling tests for `toApiError` with JSON, text, empty and missing content-type bodies.
- Added `ApiFetchClient` request logic tests for URL building, query params, 204 handling, error throwing and Content-Type headers.
- Added GitHub Actions CI workflow with lint, build, test and generated-output checks.

## [0.1.1] - 2026-07-04

### Changed

- Changed generated Angular services from `Injectable(...)` output to `Service()` output.
- Disabled declaration file generation in `tsup.config`.
- Updated README documentation.

### Added

- Added ESLint configuration.
- Added Prettier configuration.
- Added `.npmignore`.
- Added `CHANGELOG.md` to published package files.

### Chore

- Removed TypeScript 6 deprecation ignore workaround.

## [0.1.0] - 2026-07-04

### Added

- Initial MVP of `ng-openapi-signals`.
- CLI command `ng-openapi-signals generate`.
- OpenAPI 3.x JSON/YAML input.
- TypeScript model generation.
- GET endpoints as Angular `resource()` APIs.
- POST, PUT, PATCH and DELETE endpoints as Promise-based `fetch()` methods.
- Generated `ApiFetchClient`.
- Generated `API_BASE_URL` injection token.
- Support for path and query parameters.
- Support for JSON request bodies and JSON responses.
- Example OpenAPI specification under `examples/openapi.json`.
