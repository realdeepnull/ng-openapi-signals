import type {OpenAPISchema} from '../openapi';
import {formatPropertyName, typeNameFromRef, type ModelNames} from './naming';

/** Maps OpenAPI `type` values to TypeScript primitives. */
const PRIMITIVE_TYPES: Record<string, string> = {
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
  string: 'string',
};

/**
 * Convert an OpenAPI schema object to a TypeScript type string.
 *
 * Supports:
 * - `$ref` → referenced model name
 * - `enum` → inline literal union
 * - `nullable: true` (OpenAPI 3.0) and `type: [x, 'null']` (OpenAPI 3.1)
 * - `allOf` / `oneOf` / `anyOf` composition
 * - `additionalProperties` → `Record<string, T>`
 * - inline anonymous object schemas → inline TS object type literal
 * - `prefixItems` (OpenAPI 3.1) → tuple types
 * - arrays, primitives
 *
 * `names` is the document's schema-key → type-name map (see
 * {@link ModelNames}); it keeps `$ref` output identical to the emitted
 * declarations. Omit it only when rendering schema fragments that cannot
 * contain `$ref`s.
 */
export function schemaToTsType(schema: OpenAPISchema | undefined, names?: ModelNames): string {
  if (!schema) {
    return 'unknown';
  }

  // Composition keywords take precedence when there is no `type` / `enum` / `$ref`.
  if (schema.allOf) {
    const parts = schema.allOf.map((sub) => schemaToTsType(sub, names)).filter(isKnownType);
    // An empty composition (`allOf: [{}]`) must not emit an empty type — that
    // produces `export type X = ;`, which does not parse.
    return withNullable(parts.length > 0 ? parts.join(' & ') : 'unknown', schema);
  }

  if (schema.oneOf || schema.anyOf) {
    const subs = schema.oneOf ?? schema.anyOf ?? [];

    // OpenAPI 3.1 spells nullability as `anyOf: [T, {type: 'null'}]`. That
    // member renders as `unknown`, so it must be detected *before* rendering —
    // otherwise `isKnownType()` drops it and the union silently loses `null`.
    const nullMembers = subs.filter(isNullSchema).length;
    const rendered = subs
      .filter((sub) => !isNullSchema(sub))
      .map((sub) => schemaToTsType(sub, names));
    const parts = rendered.filter(isKnownType);

    // A member without any type keyword (`{}`) means "anything". Dropping it
    // would *narrow* the union: `anyOf: [{type: 'string'}, {}]` allows any
    // value, so it must stay `unknown` — not become `string`.
    const opaque = rendered.some((type) => type === 'unknown');

    if (nullMembers === 0) {
      if (parts.length === 0) {
        return 'unknown';
      }
      return withNullable(opaque ? 'unknown' : parts.join(' | '), schema);
    }

    // `anyOf: [null]` and duplicate null members collapse to a single `null`.
    if (opaque) {
      return 'unknown';
    }
    return withNullable(parts.length > 0 ? `${parts.join(' | ')} | null` : 'null', schema);
  }

  if (schema.$ref) {
    return withNullable(typeNameFromRef(schema.$ref, names), schema);
  }

  if (Array.isArray(schema.type)) {
    const types = schema.type
      .filter((type: string) => type !== 'null')
      .map((type: string) => schemaToTsType({...schema, type}, names));

    if (schema.type.includes('null')) {
      types.push('null');
    }

    return Array.from(new Set(types)).join(' | ') || 'unknown';
  }

  if (schema.enum) {
    // `enum: []` is invalid in OpenAPI but appears in the wild → `never`.
    return withNullable(
      schema.enum.map((value: unknown) => JSON.stringify(value)).join(' | ') || 'never',
      schema,
    );
  }

  switch (schema.type) {
    case 'array':
      return withNullable(arrayToTsType(schema, names), schema);

    // OpenAPI 3.1 nullable type — reachable when a schema is a bare
    // `{type: 'null'}` outside a composition.
    case 'null':
      return 'null';

    case 'integer':
    case 'number':
    case 'boolean':
    case 'string':
      if (schema.type === 'string' && schema.format === 'binary') {
        return withNullable('Blob', schema);
      }
      return withNullable(PRIMITIVE_TYPES[schema.type]!, schema);

    case 'object':
      return withNullable(objectToTsType(schema, names), schema);

    default:
      // No explicit type — try to infer from keywords.
      if (schema.properties || schema.additionalProperties) {
        return withNullable(objectToTsType(schema, names), schema);
      }

      return 'unknown';
  }
}

