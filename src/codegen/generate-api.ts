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
import {collectModelReferences} from './model-refs';
import {isQueryStyle} from './guards';
import {sanitizeIdentifier, type ModelNames} from './naming';
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

/**
 * Merges path-item parameters with operation parameters.
 *
 * OpenAPI uniqueness is `(name, in)`, and an operation-level parameter
 * *overrides* a path-item parameter with the same `(name, in)` pair — it does
 * not add a second one. Concatenating the two lists instead emitted two
 * parameter models with the same name, which `assignParamKeys()` disambiguated
 * (`idQuery` / `idQuery2`) while the wire object stayed keyed by `param.name`
 * — a duplicate object key (TS1117) from spec-legal input.
 *
 * The operation-level entry replaces the path-item entry *in place*, so the
 * order (and therefore the rendered output) is unchanged when nothing is
 * overridden. Both inputs must already be `$ref`-resolved.
 *
 * A duplicate `(name, in)` *within* `operation.parameters` is spec-invalid;
 * the last one wins, consistent with the JSON-merge semantics above, giving a
 * total and deterministic result instead of emitting duplicate keys.
 */
function mergeParameters(
  pathItemParameters: OpenApiParameter[],
  operationParameters: OpenApiParameter[],
): OpenApiParameter[] {
  const index = new Map<string, number>();
  const merged: OpenApiParameter[] = [];

  for (const parameter of pathItemParameters) {
    const key = `${parameter.in}\u0000${parameter.name}`;
    // A duplicate within the path item itself is spec-invalid too; keep the
    // last one at its first position.
    const existing = index.get(key);

    if (existing === undefined) {
      index.set(key, merged.length);
      merged.push(parameter);
    } else {
      merged[existing] = parameter;
    }
  }

  for (const parameter of operationParameters) {
    const key = `${parameter.in}\u0000${parameter.name}`;
    const existing = index.get(key);

    if (existing === undefined) {
      index.set(key, merged.length);
      merged.push(parameter);
    } else {
      // Operation-level overrides win, at the path-item position.
      merged[existing] = parameter;
    }
  }

  return merged;
}

export function extractOperations(
  api: OpenApiDocument,
  config?: Pick<GeneratorConfig, 'runtime'>,
  names?: ModelNames,
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

      const pathItemParameters = (pathItem.parameters ?? [])
        .map((parameter) => resolve(parameter, 'parameters'))
        .filter((parameter): parameter is OpenApiParameter => parameter !== undefined);
      const operationParameters = (operation.parameters ?? [])
        .map((parameter) => resolve(parameter, 'parameters'))
        .filter((parameter): parameter is OpenApiParameter => parameter !== undefined);

      // Resolve `$ref`s first: a `$ref`'d path-item parameter and an inline
      // operation parameter must be compared by their resolved `name`/`in`.
      const parameters = mergeParameters(pathItemParameters, operationParameters);

      const pathParams = parameters
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) =>
          toParameterModel(parameter, defaultQueryStyle, defaultQueryExplode, names),
        );

      const queryParams = parameters
        .filter((parameter) => parameter.in === 'query')
        .map((parameter) =>
          toParameterModel(parameter, defaultQueryStyle, defaultQueryExplode, names),
        );

      const headerParams = parameters
        .filter((parameter) => parameter.in === 'header')
        .map((parameter) =>
          toParameterModel(parameter, defaultQueryStyle, defaultQueryExplode, names),
        );

      // OpenAPI uniqueness is `(name, in)`, so the same name may legally occur
      // in several locations. Give every param its public key before any
      // renderer runs: non-colliding names keep their exact previous key.
      assignParamKeys(pathParams, queryParams, headerParams);

      const requestBody = extractRequestBody(
        resolve(operation.requestBody, 'requestBodies'),
        runtime?.preferContentType,
        names,
      );
      const {responseType, responseParser} = extractResponseType(operation, resolve, names);

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
  names: ModelNames,
): Record<string, string> {
  const files: Record<string, string> = {};
  const grouped = config.groupBy === 'path' ? groupByPath(operations) : groupByTag(operations);
  const usedFileNames = new Set<string>();
  const exportNames: string[] = [];
  const seenExports = new Set<string>();
  // The resolved model names are the authoritative answer to "is this
  // identifier a model?" — the same set `generateModelFiles()` declares. Class
  // names must be disjoint from this *document-wide* set, because the root
  // `index.ts` re-exports both barrels — see `uniqueResourceClassName()`.
  const modelNames: ReadonlySet<string> = new Set(names.values());
  // This set keeps the generated classes unique across the tree, because
  // `resources/index.ts` re-exports every one of them.
  const usedClassNames = new Set<string>();

  for (const [group, groupOperations] of Object.entries(grouped)) {
    // `kebabCase()` can collide (`User` vs `user`, or tags differing only in
    // punctuation) and returns an empty string for symbol-only tags. Both
    // the file name and the service class name must stay unique, otherwise
    // the barrel re-exports two identical members.
    const fileName = uniqueFileName(kebabCase(group), usedFileNames, 'default');
    // The class name must avoid *every* model in the document, not only the
    // ones this file imports — see `uniqueResourceClassName()`.
    const className = uniqueResourceClassName(
      serviceNameFromTag(group),
      modelNames,
      usedClassNames,
    );

    files[`resources/${fileName}.api.ts`] = generateService(
      className,
      groupOperations,
      config,
      modelNames,
    );

    const exportName = `${fileName}.api`;
    if (!seenExports.has(exportName)) {
      seenExports.add(exportName);
      exportNames.push(exportName);
    }
  }

  // A barrel with no exports is only comments, which is not a module — the
  // root `index.ts` re-exports from it and `tsc` then fails with TS2306
  // ("File ... is not a module"). Specs without any path (or without any
  // schema) are valid, so emit an explicit empty module instead.
  files['resources/index.ts'] =
    exportNames.length > 0
      ? exportNames.map((name) => `export * from './${name}';`).join('\n') + '\n'
      : 'export {};\n';

  return files;
}

