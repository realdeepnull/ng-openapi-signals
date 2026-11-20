# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A schema named like a generated runtime export produced a duplicate export from the root `index.ts` (TS2308).** `generateIndexFile()` re-exports every runtime module next to the model and resource barrels (`export * from './providers'`, `'./api-error'`, the client, `'./signal-utils'`, `'./mutation-utils'`, `'./date-utils'`, `'./models'`, `'./resources'`). A document declaring a schema `ApiError` was therefore perfectly valid per module — `models/api-error.ts` declares `export interface ApiError`, `api-error.ts` declares `export class ApiError` — but the package entry point exported the name twice: `error TS2308: Module './api-error' has already exported a member named 'ApiError'` (or `Module './models' has already exported…`, depending on order), while generation, Prettier and the CLI all exited 0. The same held for `ApiRequestOptions`, `MaybeSignal`, `MutationStatus`, `transformDates`, `provideNgOpenapiSignals`, `NG_OPENAPI_SIGNALS_BASE_PATH`, `toApiError`, `ApiNetworkError`, `QueryParamOptions` and every other module-level export of the runtime templates. Those names are now listed in a third documented set, `RESERVED_ROOT_EXPORT_NAMES`, merged into the single declaration-name decision (`sanitizeTypeName` → `avoidModuleBindingShadow`) so the same `Model` suffix applies (`ApiError` → `ApiErrorModel`, `transformDates` → `transformDatesModel`). The set is the **union** over both transports and over `signalMutations`/`dateTransformer`, for the same reason as `RESERVED_RESOURCE_BINDING_NAMES`: a declaration name must not depend on generator options, so a name is renamed even when the module that exports it is not emitted in this configuration. Resource classes need no entry in the set — `serviceNameFromTag()` always appends `Api` (tag `ApiError` → `ApiErrorApi`) and no runtime export ends in `Api` — so the model rename alone keeps the two barrels disjoint.
- **A schema named `Index` overwrote `models/index.ts` and deleted its own declaration.** Model file names are derived from the schema name, so `Index` resolved to `index` — the barrel's own file. The declaration was written first and then replaced by the barrel, whose content was `export * from './index';`: the barrel re-exported itself and the `Index` type vanished, so every consumer failed with TS2305 ("Module '…/models' has no exported member 'Index'") while generation, Prettier and the CLI all reported success. The barrel file name is now reserved before model file names are resolved, so such a schema gets the next free name (`index2`) and the barrel exports it like any other model. The reservation can only change specs that were already broken: it affects exactly the schemas whose derived file name is `index` (`Index`, `index`, `INDEX`, `_index`, …), and in every one of those the declaration was overwritten before, so nothing that compiled changes.
- **A schema named like the derived service class produced a duplicate identifier (TS2300).** A tag `Users` makes the generator emit `export class UsersApi`; a schema with that same legal name becomes a module-scope binding too — in the group that imports it (`import type {UsersApi} from '../models'` next to `export class UsersApi`) — and two bindings of one name do not compile, while generation, Prettier and the CLI all reported success. The class-name dedupe now avoids **every** resolved model name in the document, not just the ones a group's own resource file imports, and `uniqueIdentifier()` appends its numeric suffix only on a real collision (`UsersApi` → `UsersApi2`). The constraint is document-wide for two independent reasons: `resources/index.ts` re-exports every resource class (two classes with one name are TS2308 at that barrel), and the generated root `index.ts` re-exports `./models` and `./resources` side by side. The class is renamed rather than the schema: the class name is synthesized by the generator and therefore not a public-API promise, whereas renaming the user's schema would be. Specs whose tag-derived class name matches no model name anywhere are byte-identical.
- **A schema whose name equals a resource class produced a duplicate export from the generated root `index.ts` (TS2308).** `generateIndexFile()` emits both `export * from './models';` and `export * from './resources';`. A document declaring a schema `OrdersApi` therefore exported `OrdersApi` twice as soon as some tag derived the class `OrdersApi` — `error TS2308: Module './models' has already exported a member named 'OrdersApi'`, at the package's public entry point, while generation, Prettier and the CLI all exited 0. The class-name dedupe is now seeded with the document's full set of resolved model names, so a class name is always disjoint from the model names (see the preceding entry). Because the collision is document-wide, the rename applies even when no resource file in the tree imports the colliding schema; that is intentional, since the generated root barrel is document-wide as well.
- **Schema names that collide with the resource file's own imports produced duplicate identifiers (TS2300).** A schema named `Service`, `inject`, `resource`, `ApiFetchClient`, `ApiHttpClient`, `readSignalOrValue`, `MaybeSignal`, `createMutation` or `Mutation` is a legal declaration and — under the positive import rule — is imported into `resources/*.api.ts` like any other model. The file then bound the same module-scope name twice (`import {Service, inject, resource} from '@angular/core'` next to `import type {Service} from '../models'`), which is invalid TypeScript while generation, Prettier and the CLI all reported success. Those nine names are now renamed through the same `Model` suffix path as global-shadowing names (`Service` → `ServiceModel`, `Mutation` → `MutationModel`) via a second documented set, `RESERVED_RESOURCE_BINDING_NAMES`, merged into the single declaration-name decision. The rename applies regardless of `transport`/`signalMutations`, so declaration names never depend on generator options. It also applies when the previous output compiled — a schema named `Service` is renamed even if no resource file in that particular tree ever imported it. That is intentional: a declaration name is document-global, so making the rename depend on which group happens to import a model would emit a different public type for the same spec depending on unrelated configuration.
- **`anyOf: [T, {type: 'null'}]` silently dropped nullability** (OpenAPI 3.1). The null member rendered as `unknown` and was then filtered out of the union, so `lat: {anyOf: [{type: 'number'}, {type: 'null'}]}` became `number` instead of `number | null` — a type that _excludes_ a value the backend really returns. `type: 'null'` is now a first-class type, `{enum: [null]}` is recognised as a null member, and `anyOf` with only null members yields `null`. `anyOf` + `nullable: true` still produces exactly one `| null`. Related unsoundness: a member without any type keyword (`{}`) means "anything", so `anyOf: [{type: 'string'}, {}]` now yields `unknown` instead of being narrowed to `string`.
- **Generated output did not compile with `verbatimModuleSyntax`** (TS1484). Model files, `providers.ts`, `signal-utils.ts`, `mutation-utils.ts` and the resource files imported types as values. Model imports are now `import type`, and mixed runtime imports use inline `type` modifiers (`import {createMutation, type Mutation}`).
- **Empty `models/index.ts` was not a module** (TS2306). A spec without `components.schemas` produced a barrel containing only the header comment, which `index.ts` then re-exported — `tsc` failed with "File ... is not a module". Empty barrels now emit `export {};`. Same for `resources/index.ts`.
- **`basePath` lost its last segment and threw for relative values.** `new URL(path, base)` treats the base as a _file_, so `basePath: 'https://h/api'` requested `https://h/events`; `/api` threw `Invalid URL` in every environment (and `''` threw without `document`). The base is now joined as a directory; relative bases resolve without a `document` and stay relative, so SSR no longer requests `http://localhost/...`. Fixed in both the `fetch` and `httpClient` transports.
- **`--check` reported CRLF checkouts as outdated.** A Windows checkout with `core.autocrlf=true` marked every generated file as `outdated` (exit 1) although the content was identical. Comparison is now line-ending-insensitive and reports the difference separately (`outdated (line endings only)`), which does not fail the check.
- **Generated output ignored the project's Prettier configuration.** `printWidth: 80` and `trailingComma: 'none'` were hard-coded, so a project using `100` / `'all'` had every generated file rewritten by `prettier --write` — and `--check` then reported them as outdated. The effective config is resolved from the output directory and merged over the generator defaults.
- **Network failures were not `ApiError`.** A rejected `fetch` (offline, DNS, CORS, connection reset) escaped as a raw `TypeError`, so `error instanceof ApiError` was only true for HTTP errors. Such failures now throw `ApiNetworkError` (extends `Error`, `status: 0`), while `AbortError`s and errors already thrown by middleware pass through unchanged.
- **Model files imported each other through the barrel**, creating a cycle per model (`x.ts` → `index.ts` → `x.ts`) and depending on ESM evaluation order. Model files now import each other directly (`./user` instead of `./index`); the barrel remains the public surface.
- **`httpClient` `application/x-www-form-urlencoded` bodies stringified arrays** (`1,2` instead of repeated keys), in both transports.
- **Nested objects in query parameters were sent as `[object Object]`** for every style — `form`, `spaceDelimited` and `pipeDelimited` flatten one level, `deepObject` is one level by definition. Such values now throw a `TypeError` instead of losing data silently.
- **Orphaned JSDoc block** in the generated `api-fetch-client.ts`: the `acceptForResponseType` documentation sat above `hasResponseBody`.
- **Required params read their signal twice** in the `resource()` params factory (once for the idle guard, once for the object). Each value is now read once into a local.
- **Reserved-word schema names were incomplete.** `RESERVED_TYPE_NAMES` listed only ES3 keywords plus `as`, so a schema named `interface`, `implements`, `package`, `private`, `protected`, `public`, `static` or `let` was emitted verbatim (`export interface interface {}`) and the CLI exited 0 without a warning — the generated package then failed with TS1214/TS1213. The same applied to primitive type keywords (`string`, `number`, `object`, `unknown`, …, TS2427/TS2457). Both groups are now renamed like the existing entries, and so is `type` (legal as a declaration, but `import {type}` / `export {type}` are read as the type-only modifier under `verbatimModuleSyntax` / `isolatedModules`). Otherwise only names whose _declarations_ are a syntax error are renamed: `namespace`, `module`, `declare`, `abstract`, `keyof`, `readonly`, `satisfies`, `arguments`, `eval` and friends stay verbatim (a spec that merely references a type-operator keyword still fails loudly in Prettier rather than silently emitting broken output).
- **Named schemas silently dropped `additionalProperties` next to `properties`.** `MapWithProps: {properties: {id}, additionalProperties: {type: number}}` emitted only `interface MapWithProps { id?: string }`, losing the index signature. Such schemas are now type aliases rendered by the same rule as inline object types: `{ id?: string } & Record<string, number>`, `{ id?: string } & Record<string, unknown>` for `additionalProperties: true`, and a closed `{ id?: string }` for `false`. Pure maps and bare `type: object` are unchanged.
- **Nullable named objects silently dropped `| null`.** A schema that declares `properties` _and_ itself nullable — `{type: object, nullable: true, properties: {id}}` (OAS 3.0) or `{type: [object, 'null'], properties: {id}}` (OAS 3.1) — fell through to the interface branch, which renders only `properties`, so the generated type excluded `null` the backend can return. Such schemas are now aliases rendered by the same `objectToTsType()` + `withNullable()` path as inline objects: `{ id?: string } | null` (and `({ id?: string } & Record<string, number>) | null` when combined with `additionalProperties`). Nullability expressed as a `oneOf`/`anyOf` null member still goes through the composition branch unchanged, and non-nullable object schemas without `additionalProperties` keep emitting an `interface` byte-identically.
- **Schema names that shadow a global type produced non-compiling output.** A schema named `Record`, `Promise`, `Blob`, `ReadableStream`, `Uint8Array` or `AbortSignal` was emitted verbatim: `export type Record = Record<string, string>` is a circular alias (TS2456) and `{ … } & Record<string, X>` then fails with TS2315 ("Type 'Record' is not generic"); a resource file that imports a model named `Promise`/`Blob`/`ReadableStream`/`Uint8Array`/`AbortSignal` shadows the built-in used in its own signatures (TS2315/TS2740). Those six declaration names are now suffixed with `Model` (`Record` → `RecordModel`) through the existing `buildModelNames()` map, so declarations and `$ref`s stay consistent. The set is exactly the globals referenced by the two generated module families that import models (`models/*.ts`: `Record`; `resources/*.api.ts`: `Promise`, `Blob`, `ReadableStream`, `Uint8Array`, `AbortSignal`). Every other global (`Partial`, `Map`, `Date`, `Error`, `FormData`, `Response`, …) appears only in runtime modules that never import models, so a model with one of those names keeps its previous, unsuffixed declaration name — in particular a schema named `Error` still emits `export interface Error`. Names are matched case-sensitively, so `record`, `BlobModel` and ordinary business names keep their spelling.
- **Promise mutation methods sent raw signals.** They interpolated `params.<name>` directly, so a caller passing a signal produced `/users/%5BSignal%3A%20user-42%5D%20/action` and `verbose=[Signal: true]`; only the `…Mutation()` wrapper unwrapped. The Promise method now reads every path/query/header param that the request actually uses once into `resolved_*` locals (path params without a placeholder in the path template are skipped, reusing `buildParamLocals()` for collisions) and uses them in the path, query and headers. The `…Mutation()` wrapper forwards `params` unchanged instead of unwrapping twice.
- **Same parameter name in different locations produced duplicate keys (TS2300).** OpenAPI uniqueness is `(name, in)`, so `/users/{id}` may legally declare `id` as both a path and a query parameter. The params type, the resolved params object and the loader accesses were keyed by name alone, emitting `{ id: MaybeSignal<string>; id?: MaybeSignal<string> }` and a duplicate object key — `tsc` reported TS2300/TS2687/TS2717/TS1117 while the CLI exited 0. Colliding names are now suffixed by location (`idPath`, `idQuery`, `idHeader`) in every renderer (params type, resolved object, loader annotation/accesses, mutation method and `…Mutation()` wrapper). A name that occurs once keeps its key verbatim (quoted if not an identifier), so non-colliding output and the public API are unchanged, and the `resolved_*` locals keep deduplicating on the parameter name.
- **Path-item parameters were concatenated with operation parameters.** OpenAPI lets an operation override a parameter declared on the path item (uniqueness is `(name, in)`), but both copies were emitted: `assignParamKeys()` renamed the duplicate (`idQuery2`) while the wire objects stayed keyed by `param.name`, producing a duplicate object key (TS1117) and an unused `resolved_*` local — with CLI exit 0. Path-item and operation parameters are now merged by `(name, in)` after `$ref` resolution, with the operation-level entry replacing the path-item one in place, so order and output are unchanged when nothing is overridden.
- **Unused `readSignalOrValue` import** (TS6133 under `noUnusedLocals`) in resource files whose only param-bearing operation was a mutation with path/query but no header params: the import was gated on "has params" even though only the header path called the helper. It is now emitted only when the helper is actually called, and `MaybeSignal` is imported type-only when it is merely referenced.
- **Unused `mutationBody` callback parameter** (TS6133 under `noUnusedParameters`) in `…Mutation()` wrappers for body-less operations (`DELETE` etc.). The `createMutation()` callback now names it `_mutationBody` when there is no body to forward. The same option also exposed an unused `params` parameter on Promise mutation methods whose declared params are never read (a path param without a placeholder in the path template); the parameter is now named `_params` in that case, keeping the positional signature unchanged.
- **Model-import collection used exclusion lists instead of the declared model names.** Both collectors decided "is this a model?" with a `primitives` set, prefix checks and `type.split(/[ |&]+/)`. Every gap was a silent misbinding or a Prettier crash:
  - a schema named `FormData` or `URLSearchParams` kept its name but its import was suppressed (they were in the `primitives` set), so `request<FormData>` bound to the DOM global;
  - `never` (from `enum: []` or `Record<string, never>`) was _emitted_ but not suppressed, producing `import type {never} from '../models'`, which does not compile;
  - splitting on `[ |&]+` split _spaces inside object literals_: `{ id?: string } | null` yielded `{`, `id?:`, `string`, `}` and `null`, so the resource file imported `id?:` / `}` and Prettier threw;
  - the model collector had no tuple branch, so `prefixItems: [{$ref: User}, {$ref: Tag}]` emitted `pair: [User, Tag]` without imports (TS2304).

  Both collectors now apply one positive rule (`codegen/model-refs.ts`): a type expression references a model iff one of its identifier tokens is present in the document's resolved `ModelNames` set — the same set `generateModelFiles()` declares. String-literal types and object-literal member names are removed first, so enum values and property keys named after models are not imported. Keywords, emitted globals (`Record`, `Promise`, `Blob`, `ReadableStream`, `Uint8Array`, `AbortSignal`), punctuation, tuples, generics, unions and intersections need no special cases: none of them is a declared model name, because `RESERVED_GLOBAL_TYPE_NAMES` renames those globals (`Record` → `RecordModel`). The `primitives` set, `genericBuiltin` handling, `Record<string, …>` unwrap, union/intersection splitting and tuple/`[]` branches are deleted, along with `SchemaModel.importTypes` (only needed because the old scanner could not read an object literal intersected with a `Record`). Import lists stay sorted.

