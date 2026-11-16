const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const LEADING_DIGIT = /^[0-9]/;

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
 */
const RESERVED_TYPE_NAMES = new Set([
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
  // A valid interface name, but `export type as = …` does not parse.
  'as',
]);

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
 */
export function sanitizeTypeName(value: string, fallback = 'Generated'): string {
  if (isIdentifier(value) && !isReservedTypeName(value)) {
    return value;
  }
  return toPascalIdentifier(value, fallback);
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
