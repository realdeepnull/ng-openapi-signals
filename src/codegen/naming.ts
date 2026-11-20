const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const LEADING_DIGIT = /^[0-9]/;

/*
 * Rename sets — one decision, four disjoint rationales.
 *
 * Every set below answers a different question about a *legal* schema name, and
 * each is fixed by the same mechanism (`Model` suffix inside `buildModelNames`),
 * so a declaration and every `$ref` to it agree:
 *
 * 1. `RESERVED_TYPE_NAMES` — **syntax**. The declaration itself does not parse
 *    (`export interface default {}`, TS1214/TS2457).
 * 2. `RESERVED_GLOBAL_TYPE_NAMES` — **module binding, global namespace**. The
 *    declaration is fine, but it shadows a built-in type that a module importing
 *    it also emits (`Record<…>`, `Promise<T>`, `AbortSignal`).
 * 3. `RESERVED_RESOURCE_BINDING_NAMES` — **module binding, sibling import**. The
 *    declaration is fine, but the resource template already binds that
 *    identifier by name (`import {Service} from '@angular/core'`).
 * 4. `RESERVED_ROOT_EXPORT_NAMES` — **root barrel**. The declaration is fine and
 *    no single module binds it twice, but the generated root `index.ts`
 *    re-exports both the runtime module and `./models`, so the name is exported
 *    twice (TS2308).
 *
 * The last two are both "module bindings" but in different scopes: set 3 is
 * per-file, set 4 is document-wide at the package entry point. A name may
 * legitimately appear in several sets (`MaybeSignal`, `Mutation`, …); each
 * membership is documented at its own definition and the union is applied once,
 * in `sanitizeTypeName()` → `avoidModuleBindingShadow()` — a single rename path,
 * not one function per set.
 */

/**
 * Words that cannot name a type declaration.
 *
 * Component keys are legal OpenAPI (`^[a-zA-Z0-9\.\-_]+$`), so `default` is a
 * valid schema name — but `export interface default {}` is a parse error, and
 * `export type as = string` fails as well.
 *
 * These words stay valid as *property* and *member* names (`params.default`,
 * `{default?: string}` both compile), so this set is deliberately not folded
 * into {@link isIdentifier}: only declaration-level sanitizers consult it.
 *
 * Membership is limited to names for which the declarations the generator
 * emits (`export interface X {}`, `export type X = …`) are a syntax error.
 * Renaming a legal schema name would be a needless breaking change to the
 * generated public API, so names that only act as operators in *type position*
 * are deliberately not listed: `export interface keyof {}` and
 * `export type readonly = string` are legal (checked with `tsc`), as are
 * `infer`, `unique`, `intrinsic`, `namespace`, `module`, `global`, `declare`,
 * `abstract`, `require`, `is`, `asserts`, `satisfies`, `override`, `using`,
 * `accessor`, `from`, `of`, `get`, `set`, `async`, `arguments` and `eval`.
 * A spec that *references* one of those names is a separate problem: the
 * reference itself does not parse, so generation fails loudly in Prettier
 * instead of silently emitting broken output.
 *
 * `type` is the one listed name whose declarations parse. It is still renamed:
 * consumers cannot import it portably (`import {type}` is read as the type-only
 * modifier under `verbatimModuleSyntax`, TS1484; `export {type}` fails under
 * `isolatedModules`, TS1205), so a schema named `type` would break the
 * package's import/export surface.
 */
const RESERVED_TYPE_NAMES = new Set([
  // ECMAScript keywords.
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  // Strict-mode future reserved words: a module (and a class body) is always
  // strict, so `export interface private {}` fails with TS1214/TS1213.
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  // Reserved at the top level of a module (TS1262).
  'await',
  // Type keywords: TypeScript rejects them as interface/type-alias names
  // (TS2427 / TS2457) although they are valid identifiers elsewhere.
  'any',
  'bigint',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'symbol',
  'undefined',
  'unknown',
  // Declaration/import modifier — see the note above.
  'type',
  // A valid interface name, but `export type as = …` does not parse.
  'as',
]);

