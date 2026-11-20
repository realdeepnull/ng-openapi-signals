# Schema names and import rules

The generator renames models whose name collides with a global type, a binding
in the resource file, or an export of a generated runtime module — and it
imports a model exactly when the generated type expression references its name.

Back to the [configuration overview](./CONFIGURATION.md) · Overview:
[README](../README.md).

---

## Schema names that shadow globals or generated exports

A schema named after a global type that a generated module _which imports
models_ references is renamed with a `Model` suffix —
`components.schemas.Record` becomes
`export type RecordModel = Record<string, string>`, and every `$ref` follows
the rename. Without this, `Record<…>` in the same module would resolve to the
imported declaration instead of the built-in (TS2315 / TS2456), and a resource
file importing a model named `Promise`/`Blob`/`ReadableStream`/`Uint8Array`/
`AbortSignal` would shadow the built-in used in its own signatures.

A schema whose name matches a binding the resource file **already imports** is
renamed the same way: `Service`, `inject`, `resource` (from `@angular/core`),
`ApiFetchClient`/`ApiHttpClient`, `readSignalOrValue`, `MaybeSignal`,
`createMutation` and `Mutation`. A schema named `Service` is imported like any
other model, so without the rename the file would declare that identifier twice
— `import {Service} from '@angular/core'` and
`import type {Service} from '../models'` (TS2300) — while generation, Prettier
and the CLI all succeed.

A schema whose name matches a **module-level export of a generated runtime
module** is renamed the same way. The generated root `index.ts` re-exports
`./providers`, `./api-error`, the client, `./signal-utils` (plus
`./mutation-utils` / `./date-utils` when enabled) next to `./models`, so a
schema called `ApiError`, `ApiRequestOptions`, `MaybeSignal`, `MutationStatus`,
`transformDates`, `provideNgOpenapiSignals`, `NG_OPENAPI_SIGNALS_BASE_PATH`,
`toApiError`, … is exported twice — `error TS2308: Module './models' has
already exported a member named 'ApiError'` — for every consumer of the
package. The complete list is
`RESERVED_ROOT_EXPORT_NAMES` in `src/codegen/naming.ts`; `ApiError` becomes
`ApiErrorModel`, `transformDates` becomes `transformDatesModel`.

All three rename sets apply regardless of `transport` / `signalMutations` /
`dateTransformer`, and they are applied as the **union** over every
configuration, so declaration names never depend on generator options. They
also apply when the previous output compiled: a schema using one of these
names is renamed even if no collision occurred in that particular tree.
Declaration names are document-global, so making the rename depend on which
module happens to be emitted (or which group happens to import a model) would
emit a different public type for the same spec depending on unrelated
configuration.

The global rename set is exactly six names — `Record`, `Promise`, `Blob`,
`ReadableStream`, `Uint8Array`, `AbortSignal`. It is not "every global the
generator mentions": `Partial`, `Map`, `Date`, `Error`, `FormData`, `Response`
and friends only appear in the runtime modules, which never import models, so a
model with one of those names is emitted unchanged. Matching is
case-sensitive, so `record` or `MyRecord` keep their spelling. A tag-derived
service class can never collide with the runtime-export set: `serviceNameFromTag()`
always appends `Api` (`ApiError` → `ApiErrorApi`), and no runtime export ends in
`Api`.

## Which names are imported

The generator imports a model whenever a generated type expression **references
a declared model name** — that is the whole rule. The set of model names is the
resolved set of `components.schemas` declarations (after reserved-word,
global-shadow, resource-binding and runtime-export renames), so:

- keywords emitted by the renderer (`never`, `null`, `unknown`) are never
  imported;
- globals the generated modules emit (`Record`, `Promise`, `Blob`,
  `ReadableStream`, `Uint8Array`, `AbortSignal`) are never imported, because a
  declaration with one of those names is renamed first (`Record` →
  `RecordModel`);
- names the generated runtime modules export (`ApiError`, `MaybeSignal`,
  `transformDates`, …) are never imported under their unsuffixed spelling,
  because such a declaration is renamed too (`ApiError` → `ApiErrorModel`) —
  otherwise the root barrel would re-export the name twice;
- object-literal property names and enum values that happen to match a model
  name are not references and are not imported;
- references inside unions, intersections, tuples, generics, `Record<…>` and
  inline object literals are found regardless of how the type is structured.

A schema named `File`, `ArrayBuffer`, `FormData` or `URLSearchParams` keeps its
name and is imported like any other model: the generator never renders those
names as a type (`format: binary` renders `Blob`; there is no `arrayBuffer`
parser; the runtime _builds_ `FormData`/`URLSearchParams` from its `formData`
option). Leaving them unimported would silently bind the use to the DOM global.

More generation invariants: [ARCHITECTURE.md](./ARCHITECTURE.md#invariants).
