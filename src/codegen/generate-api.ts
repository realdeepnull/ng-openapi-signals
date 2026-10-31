import type {
  GeneratorConfig,
  HttpMethod,
  MultipartPartModel,
  OperationModel,
  ParameterModel,
  QueryStyle,
  RequestBodyModel,
} from './types';
import {
  formatPropertyAccess,
  formatPropertyName,
  kebabCase,
  serviceNameFromTag,
  toCamelIdentifier,
  toPascalIdentifier,
  uniqueFileName,
  uniqueIdentifier,
} from './naming';
import {schemaToTsType} from './schema-to-ts';
import {isQueryStyle} from './guards';
import {sanitizeIdentifier} from './naming';
import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  RefResolver,
} from './document';
import {isReference} from './document';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

/** Default query style per OpenAPI spec: `form` for query/header params. */
const DEFAULT_QUERY_STYLE: QueryStyle = 'form';
/** Default explode per OpenAPI spec: `true` for `form` style query params. */
const DEFAULT_QUERY_EXPLODE = true;

export function extractOperations(
  api: OpenApiDocument,
  config?: Pick<GeneratorConfig, 'runtime'>,
): OperationModel[] {
  // Effective query serialization defaults: config override or OpenAPI defaults.
  const runtime = config?.runtime;
  const defaultQueryStyle: QueryStyle = runtime?.defaultQueryStyle ?? DEFAULT_QUERY_STYLE;
  const defaultQueryExplode: boolean = runtime?.defaultQueryExplode ?? DEFAULT_QUERY_EXPLODE;

  // `bundle()` hoists external refs into `#/components/**`, but does not
  // dereference them. Reusable parameters, request bodies and responses are
  // therefore still `$ref` objects here and must be resolved before use —
  // otherwise every such operation would silently lose its params/body/type.
  const resolve: RefResolver = (value, kind) => {
    if (!isReference(value)) {
      return value as never;
    }

    const prefix = `#/components/${kind}/`;
    if (!value.$ref.startsWith(prefix)) {
      return undefined;
    }

    const name = value.$ref.slice(prefix.length);
    return api.components?.[kind]?.[name] as never;
  };

  const operations: OperationModel[] = [];

  for (const [path, pathItem] of Object.entries(api.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];

      if (!operation) {
        continue;
      }

      const parameters = [
        ...(pathItem.parameters ?? []),
        ...(operation.parameters ?? []),
      ]
        .map((parameter) => resolve(parameter, 'parameters'))
        .filter((parameter): parameter is OpenApiParameter => parameter !== undefined);

      const pathParams = parameters
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => toParameterModel(parameter, defaultQueryStyle, defaultQueryExplode));

      const queryParams = parameters
        .filter((parameter) => parameter.in === 'query')
        .map((parameter) => toParameterModel(parameter, defaultQueryStyle, defaultQueryExplode));

      const headerParams = parameters
        .filter((parameter) => parameter.in === 'header')
        .map((parameter) => toParameterModel(parameter, defaultQueryStyle, defaultQueryExplode));

      const requestBody = extractRequestBody(
        resolve(operation.requestBody, 'requestBodies'),
        runtime?.preferContentType,
      );
      const {responseType, responseParser} = extractResponseType(operation, resolve);

      operations.push({
        operationId: sanitizeIdentifier(
          operation.operationId ?? fallbackOperationId(method, path),
          'operation',
        ),
        tag: operation.tags?.[0] ?? 'Default',
        method,
        path,
        pathParams,
        queryParams,
        headerParams,
        responseType,
        ...(responseParser ? {responseParser} : {}),
        ...(requestBody ? {requestBody} : {}),
      });
    }
  }

  return operations;
}