/**
 * Global type names that a generated module **that imports models** references.
 *
 * Unlike {@link RESERVED_TYPE_NAMES} (names whose *declaration* is a syntax
 * error), these names are perfectly legal declarations — they are renamed
 * because of the *import rule*: a type expression imports a model iff it
 * references a declared model name (see `model-refs.ts`). Without a rename, a
 * schema named `Record` would be both declared and imported, and the emitted
 * `Record<…>` in the same module would then resolve to the imported declaration
 * instead of the global — silently, with a compiler error only in the specific
 * shapes listed below:
 *
 * - `export type Record = Record<string, string>` is a circular alias (TS2456)
 *   and `{ … } & Record<string, X>` then fails with TS2315 ("Type 'Record' is
 *   not generic"). Model files (`models/*.ts`) emit `Record<…>`.
 * - A resource file that imports a `Promise`/`Blob`/`ReadableStream`/
 *   `Uint8Array`/`AbortSignal` declaration shadows the global in that module,
 *   so the emitted `Promise<T>`, `Blob`, `ReadableStream<Uint8Array>` and
 *   `AbortSignal` annotations stop resolving to the built-in types
 *   (TS2315/TS2740). `resources/*.api.ts` emits all of those.
 *
 * The criterion is therefore *not* "a global the generator mentions anywhere"
 * but "a **type** global referenced by `models/*.ts` or `resources/*.api.ts`",
 * because those are the only generated modules that import models and can
 * therefore be shadowed by a model declaration. Globals that appear only in the
 * runtime modules — which never import models — keep their old, unsuffixed
 * model names: `Partial`/`Readonly`/`Pick`/`Omit`/`Required`/`Exclude`/
 * `Extract`/`NonNullable`/`Map`/`Set`/`WeakMap`/`WeakSet`/`Date`/`Error`/
 * `Function`/`Symbol`/`RegExp`/`URL`/`JSON`/`Math`/`Request`/`Response`/
 * `Headers`/`FormData`/`URLSearchParams`/`Array`. `ReadonlyArray` is gone as
 * well: the runtime emits `readonly T[]` (since 0.10.3). Because no generated
 * type expression emits those names, the positive import rule imports a model
 * with one of them instead of skipping it.
 *
 * `File`, `ArrayBuffer`, `FormData` and `URLSearchParams` are not listed
 * either: no generated module ever *references* them as a type (binary schemas
 * render `Blob`; there is no `arrayBuffer` parser for a schema; the runtime
 * *builds* `FormData`/`URLSearchParams` from its `formData` option), so a
 * schema with one of those names is imported normally instead of being
 * silently bound to the DOM global.
 *
 * `Object`, `String`, `Number` and `Boolean` are deliberately **not** listed:
 * they are referenced in *value* position (`String(...)` is emitted in resource
 * files — `encodeURIComponent(String(params.id))`; `Object.entries(...)` only in
 * the runtime), and an `import type` does not introduce a value binding, so it
 * cannot shadow the value namespace. This also preserves the documented
 * `export type Object = Record<string, unknown>` behaviour.
 *
 * Names are matched case-sensitively, so `record`, `blob` and `myRecord` keep
 * their spelling.
 */
const RESERVED_GLOBAL_TYPE_NAMES = new Set([
  // Emitted by the model renderer (`Record<string, T>`).
  'Record',
  // Emitted by `resources/*.api.ts`, which imports models.
  'Promise',
  'Blob',
  'ReadableStream',
  'Uint8Array',
  'AbortSignal',
]);