/** Whether a rendered type carries actual information. */
function isKnownType(type: string): boolean {
  return type !== '' && type !== 'unknown';
}

/**
 * Whether a schema only describes `null`.
 *
 * Covers the spellings that occur in the wild for OpenAPI 3.1 nullability:
 * `{type: 'null'}`, `{type: ['null']}` and `{enum: [null]}`. A `{type: 'null'}`
 * member inside `anyOf`/`oneOf` must be recognised before rendering, because
 * rendering it yields `unknown`, which the union builder then discards.
 */
export function isNullSchema(schema: OpenAPISchema | undefined): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }

  if (schema.type === 'null') {
    return true;
  }

  if (Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === 'null') {
    return true;
  }

  return Array.isArray(schema.enum) && schema.enum.length === 1 && schema.enum[0] === null;
}

/**
 * Wrap a type in `| null` when the schema is nullable.
 *
 * Handles both OpenAPI 3.0 (`nullable: true`) and OpenAPI 3.1
 * (`type: ['string', 'null']` — but that case is already split by the caller).
 */
function withNullable(type: string, schema: OpenAPISchema): string {
  if (!type || type === 'unknown') {
    return type;
  }

  if (type.endsWith(' | null') || type === 'null') {
    return type;
  }

  if (schema.nullable === true) {
    return `${type} | null`;
  }

  return type;
}

/**
 * Convert an `array` schema to a TS type string.
 *
 * Supports:
 * - `items` as a single schema → `T[]`
 * - `prefixItems` (OpenAPI 3.1) → tuple `[A, B, C]`
 */
function arrayToTsType(schema: OpenAPISchema, names?: ModelNames): string {
  if (schema.prefixItems) {
    const tuple = schema.prefixItems.map((sub) => schemaToTsType(sub, names)).join(', ');
    return `[${tuple}]`;
  }

  const inner = schemaToTsType(schema.items, names);
  // Wrap unions/intersections in parentheses so `[]` binds to the whole type,
  // not just the last member (e.g. `('A' | 'B' | 'C')[]` instead of `'A' | 'B' | 'C'[]`).
  const wrapped = / \| | & /.test(inner) && !inner.startsWith('(') ? `(${inner})` : inner;
  return `${wrapped}[]`;
}

/**
 * Convert an `object` schema to a TS type string.
 *
 * Supports:
 * - `properties` + `required` → inline object type literal
 * - `additionalProperties: { schema }` → `Record<string, T>`
 * - `additionalProperties: true` → `Record<string, unknown>`
 * - empty object → `Record<string, unknown>`
 */
function objectToTsType(schema: OpenAPISchema, names?: ModelNames): string {
  const properties = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);
  const propertyNames = Object.keys(properties);

  // Build the declared members first: a schema may combine `properties` with
  // `additionalProperties` (a typed map with known keys). Dropping the named
  // members in favour of a bare `Record` would lose information.
  const members = propertyNames
    .map((name) => {
      const optional = required.has(name) ? '' : '?';
      const type = schemaToTsType(properties[name], names);
      return `${formatPropertyName(name)}${optional}: ${type}`;
    })
    .join('; ');

  const additionalProperties = schema.additionalProperties;

  // `additionalProperties: false` → closed object, only the declared members.
  if (additionalProperties === false) {
    return propertyNames.length === 0 ? 'Record<string, never>' : `{ ${members} }`;
  }

  if (additionalProperties && typeof additionalProperties === 'object') {
    const valueType = schemaToTsType(additionalProperties, names);
    const record = `Record<string, ${valueType}>`;

    // Index signatures must encompass the declared property types; combining
    // both is unsound for heterogeneous objects, so a pure map (no declared
    // properties) stays a plain `Record`.
    return propertyNames.length === 0 ? record : `{ ${members} } & ${record}`;
  }

  // `additionalProperties: true` allows arbitrary extra keys. Declared members
  // must stay visible, so the open record is intersected with the members
  // rather than replacing them.
  if (additionalProperties === true && propertyNames.length > 0) {
    return `{ ${members} } & Record<string, unknown>`;
  }

  // No properties and additionalProperties: true (or unspecified) → open record
  if (propertyNames.length === 0) {
    return 'Record<string, unknown>';
  }

  return `{ ${members} }`;
}