export function generateApiFiles(
  operations: OperationModel[],
  config: GeneratorConfig,
): Record<string, string> {
  const files: Record<string, string> = {};
  const grouped = config.groupBy === 'path' ? groupByPath(operations) : groupByTag(operations);
  const usedFileNames = new Set<string>();
  const usedClassNames = new Set<string>();
  const exportNames: string[] = [];
  const seenExports = new Set<string>();

  for (const [group, groupOperations] of Object.entries(grouped)) {
    // `kebabCase()` can collide (`User` vs `user`, or tags differing only in
    // punctuation) and returns an empty string for symbol-only tags. Both
    // the file name and the service class name must stay unique, otherwise
    // the barrel re-exports two identical members.
    const fileName = uniqueFileName(kebabCase(group), usedFileNames, 'default');
    const className = uniqueIdentifier(serviceNameFromTag(group), usedClassNames);

    files[`resources/${fileName}.api.ts`] = generateService(className, groupOperations, config);

    const exportName = `${fileName}.api`;
    if (!seenExports.has(exportName)) {
      seenExports.add(exportName);
      exportNames.push(exportName);
    }
  }

  files['resources/index.ts'] =
    exportNames.map((name) => `export * from './${name}';`).join('\n') + '\n';

  return files;
}

function generateService(
  serviceName: string,
  operations: OperationModel[],
  config: GeneratorConfig,
): string {
  const modelImports = collectModelImports(operations);
  const hasGets = operations.some((op) => op.method === 'get');
  const hasGetsWithParams = operations.some(
    (op) =>
      op.method === 'get' &&
      op.pathParams.length + op.queryParams.length + op.headerParams.length > 0,
  );
  const hasMutationsWithParams = operations.some(
    (op) =>
      op.method !== 'get' &&
      op.pathParams.length + op.queryParams.length + op.headerParams.length > 0,
  );
  const responseTypeHints = config.runtime?.responseTypeHints ?? true;
  const signalMutations = config.runtime?.signalMutations === true;
  const hasMutations = operations.some((op) => op.method !== 'get');
  const transport = config.runtime?.transport ?? 'fetch';
  const clientClassName = transport === 'httpClient' ? 'ApiHttpClient' : 'ApiFetchClient';
  const clientImportPath =
    transport === 'httpClient' ? '../api-http-client' : '../api-fetch-client';

  const angularImports = ['Service', 'inject'];
  if (hasGets) {
    angularImports.push('resource');
  }

  const signalUtilImport =
    hasGetsWithParams || hasMutationsWithParams
      ? `import { MaybeSignal, readSignalOrValue } from '../signal-utils';\n`
      : '';
  const mutationUtilImport =
    signalMutations && hasMutations
      ? `import { Mutation, createMutation } from '../mutation-utils';\n`
      : '';
  const modelImportLine = modelImports ? `${modelImports}\n` : '';

  // Duplicate `operationId`s across paths (a common hand-written-spec mistake)
  // would emit two methods with the same name — invalid TypeScript. Suffix the
  // later ones instead of failing the whole generation. Derived member names
  // (`…Resource`, `…Mutation`) are reserved as well so a later operation cannot
  // collide with them.
  const usedMethodNames = new Set<string>();
  const methodNames = operations.map((operation) => {
    const baseName = uniqueIdentifier(operation.operationId, usedMethodNames);

    if (operation.method === 'get') {
      usedMethodNames.add(`${baseName}Resource`);
    } else if (signalMutations) {
      usedMethodNames.add(`${baseName}Mutation`);
    }

    return baseName;
  });

  const methods = operations
    .map((operation, index) => {
      const methodName = methodNames[index]!;

      if (operation.method === 'get') {
        return generateResourceMethod(operation, methodName, responseTypeHints);
      }

      const promiseMethod = generateMutationMethod(operation, methodName, responseTypeHints);
      if (!signalMutations) {
        return promiseMethod;
      }

      return `${promiseMethod}\n\n${generateSignalMutationMethod(operation, methodName)}`;
    })
    .join('\n\n');

  return `import { ${angularImports.join(', ')} } from '@angular/core';
import { ${clientClassName} } from '${clientImportPath}';
${signalUtilImport}${mutationUtilImport}${modelImportLine}
@Service()
export class ${serviceName} {
  private readonly client = inject(${clientClassName});

${methods}
}
`;
}

