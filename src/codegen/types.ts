export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type GroupBy = 'tag' | 'path';

/**
 * The HTTP transport used by the generated runtime.
 *
 * - `'fetch'` (default): native `fetch()`, zero `HttpClient` dependency.
 * - `'httpClient'`: Angular `HttpClient` wrapper, integrates with the
 *   Angular interceptor ecosystem and `provideHttpClient()`.
 */
export type HttpTransport = 'fetch' | 'httpClient';

/**
 * OpenAPI parameter serialization styles for query parameters.
 *
 * - `'form'` (default): comma-separated when `explode: false`,
 *   repeated keys when `explode: true`.
 * - `'spaceDelimited'`: space-separated (`%20`).
 * - `'pipeDelimited'`: pipe-separated (`|`).
 * - `'deepObject'`: nested key notation (`key[prop]=value`).
 */
export type QueryStyle = 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject';

/**
 * Runtime-related generator options.
 *
 * These influence the generated runtime files (providers, fetch client).
 * Runtime extension points that are functions (middleware, auth, hooks,
 * error mapper) are configured at runtime via Angular DI tokens emitted by
 * `provideNgOpenapiSignals`. Only static, codegen-time defaults live here.
 */
export interface RuntimeConfig {
  /**
   * Selects the HTTP transport for the generated runtime.
   *
   * - `'fetch'` (default): generates `ApiFetchClient` using native `fetch()`.
   * - `'httpClient'`: generates `ApiHttpClient` wrapping Angular `HttpClient`.
   *
   * The `fetch` transport preserves the zero-`HttpClient` guarantee.
   */
  transport?: HttpTransport;
  /**
   * Static default headers merged into every request. These are baked into
   * the generated `provideNgOpenapiSignals` default and can be overridden
   * per request via `ApiRequestOptions.headers`.
   */
  defaultHeaders?: Record<string, string>;
  /**
   * When `true` (default), generated API methods emit a `responseType`
   * hint (`'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream'`) derived from the
   * OpenAPI response `content` type. Set to `false` to rely solely on
   * runtime content-type sniffing.
   */
  responseTypeHints?: boolean;
  /**
   * Default query parameter serialization style when the OpenAPI spec does
   * not specify `style`. Defaults to `'form'` (the OpenAPI default for
   * query parameters).
   */
  defaultQueryStyle?: QueryStyle;
  /**
   * Default `explode` flag for query parameters when the OpenAPI spec does
   * not specify `explode`. Defaults to `true` (the OpenAPI default for
   * `form` style query parameters).
   */
  defaultQueryExplode?: boolean;
  /**
   * Preferred content type when a request body offers multiple media types.
   * Defaults to `'application/json'`. Set to e.g. `'multipart/form-data'`
   * to prefer multipart when available.
   */
  preferContentType?: string;
  /**
   * When `true`, generates an additional signal-based `…Mutation()` method
   * for every POST/PUT/PATCH/DELETE operation, alongside the existing
   * Promise-based method. The generated `…Mutation()` returns a `Mutation`
   * object exposing `result`, `error`, `status`, `isLoading` signals and a
   * `mutate(body, signal?)` function. Defaults to `false` to preserve the
   * zero-magic generation default.
   */
  signalMutations?: boolean;
  /**
   * When `true`, generates a `transformDates` runtime helper and wires it
   * into the JSON response parsing path of both transports. ISO-8601
   * date-time strings (e.g. `2026-07-15T12:00:00Z`) found anywhere in a
   * parsed JSON body are recursively converted to `Date` instances.
   * Non-JSON responses (text, blob, arrayBuffer, stream) are left
   * untouched. Defaults to `false` to preserve the zero-magic default.
   */
  dateTransformer?: boolean;
}

export interface GeneratorConfig {
  input: string;
  output: string;
  clean: boolean;
  groupBy: GroupBy;
  /** Runtime options. Omitted in partial configs; defaulted by `resolveConfig`. */
  runtime?: RuntimeConfig;
}

export type PartialGeneratorConfig = Partial<Omit<GeneratorConfig, 'runtime'>> & {
  runtime?: Partial<RuntimeConfig>;
};

export interface GenerateOptions {
  input: string;
  output: string;
}

export interface ParameterModel {
  name: string;
  location: 'path' | 'query' | 'header';
  required: boolean;
  type: string;
  /**
   * Public property key used in the generated params type and object.
   *
   * Equal to {@link name} unless the same name also occurs in another
   * location: OpenAPI uniqueness is `(name, in)`, so a path `id` and a query
   * `id` are both legal but would emit duplicate property keys (TS2300).
   * Colliding names are suffixed by location (`idPath`, `idQuery`,
   * `idHeader`); see `assignParamKeys()`.
   */
  key: string;
  /** OpenAPI `style` for query parameters. Defaults to `'form'`. */
  style?: QueryStyle;
  /** OpenAPI `explode` flag. Defaults to `true` for `form` style. */
  explode?: boolean;
}

/** A single part of a multipart form-data request body. */
export interface MultipartPartModel {
  name: string;
  type: string;
  required: boolean;
}

/** Request body model capturing content type, TS type, and multipart metadata. */
export interface RequestBodyModel {
  /** The TypeScript type string for the request body (e.g. `CreateUserRequest`). */
  type: string;
  /** The primary content type (e.g. `application/json`, `multipart/form-data`). */
  contentType: string;
  /** True when the content type is `multipart/form-data`. */
  isMultipart: boolean;
  /** True when the content type is `application/x-www-form-urlencoded`. */
  isFormUrlencoded: boolean;
  /** Multipart parts when `isMultipart` is true. */
  parts?: MultipartPartModel[];
}

export interface OperationModel {
  operationId: string;
  tag: string;
  method: HttpMethod;
  path: string;
  pathParams: ParameterModel[];
  queryParams: ParameterModel[];
  headerParams: ParameterModel[];
  responseType: string;
  /** Parser hint derived from the success response content type. */
  responseParser?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
  /** Request body metadata (content type, multipart info). */
  requestBody?: RequestBodyModel;
}

export type SchemaModelKind = 'interface' | 'enum' | 'alias';

export interface SchemaModel {
  name: string;
  kind: SchemaModelKind;
  properties: SchemaPropertyModel[];
  /** Present when `kind === 'enum'`. */
  values?: (string | number)[];
  /** Optional enum member names from `x-enumNames` / `x-enum-varnames`. */
  enumNames?: string[];
  /** Present when `kind === 'alias'` — a type alias for a primitive or composition. */
  aliasType?: string;
}

export interface SchemaPropertyModel {
  name: string;
  type: string;
  required: boolean;
}
