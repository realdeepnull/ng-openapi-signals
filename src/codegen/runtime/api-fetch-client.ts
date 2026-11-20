import type {GeneratorConfig} from '../types';

export function generateApiFetchClient(config: GeneratorConfig): string {
  const responseTypeHints = config.runtime?.responseTypeHints ?? true;
  const dateTransformer = config.runtime?.dateTransformer === true;
  const responseTypeField = responseTypeHints
    ? `  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';\n`
    : '';
  const dateUtilsImport = dateTransformer ? `import { transformDates } from './date-utils';\n` : '';

  return `import { Service, inject } from '@angular/core';
${dateUtilsImport}import {
  NG_OPENAPI_SIGNALS_BASE_PATH,
  NG_OPENAPI_SIGNALS_MIDDLEWARE,
  NG_OPENAPI_SIGNALS_AUTH,
  NG_OPENAPI_SIGNALS_DEFAULT_HEADERS,
  NG_OPENAPI_SIGNALS_ERROR_MAPPER,
  NG_OPENAPI_SIGNALS_REQUEST_HOOK,
  NG_OPENAPI_SIGNALS_RESPONSE_HOOK,
  NG_OPENAPI_SIGNALS_TIMEOUT,
  type ApiRequestContext,
} from './providers';
import { ApiError, ApiNetworkError } from './api-error';

/**
 * Query parameter serialization metadata for non-default styles.
 *
 * When a query parameter uses a non-default OpenAPI style/explode, the
 * generated code wraps the value with this metadata so the runtime can
 * serialize it correctly.
 */
export interface QueryParamOptions {
  value: unknown;
  style: 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject';
  explode: boolean;
}

export interface ApiRequestOptions {
  method: string;
  path: string;
  query?: Record<string, unknown | QueryParamOptions>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  /**
   * Form data object for multipart/form-data or application/x-www-form-urlencoded.
   * The runtime converts this to FormData or URLSearchParams respectively.
   * When set, takes precedence over \`body\`.
   */
  formData?: object;
  /**
   * Explicit Content-Type for the request body. When omitted, the runtime
   * defaults to 'application/json' for JSON bodies. For FormData, the
   * Content-Type is set automatically by the browser (multipart boundary).
   */
  contentType?: string;
  signal?: AbortSignal | undefined;
${responseTypeField}}

/**
 * Derives the \`Accept\` header from the operation's response type hint.
 *
 * A JSON-only Accept header makes servers return 406 (or a JSON error
 * document) for endpoints declared as text, image or event-stream in the
 * spec. Falls back to a wildcard when the parser is unknown, letting the
 * server pick.
 */
function acceptForResponseType(
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream',
): string {
  switch (responseType) {
    case 'text':
      return 'text/*';
    case 'blob':
    case 'arrayBuffer':
      return '*/*';
    case 'stream':
      return 'text/event-stream';
    case 'json':
    default:
      // No hint (responseTypeHints disabled) keeps the historical default.
      return 'application/json';
  }
}

/**
 * Whether an error signals an abort rather than a failure.
 *
 * \`AbortError\` comes from a caller-provided \`AbortSignal\`; \`TimeoutError\` comes
 * from \`AbortSignal.timeout()\`. Both are rethrown unchanged so cancellation
 * (and a timeout) stays distinguishable from a network failure.
 */
function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

/**
 * Whether an HTTP status code can legally carry a response body.
 *
 * 204, 205 and 304 are body-less per RFC 9110; reading them throws a
 * \`TypeError\` ("body stream already read" / "not a Response") in some
 * environments, so they short-circuit to \`undefined\`.
 */
function hasResponseBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

@Service()
export class ApiFetchClient {
  private readonly baseUrl = inject(NG_OPENAPI_SIGNALS_BASE_PATH);
  private readonly middleware = inject(NG_OPENAPI_SIGNALS_MIDDLEWARE, { optional: true }) ?? [];
  private readonly auth = inject(NG_OPENAPI_SIGNALS_AUTH, { optional: true });
  private readonly defaultHeaders = inject(NG_OPENAPI_SIGNALS_DEFAULT_HEADERS);
  private readonly errorMapper = inject(NG_OPENAPI_SIGNALS_ERROR_MAPPER);
  private readonly onRequest = inject(NG_OPENAPI_SIGNALS_REQUEST_HOOK, { optional: true });
  private readonly onResponse = inject(NG_OPENAPI_SIGNALS_RESPONSE_HOOK, { optional: true });
  private readonly timeoutMs = inject(NG_OPENAPI_SIGNALS_TIMEOUT, { optional: true }) ?? 0;

  async request<T>(options: ApiRequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.query);

    const authHeaders = this.auth ? await this.auth() : {};

    // Build the request body and determine Content-Type.
    const { body, contentType } = this.prepareBody(options);

    const headers: Record<string, string> = {
      Accept: acceptForResponseType(options.responseType),
      ...this.defaultHeaders,
      ...authHeaders,
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...this.stripUndefinedHeaders(options.headers)
    };

    const init: RequestInit = {
      method: options.method,
      signal: this.withTimeout(options.signal),
      headers,
      ...(body !== undefined ? { body } : {})
    };
    const context: ApiRequestContext = { url, init };

    if (this.onRequest) {
      await this.onRequest(context);
    }

    const coreFetch = async (): Promise<Response> => fetch(context.url, context.init);

    const pipeline = this.middleware.reduceRight<() => Promise<Response>>(
      (next, mw) =>
        async () =>
          typeof mw === 'function'
            ? mw(context, next)
            : mw.handle(context, next),
      coreFetch,
    );

    const response = await this.runPipeline(pipeline, context.url, options.method);

    if (!response.ok) {
      throw await this.errorMapper(response);
    }

    if (this.onResponse) {
      // Pass a clone so the hook can inspect the body without consuming the
      // original stream (which parseBody needs to read afterwards).
      await this.onResponse(response.clone());
    }

    if (!hasResponseBody(response.status)) {
      return undefined as unknown as T;
    }

    return (await this.parseBody(response, options.responseType)) as T;
  }

  /**
   * Combines the caller's \`AbortSignal\` with the configured timeout.
   *
   * Returns \`null\` (the \`RequestInit\` default) when neither is in play.
   */
  private withTimeout(signal: AbortSignal | undefined): AbortSignal | null {
    if (this.timeoutMs <= 0) {
      return signal ?? null;
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);

    // \`AbortSignal.any\` is available in Node >= 20 and every current browser.
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /**
   * Runs the middleware pipeline and normalizes transport-level failures.
   *
   * A \`fetch\` rejection (offline, DNS failure, CORS, aborted connection) would
   * otherwise escape as a raw \`TypeError\`, so \`error instanceof ApiError\`
   * would be true only for HTTP errors. Callers could not handle errors
   * uniformly.
   *
   * Two aborts stay untouched because \`resource()\` reacts to them:
   * \`AbortError\` (the caller's own \`signal\`) and \`TimeoutError\`
   * (\`AbortSignal.timeout()\`, which uses a *different* name). A timeout that
   * is wrapped in \`ApiNetworkError\` would be indistinguishable from a genuine
   * network failure, so both are rethrown as-is.
   */
  private async runPipeline(
    pipeline: () => Promise<Response>,
    url: string,
    method: string,
  ): Promise<Response> {
    try {
      return await pipeline();
    } catch (cause) {
      if (isAbortLike(cause)) {
        throw cause;
      }

      // Middleware may already have produced a typed error (e.g. a response
      // validator rejecting a 200 error envelope) — do not wrap those.
      if (cause instanceof ApiNetworkError || cause instanceof ApiError) {
        throw cause;
      }

      throw new ApiNetworkError(url, method, cause);
    }
  }

  /**
   * Removes headers with \`undefined\` values so they are not sent.
   * Optional header parameters may resolve to \`undefined\` when omitted.
   */
  private stripUndefinedHeaders(
    headers: Record<string, string | undefined> | undefined,
  ): Record<string, string> {
    if (!headers) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Prepares the request body and determines the Content-Type.
   *
   * - FormData objects: builds FormData from the object, lets the browser
   *   set the multipart boundary (no explicit Content-Type).
   * - URLSearchParams: builds from the object for form-urlencoded.
   * - Blob/ArrayBuffer: passes through with the provided contentType.
   * - Plain objects: JSON.stringify with 'application/json'.
   */
  private prepareBody(options: ApiRequestOptions): { body: BodyInit | undefined; contentType: string | undefined } {
    // FormData takes precedence over body.
    if (options.formData !== undefined) {
      // For application/x-www-form-urlencoded, build URLSearchParams.
      // For multipart/form-data, build FormData and let the browser set the boundary.
      if (options.contentType === 'application/x-www-form-urlencoded') {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options.formData)) {
          if (value === undefined || value === null) {
            continue;
          }
          // Arrays are repeated keys (the OpenAPI default for form encoding),
          // not \`1,2\` — \`String(array)\` loses the element boundary.
          if (Array.isArray(value)) {
            for (const item of value) {
              if (item !== undefined && item !== null) {
                params.append(key, String(item));
              }
            }
          } else {
            params.append(key, String(value));
          }
        }
        return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' };
      }
      const formData = new FormData();
      for (const [key, value] of Object.entries(options.formData)) {
        if (value === undefined || value === null) {
          continue;
        }
        if (value instanceof Blob) {
          formData.append(key, value);
        } else {
          formData.append(key, String(value));
        }
      }
      return { body: formData, contentType: undefined };
    }

    if (options.body !== undefined && options.body !== null) {
      // Pass through FormData, Blob, ArrayBuffer, URLSearchParams, ReadableStream.
      if (
        options.body instanceof FormData ||
        options.body instanceof Blob ||
        options.body instanceof ArrayBuffer ||
        options.body instanceof URLSearchParams ||
        (typeof ReadableStream !== 'undefined' && options.body instanceof ReadableStream)
      ) {
        return { body: options.body as BodyInit, contentType: options.contentType };
      }
      // Default: JSON.stringify.
      return { body: JSON.stringify(options.body), contentType: options.contentType ?? 'application/json' };
    }

    return { body: undefined, contentType: undefined };
  }

  private async parseBody(
    response: Response,
    responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream',
  ): Promise<unknown> {
    if (responseType) {
      switch (responseType) {
        case 'json':
          // Honor the actual response Content-Type when it contradicts the
          // spec-declared responseType. A server may declare application/json
          // in the OpenAPI document but actually return text/plain or
          // text/html. In that case, return the raw text instead of forcing
          // JSON parsing (which would throw a SyntaxError on non-JSON bodies).
          return this.parseJson(response);
        case 'text':
          return response.text();
        case 'blob':
          return response.blob();
        case 'arrayBuffer':
          return response.arrayBuffer();
        case 'stream':
          // \`response.body\` is typed \`ReadableStream | null\` per DOM types — it is
          // null for responses that cannot have a body (204, 304, redirects,
          // empty SSE responses). The generated \`request<ReadableStream<Uint8Array> | null>\`
          // type reflects this honestly, so the raw value is passed through.
          return response.body;
      }
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      return this.parseJson(response);
    }

    if (contentType === 'text/event-stream') {
      // Spec-declared or content-type-detected SSE stream. \`response.body\` is
      // typed \`ReadableStream | null\` — passed through as-is for the same
      // reason as the \`case 'stream'\` branch above.
      return response.body;
    }

    if (contentType.startsWith('text/')) {
      return response.text();
    }

    if (contentType.length === 0) {
      return undefined;
    }

    return response.blob();
  }

  /**
   * Safely parses a JSON response body.
   *
   * - An empty body (e.g. a 200 with Content-Type: application/json but no
   *   content) returns undefined instead of throwing a SyntaxError.
   * - If the actual response Content-Type is not JSON (e.g. a server returns
   *   text/plain or text/html despite the spec declaring application/json),
   *   the raw text is returned without attempting JSON.parse.
   * - As a last line of defense, if JSON.parse still fails (e.g. a JSON
   *   Content-Type header with a non-JSON body), the raw text is returned
   *   instead of throwing a SyntaxError.
   */
  private async parseJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.length > 0 && !contentType.includes('json')) {
      // The server returned a non-JSON content type (e.g. text/plain, text/html,
      // image/png) despite the spec declaring application/json. Return the raw
      // text instead of forcing JSON parsing (which would throw a SyntaxError).
      const text = await response.text();
      return text.length > 0 ? text : undefined;
    }
    const text = await response.text();
    if (text.length === 0) {
      return undefined;
    }
    try {
      return ${dateTransformer ? 'transformDates(JSON.parse(text))' : 'JSON.parse(text)'};
    } catch {
      // The body claims to be JSON but is not valid JSON. Return the raw text
      // so callers receive something usable instead of a SyntaxError.
      return text;
    }
  }

  /**
   * Builds the request URL from the configured base path and the operation
   * path.
   *
   * The base is treated as a *directory*, not as a file: \`new URL(path, base)\`
   * drops the last base segment (\`new URL('/events', 'https://h/api')\` is
   * \`https://h/events\`). Joining the strings first keeps \`/api\` intact.
   *
   * Relative base paths (\`/api\` for a dev-server proxy, or \`''\`) are extremely
   * common and would throw \`Invalid URL\` when handed to the \`URL\` constructor,
   * so a synthetic origin is used for query serialization and stripped again
   * afterwards — otherwise server-side rendering would request
   * \`http://localhost/api/...\`.
   */
  private buildUrl(path: string, query?: Record<string, unknown | QueryParamOptions>): string {
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    const resolvedBase = this.baseUrl || (typeof document === 'undefined' ? '' : document.baseURI);

    // A protocol-relative base (\`//cdn.example.com/api\`) does not match the
    // absolute-URL test, so string concatenation used to mangle it into
    // \`le.com/api/...\`. A base carrying a query or fragment cannot be joined by
    // concatenation either — the path would land after the \`?\`/\`#\`. Both are
    // resolved through \`URL\` with the path appended to the pathname.
    if (resolvedBase.startsWith('//') || /[?#]/.test(resolvedBase)) {
      const joined = new URL(resolvedBase, 'http://localhost');
      joined.pathname = \`\${joined.pathname.replace(/\\/+$/, '')}\${normalizedPath}\`;

      const merged = this.appendQuery(joined, query).toString();

      // \`URL\` normalizes a protocol-relative base to \`http:\`; restore the
      // scheme-less form the caller configured.
      if (resolvedBase.startsWith('//')) {
        return merged.slice('http:'.length);
      }

      return merged;
    }

    const base = resolvedBase.replace(/\\/+$/, '');
    const joined = base + normalizedPath;

    // Absolute bases keep their origin; relative ones are resolved against a
    // synthetic origin that is removed again below.
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\\/\\//i.test(joined);
    const url = isAbsolute ? new URL(joined) : new URL(joined, 'http://localhost');

    const result = this.appendQuery(url, query).toString();

    return isAbsolute ? result : result.slice('http://localhost'.length);
  }

  /** Appends the serialized query parameters to \`url\`. */
  private appendQuery(url: URL, query?: Record<string, unknown | QueryParamOptions>): URL {
    for (const [key, raw] of Object.entries(query ?? {})) {
      if (raw === undefined || raw === null) {
        continue;
      }

      // Check if the value is wrapped with serialization metadata.
      const isWrapped =
        typeof raw === 'object' &&
        raw !== null &&
        !Array.isArray(raw) &&
        'value' in raw &&
        'style' in raw;

      if (isWrapped) {
        const opts = raw as QueryParamOptions;
        if (opts.value === undefined || opts.value === null) {
          continue;
        }
        this.appendQueryParam(url, key, opts.value, opts.style, opts.explode);
      } else {
        this.appendQueryParam(url, key, raw, 'form', true);
      }
    }

    return url;
  }

  /**
   * Serializes one query parameter.
   *
   * A nested object cannot be expressed by any OpenAPI query style: \`form\`,
   * \`spaceDelimited\` and \`pipeDelimited\` flatten one level only, and
   * \`deepObject\` is defined as a single level of \`key[prop]\`. Previously such
   * values fell through to \`String(value)\` and were sent as \`[object Object]\`
   * — a silent data loss. They now throw, so the failure is visible at the
   * call site instead of in the backend.
   */
  private appendQueryParam(
    url: URL,
    key: string,
    value: unknown,
    style: 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject',
    explode: boolean,
  ): void {
    if (Array.isArray(value)) {
      if (explode) {
        for (const item of value) {
          url.searchParams.append(key, this.serializeScalar(key, item, style));
        }
      } else {
        url.searchParams.set(key, this.joinValues(value, style, key));
      }
      return;
    }

    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value).filter(
        ([, val]) => val !== undefined && val !== null,
      );

      // deepObject is keyed by definition (\`color[R]=100\`), regardless of explode.
      if (style === 'deepObject') {
        for (const [prop, val] of entries) {
          url.searchParams.append(
            \`\${key}[\${prop}]\`,
            this.serializeScalar(\`\${key}[\${prop}]\`, val, style),
          );
        }
        return;
      }

      if (explode) {
        // form + explode:true — each property becomes its own parameter.
        for (const [prop, val] of entries) {
          url.searchParams.append(prop, this.serializeScalar(prop, val, style));
        }
        return;
      }

      url.searchParams.set(
        key,
        entries
          .map(
            ([prop, val]) =>
              \`\${prop}\${this.separatorFor(style)}\${this.serializeScalar(prop, val, style)}\`,
          )
          .join(this.separatorFor(style)),
      );
      return;
    }

    url.searchParams.set(key, this.serializeScalar(key, value, style));
  }

  /**
   * Renders a single query value, rejecting shapes no style can express.
   *
   * Arrays are joined with the style separator (a nested array cannot be
   * nested in the URL syntax either), objects and other non-primitives throw.
   */
  private serializeScalar(key: string, value: unknown, style: string): string {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.serializeScalar(key, item, style))
        .join(this.separatorFor(style as 'form'));
    }

    if (typeof value === 'object' && value !== null) {
      throw new TypeError(
        \`Query parameter '\${key}' is a nested object, which no OpenAPI query style can serialize. \` +
          \`Flatten it, or send it in the request body.\`,
      );
    }

    return String(value);
  }

  /** Separator used by the non-exploded delimited styles. */
  private separatorFor(style: 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject'): string {
    return style === 'spaceDelimited' ? ' ' : style === 'pipeDelimited' ? '|' : ',';
  }

  /** Joins an array with the separator of the requested style. */
  private joinValues(
    values: unknown[],
    style: 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject',
    key: string,
  ): string {
    return values.map((v) => this.serializeScalar(key, v, style)).join(this.separatorFor(style));
  }
}
`;
}