function generateResourceMethod(
  operation: OperationModel,
  methodName: string,
  responseTypeHints: boolean,
): string {
  const hasParams =
    operation.pathParams.length + operation.queryParams.length + operation.headerParams.length > 0;
  const paramsType = generateParamsType(operation);
  const resourceParamsType = generateResolvedParamsType(operation);
  const paramsExpression = generateResourceParamsExpression(operation);
  const pathExpression = generatePathExpression(operation);
  const queryExpression = generateQueryExpression(operation);
  const headerExpression = generateHeaderExpression(operation, false);
  const paramsArg = hasParams ? `params: ${paramsType}` : '';
  const paramsFactory = hasParams
    ? `params: (): ${resourceParamsType} => (${paramsExpression}),`
    : '';

  const requestLines = [`method: '${operation.method.toUpperCase()}',`, `path: ${pathExpression},`];

  if (queryExpression) {
    requestLines.push(`query: ${queryExpression},`);
  }

  if (headerExpression) {
    requestLines.push(`headers: ${headerExpression},`);
  }

  if (responseTypeHints && operation.responseParser) {
    requestLines.push(`responseType: '${operation.responseParser}',`);
  }

  requestLines.push('signal: abortSignal');
  const requestBody = requestLines.map((line) => `          ${line}`).join('\n');

  // The loader's `params` is the resolved (non-signal) type. Angular narrows
  // `params` to `Exclude<R, undefined>` when the params factory can return
  // `undefined`, so the loader only runs with a concrete params object.
  const resolvedParamsType = generateResolvedParamsType(operation);
  const loaderParamsType = resolvedParamsType.endsWith(' | undefined')
    ? resolvedParamsType.slice(0, -' | undefined'.length)
    : resolvedParamsType;

  const loaderSignature = hasParams
    ? `loader: ({ params, abortSignal }: { params: ${loaderParamsType}; abortSignal: AbortSignal }) =>`
    : `loader: ({ abortSignal }: { abortSignal: AbortSignal }) =>`;

  return `  ${methodName}Resource(${paramsArg}) {
    return resource({
      ${paramsFactory}
      ${loaderSignature}
        this.client.request<${operation.responseType}>({
${requestBody}
        })
    });
  }`;
}

function generateResolvedParamsType(operation: OperationModel): string {
  const params = [...operation.pathParams, ...operation.queryParams, ...operation.headerParams];

  if (params.length === 0) {
    return 'undefined';
  }

  const properties = params
    .map((param) => {
      // With `exactOptionalPropertyTypes`, an optional property `q?: string`
      // does not accept `undefined` as a value. The params factory always
      // assigns every property (even optional ones) via `readSignalOrValue`,
      // which yields `T | undefined`. Append `| undefined` to optional
      // properties so the resolved type accepts an explicit `undefined` value.
      const optional = param.required ? '' : '?';
      const type = param.required ? param.type : `${param.type} | undefined`;
      const name = formatParamName(param);
      return `    ${name}${optional}: ${type};`;
    })
    .join('\n');

  // Allow `undefined` so the params factory can return `undefined` to keep
  // the resource in Angular's idle state (loader is not invoked).
  return `{
${properties}
  } | undefined`;
}

function generateMutationMethod(
  operation: OperationModel,
  methodName: string,
  responseTypeHints: boolean,
): string {
  const hasParams =
    operation.pathParams.length + operation.queryParams.length + operation.headerParams.length > 0;
  const paramsType = generateParamsType(operation);
  const bodyType = operation.requestBody?.type;
  const bodyParameter = bodyType ? `body: ${bodyType}, ` : '';
  const paramsParameter = hasParams ? `params: ${paramsType}, ` : '';
  const pathExpression = generatePathExpression(operation);
  const queryExpression = generateQueryExpression(operation);
  const headerExpression = generateHeaderExpression(operation, true);

  const requestLines = [`method: '${operation.method.toUpperCase()}',`, `path: ${pathExpression},`];

  if (queryExpression) {
    requestLines.push(`query: ${queryExpression},`);
  }

  if (headerExpression) {
    requestLines.push(`headers: ${headerExpression},`);
  }

  if (bodyType) {
    if (operation.requestBody?.isMultipart) {
      // Multipart: pass body as formData; runtime builds FormData.
      requestLines.push('formData: body,');
    } else if (operation.requestBody?.isFormUrlencoded) {
      // Form URL-encoded: pass body as formData; runtime builds URLSearchParams.
      requestLines.push('formData: body,');
    } else {
      requestLines.push('body,');
    }
  }

  // Emit contentType for non-JSON request bodies.
  if (operation.requestBody && operation.requestBody.contentType !== 'application/json') {
    requestLines.push(`contentType: ${JSON.stringify(operation.requestBody.contentType)},`);
  }

  if (responseTypeHints && operation.responseParser) {
    requestLines.push(`responseType: '${operation.responseParser}',`);
  }

  requestLines.push('signal');
  const requestBody = requestLines.map((line) => `      ${line}`).join('\n');

  return `  ${methodName}(${bodyParameter}${paramsParameter}signal?: AbortSignal): Promise<${operation.responseType}> {
    return this.client.request<${operation.responseType}>({
${requestBody}
    });
  }`;
}