function generateService(
  serviceName: string,
  operations: OperationModel[],
  config: GeneratorConfig,
  modelNames: ReadonlySet<string>,
): string {
  const modelImports = collectModelImports(operations, modelNames);
  const hasGets = operations.some((op) => op.method === 'get');
  // `readSignalOrValue` is emitted for GET params factories and for mutation
  // methods that resolve their params. `MaybeSignal` is referenced by every
  // params type. Track the two separately: gating the whole import on "has
  // params" emitted an unused `readSignalOrValue` binding (TS6133 under
  // `noUnusedLocals`).
  const callsReadSignalOrValue = operations.some(usesReadSignalOrValue);
  const referencesMaybeSignal = operations.some((op) => countParams(op) > 0);
  const signalUtilImport = callsReadSignalOrValue
    ? `import { readSignalOrValue, type MaybeSignal } from '../signal-utils';\n`
    : referencesMaybeSignal
      ? `import type { MaybeSignal } from '../signal-utils';\n`
      : '';
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

  const mutationUtilImport =
    signalMutations && hasMutations
      ? `import { createMutation, type Mutation } from '../mutation-utils';\n`
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
  // The loader's params are already resolved by the factory above, so header
  // values are read directly from them.
  const headerExpression = generateHeaderExpression(operation);
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

/** All parameter models of an operation, in declaration order. */
function operationParams(operation: OperationModel): ParameterModel[] {
  return [...operation.pathParams, ...operation.queryParams, ...operation.headerParams];
}

function countParams(operation: OperationModel): number {
  return operation.pathParams.length + operation.queryParams.length + operation.headerParams.length;
}

/**
 * Params that must be read through `readSignalOrValue()` in a mutation method,
 * index-aligned with their locals.
 *
 * Only params the request actually reads get a local: a path param without a
 * placeholder in the path template would otherwise be an unused variable.
 */
function mutationParamLocals(operation: OperationModel): {
  params: ParameterModel[];
  locals: string[];
} {
  const params = operationParams(operation);
  const locals = buildParamLocals(params);
  const referenced = readPathTemplateParamNames(operation);
  const readParams: ParameterModel[] = [];
  const readLocals: string[] = [];

  params.forEach((param, index) => {
    if (param.location === 'path' && !referenced.has(param.name)) {
      return;
    }

    readParams.push(param);
    readLocals.push(locals[index]!);
  });

  return {params: readParams, locals: readLocals};
}

/** Whether the generated method body calls `readSignalOrValue()`. */
function usesReadSignalOrValue(operation: OperationModel): boolean {
  return operation.method === 'get'
    ? countParams(operation) > 0
    : mutationParamLocals(operation).params.length > 0;
}

function generateMutationMethod(
  operation: OperationModel,
  methodName: string,
  responseTypeHints: boolean,
): string {
  const params = operationParams(operation);
  const hasParams = params.length > 0;
  const paramsType = generateParamsType(operation);
  const bodyType = operation.requestBody?.type;
  const bodyParameter = bodyType ? `body: ${bodyType}, ` : '';

  // The params are typed `MaybeSignal<T>` (the documented contract), so a
  // caller may pass a signal. Read each value once into a local before the
  // request object, exactly like the resource params factory: interpolating
  // `params.id` straight into the URL would stringify the signal itself
  // (`[Signal: 42]`).
  const {params: readParams, locals: readLocals} = mutationParamLocals(operation);

  // A declared path param without a placeholder in the path template keeps its
  // entry in the params type but is never read, so the whole `params` parameter
  // is unused — TS6133 under `noUnusedParameters`. The leading underscore keeps
  // the generated file compiling without changing the positional signature.
  const paramsParameter = hasParams
    ? `${readParams.length > 0 ? 'params' : '_params'}: ${paramsType}, `
    : '';

  const resolvedAccess = new Map(
    readParams.map((param, index) => [param, readLocals[index]!] as const),
  );
  // The resolver receives the *same* model object that the path/query/header
  // renderers hold, so the lookup is stable; unmapped params fall back to a
  // direct `params.x` read (the pre-existing behaviour).
  const resolveParam = (param: ParameterModel): string =>
    resolvedAccess.get(param) ?? formatParamAccess(param);

  const pathExpression = generatePathExpression(operation, resolveParam);
  const queryExpression = generateQueryExpression(operation, resolveParam);
  const headerExpression = generateHeaderExpression(operation, resolveParam);
  const localLines =
    readParams.length > 0 ? `${generateParamLocals(readParams, readLocals, '    ')}\n    ` : '';

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
    ${localLines}return this.client.request<${operation.responseType}>({
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
  // Both methods take the same `MaybeSignal` params type and the Promise method
  // resolves each value at call time, so `params` is forwarded as-is: the
  // closure keeps binding at construction time and the signal is read exactly
  // once, when `mutate()` actually dispatches the request.
  const forwardedArgs: string[] = [];
  if (bodyType) {
    forwardedArgs.push('mutationBody');
  }
  if (hasParams) {
    forwardedArgs.push('params');
  }
  forwardedArgs.push('mutationSignal');
  const forwardedCall = forwardedArgs.join(', ');

  // Without a request body the callback's first parameter is never read. The
  // leading underscore keeps `noUnusedParameters` quiet (generated output must
  // compile under it) without changing the `createMutation<void, T>` contract.
  const mutationBodyArg = bodyType ? 'mutationBody' : '_mutationBody';

  return `  ${methodName}Mutation(${paramsArg}): Mutation<${mutationBodyType}, ${operation.responseType}> {
    return createMutation<${mutationBodyType}, ${operation.responseType}>((${mutationBodyArg}, mutationSignal) =>
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
  const locals = buildParamLocals(params);
  const requiredLocals = requiredParams.map((p) => locals[params.indexOf(p)]);

  // When all required params resolve to undefined, return undefined to keep
  // the resource in idle state (no HTTP request). This allows callers to pass
  // signal(undefined) for required params until they are ready (e.g. after
  // authentication), preventing premature 401 responses.
  if (requiredParams.length === 0) {
    // No required params — always resolve (optional params can be undefined).
    // Values are read once into locals so a `computed`/`linkedSignal` with an
    // expensive derivation is not evaluated twice per read.
    return `(() => {
${generateParamLocals(params, locals)}
        return {
${renderResolvedParams(params, locals)}
        };
      })()`;
  }

  // Read each param once: the idle-state guard and the returned object would
  // otherwise evaluate every signal twice.
  return `(() => {
${generateParamLocals(params, locals)}
        if (${requiredLocals.map((local) => `${local} === undefined`).join(' || ')}) {
          return undefined;
        }
        return {
${renderResolvedParams(params, locals)}
        };
      })()`;
}

/**
 * `const resolved_x = readSignalOrValue(params.x);` for the given params,
 * index-aligned with `locals` (see {@link buildParamLocals}).
 */
function generateParamLocals(
  params: ParameterModel[],
  locals: string[],
  indent = '        ',
): string {
  return params
    .map(
      (param, index) =>
        `${indent}const ${locals[index]} = readSignalOrValue(${formatParamAccess(param)});`,
    )
    .join('\n');
}

/**
 * Names of the path params that the path template actually interpolates.
 *
 * The path is rendered from the *model* params, but only placeholders present
 * in the URL are used. Reading the others into locals would leave unused
 * (`noUnusedLocals`) variables in the mutation method.
 */
function readPathTemplateParamNames(operation: OperationModel): Set<string> {
  const referenced = new Set<string>();

  for (const match of operation.path.matchAll(/\{([^}]+)\}/g)) {
    referenced.add(match[1]!);
  }

  return referenced;
}

/** `${name}: ${local},` entries read from the locals created by the above. */
function renderResolvedParams(params: ParameterModel[], locals: string[]): string {
  return params
    .map((param, index) => `          ${formatParamName(param)}: ${locals[index]}`)
    .join(',\n');
}

/**
 * Local variable names for the resolved params, index-aligned with `params`.
 *
 * Prefixed because a param can be named like a reserved word (`default`,
 * `class`) — valid as a property, invalid as a `const`. Different parameter
 * names can normalize to the same identifier (`user-id` and `userId` both
 * become `userId`), which would emit two `const` declarations in the same
 * block (TS2451), so collisions are suffixed (`resolvedUserId2`).
 */
function buildParamLocals(params: ParameterModel[]): string[] {
  const used = new Set<string>();

  return params.map((param) => {
    const base = `resolved_${toCamelIdentifier(param.name, 'param')}`;

    if (!used.has(base)) {
      used.add(base);
      return base;
    }

    let counter = 2;
    while (used.has(`${base}${counter}`)) {
      counter++;
    }

    const unique = `${base}${counter}`;
    used.add(unique);
    return unique;
  });
}

/**
 * Renders the request path.
 *
 * `resolve` supplies the value expression for a parameter: the resolved local
 * in mutation methods (so a `MaybeSignal` argument is unwrapped) and `params.x`
 * in resource loaders (where the params object is already resolved).
 */
function generatePathExpression(
  operation: OperationModel,
  resolve: (param: ParameterModel) => string = (param) => formatParamAccess(param),
): string {
  if (countParams(operation) === 0) {
    return JSON.stringify(operation.path);
  }

  // Path templating: `{id}` → the resolved expression. A placeholder can only
  // refer to a *path* parameter (OpenAPI requires the template and the
  // `in: path` parameters to match), and names that are not valid identifiers
  // (e.g. `{user-id}`) are resolved through the model.
  //
  // Looking the name up across every location let a query/header parameter
  // that shares the name shadow the path parameter: uniqueness is
  // (name, `in`), not name alone. The template would then render the query
  // param's local and leave the path param's `const` unused (TS6133), and the
  // query object would silently use the path local. Resolving the declared
  // path parameter here also means `resolve()` receives the very object the
  // mutation resolver keyed its local map by (identity, not name).
  const pathParamsByName = new Map(operation.pathParams.map((param) => [param.name, param]));

  const templatePath = operation.path.replace(/\{([^}]+)\}/g, (placeholder, name: string) => {
    const pathParam = pathParamsByName.get(name);

    if (!pathParam) {
      // Not a declared path parameter — keep the literal placeholder instead
      // of emitting a reference to a non-existent property.
      return placeholder;
    }

    return `\${encodeURIComponent(String(${resolve(pathParam)}))}`;
  });

  return '`' + templatePath + '`';
}

/**
 * Formats a parameter's public property name for a params type/object.
 *
 * Parameter names are free-form in OpenAPI (`X-Request-Id`, `filter[name]`,
 * `user-id`), so any name that is not a valid identifier is quoted. The
 * rendered key is {@link ParameterModel.key}: the verbatim name unless the
 * same name also occurs in another location (see `assignParamKeys()`).
 */
function formatParamName(param: ParameterModel): string {
  return formatPropertyName(param.key);
}

/** Formats a parameter access expression (`params.id` / `params['user-id']`). */
function formatParamAccess(param: ParameterModel): string {
  return formatPropertyAccess('params', param.key);
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
function generateQueryExpression(
  operation: OperationModel,
  resolve: (param: ParameterModel) => string = (param) => formatParamAccess(param),
): string {
  if (operation.queryParams.length === 0) {
    return '';
  }

  const properties = operation.queryParams
    .map((param) => {
      // The object *key* is the wire-level query name from the spec and must
      // stay verbatim; only the value (`resolve`) uses the public params key,
      // which may be location-suffixed (see `assignParamKeys()`).
      const wireName = formatPropertyName(param.name);
      // The runtime's implicit default (no metadata) is form + explode:true.
      const isRuntimeDefault = !param.style && param.explode === undefined;

      if (isRuntimeDefault) {
        return `            ${wireName}: ${resolve(param)}`;
      }

      const style = param.style ?? DEFAULT_QUERY_STYLE;
      const explode = param.explode ?? DEFAULT_QUERY_EXPLODE;
      return `            ${wireName}: { value: ${resolve(param)}, style: '${style}', explode: ${explode} }`;
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
function generateHeaderExpression(
  operation: OperationModel,
  resolve: (param: ParameterModel) => string = (param) => formatParamAccess(param),
): string {
  if (operation.headerParams.length === 0) {
    return '';
  }

  const properties = operation.headerParams
    // The header name is the wire name and stays verbatim; `resolve` reads the
    // public params key, which may be location-suffixed.
    .map((param) => `            ${formatPropertyName(param.name)}: ${resolve(param)}`)
    .join(',\n');

  return `{
${properties}
          }`;
}

function toParameterModel(
  parameter: OpenApiParameter,
  defaultQueryStyle: QueryStyle = DEFAULT_QUERY_STYLE,
  defaultQueryExplode: boolean = DEFAULT_QUERY_EXPLODE,
  names?: ModelNames,
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
    type: schemaToTsType(parameter.schema, names),
    // Defaults to the verbatim name; `assignParamKeys()` changes it only when
    // the same name occurs in another location.
    key: parameter.name,
    ...(isQuery && style !== DEFAULT_QUERY_STYLE
      ? {style}
      : {}),
    ...(isQuery && explode !== DEFAULT_QUERY_EXPLODE ? {explode} : {}),
  };
}

/** Suffix appended to a parameter name that occurs in more than one location. */
const LOCATION_SUFFIX: Record<ParameterModel['location'], string> = {
  path: 'Path',
  query: 'Query',
  header: 'Header',
};

/**
 * Assigns the public property key of every parameter model of one operation.
 *
 * OpenAPI only requires `(name, in)` pairs to be unique, so `/users/{id}` may
 * legally declare `id` both as a path and as a query parameter. Keying the
 * params type by `name` alone emitted duplicate property keys — TS2300 /
 * TS2687 / TS2717 in the type, TS1117 in the resolved object literal — while
 * the CLI exited 0.
 *
 * A name that occurs once keeps its exact previous key (the verbatim name, so
 * non-colliding output stays byte-identical and no public API is renamed).
 * Only colliding names get a location suffix (`idPath`, `idQuery`,
 * `idHeader`); `formatPropertyName()` still quotes them when the result is not
 * a valid identifier. The resolved `resolved_*` locals are deliberately *not*
 * derived from this key — they keep deduplicating on `name` (see
 * `buildParamLocals()`).
 */
function assignParamKeys(...groups: ParameterModel[][]): void {
  const counts = new Map<string, number>();

  for (const group of groups) {
    for (const param of group) {
      counts.set(param.name, (counts.get(param.name) ?? 0) + 1);
    }
  }

  // Reserve every non-colliding name first. A suffixed key may then collide
  // with a parameter that is literally called `idPath`, and that parameter
  // keeps its name instead of being renamed by someone else's collision.
  const used = new Set<string>();

  for (const group of groups) {
    for (const param of group) {
      if ((counts.get(param.name) ?? 0) === 1) {
        used.add(param.name);
      }
    }
  }

  // `id` in two locations plus a parameter literally named `idPath`: such a
  // spec produced duplicate keys before the suffix rule existed too, so
  // deduping it cannot rename a working API — it only keeps the output
  // compilable.
  for (const group of groups) {
    for (const param of group) {
      if ((counts.get(param.name) ?? 0) === 1) {
        param.key = param.name;
        continue;
      }

      const base = `${param.name}${LOCATION_SUFFIX[param.location]}`;
      let key = base;
      let counter = 2;

      while (used.has(key)) {
        key = `${base}${counter}`;
        counter++;
      }

      used.add(key);
      param.key = key;
    }
  }
}

function extractResponseType(
  operation: OpenApiOperation,
  resolve: RefResolver,
  names?: ModelNames,
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

    const {schema, contentType} = extractSchemaFromResponse(response, names);

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
      ? extractSchemaFromResponse(defaultResponse, names)
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

function extractSchemaFromResponse(
  response: OpenApiResponse,
  names?: ModelNames,
): {
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

  return {schema: schemaToTsType(schema, names), contentType};
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
  names?: ModelNames,
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
      type: schemaToTsType(propSchema, names),
      required: required.has(name),
    }));
  }

  return {
    type: schemaToTsType(schema, names),
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

/**
 * The model names a single `resources/*.api.ts` file imports, i.e. every
 * declared model referenced by one of the group's operations.
 *
 * This is the one definition of "which models does this module bind", used by
 * the import renderer below. It is deliberately *not* the class-name collision
 * rule: that one is document-wide (see {@link uniqueResourceClassName()}).
 */
function collectModelNamesForOperations(
  operations: OperationModel[],
  modelNames: ReadonlySet<string>,
): Set<string> {
  const types = new Set<string>();

  for (const operation of operations) {
    collectModelReferences(operation.responseType, modelNames, types);

    const bodyType = operation.requestBody?.type;
    if (bodyType) {
      collectModelReferences(bodyType, modelNames, types);
    }

    for (const param of [
      ...operation.pathParams,
      ...operation.queryParams,
      ...operation.headerParams,
    ]) {
      collectModelReferences(param.type, modelNames, types);
    }
  }

  return types;
}

/**
 * Resolves a service class name that collides with no other generated name.
 *
 * Two constraints, both document-wide:
 *
 * 1. Class names must be unique across the whole tree, because
 *    `resources/index.ts` re-exports every `resources/*.api.ts` module — two
 *    classes with one name are a duplicate export (TS2308) at the barrel.
 * 2. Class names must not equal *any* model name in the document, because the
 *    generated root `index.ts` re-exports both `./models` and `./resources`. Two
 *    `export *` of the same name is TS2308 ("Module './models' has already
 *    exported a member named 'X'"), regardless of whether the model is imported
 *    by the group whose class collides. It is therefore *not* enough to avoid
 *    the model names the group's own file imports — a schema `OrdersApi`
 *    anywhere in the document forbids a class of that name for any tag.
 *
 * The numeric suffix is applied in generation order (declaration order), so the
 * result stays deterministic for a given spec. The class is renamed rather than
 * the model: the class name is synthesized by the generator and therefore not a
 * public-API promise, whereas renaming the user's schema would be.
 *
 * The runtime exports (`RESERVED_ROOT_EXPORT_NAMES`: `ApiError`,
 * `provideNgOpenapiSignals`, `transformDates`, …) need no entry here:
 * `serviceNameFromTag()` always appends `Api`, and no runtime export ends in
 * `Api`, so a derived class name can never equal one. Renaming the models away
 * from those names is what keeps the two barrels disjoint.
 */
function uniqueResourceClassName(
  base: string,
  modelNames: ReadonlySet<string>,
  usedClassNames: Set<string>,
): string {
  // `uniqueIdentifier()` has no "taken" parameter, so hold the forbidden names
  // in `used` for the duration of the call: it then skips exactly the document's
  // model names, plus every class taken before.
  const taken: Set<string> = new Set([...usedClassNames, ...modelNames]);
  const className = uniqueIdentifier(base, taken);

  usedClassNames.add(className);
  return className;
}

function collectModelImports(
  operations: OperationModel[],
  modelNames: ReadonlySet<string>,
): string {
  const types = collectModelNamesForOperations(operations, modelNames);

  if (types.size === 0) {
    return '';
  }

  // Model imports are type-only: every generated model is an `interface` or a
  // `type` alias (enums are emitted as literal unions), so a value import would
  // break `verbatimModuleSyntax` (TS1484) for no reason. Names that would
  // collide with a binding this module already imports never reach this list:
  // `RESERVED_RESOURCE_BINDING_NAMES` renames them at declaration time.
  return `import type { ${Array.from(types).sort().join(', ')} } from '../models';`;
}