### Added

- **`ApiError.retryAfterSeconds`** — parses the `Retry-After` header (seconds or HTTP date) so a 429 retry loop does not have to.
- **`ApiNetworkError`** — network-level failure type shared shape with `ApiError` (`status: 0`), so `error instanceof Error` holds for every failure mode.
- **`timeoutMs`** in `provideNgOpenapiSignals()` — aborts requests that hang (default `0`, unbounded, preserving previous behaviour). The `fetch` transport uses `AbortSignal.timeout()`; the `httpClient` transport uses Angular's native `timeout` option (it has no `signal` option — an extra `signal` property is silently dropped). Both reject with a `TimeoutError` that is not wrapped in `ApiError`, so a timeout stays distinguishable from a network failure.
- **`--fail-on-stale`** — opt-in for `--check` to exit 1 when the spec no longer produces files that exist on disk. The default stays tolerant (documented behaviour).
- **`.gitattributes`** with `* text=auto eol=lf` so checkouts stay LF.
- **Tests**: `anyOf`/`oneOf` nullability variants (required, optional, duplicate null, `nullable` combined, `enum: [null]`, opaque member), base-path matrix for both transports (absolute, trailing slash, root-relative, empty, protocol-relative, no `document`), CRLF and stale `--check` cases, `ApiNetworkError`/`AbortError`/`TimeoutError`/middleware pass-through, `Retry-After`, colliding parameter names, nested-object query rejection, and form-urlencoded array bodies. Extended for the reserved-word set (strict-mode future reserved words + `type`, `$ref`s in mutation bodies/responses, a legal contextual keyword kept verbatim), for `additionalProperties` next to `properties` (typed / `true` / `false`, pure maps, imports of referenced members), for nullable named objects (`nullable: true` and `type: [object, 'null']`, with and without `additionalProperties`; `tests/nullable.test.ts` asserts `| null` and the retained members), and for schema names that shadow globals or collide with the resource template imports (`tests/global-type-names.test.ts` + `tests/fixtures/global-type-names.yml`: `Record`/`Promise`/`Blob`/`ReadableStream` are renamed, `$ref`s bind to the renamed name, `Record<…>` stays the global, `Service`/`Mutation` are renamed and the resource file imports exactly one binding per template name, every other name in `RESERVED_RESOURCE_BINDING_NAMES` (`inject`, `resource`, `ApiFetchClient`, `ApiHttpClient`, `readSignalOrValue`, `MaybeSignal`, `createMutation`) is declared and `$ref`'d so deleting one from the set fails the suite, `Error` stays unrenamed, `File`/`ArrayBuffer`/`FormData`/`URLSearchParams` are imported rather than bound to the DOM globals, business names are untouched; `tests/model-refs.test.ts` covers escaped quotes in single- and double-quoted string-literal types), and for the positive import rule (`tests/inline-model-imports.test.ts` + `tests/fixtures/inline-model-imports.yml`: inline `never` and `Record<string, never>` produce no import, an inline OpenAPI 3.1 nullable object renders and keeps its `$ref` imports, property keys / enum values named after models are not imported; `tests/tuples.test.ts` + `tests/fixtures/tuples.yml`: a tuple of `$ref`s imports both members), and a new `tests/mutation-signal-params.test.ts` asserting that Promise mutations resolve their params and that the signal-utils import is only emitted when used, plus a new `tests/generated-name-collisions.test.ts` (`tests/fixtures/generated-name-collisions.yml`: a schema named `Index` gets `models/index2.ts` and is exported from a barrel that never re-exports itself, a schema named `UsersApi` forces the class for tag `Users` to `UsersApi2` while the model keeps its own name, and a schema named `OrdersApi` forces `OrdersApi2` although that group never imports it — the root-barrel rule is document-wide; `tests/fixtures/generated-name-collisions-unimported.yml`: the same rule for a model reachable only from another group), and a new `tests/root-barrel-exports.test.ts` (`tests/fixtures/global-type-names.yml` with `dateTransformer` enabled: `ApiError` → `ApiErrorModel`, `ApiNetworkError`, `toApiError`, `ApiRequestOptions`, `QueryParamOptions`, `transformDates`, `provideNgOpenapiSignals`, `NG_OPENAPI_SIGNALS_BASE_PATH`, `MutationStatus` and the remaining `providers` tokens/hooks are declared and `$ref`'d, the renames are asserted per file and in the barrel, and a second `httpClient`/no-optional-modules pass proves the rename does not depend on configuration; a shared `tests/helpers/barrel-exports.ts` resolves every `export *` of the generated root `index.ts` — runtime modules, `./models` and `./resources` — and asserts the exported name set is disjoint, with a control that compiles a pre-fix `ApiError`-in-both-barrels tree and asserts TS2308). A `tsc` check now compiles the generated model files (via the TypeScript compiler API) so semantic declaration errors (TS1214/TS1213, TS2427/TS2457) cannot regress behind Prettier's parser, and a second `tsc` check compiles the full generated tree (runtime + resources + models, with `noUnusedLocals`/`noUnusedParameters`) for a small set of fixtures — the colliding-parameter fixture, `additional-properties`, `mutation-signal-params`, `mutation-import-only`, `mutation-body-only`, the path-item-override fixture, `nullable`, `global-type-names` (now also with `dateTransformer`, so the root barrel contains `./date-utils`/`./mutation-utils`), `inline-model-imports`, `tuples` and `generated-name-collisions` (+ `generated-name-collisions-unimported`) — so the shapes covered there (cross-location collisions and path-item overrides: duplicate property keys TS2300/TS1117 and unused locals TS6133; global shadowing: TS2456/TS2315/TS2740; missing tuple imports: TS2304; unused imports from inline keys: TS6133; a self-exporting barrel (TS2305), a class/model name clash (TS2440/TS2395) and a class name equal to a document model (TS2308 at the root barrel)) fail loudly instead of passing green. It is a regression net for those fixtures, not a global guarantee for arbitrary specs. Both checks have a negative control asserting that the check still reports the relevant diagnostics.