/**
 * Generates a signal-based `…Mutation()` method that wraps the existing
 * Promise-based mutation method in a `createMutation()` factory, exposing
 * `result`, `error`, `status`, `isLoading` signals and a `mutate()` function.
 *
 * Path/query/header params are bound at construction time (captured in the
 * closure); the request body is passed to `mutate(body)`. The generated method
 * delegates to the Promise-based method (no request construction is duplicated)
 * and only applies when `runtime.signalMutations` is enabled. The Promise-based
 * method remains available.
 */
function generateSignalMutationMethod(operation: OperationModel, methodName: string): string {
  const hasParams =
    operation.pathParams.length + operation.queryParams.length + operation.headerParams.length > 0;
  const paramsType = generateParamsType(operation);
  const bodyType = operation.requestBody?.type;
  const paramsArg = hasParams ? `params: ${paramsType}` : '';
  const mutationBodyType = bodyType ?? 'void';

  // Build the argument list forwarded to the Promise-based method.
  // Path/query/header params are unwrapped from MaybeSignal before forwarding,
  // since the Promise method consumes plain (non-signal) values.
  const forwardedArgs: string[] = [];
  if (bodyType) {
    forwardedArgs.push('mutationBody');
  }
  if (hasParams) {
    // Mutations are triggered on demand via `mutate(body)`, so there is no
    // idle-state concern — always resolve to the concrete (non-undefined)
    // params object instead of reusing the idle-capable resource expression.
    forwardedArgs.push(generateResolvedParamsObject(operation));
  }
  forwardedArgs.push('mutationSignal');
  const forwardedCall = forwardedArgs.join(', ');

  return `  ${methodName}Mutation(${paramsArg}): Mutation<${mutationBodyType}, ${operation.responseType}> {
    return createMutation<${mutationBodyType}, ${operation.responseType}>((mutationBody, mutationSignal) =>
      this.${methodName}(${forwardedCall}),
    );
  }`;
}

function generateParamsType(operation: OperationModel): string {
  const params = [...operation.pathParams, ...operation.queryParams, ...operation.headerParams];

  if (params.length === 0) {
    return 'void';
  }

  const properties = params
    .map((param) => {
      const optional = param.required ? '' : '?';
      const name = formatParamName(param);
      return `    ${name}${optional}: MaybeSignal<${param.type}>;`;
    })
    .join('\n');

  return `{
${properties}
  }`;
}

function generateResourceParamsExpression(operation: OperationModel): string {
  const params = [...operation.pathParams, ...operation.queryParams, ...operation.headerParams];

  if (params.length === 0) {
    return 'undefined';
  }

  const requiredParams = params.filter((p) => p.required);

  // Build the resolved params object with signals unwrapped.
  const properties = params
    .map(
      (param) =>
        `        ${formatParamName(param)}: readSignalOrValue(${formatParamAccess(param)})`,
    )
    .join(',\n');

  // When all required params resolve to undefined, return undefined to keep
  // the resource in idle state (no HTTP request). This allows callers to pass
  // signal(undefined) for required params until they are ready (e.g. after
  // authentication), preventing premature 401 responses.
  if (requiredParams.length === 0) {
    // No required params — always resolve (optional params can be undefined).
    return `{
${properties}
      }`;
  }

  const requiredChecks = requiredParams
    .map((p) => `readSignalOrValue(${formatParamAccess(p)}) === undefined`)
    .join(' || ');

  return `(${requiredChecks}) ? undefined : {
${properties}
      }`;
}

