import type {SchemaModel} from './types';
import {
  formatPropertyName,
  kebabCase,
  sanitizeTypeName,
  uniqueFileName,
  uniqueIdentifier,
} from './naming';
import {schemaToTsType} from './schema-to-ts';
import type {OpenApiDocument} from './document';
import type {OpenAPISchema} from '../openapi';

export function extractSchemas(api: OpenApiDocument): SchemaModel[] {
  const schemas = api.components?.schemas ?? {};

  // Schema names are free-form and may not be valid identifiers (`200Response`,
  // `foo/bar`). Sanitize consistently so the emitted declaration, the file
  // name and every `$ref`-derived type name agree. Distinct keys can normalize
  // to the same identifier (`A/B` and `A B`), which would emit two declarations
  // with the same name — deduplicate them.
  const usedNames = new Set<string>();

  return Object.entries(schemas).map(([name, schema]) => {
    return extractSchemaModel(
      uniqueIdentifier(sanitizeTypeName(name, 'InlineSchema'), usedNames),
      schema,
    );
  });
}

function extractSchemaModel(name: string, schema: OpenAPISchema): SchemaModel {
  // Enum schema → named union type
  if (schema.enum) {
    const enumNames = schema['x-enumNames'] ?? schema['x-enum-varnames'];
    return {
      name,
      kind: 'enum',
      properties: [],
      values: schema.enum as (string | number)[],
      ...(enumNames ? {enumNames} : {}),
    };
  }

  // Composition-only schemas (allOf/oneOf/anyOf) without properties → type alias
  if (!schema.properties && (schema.allOf || schema.oneOf || schema.anyOf)) {
    return {
      name,
      kind: 'alias',
      properties: [],
      aliasType: schemaToTsType(schema),
    };
  }

  // Primitive type alias (string/integer/number/boolean without properties/enum)
  if (schema.type && schema.type !== 'object' && !schema.properties && !schema.enum) {
    return {
      name,
      kind: 'alias',
      properties: [],
      aliasType: schemaToTsType(schema),
    };
  }

  // Object schema with only `additionalProperties` (no properties) → type alias
  // `Record<string, T>`. Without this the generator would emit an empty interface
  // (e.g. `export interface RecordResponse {}`), silently dropping the value
  // type and, for a schema named `Object`, shadowing the global `Object` type.
  // `properties: {}` (empty, truthy) counts as "no properties" — NestJS specs
  // frequently declare `{type: object, properties: {}}`.
  if (
    schema.type === 'object' &&
    Object.keys(schema.properties ?? {}).length === 0 &&
    schema.additionalProperties !== undefined
  ) {
    return {
      name,
      kind: 'alias',
      properties: [],
      aliasType: schemaToTsType(schema),
    };
  }

  // Bare `type: object` (no/empty `properties`, no `additionalProperties`) → type
  // alias `Record<string, unknown>`. Consistent with `objectToTsType()` (inline
  // path) and avoids empty interfaces like `export interface Object {}` that
  // shadow the global `Object` type when the schema is literally named `Object`.
  if (
    schema.type === 'object' &&
    Object.keys(schema.properties ?? {}).length === 0 &&
    schema.additionalProperties === undefined
  ) {
    return {
      name,
      kind: 'alias',
      properties: [],
      aliasType: 'Record<string, unknown>',
    };
  }

  // Object schema → interface
  const required = new Set<string>(schema.required ?? []);
  const properties = schema.properties ?? {};

  return {
    name,
    kind: 'interface',
    properties: Object.entries(properties).map(([propertyName, propertySchema]) => ({
      name: propertyName,
      type: schemaToTsType(propertySchema),
      required: required.has(propertyName),
    })),
  };
}

