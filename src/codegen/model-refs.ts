/**
 * Which identifiers in a rendered type expression refer to a declared model.
 *
 * The rule is *positive*: an identifier token is a model reference iff it is
 * present in the document's resolved model-name set (the value set of
 * `ModelNames`), which is exactly the set of types `generateModelFiles()`
 * declares.
 *
 * Everything else in a type expression — keywords (`never`, `null`,
 * `unknown`), globals the renderer emits (`Record`, `Promise`, `Blob`,
 * `ReadableStream`, `Uint8Array`, `AbortSignal`), object-literal keys,
 * punctuation, and all union/intersection/tuple/generic structure — is simply
 * not in the set and is therefore not imported.
 *
 * That invariant is what makes a token scan safe, and it is maintained by
 * `RESERVED_GLOBAL_TYPE_NAMES` in `naming.ts`: every global referenced by a
 * module that imports models is renamed on declaration (`Record` →
 * `RecordModel`, `Promise` → `PromiseModel`, …), so a declared model can never
 * share a name with a global the generated code emits. A schema named `File`,
 * `FormData` or `URLSearchParams` keeps its name and is imported normally,
 * because no generated type expression ever emits those names.
 *
 * The same scan introduces a second collision class the declaration side must
 * absorb: a model whose name matches a module-scope binding the *template*
 * imports (`Service`, `Mutation`, …). `RESERVED_RESOURCE_BINDING_NAMES` renames
 * those as well; otherwise `import {Service} from '@angular/core'` and
 * `import type {Service} from '../models'` would declare the same identifier
 * twice (TS2300).
 *
 * A third class lives at the package entry point rather than inside a module:
 * the root `index.ts` re-exports every runtime module *and* `./models`, so a
 * model named like a runtime export (`ApiError`, `MaybeSignal`, …) is exported
 * twice (TS2308). `RESERVED_ROOT_EXPORT_NAMES` renames those on declaration.
 * The token scan itself is unaffected — those names are simply never model
 * names.
 *
 * A token scan is deliberately preferred over a recursive parse: splitting on
 * `|` / `&` / spaces breaks on object literals (`{ user?: User } | null` splits
 * into `{`, `user?:`, `User`, `}`), and a parser is far more machinery for the
 * same answer.
 */

/** Matches a single- or double-quoted string-literal type (`'active'`). */
const STRING_LITERAL_TYPE = /'[^'\\]*(?:\\.[^'\\]*)*'|"(?:[^"\\]|\\.)*"/g;

/**
 * Matches an object-literal member name: an identifier (or quoted string)
 * after `{`, `,`, `;` or `[`, followed by `?:` or `:`.
 *
 * A member key is not a type reference. `{ User?: string }` declares a property
 * named `User`; it does not reference a model of that name, and importing it
 * would be an unused import (TS6133 under `noUnusedLocals`). The `[` prefix
 * covers index signatures (`{ [key: string]: User }`).
 */
const OBJECT_MEMBER_NAME =
  /([{,;[])\s*(?:[A-Za-z_$][A-Za-z0-9_$]*|"(?:[^"\\]|\\.)*"|'[^'\\]*(?:\\.[^'\\]*)*')\s*\??\s*:/g;

/** Matches one TypeScript identifier. */
const IDENTIFIER_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Adds every declared model name referenced by `type` to `output`.
 *
 * Quoted regions are removed first (a string-literal *type* like `'active'` is
 * a value, not a reference to a model named `active`), then object-literal
 * member names, so only identifiers in type position reach the scan.
 */
export function collectModelReferences(
  type: string,
  modelNames: ReadonlySet<string>,
  output: Set<string>,
): void {
  if (!type) {
    return;
  }

  const typeTokens = type.replace(STRING_LITERAL_TYPE, ' ').replace(OBJECT_MEMBER_NAME, '$1');

  for (const token of typeTokens.match(IDENTIFIER_TOKEN) ?? []) {
    if (modelNames.has(token)) {
      output.add(token);
    }
  }
}
