import type {SchemaModel} from './types';
import {
  buildModelNames,
  formatPropertyName,
  kebabCase,
  uniqueFileName,
  type ModelNames,
} from './naming';
import {schemaToTsType} from './schema-to-ts';
import {collectModelReferences} from './model-refs';
import type {OpenApiDocument} from './document';
import type {OpenAPISchema} from '../openapi';

export function extractSchemas(api: OpenApiDocument, names?: ModelNames): SchemaModel[] {
  const schemas = api.components?.schemas ?? {};

  // Schema names are free-form and may not be valid identifiers (`200Response`),
  // reserved words (`default`) or may normalize to the same identifier
  // (`A/B` and `A B`). The names are resolved once by `buildModelNames` so the
  // emitted declaration, the file name and every `$ref`-derived type name agree.
  const resolved = names ?? buildModelNames(Object.keys(schemas));

  return Object.entries(schemas).map(([name, schema]) => {
    return extractSchemaModel(resolved.get(name)!, schema, resolved);
  });
}

function extractSchemaModel(name: string, schema: OpenAPISchema, names: ModelNames): SchemaModel {
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
      aliasType: schemaToTsType(schema, names),
    };
  }

  // Primitive type alias (string/integer/number/boolean without properties/enum)
  if (schema.type && schema.type !== 'object' && !schema.properties && !schema.enum) {
    return {
      name,
      kind: 'alias',
      properties: [],
      aliasType: schemaToTsType(schema, names),
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
      aliasType: schemaToTsType(schema, names),
    };
  }

  // Object schema that declares `additionalProperties` *or* is nullable → type
  // alias, so the members, the index signature/closed-object semantics and
  // `| null` are all rendered by the single `objectToTsType()` /
  // `withNullable()` implementation: `{ id?: string } & Record<string, number>`,
  // `{ … } & Record<string, unknown>` for `additionalProperties: true`, `{ … }`
  // for `false`, and `{ id?: string } | null` for `nullable: true` /
  // `type: [object, 'null']`.
  //
  // The nullability test is deliberately *not* gated on `properties` being
  // non-empty: `{type: object, nullable: true, properties: {}}` and
  // `{type: [object, 'null'], properties: {}}` are the same object shape as a
  // bare `type: object` and must render `Record<string, unknown> | null`, not
  // the bare record and not `export interface X {}`. The type-array spelling
  // would otherwise fall into the interface branch below, losing both the
  // `| null` and the map semantics.
  //
  // Rendering these as an interface would silently drop both the
  // `additionalProperties` index signature and the nullability (the interface
  // branch only renders `properties`). The interface branch stays reachable
  // for the common non-nullable object case, whose output must not change.
  if (
    isObjectLike(schema) &&
    (schema.additionalProperties !== undefined || isNullableSchema(schema))
  ) {
    return {
      name,
      kind: 'alias',
      properties: [],
      aliasType: schemaToTsType(schema, names),
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
      type: schemaToTsType(propertySchema, names),
      required: required.has(propertyName),
    })),
  };
}

/**
 * Whether the schema declares itself nullable through a *type keyword*.
 *
 * Covers the OpenAPI 3.0 spelling (`nullable: true`) and the OpenAPI 3.1 type
 * array (`type: [..., 'null']`).
 *
 * Composition nullability (`oneOf`/`anyOf` with a null member) is deliberately
 * not consulted here: this predicate is only used for object-like schemas, and
 * {@link isObjectLike} returns `false` for every composition, so a
 * `oneOf`/`anyOf` clause would be unreachable. Compositions render `| null`
 * themselves in `schemaToTsType()`.
 */
function isNullableSchema(schema: OpenAPISchema): boolean {
  if (schema.nullable === true) {
    return true;
  }

  return Array.isArray(schema.type) && schema.type.includes('null');
}

/**
 * Whether the schema describes an object, including the OpenAPI 3.1 spelling
 * `type: ['object', 'null']` and schemas that only declare `properties` /
 * `additionalProperties` without a `type`.
 *
 * Compositions are excluded: they render their own intersection, so
 * `objectToTsType()` is not reached for them and their precedence must stay
 * unchanged.
 */
function isObjectLike(schema: OpenAPISchema): boolean {
  if (schema.$ref || schema.allOf || schema.oneOf || schema.anyOf) {
    return false;
  }

  return (
    schema.type === undefined ||
    schema.type === 'object' ||
    (Array.isArray(schema.type) && schema.type.includes('object'))
  );
}