/**
 * Identifiers the generated `resources/*.api.ts` template binds at module
 * scope via its own `import` statements.
 *
 * This is the *second* collision class, structurally different from
 * {@link RESERVED_GLOBAL_TYPE_NAMES}: the model declaration does not shadow a
 * global, it collides with a sibling binding of the same module. Since the
 * import rule is positive (see `model-refs.ts`), a schema named `Service` is
 * imported into the resource file exactly like any other model:
 *
 * ```ts
 * import { Service, inject, resource } from '@angular/core';
 * import type { Service } from '../models';   // TS2300: duplicate identifier
 * ```
 *
 * That is invalid TypeScript, yet generation itself succeeds and Prettier
 * parses the file happily — the CLI exits 0 and the user's build fails.
 * Renaming the declaration (`Service` → `ServiceModel`) is therefore the only
 * place the conflict can be resolved, because the template's imports are not
 * negotiable.
 *
 * Membership must match the template's import block exactly (see
 * `generateService()` in `generate-api.ts`):
 *
 * - `@angular/core`: `Service`, `inject`, `resource` (the last one only for
 *   GET groups).
 * - `../api-fetch-client` / `../api-http-client`: `ApiFetchClient` /
 *   `ApiHttpClient` (one of the two, depending on `runtime.transport`).
 * - `../signal-utils`: `readSignalOrValue`, `MaybeSignal`.
 * - `../mutation-utils`: `createMutation`, `Mutation` (only when
 *   `runtime.signalMutations` is enabled). `mutation-utils.ts` is a separate
 *   module, so `signal`/`computed` are never imported here and stay unrenamed.
 *
 * The rename is applied regardless of configuration (`transport`,
 * `signalMutations`, whether the group has a GET): the declaration name must
 * not depend on generator options, otherwise the same spec would emit
 * different names in two projects. The cost is a needless `Model` suffix on a
 * name that would not have collided in that particular configuration.
 *
 * Matched case-sensitively: `service`, `APIFetchClient` and `Mutation2` keep
 * their spelling.
 */
const RESERVED_RESOURCE_BINDING_NAMES = new Set([
  'Service',
  'inject',
  'resource',
  'ApiFetchClient',
  'ApiHttpClient',
  'readSignalOrValue',
  'MaybeSignal',
  'createMutation',
  'Mutation',
]);

