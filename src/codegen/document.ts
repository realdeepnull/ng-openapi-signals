import type {OpenAPISchema} from '../openapi';

/**
 * Permissive OpenAPI document shape used by the codegen.
 *
 * Only the fields the generator actually walks are declared. `openapi-types`
 * exposes a stricter discriminated union (e.g. `ReferenceObject` parameters)
 * that the traversal intentionally does not model, so a single permissive
 * shape is shared by every codegen module instead of three drifting copies.
 */
export interface OpenApiDocument {
  components?: {
    schemas?: Record<string, OpenAPISchema>;
    parameters?: Record<string, OpenApiParameter>;
    requestBodies?: Record<string, OpenApiRequestBody>;
    responses?: Record<string, OpenApiResponse>;
  };
  paths?: Record<string, OpenApiPathItem>;
}

/** A single path item (collection of operations + path-level parameters). */
export interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
  parameters?: (OpenApiParameter | OpenApiReference)[];
}

/** An operation (e.g. GET /users). */
export interface OpenApiOperation {
  operationId?: string;
  tags?: string[];
  parameters?: (OpenApiParameter | OpenApiReference)[];
  requestBody?: OpenApiRequestBody | OpenApiReference;
  responses?: Record<string, OpenApiResponse | OpenApiReference>;
}

/** A parameter (path/query/header/cookie). */
export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: OpenAPISchema;
  style?: string;
  explode?: boolean;
}

/** A response object. */
export interface OpenApiResponse {
  content?: Record<string, OpenApiContent>;
}

/** A media-type content entry. */
export interface OpenApiContent {
  schema?: OpenAPISchema;
}

/** A request body object. */
export interface OpenApiRequestBody {
  content?: Record<string, OpenApiContent>;
}

/** A local reference to a reusable component. */
export interface OpenApiReference {
  $ref: string;
}

/** Component kinds that can be referenced from an operation. */
export type ComponentKind = 'parameters' | 'requestBodies' | 'responses';

/** Whether a value is a local `$ref` object. */
export function isReference(value: unknown): value is OpenApiReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$ref' in value &&
    typeof (value as OpenApiReference).$ref === 'string'
  );
}

/** Resolves local `$ref`s (`#/components/...`) against the document. */
export type RefResolver = <T>(
  value: T | OpenApiReference | undefined,
  kind: ComponentKind,
) => T | undefined;