export function generateModelFiles(schemas: SchemaModel[]): Record<string, string> {
  const files: Record<string, string> = {};
  const usedFileNames = new Set<string>();
  const exports: string[] = [];

  // `models/index.ts` is the barrel this function writes below; a schema named
  // `Index` must not claim that file name, or the barrel overwrites it.
  usedFileNames.add('index');

  // Resolve every file name before rendering any file: model files import each
  // other directly (`./user` instead of the `./index` barrel), so the target
  // file name must be known while imports are rendered. Importing through the
  // barrel created a cycle per model (`x.ts` → `index.ts` → `x.ts`).
  const fileNames = new Map<string, string>();

  for (const schema of schemas) {
    // Sanitized names can collide (`User` / `user` → both `user`) and file
    // systems are case-insensitive. Deduplicate rather than silently
    // overwriting a previously generated model file.
    fileNames.set(schema.name, uniqueFileName(kebabCase(schema.name), usedFileNames, 'model'));
  }

  for (const schema of schemas) {
    const fileName = fileNames.get(schema.name)!;

    if (schema.kind === 'enum') {
      files[`models/${fileName}.ts`] = generateEnumType(schema, fileNames);
    } else if (schema.kind === 'alias') {
      files[`models/${fileName}.ts`] = generateAliasType(schema, fileNames);
    } else {
      files[`models/${fileName}.ts`] = generateInterface(schema, fileNames);
    }

    exports.push(`export * from './${fileName}';`);
  }

  // A barrel with no exports is only comments, which is not a module — the
  // root `index.ts` re-exports from it and `tsc` then fails with TS2306
  // ("File ... is not a module"). Specs without any schema are valid, so emit
  // an explicit empty module instead.
  files['models/index.ts'] = exports.length > 0 ? exports.join('\n') + '\n' : 'export {};\n';

  return files;
}

function generateEnumType(schema: SchemaModel, modelFiles: ReadonlyMap<string, string>): string {
  // An empty `enum: []` would emit `export type X = ;` — invalid TypeScript.
  const values = (schema.values ?? []).map((v) => JSON.stringify(v)).join(' | ') || 'never';
  const imports = collectModelImportsForType(values, modelFiles, schema.name);

  return `${imports}export type ${schema.name} = ${values};
`;
}

function generateAliasType(schema: SchemaModel, modelFiles: ReadonlyMap<string, string>): string {
  const aliasType = schema.aliasType || 'unknown';
  const imports = collectModelImportsForType(aliasType, modelFiles, schema.name);

  return `${imports}export type ${schema.name} = ${aliasType};
`;
}

function generateInterface(schema: SchemaModel, modelFiles: ReadonlyMap<string, string>): string {
  const properties = schema.properties
    .map((property) => {
      const optional = property.required ? '' : '?';
      return `  ${formatPropertyName(property.name)}${optional}: ${property.type};`;
    })
    .join('\n');

  const imports = collectModelImportsForSchema(schema, modelFiles);

  return `${imports}export interface ${schema.name} {
${properties}
}
`;
}

/**
 * Renders a `import type` statement for the model files a type expression
 * references, grouped by target file.
 *
 * Model imports are always type-only (every model is an `interface` or a `type`
 * alias), which keeps `verbatimModuleSyntax` happy and removes the import
 * entirely at compile time. Importing from the target file rather than
 * `./index` also removes the cycle between the model file and the barrel.
 */
function renderModelImports(
  typeNames: Set<string>,
  modelFiles: ReadonlyMap<string, string>,
): string {
  if (typeNames.size === 0) {
    return '';
  }

  const byFile = new Map<string, string[]>();

  for (const name of Array.from(typeNames).sort()) {
    const file = modelFiles.get(name);

    // `typeNameFromRef()` falls back to a sanitized name for references that
    // are not in this document; such a symbol has no local file to import.
    if (!file) {
      continue;
    }

    const names = byFile.get(file) ?? [];
    names.push(name);
    byFile.set(file, names);
  }

  if (byFile.size === 0) {
    return '';
  }

  return (
    Array.from(byFile.entries())
      // Code-unit order, not `localeCompare()`: generated output must be
      // deterministic and must not depend on the host locale.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([file, names]) => `import type { ${names.join(', ')} } from './${file}';\n`)
      .join('') + '\n'
  );
}

function collectModelImportsForSchema(
  schema: SchemaModel,
  modelFiles: ReadonlyMap<string, string>,
): string {
  const types = new Set<string>();

  for (const property of schema.properties) {
    collectType(property.type, types, new Set(modelFiles.keys()));
  }

  // Don't import yourself
  types.delete(schema.name);

  return renderModelImports(types, modelFiles);
}

function collectModelImportsForType(
  type: string,
  modelFiles: ReadonlyMap<string, string>,
  selfName: string,
): string {
  const referenced = new Set<string>();

  collectType(type, referenced, new Set(modelFiles.keys()));

  referenced.delete(selfName);

  return renderModelImports(referenced, modelFiles);
}

/**
 * Collects the declared model names a rendered type expression references.
 *
 * Delegates to {@link collectModelReferences} so the model files and the
 * resource files cannot drift apart again.
 */
function collectType(type: string, output: Set<string>, schemaNames: Set<string>): void {
  collectModelReferences(type, schemaNames, output);
}