/**
 * Identifiers the generated **runtime modules** export, and that the generated
 * root `index.ts` therefore re-exports with `export *`.
 *
 * This is the root-barrel collision class, and it is unlike the sets above: the
 * declaration is not a syntax error, and no single generated module binds the
 * name twice. The conflict only exists at the package entry point, where every
 * runtime module is re-exported next to `./models` (see `generateIndexFile()`
 * in `generate.ts`):
 *
 * ```ts
 * export * from './providers';
 * export * from './api-error';
 * export * from './api-fetch-client';   // or './api-http-client'
 * export * from './signal-utils';
 * export * from './mutation-utils';     // only with signalMutations
 * export * from './date-utils';         // only with dateTransformer
 * export * from './models';
 * export * from './resources';
 * ```
 *
 * A schema named `ApiError` is a legal declaration and produces a valid
 * `models/api-error.ts`; the root barrel then exports `ApiError` twice — the
 * class from `./api-error` and the interface from `./models` — which is TS2308
 * ("Module './models' has already exported a member named 'ApiError'") for every
 * consumer of the generated package, while generation, Prettier and the CLI all
 * exit 0.
 *
 * Membership is the exact, exhaustive set of module-level exports of the runtime
 * templates in `src/codegen/runtime/`:
 *
 * - `providers-fetch.ts` / `providers-http-client.ts`: the eight
 *   `NG_OPENAPI_SIGNALS_*` injection tokens (`…_MIDDLEWARE` is fetch-only),
 *   `ApiAuthHook`, `ApiErrorMapper`, `ApiRequestHook`, `ApiResponseHook`,
 *   `ApiRequestContext`, `NgOpenapiSignalsOptions`, `provideNgOpenapiSignals`,
 *   and — fetch only — `ApiMiddlewareFn`, `ApiMiddleware`, `ApiMiddlewareEntry`.
 * - `api-error.ts`: `ApiError`, `ApiNetworkError`, `toApiError`,
 *   `toApiErrorFromHttpErrorResponse` (the last two are transport-specific).
 * - `api-fetch-client.ts` / `api-http-client.ts`: `QueryParamOptions`,
 *   `ApiRequestOptions`, `ApiFetchClient`, `ApiHttpClient`.
 * - `signal-utils.ts`: `MaybeSignal`, `readSignalOrValue`.
 * - `mutation-utils.ts`: `MutationStatus`, `Mutation`, `createMutation`.
 * - `date-utils.ts`: `transformDates`.
 *
 * The **union** over all configurations is used, for the same reason as
 * {@link RESERVED_RESOURCE_BINDING_NAMES}: a declaration name must not depend on
 * generator options, otherwise the same spec would emit different public type
 * names in two projects. The cost is a needless `Model` suffix on a name whose
 * module happens not to be emitted (or whose module *is* emitted but only in the
 * other transport) for a given configuration.
 *
 * The overlap with {@link RESERVED_RESOURCE_BINDING_NAMES} (`ApiFetchClient`,
 * `MaybeSignal`, `Mutation`, `readSignalOrValue`, `createMutation`) is
 * deliberate: that set records "the resource template imports this name in the
 * same module", this one records "the root barrel exports this name". Each set
 * documents one failure mode; {@link isReservedModuleBindingName} unions them.
 *
 * `serviceNameFromTag()` can never produce one of these names: it always appends
 * `Api`, so tag `ApiError` derives `ApiErrorApi`, and no runtime export ends in
 * `Api`. Resource classes are therefore disjoint from this set without
 * `uniqueResourceClassName()` having to consult it.
 *
 * Matched case-sensitively, so `apierror` and `ApiErrorModel` keep their
 * spelling.
 */
const RESERVED_ROOT_EXPORT_NAMES = new Set([
  // `providers.ts` (both transports).
  'NG_OPENAPI_SIGNALS_BASE_PATH',
  'NG_OPENAPI_SIGNALS_AUTH',
  'NG_OPENAPI_SIGNALS_DEFAULT_HEADERS',
  'NG_OPENAPI_SIGNALS_ERROR_MAPPER',
  'NG_OPENAPI_SIGNALS_REQUEST_HOOK',
  'NG_OPENAPI_SIGNALS_RESPONSE_HOOK',
  'NG_OPENAPI_SIGNALS_TIMEOUT',
  'ApiAuthHook',
  'ApiErrorMapper',
  'ApiRequestHook',
  'ApiResponseHook',
  'ApiRequestContext',
  'NgOpenapiSignalsOptions',
  'provideNgOpenapiSignals',
  // `providers.ts`, fetch transport only.
  'NG_OPENAPI_SIGNALS_MIDDLEWARE',
  'ApiMiddlewareFn',
  'ApiMiddleware',
  'ApiMiddlewareEntry',
  // `api-error.ts`.
  'ApiError',
  'ApiNetworkError',
  'toApiError',
  'toApiErrorFromHttpErrorResponse',
  // `api-fetch-client.ts` / `api-http-client.ts`.
  'QueryParamOptions',
  'ApiRequestOptions',
  'ApiFetchClient',
  'ApiHttpClient',
  // `signal-utils.ts`.
  'MaybeSignal',
  'readSignalOrValue',
  // `mutation-utils.ts` (`signalMutations` only).
  'MutationStatus',
  'Mutation',
  'createMutation',
  // `date-utils.ts` (`dateTransformer` only).
  'transformDates',
]);

/**
 * Whether `value` already names a generated binding that would collide with the
 * declaration: a global type the generated code references, an identifier the
 * resource template imports, or a name the root barrel re-exports from a runtime
 * module.
 *
 * All three sets are consulted here, so declarations, file names and `$ref`s
 * share one decision.
 */