### Changed

- **CI verifies generated output with `--check`** instead of `git diff --exit-code examples/generated`, which could never fail because the directory is git-ignored. The example now also matches the project's Prettier config.
- **Reserved-word schema names are renamed instead of failing generation**: `components.schemas` keys are legal OpenAPI (`^[a-zA-Z0-9\.\-_]+$`), so `default`, `class`, `enum`, `new` and friends are valid schema names — but `export interface default {}` is a parse error. Such names are now renamed the same way as any other invalid identifier (`default` → `Default`, `as` → `As`), covering the full set of names that make the emitted declarations invalid (strict-mode reserved words, primitive type keywords, `as` and `type`; see the entries above). Reserved words remain valid as _property_ and _member_ names (`params.default`, `{default?: string}`), so only declaration names are affected.
- **Global type names are suffixed with `Model`**: a schema named after a global referenced by a generated module that imports models (`Record`, `Promise`, `Blob`, `ReadableStream`, `Uint8Array`, `AbortSignal`) is a legal declaration but shadows that global in every module importing it. Such names are renamed deterministically (`Record` → `RecordModel`, …) via the same `buildModelNames()` map that resolves `$ref`s; see the entry above. A schema named `File` or `ArrayBuffer` is _not_ renamed — it is imported normally, because the generator never renders those names as a type (suppressing the import would silently bind the use to the DOM global). Business names are unaffected. The same `Model` suffix is applied to names that would collide with a binding the resource file already imports (`Service`, `inject`, `resource`, `ApiFetchClient`, `ApiHttpClient`, `readSignalOrValue`, `MaybeSignal`, `createMutation`, `Mutation`; see the `TS2300` entry above) and to names that a generated runtime module exports (`ApiError`, `ApiNetworkError`, `toApiError`, `ApiRequestOptions`, `QueryParamOptions`, `MaybeSignal`, `readSignalOrValue`, `MutationStatus`, `Mutation`, `createMutation`, `transformDates`, `provideNgOpenapiSignals`, `NG_OPENAPI_SIGNALS_*`, `Api*Hook`, `ApiErrorMapper`, `ApiRequestContext`, `NgOpenapiSignalsOptions`, `ApiMiddleware*`; see the root-barrel `TS2308` entry above).
- **`$ref` could bind to the wrong model**: sanitized names were de-duplicated per declaration (`200Response` → `_200Response2` when `_200Response` already exists), but `typeNameFromRef()` re-derived the name from the pointer and returned `_200Response` — silently selecting the wrong type. Schema names are now resolved once via `buildModelNames()` and every `$ref` goes through that map.
- **Object query parameters serialized as `[object Object]`**: `appendQueryParam()` only handled objects for `deepObject` with `explode: true`; every other combination fell through to `String(value)`. `form` (the OpenAPI default style) with `explode: true` now emits one parameter per property (`?R=100&G=200`), `explode: false` emits `key=R,100,G,200`, and `spaceDelimited` / `pipeDelimited` / `deepObject` objects are handled as well — in both the `fetch` and `httpClient` runtimes. `null`/`undefined` object properties are omitted.