/**
 * Builds a resolved (non-signal) params object literal without any idle-state
 * guard. Used by signal mutation methods to forward unwrapped params to the
 * Promise-based method, which always requires a concrete params object.
 */
function generateResolvedParamsObject(operation: OperationModel): string {
  const params = [...operation.pathParams, ...operation.queryParams, ...operation.headerParams];

  if (params.length === 0) {
    return 'undefined';
  }

  const properties = params
    .map(
      (param) =>
        `        ${formatParamName(param)}: readSignalOrValue(${formatParamAccess(param)})`,
    )
    .join(',\n');

  return `{
${properties}
      }`;
}

function generatePathExpression(operation: OperationModel): string {
  const hasParams =
    [...operation.pathParams, ...operation.queryParams, ...operation.headerParams].length > 0;

  if (!hasParams) {
    return JSON.stringify(operation.path);
  }

  // Path templating: `{id}` → `params.id`. Parameter names are looked up in the
  // model so names that are not valid identifiers (e.g. `{user-id}`) use bracket
  // notation, and the result is encoded so the URL stays well-formed.
  const byName = new Map(
    [...operation.pathParams, ...operation.queryParams, ...operation.headerParams].map((param) => [
      param.name,
      param,
    ]),
  );

  const templatePath = operation.path.replace(/\{([^}]+)\}/g, (placeholder, name: string) => {
    const param = byName.get(name);

    if (!param) {
      // Not a declared parameter — keep the literal placeholder instead of
      // emitting a reference to a non-existent property.
      return placeholder;
    }

    return `\${encodeURIComponent(String(${formatPropertyAccess('params', name)}))}`;
  });

  return '`' + templatePath + '`';
}

/**
 * Formats a parameter name for use as a TypeScript property name.
 *
 * Parameter names are free-form in OpenAPI (`X-Request-Id`, `filter[name]`,
 * `user-id`), so any name that is not a valid identifier is quoted.
 */
function formatParamName(param: ParameterModel): string {
  return formatPropertyName(param.name);
}

/** Formats a parameter access expression (`params.id` / `params['user-id']`). */
function formatParamAccess(param: ParameterModel): string {
  return formatPropertyAccess('params', param.name);
}

/**
 * Generates the query expression for the runtime client.
 *
 * Params whose resolved serialization deviates from the OpenAPI spec default
 * (`form` + `explode: true`) are wrapped with metadata:
 * `{ value: params.tags, style: 'spaceDelimited', explode: false }`.
 * Params using the spec default are passed as plain values (the runtime
 * treats them as form+explode:true).
 */
function generateQueryExpression(operation: OperationModel): string {
  if (operation.queryParams.length === 0) {
    return '';
  }

  const properties = operation.queryParams
    .map((param) => {
      // The runtime's implicit default (no metadata) is form + explode:true.
      const isRuntimeDefault = !param.style && param.explode === undefined;

      if (isRuntimeDefault) {
        return `            ${formatPropertyName(param.name)}: ${formatParamAccess(param)}`;
      }

      const style = param.style ?? DEFAULT_QUERY_STYLE;
      const explode = param.explode ?? DEFAULT_QUERY_EXPLODE;
      return `            ${formatPropertyName(param.name)}: { value: ${formatParamAccess(param)}, style: '${style}', explode: ${explode} }`;
    })
    .join(',\n');

  return `{
${properties}
          }`;
}

/**
 * Generates a headers object expression for header parameters.
 * Returns empty string if there are no header parameters.
 */
function generateHeaderExpression(operation: OperationModel, unwrapSignals = false): string {
  if (operation.headerParams.length === 0) {
    return '';
  }

  const properties = operation.headerParams
    .map((param) => {
      const access = formatParamAccess(param);
      const value = unwrapSignals ? `readSignalOrValue(${access})` : access;
      return `            ${formatPropertyName(param.name)}: ${value}`;
    })
    .join(',\n');

  return `{
${properties}
          }`;
}