function isReservedModuleBindingName(value: string): boolean {
  return (
    RESERVED_GLOBAL_TYPE_NAMES.has(value) ||
    RESERVED_RESOURCE_BINDING_NAMES.has(value) ||
    RESERVED_ROOT_EXPORT_NAMES.has(value)
  );
}

/**
 * Deterministic rename for a declaration whose name is already taken elsewhere
 * in the generated tree — a global type the generated code references, an
 * identifier the resource template imports, or a runtime export the root barrel
 * re-exports.
 *
 * One mechanism covers all three sets: a single `Model` suffix (`Record` →
 * `RecordModel`, `Service` → `ServiceModel`, `ApiError` → `ApiErrorModel`),
 * chosen because it is readable and never produces the original name.
 * `buildModelNames()` still runs the result through `uniqueIdentifier()`, so a
 * spec that also declares `RecordModel` de-duplicates to `RecordModel2` in
 * declaration order.
 */
function avoidModuleBindingShadow(name: string): string {
  return isReservedModuleBindingName(name) ? `${name}Model` : name;
}

/** Whether `value` is a valid, unquoted TypeScript identifier. */
export function isIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

/** Whether `value` is a reserved word and therefore unusable as a type name. */
export function isReservedTypeName(value: string): boolean {
  return RESERVED_TYPE_NAMES.has(value);
}

/**
 * Schema key → emitted type name mapping.
 *
 * Sanitizing and de-duplicating names happens once, in
 * {@link buildModelNames}; every `$ref` is then resolved through the same map.
 * Re-deriving the name from the reference would bypass de-duplication and
 * silently bind a `$ref` to the wrong declaration (`200Response` resolving to
 * `_200Response` when both `_200Response` and `200Response` exist).
 */
export type ModelNames = ReadonlyMap<string, string>;

/** Builds the schema-key → type-name map for a document's `components.schemas`. */
export function buildModelNames(schemaKeys: Iterable<string>): ModelNames {
  const used = new Set<string>();
  const names = new Map<string, string>();

  for (const key of schemaKeys) {
    names.set(key, uniqueIdentifier(sanitizeTypeName(key, 'InlineSchema'), used));
  }

  return names;
}

export function pascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function camelCase(value: string): string {
  const pascal = pascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function kebabCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');
}

/**
 * Coerces `value` into a valid TypeScript identifier (`PascalCase`).
 *
 * Names coming from an OpenAPI document are not guaranteed to be valid
 * identifiers: they may start with a digit (`200Response`), contain only
 * symbols, or be empty. Without sanitizing, the generated code would not
 * compile (or Prettier would fail while formatting it).
 */
export function toPascalIdentifier(value: string, fallback = 'Generated'): string {
  const safe = pascalCase(value) || fallback;
  return LEADING_DIGIT.test(safe) ? `_${safe}` : safe;
}

/** Coerces `value` into a valid `camelCase` TypeScript identifier. */
export function toCamelIdentifier(value: string, fallback = 'generated'): string {
  const safe = camelCase(value) || fallback;
  return LEADING_DIGIT.test(safe) ? `_${safe}` : safe;
}

export function serviceNameFromTag(tag: string): string {
  // Tags name a group, not an exported identifier: the class name is
  // synthesized (`users` → `UsersApi`), so PascalCase normalization is intended.
  return `${toPascalIdentifier(tag, 'Default')}Api`;
}

/**
 * Renders a property name for an object type or interface literal.
 *
 * Quoted when the name is not a valid identifier (e.g. a header parameter
 * `X-Request-Id` or a schema property `@type`), otherwise returned as-is.
 */
export function formatPropertyName(name: string): string {
  return isIdentifier(name) ? name : JSON.stringify(name);
}