## [0.10.3] - 2026-11-01

### Fixed

- **Lint errors in the generated fetch runtime**: middleware types now emit `readonly T[]` instead of `ReadonlyArray<T>` (semantically identical, but the generated `providers.ts` changes), and `toApiError()` no longer initializes its `body` variable with a needless `null`.

## [0.10.2] - 2026-10-31

### Fixed

- **Invalid identifiers from the spec**: parameter names, `operationId`s and schema names are free-form in OpenAPI, but the generator emitted them verbatim. A path parameter `{user-id}`, a query parameter `filter[name]`, an `operationId: get-users` or a schema named `200Response` produced non-compiling TypeScript (and made `generate` crash inside Prettier). Names that are already valid identifiers are preserved verbatim — `operationId: UsersController_rangeUsers` still maps to `UsersController_rangeUsersResource`, so no public API is renamed. Only invalid names are quoted (properties) or sanitized (identifiers).
- **`$ref` targets other than schemas were silently ignored**: reusable `components/parameters`, `components/requestBodies` and `components/responses` are still `$ref` objects after `SwaggerParser.bundle()`. Such operations lost all their parameters, request body and response type (returning `unknown`). They are now resolved before extraction.
- **Empty compositions and enums**: `oneOf: [{}]`, `allOf: [{}, {}]` and `enum: []` emitted `export type X = ;`, which does not parse. They now degrade to `unknown` / `never`.
- **`additionalProperties` next to `properties`**: the declared members were dropped, losing type information. The emitted type now keeps both (`{ id?: string } & Record<string, number>`), and `additionalProperties: false` yields a closed object instead of a bare `Record`.
- **JSON Pointer escapes in `$ref`**: `#/components/schemas/A~1B` produced the type name `A~1B`; escapes are now decoded (`~1` → `/`, `~0` → `~`) and sanitized consistently with the model declarations.
- **Name collisions produced invalid output**: duplicate `operationId`s emitted two methods with the same name, and tags that only differ in case (`User` / `user`) overwrote each other's file (case-insensitive file systems) while producing two identical barrel exports. Both are now deduplicated (`getUser` / `getUser2`, `user.api.ts` / `user2.api.ts`).
- **`writeFiles({clean: true})` could delete the project**: a misconfigured `output` (`.`, `..`, a drive root) was removed recursively. The generator now refuses to clean a filesystem root or any directory containing the current working directory.
- **`--clean` was never applied from the CLI**: the `--clean` / `--no-clean` pair left `clean` as `undefined` unless a flag was passed. `--clean` now defaults to `true` and `--no-clean` correctly yields `false`.
- **`--version` reported a stale hard-coded version** (`0.10.0` while `package.json` was already `0.10.1`). The version is now injected at build time from `package.json` (`tsdown` `define`).
- **Silently ignored invalid CLI values**: `--transport grpc` fell back to the file/default value, generating output the caller did not ask for. Invalid enum values and non-`true`/`false` `--default-query-explode` values now fail with a clear error.
- **`--config` pointing to a missing file was silently ignored**; it now throws. CommonJS configs (`module.exports`) are loaded correctly (previously only `export default` worked).
- **Relative `basePath` values crashed every request**: `new URL(path, '/api')` throws `Invalid URL`. Relative base paths (a dev-server proxy setup) now resolve against `document.baseURI`, and operation paths without a leading slash no longer append to the last base segment.
- **Hard-coded `Accept: application/json`** broke non-JSON endpoints: servers may answer `text/*`, `image/*` or `text/event-stream` operations with 406. The header is now derived from the response type hint, keeping `application/json` as the default when no hint exists.
- **Body-less status codes**: 205 and 304 were parsed as bodies (throwing in some runtimes); they now short-circuit to `undefined` like 204.
- **`--check` performance**: generated files are now read in parallel instead of sequentially, and symlinks/special entries in the output directory are ignored rather than followed.

### Added

- **`codegen/document.ts`** — one permissive OpenAPI document shape shared by all codegen modules (previously three drifting copies) plus a `RefResolver` for `#/components/**` references.
- **`codegen/guards.ts`** — the `GroupBy` / `HttpTransport` / `QueryStyle` type guards, so the pure codegen layer no longer has to import the CLI-facing `config.ts`.
- **Tests**: `tests/robustness.test.ts` (+ fixtures `robustness.yml`, `duplicate-operation-ids.yml`, `duplicate-tags.yml`) covering identifier sanitizing, `$ref` resolution, invalid type shapes, name collisions and `writeFiles` safety.

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