function toParameterModel(
  parameter: OpenApiParameter,
  defaultQueryStyle: QueryStyle = DEFAULT_QUERY_STYLE,
  defaultQueryExplode: boolean = DEFAULT_QUERY_EXPLODE,
): ParameterModel {
  // Resolve the effective style/explode for query params: explicit spec
  // values win, otherwise the effective defaults (config override or
  // OpenAPI spec defaults) apply. The resolved values are captured in the
  // model so downstream generation sees the full effective serialization.
  const style: QueryStyle = isQueryStyle(parameter.style)
    ? parameter.style
    : defaultQueryStyle;
  const explode: boolean = parameter.explode ?? defaultQueryExplode;
  // Only query params are serialized via style/explode metadata.
  const isQuery = parameter.in === 'query';

  return {
    name: parameter.name,
    location: parameter.in as ParameterModel['location'],
    required: Boolean(parameter.required),
    type: schemaToTsType(parameter.schema),
    ...(isQuery && style !== DEFAULT_QUERY_STYLE
      ? {style}
      : {}),
    ...(isQuery && explode !== DEFAULT_QUERY_EXPLODE ? {explode} : {}),
  };
}

function extractResponseType(
  operation: OpenApiOperation,
  resolve: RefResolver,
): {
  responseType: string;
  responseParser?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
} {
  const responses = operation.responses ?? {};

  // Collect all 2xx response schemas (including 2XX range from OpenAPI 3.1).
  const successSchemas: string[] = [];
  // Tracks whether a non-204 2xx response was found that has no schema. Such
  // responses may still carry a body at runtime, so the type should be `unknown`
  // rather than `void` (which would discard the body on the type level).
  let found2xxWithoutSchema = false;
  let responseParser: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream' | undefined;

  for (const [statusCode, rawResponse] of Object.entries(responses)) {
    if (!isSuccessStatus(statusCode)) {
      continue;
    }

    const response = resolve(rawResponse, 'responses');

    if (!response) {
      continue;
    }

    const {schema, contentType} = extractSchemaFromResponse(response);

    // 204 No Content → void; skip adding to the union.
    if (statusCode === '204') {
      continue;
    }

    // Other 2xx without a schema → remember for `unknown` fallback below.
    if (!schema || schema === 'void') {
      found2xxWithoutSchema = true;

      // Use the first success response's content type to derive the parser hint.
      if (!responseParser && contentType) {
        responseParser = parserForContentType(contentType);
      }
      continue;
    }

    successSchemas.push(schema);

    // Use the first success response's content type to derive the parser hint.
    if (!responseParser && contentType) {
      responseParser = parserForContentType(contentType);
    }
  }

  // Fallback: when no explicit 2xx schema was found, use the `default` response
  // schema as the return type. Many OpenAPI specs only define a `default` response
  // with the success schema (e.g. NestJS-generated specs), so without this the
  // generator would emit `void` even though a concrete DTO is defined.
  if (successSchemas.length === 0 && responses['default']) {
    const defaultResponse = resolve(responses['default'], 'responses');
    const {schema, contentType} = defaultResponse
      ? extractSchemaFromResponse(defaultResponse)
      : {};

    if (schema && schema !== 'void') {
      successSchemas.push(schema);

      if (!responseParser && contentType) {
        responseParser = parserForContentType(contentType);
      }
    }
  }

  if (successSchemas.length === 0) {
    // A non-204 2xx response without a schema may still return a body at
    // runtime (e.g. NestJS `@ApiOkResponse()` without a schema). Use `unknown`
    // so consumers can access the body, instead of `void` which discards it.
    if (found2xxWithoutSchema) {
      return {responseType: 'unknown'};
    }
    return {responseType: 'void'};
  }

  // Deduplicate while preserving order.
  const unique = Array.from(new Set(successSchemas));

  let responseType = unique.length === 1 ? unique[0]! : unique.join(' | ');

  // Stream responses (e.g. text/event-stream) return a ReadableStream at
  // runtime, regardless of the declared schema type. Override the schema-
  // derived type so the generated client reflects the actual runtime value.
  // `response.body` is `ReadableStream<Uint8Array> | null` per DOM types —
  // it is null for responses that cannot have a body (204, 304, redirects),
  // so the generated type includes `| null` to stay honest.
  if (responseParser === 'stream') {
    responseType = 'ReadableStream<Uint8Array> | null';
  }

  return {
    responseType,
    ...(responseParser ? {responseParser} : {}),
  };
}