/** Renders a property access expression (`params.name` / `params['X-Id']`). */
export function formatPropertyAccess(target: string, name: string): string {
  return isIdentifier(name) ? `${target}.${name}` : `${target}[${JSON.stringify(name)}]`;
}

/**
 * Returns `value` unchanged when it is already a valid TypeScript identifier,
 * otherwise coerces it into one.
 *
 * Names coming from an OpenAPI document are user-facing API surface: a valid
 * `operationId` such as `UsersController_rangeUsers` must be preserved
 * verbatim, while an invalid one (`get-users`, `200Response`) would not
 * compile and has to be sanitized.
 */
export function sanitizeIdentifier(value: string, fallback = 'generated'): string {
  return isIdentifier(value) ? value : toCamelIdentifier(value, fallback);
}

/**
 * Same contract as {@link sanitizeIdentifier}, using `PascalCase` for the
 * fallback — used for type names, where PascalCase is conventional.
 *
 * Reserved words are renamed as well: they pass the identifier regex but
 * cannot name a declaration (`default` → `Default`, `as` → `As`).
 *
 * Legal identifiers are then checked against the three generated-name collision
 * sets and suffixed when the name is already taken somewhere in the generated
 * tree: {@link RESERVED_GLOBAL_TYPE_NAMES} (`Record` → `RecordModel`,
 * `Blob` → `BlobModel`), {@link RESERVED_RESOURCE_BINDING_NAMES}
 * (`Service` → `ServiceModel`, `Mutation` → `MutationModel`) and
 * {@link RESERVED_ROOT_EXPORT_NAMES} (`ApiError` → `ApiErrorModel`,
 * `transformDates` → `transformDatesModel`). This happens
 * here — and only here — so every declaration and every `$ref` share one
 * rename path.
 */
export function sanitizeTypeName(value: string, fallback = 'Generated'): string {
  const name =
    isIdentifier(value) && !isReservedTypeName(value) ? value : toPascalIdentifier(value, fallback);

  return avoidModuleBindingShadow(name);
}

/**
 * Resolves a local JSON Pointer `$ref` (e.g. `#/components/schemas/User`) to a
 * TypeScript type name.
 *
 * JSON Pointer escapes (`~1` → `/`, `~0` → `~`) are decoded. When the target
 * document's {@link ModelNames} map is supplied the name is looked up there, so
 * the reference always matches the generated declaration — including names
 * that were renamed (reserved words) or de-duplicated (`200Response`).
 */
export function typeNameFromRef(ref: string, names?: ModelNames): string {
  const segment = ref.split('/').pop() ?? '';
  const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
  return names?.get(decoded) ?? sanitizeTypeName(decoded, 'InlineSchema');
}

/**
 * Returns `base` or the first free `${base}2`, `${base}3`, … variant and
 * records the result in `used` (compared case-sensitively).
 *
 * Used for generated member names, where duplicates would produce duplicate
 * declarations in the same class/interface.
 */
export function uniqueIdentifier(
  base: string,
  used: Set<string>,
  fallback = 'generated',
): string {
  const safe = base || fallback;

  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }

  let counter = 2;
  while (used.has(`${safe}${counter}`)) {
    counter++;
  }

  const candidate = `${safe}${counter}`;
  used.add(candidate);
  return candidate;
}

/**
 * Returns `base` or the first free `${base}2`, `${base}3`, … variant and
 * records the result in `used` (compared case-insensitively).
 *
 * Used for generated file names: file systems on Windows and macOS are
 * case-insensitive, so `User` and `user` would map to the same file and
 * silently overwrite each other.
 */
export function uniqueFileName(base: string, used: Set<string>, fallback = 'generated'): string {
  const safe = base || fallback;

  if (!used.has(safe.toLowerCase())) {
    used.add(safe.toLowerCase());
    return safe;
  }

  let counter = 2;
  while (used.has(`${safe}${counter}`.toLowerCase())) {
    counter++;
  }

  const candidate = `${safe}${counter}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