export function generateModelFiles(schemas: SchemaModel[]): Record<string, string> {
  const files: Record<string, string> = {};
  const schemaNames = new Set(schemas.map((s) => s.name));
  const usedFileNames = new Set<string>();
  const exports: string[] = [];

  for (const schema of schemas) {
    // Sanitized names can collide (`User` / `user` → both `user`) and file
    // systems are case-insensitive. Deduplicate rather than silently
    // overwriting a previously generated model file.
    const fileName = uniqueFileName(kebabCase(schema.name), usedFileNames, 'model');

    if (schema.kind === 'enum') {
      files[`models/${fileName}.ts`] = generateEnumType(schema, schemaNames);
    } else if (schema.kind === 'alias') {
      files[`models/${fileName}.ts`] = generateAliasType(schema, schemaNames);
    } else {
      files[`models/${fileName}.ts`] = generateInterface(schema, schemaNames);
    }

    exports.push(`export * from './${fileName}';`);
  }

  files['models/index.ts'] = exports.join('\n') + '\n';

  return files;
}

function generateEnumType(schema: SchemaModel, allSchemaNames: Set<string>): string {
  // An empty `enum: []` would emit `export type X = ;` — invalid TypeScript.
  const values = (schema.values ?? []).map((v) => JSON.stringify(v)).join(' | ') || 'never';
  const imports = collectModelImportsForType(values, allSchemaNames, schema.name);

  return `${imports}export type ${schema.name} = ${values};
`;
}

function generateAliasType(schema: SchemaModel, allSchemaNames: Set<string>): string {
  const aliasType = schema.aliasType || 'unknown';
  const imports = collectModelImportsForType(aliasType, allSchemaNames, schema.name);

  return `${imports}export type ${schema.name} = ${aliasType};
`;
}

function generateInterface(schema: SchemaModel, allSchemaNames: Set<string>): string {
  const properties = schema.properties
    .map((property) => {
      const optional = property.required ? '' : '?';
      return `  ${formatPropertyName(property.name)}${optional}: ${property.type};`;
    })
    .join('\n');

  const imports = collectModelImportsForSchema(schema, allSchemaNames);

  return `${imports}export interface ${schema.name} {
${properties}
}
`;
}

function collectModelImportsForSchema(schema: SchemaModel, allSchemaNames: Set<string>): string {
  const types = new Set<string>();

  for (const property of schema.properties) {
    collectType(property.type, types, allSchemaNames);
  }

  // Don't import yourself
  types.delete(schema.name);

  if (types.size === 0) {
    return '';
  }

  return `import { ${Array.from(types).sort().join(', ')} } from './index';\n\n`;
}

function collectModelImportsForType(
  type: string,
  allSchemaNames: Set<string>,
  selfName: string,
): string {
  const types = new Set<string>();
  collectType(type, types, allSchemaNames);
  types.delete(selfName);

  if (types.size === 0) {
    return '';
  }

  return `import { ${Array.from(types).sort().join(', ')} } from './index';\n\n`;
}

export function collectType(type: string, output: Set<string>, schemaNames: Set<string>): void {
  if (!type) {
    return;
  }

  // Unwrap a single surrounding pair of parentheses so that array-of-union
  // types like `('A' | 'B' | 'C')[]` are recursed into correctly: strip `[]`
  // first → `('A' | 'B' | 'C')` → unwrap parens → union split branch.
  if (type.startsWith('(') && type.endsWith(')')) {
    type = type.slice(1, -1);
  }

  if (type.endsWith('[]')) {
    collectType(type.slice(0, -2), output, schemaNames);
    return;
  }

  if (type.startsWith('Record<string, ') && type.endsWith('>')) {
    const inner = type.slice('Record<string, '.length, -1);
    collectType(inner, output, schemaNames);
    return;
  }

  if (type.includes(' | ') || type.includes(' & ')) {
    for (const part of type.split(/[ |&]+/)) {
      collectType(part.trim(), output, schemaNames);
    }
    return;
  }

  if (type.startsWith('"') || type.startsWith("'")) {
    return;
  }

  if (schemaNames.has(type)) {
    output.add(type);
  }
}