/** Maps an HTTP content-type to a runtime response parser hint. */
function parserForContentType(
  contentType: string,
): 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream' | undefined {
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    return 'json';
  }

  if (contentType === 'text/event-stream') {
    return 'stream';
  }

  if (contentType.startsWith('text/')) {
    return 'text';
  }

  // Binary content types → Blob by default.
  if (
    contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType === 'application/octet-stream' ||
    contentType.startsWith('multipart/')
  ) {
    return 'blob';
  }

  return undefined;
}

function isSuccessStatus(statusCode: string): boolean {
  if (statusCode === 'default') {
    return false;
  }

  // Exact 2xx codes: 200, 201, ...
  if (/^2\d\d$/.test(statusCode)) {
    return true;
  }

  // OpenAPI 3.1 range: 2XX
  if (/^2XX$/i.test(statusCode)) {
    return true;
  }

  return false;
}

function extractSchemaFromResponse(response: OpenApiResponse): {
  schema?: string;
  contentType?: string;
} {
  if (!response?.content) {
    return {};
  }

  // Prefer application/json, then any JSON-like content type, then */*.
  const entries = Object.entries(response.content);

  const jsonEntry = entries.find(([type]) => type === 'application/json');
  const jsonLikeEntry = entries.find(
    ([type, c]) => type !== 'application/json' && type !== '*/*' && c?.schema,
  );
  const wildcardEntry = entries.find(([type]) => type === '*/*');

  const chosen = jsonEntry ?? jsonLikeEntry ?? wildcardEntry;

  if (!chosen) {
    return {};
  }

  const [contentType, content] = chosen;
  const schema = content?.schema;

  if (!schema) {
    return {contentType};
  }

  return {schema: schemaToTsType(schema), contentType};
}

/**
 * Extracts the request body model from an OpenAPI operation.
 *
 * Selects the primary content type in this order:
 * 1. `runtime.preferContentType` (when set and offered by the spec)
 * 2. `application/json`
 * 3. First entry with a schema
 *
 * Detects `multipart/form-data` and `application/x-www-form-urlencoded` and
 * captures part schemas for multipart bodies.
 */
function extractRequestBody(
  requestBody: OpenApiRequestBody | undefined,
  preferContentType?: string,
): RequestBodyModel | undefined {
  const content = requestBody?.content;
  if (!content) {
    return undefined;
  }

  const entries = Object.entries(content);
  if (entries.length === 0) {
    return undefined;
  }

  // Select the primary content type: prefer the configured content type,
  // then application/json, then the first entry with a schema.
  const preferredEntry =
    preferContentType !== undefined
      ? entries.find(([type]) => type === preferContentType)
      : undefined;
  const jsonEntry = entries.find(([type]) => type === 'application/json');
  const firstWithSchema = entries.find(([, c]) => c?.schema);
  const chosen = preferredEntry ?? jsonEntry ?? firstWithSchema;

  if (!chosen) {
    return undefined;
  }

  const [contentType, contentObj] = chosen;
  const schema = contentObj?.schema;

  if (!schema) {
    return undefined;
  }

  const isMultipart = contentType === 'multipart/form-data';
  const isFormUrlencoded = contentType === 'application/x-www-form-urlencoded';

  let parts: MultipartPartModel[] | undefined;

  if (isMultipart && schema.type === 'object' && schema.properties) {
    const required = new Set<string>(schema.required ?? []);
    parts = Object.entries(schema.properties).map(([name, propSchema]) => ({
      name,
      type: schemaToTsType(propSchema),
      required: required.has(name),
    }));
  }

  return {
    type: schemaToTsType(schema),
    contentType,
    isMultipart,
    isFormUrlencoded,
    ...(parts ? {parts} : {}),
  };
}

function groupByTag(operations: OperationModel[]): Record<string, OperationModel[]> {
  return operations.reduce<Record<string, OperationModel[]>>((result, operation) => {
    const tagOperations = result[operation.tag] ?? [];
    tagOperations.push(operation);
    result[operation.tag] = tagOperations;
    return result;
  }, {});
}

