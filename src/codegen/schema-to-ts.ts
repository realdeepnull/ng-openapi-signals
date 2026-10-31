import type {OpenAPISchema} from '../openapi';
import {formatPropertyName, typeNameFromRef} from './naming';

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
 */
export function schemaToTsType(schema: OpenAPISchema | undefined): string {
  if (!schema) {
    return 'unknown';
  }

  // Composition keywords take precedence when there is no `type` / `enum` / `$ref`.
  if (schema.allOf) {
    const parts = schema.allOf.map((sub) => schemaToTsType(sub)).filter(isKnownType);
    // An empty composition (`allOf: [{}]`) must not emit an empty type — that
    // produces `export type X = ;`, which does not parse.
    return withNullable(parts.length > 0 ? parts.join(' & ') : 'unknown', schema);
  }

  if (schema.oneOf || schema.anyOf) {
    const subs = schema.oneOf ?? schema.anyOf ?? [];
    const parts = subs.map((sub) => schemaToTsType(sub)).filter(isKnownType);
    return withNullable(parts.length > 0 ? parts.join(' | ') : 'unknown', schema);
  }

  if (schema.$ref) {
    return withNullable(typeNameFromRef(schema.$ref), schema);
  }

  if (Array.isArray(schema.type)) {
    const types = schema.type
      .filter((type: string) => type !== 'null')
      .map((type: string) => schemaToTsType({...schema, type}));

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
      return withNullable(arrayToTsType(schema), schema);

    case 'integer':
    case 'number':
    case 'boolean':
    case 'string':
      if (schema.type === 'string' && schema.format === 'binary') {
        return withNullable('Blob', schema);
      }
      return withNullable(PRIMITIVE_TYPES[schema.type]!, schema);

    case 'object':
      return withNullable(objectToTsType(schema), schema);

    default:
      // No explicit type — try to infer from keywords.
      if (schema.properties || schema.additionalProperties) {
        return withNullable(objectToTsType(schema), schema);
      }

      return 'unknown';
  }
}

/** Whether a rendered type carries actual information. */
function isKnownType(type: string): boolean {
  return type !== '' && type !== 'unknown';
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
function arrayToTsType(schema: OpenAPISchema): string {
  if (schema.prefixItems) {
    const tuple = schema.prefixItems.map((sub) => schemaToTsType(sub)).join(', ');
    return `[${tuple}]`;
  }

  const inner = schemaToTsType(schema.items);
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
function objectToTsType(schema: OpenAPISchema): string {
  const properties = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);
  const propertyNames = Object.keys(properties);

  // Build the declared members first: a schema may combine `properties` with
  // `additionalProperties` (a typed map with known keys). Dropping the named
  // members in favour of a bare `Record` would lose information.
  const members = propertyNames
    .map((name) => {
      const optional = required.has(name) ? '' : '?';
      const type = schemaToTsType(properties[name]);
      return `${formatPropertyName(name)}${optional}: ${type}`;
    })
    .join('; ');

  const additionalProperties = schema.additionalProperties;

  // `additionalProperties: false` → closed object, only the declared members.
  if (additionalProperties === false) {
    return propertyNames.length === 0 ? 'Record<string, never>' : `{ ${members} }`;
  }

  if (additionalProperties && typeof additionalProperties === 'object') {
    const valueType = schemaToTsType(additionalProperties);
    const record = `Record<string, ${valueType}>`;

    // Index signatures must encompass the declared property types; combining
    // both is unsound for heterogeneous objects, so a pure map (no declared
    // properties) stays a plain `Record`.
    return propertyNames.length === 0 ? record : `{ ${members} } & ${record}`;
  }

  // No properties and additionalProperties: true (or unspecified) → open record
  if (propertyNames.length === 0) {
    return 'Record<string, unknown>';
  }

  return `{ ${members} }`;
}