function groupByPath(operations: OperationModel[]): Record<string, OperationModel[]> {
  return operations.reduce<Record<string, OperationModel[]>>((result, operation) => {
    const group = pathGroupName(operation.path);
    const groupOperations = result[group] ?? [];
    groupOperations.push(operation);
    result[group] = groupOperations;
    return result;
  }, {});
}

function pathGroupName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[0] ?? 'Default';
}

function fallbackOperationId(method: HttpMethod, path: string): string {
  const segments = path.split('/').filter(Boolean);
  const methodPrefix = methodVerbPrefix(method);
  const nameParts: string[] = [methodPrefix];

  for (const segment of segments) {
    const paramMatch = segment.match(/^\{(.+)\}$/);

    if (paramMatch) {
      nameParts.push('By', toPascalIdentifier(paramMatch[1]!, 'Param'));
    } else {
      nameParts.push(toPascalIdentifier(segment, 'Path'));
    }
  }

  return toCamelIdentifier(nameParts.join(''), 'operation');
}

function methodVerbPrefix(method: HttpMethod): string {
  switch (method) {
    case 'get':
      return 'get';
    case 'post':
      return 'create';
    case 'put':
    case 'patch':
      return 'update';
    case 'delete':
      return 'delete';
    default:
      return method;
  }
}

function collectModelImports(operations: OperationModel[]): string {
  const types = new Set<string>();

  for (const operation of operations) {
    collectType(operation.responseType, types);

    const bodyType = operation.requestBody?.type;
    if (bodyType) {
      collectType(bodyType, types);
    }

    for (const param of [
      ...operation.pathParams,
      ...operation.queryParams,
      ...operation.headerParams,
    ]) {
      collectType(param.type, types);
    }
  }

  if (types.size === 0) {
    return '';
  }

  return `import { ${Array.from(types).sort().join(', ')} } from '../models';`;
}

function collectType(type: string, output: Set<string>): void {
  if (!type) {
    return;
  }

  // Unwrap a single surrounding pair of parentheses so that array-of-union
  // types like `('A' | 'B' | 'C')[]` are recursed into correctly: strip `[]`
  // first → `('A' | 'B' | 'C')` → unwrap parens → union split branch.
  if (type.startsWith('(') && type.endsWith(')')) {
    type = type.slice(1, -1);
  }

  const primitives = new Set([
    'string',
    'number',
    'boolean',
    'void',
    'unknown',
    'null',
    'Record<string, unknown>',
    'Uint8Array',
    // Browser built-in types — never imported from generated models.
    'Blob',
    'ArrayBuffer',
    'File',
    'FormData',
    'ReadableStream',
    'ReadableStream<Uint8Array>',
    'ReadableStream<Uint8Array> | null',
    'URLSearchParams',
  ]);

  // Generic built-ins (e.g. `ReadableStream<Uint8Array>`) — strip the type
  // arguments so the union-split branch doesn't mistake the wrapper for a
  // model import.
  const genericBuiltin = /^([A-Za-z_$][\w$]*)<.*>$/.exec(type);
  if (genericBuiltin && primitives.has(genericBuiltin[1]!)) {
    return;
  }

  if (primitives.has(type)) {
    return;
  }

  if (type.endsWith('[]')) {
    collectType(type.slice(0, -2), output);
    return;
  }

  if (type.startsWith('Record<string, ') && type.endsWith('>')) {
    const inner = type.slice('Record<string, '.length, -1);
    collectType(inner, output);
    return;
  }

  if (type.includes(' | ') || type.includes(' & ')) {
    for (const part of type.split(/[ |&]+/)) {
      collectType(part.trim(), output);
    }
    return;
  }

  if (type.startsWith('"') || type.startsWith("'")) {
    return;
  }

  // Inline object type literal — no imports needed.
  if (type.startsWith('{')) {
    return;
  }

  // Tuple type — recurse into elements.
  if (type.startsWith('[') && type.endsWith(']')) {
    const inner = type.slice(1, -1);
    for (const part of inner.split(', ')) {
      collectType(part.trim(), output);
    }
    return;
  }

  output.add(type);
}
