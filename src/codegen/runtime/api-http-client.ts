import type {GeneratorConfig} from '../types';

/**
 * Derives the `Accept` header from the operation's response type hint.
 *
 * A JSON-only Accept header makes servers return 406 (or a JSON error
 * document) for endpoints declared as text, image or event-stream in the
 * spec. Falls back to a wildcard when the parser is unknown, letting the
 * server pick.
 */
const ACCEPT_HELPERS = `function acceptForResponseType(
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
 * Whether an HTTP status code can legally carry a response body.
 *
 * 204, 205 and 304 are body-less per RFC 9110; Angular reports \`null\` for
 * them and some servers send a stray \`Content-Length\`, so they
 * short-circuit to \`undefined\`.
 */
function hasResponseBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

/** Mirrors the rejection \`fetch\` produces for an aborted request. */
function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * Whether an error signals an abort rather than a failure.
 *
 * \`AbortError\` comes from a caller-provided signal; \`TimeoutError\` comes from
 * the \`timeout\` option (Angular's fetch backend aborts with
 * \`DOMException('signal timed out', 'TimeoutError')\`). Both are rethrown
 * unchanged so cancellation stays distinguishable from a network failure —
 * matching the \`fetch\` transport.
 */
function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
`;

export function generateApiHttpClient(config: GeneratorConfig): string {
  const responseTypeHints = config.runtime?.responseTypeHints ?? true;
  const dateTransformer = config.runtime?.dateTransformer === true;
  const responseTypeField = responseTypeHints
    ? `  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';\n`
    : '';
  const dateUtilsImport = dateTransformer ? `import { transformDates } from './date-utils';\n` : '';

  return `import { Service, inject } from '@angular/core';
${dateUtilsImport}import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { firstValueFrom, Observable, takeUntil } from 'rxjs';
import {
  NG_OPENAPI_SIGNALS_BASE_PATH,
  NG_OPENAPI_SIGNALS_AUTH,
  NG_OPENAPI_SIGNALS_DEFAULT_HEADERS,
  NG_OPENAPI_SIGNALS_ERROR_MAPPER,
  NG_OPENAPI_SIGNALS_REQUEST_HOOK,
  NG_OPENAPI_SIGNALS_RESPONSE_HOOK,
  NG_OPENAPI_SIGNALS_TIMEOUT,
  type ApiRequestContext,
} from './providers';

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

${ACCEPT_HELPERS}
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

@Service()
export class ApiHttpClient {
  private readonly baseUrl = inject(NG_OPENAPI_SIGNALS_BASE_PATH);
  private readonly http = inject(HttpClient);
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

    const context: ApiRequestContext = {
      url,
      method: options.method,
      headers,
      body
    };

    if (this.onRequest) {
      await this.onRequest(context);
    }

    const responseType = this.mapResponseType(options.responseType);

    // Angular's \`HttpClient\` has no \`signal\` option — \`HttpRequestOptions\` only
    // knows \`timeout\`, and an extra \`signal\` property is silently dropped by the
    // runtime (and rejected by \`tsc\`). So the timeout is passed natively and the
    // caller's signal aborts through \`takeUntil\`.
    const timeoutOption = this.timeoutMs > 0 ? { timeout: this.timeoutMs } : {};
    const abort$ = options.signal ? this.abortOn(options.signal) : undefined;

    try {
      let response: HttpResponse<unknown>;

      if (responseType === 'arraybuffer') {
        response = await firstValueFrom(
          this.http
            .request(context.method, context.url, {
              headers: context.headers,
              ...(context.body !== undefined ? { body: context.body } : {}),
              observe: 'response',
              responseType: 'arraybuffer',
              ...timeoutOption,
            })
            .pipe(abort$ ? takeUntil(abort$) : (source) => source),
        );
      } else if (responseType === 'blob') {
        response = await firstValueFrom(
          this.http
            .request(context.method, context.url, {
              headers: context.headers,
              ...(context.body !== undefined ? { body: context.body } : {}),
              observe: 'response',
              responseType: 'blob',
              ...timeoutOption,
            })
            .pipe(abort$ ? takeUntil(abort$) : (source) => source),
        );
      } else if (responseType === 'text') {
        response = await firstValueFrom(
          this.http
            .request(context.method, context.url, {
              headers: context.headers,
              ...(context.body !== undefined ? { body: context.body } : {}),
              observe: 'response',
              responseType: 'text',
              ...timeoutOption,
            })
            .pipe(abort$ ? takeUntil(abort$) : (source) => source),
        );
      } else {
        response = await firstValueFrom(
          this.http
            .request<unknown>(context.method, context.url, {
              headers: context.headers,
              ...(context.body !== undefined ? { body: context.body } : {}),
              observe: 'response',
              responseType: 'json',
              ...timeoutOption,
            })
            .pipe(abort$ ? takeUntil(abort$) : (source) => source),
        );
      }

      if (this.onResponse) {
        await this.onResponse(response);
      }

      if (!hasResponseBody(response.status)) {
        return undefined as unknown as T;
      }

      return ${dateTransformer ? `(options.responseType === 'json' ? transformDates(response.body) : response.body)` : 'response.body'} as T;
    } catch (error) {
      // Aborts and timeouts surface as an \`HttpErrorResponse\` whose \`error\`
      // holds the DOMException. Re-throwing that keeps \`error.name\`
      // (\`AbortError\`/\`TimeoutError\`) available to the caller, exactly like the
      // \`fetch\` transport.
      if (isAbortLike(error)) {
        throw error;
      }

      if (error instanceof HttpErrorResponse) {
        if (isAbortLike(error.error)) {
          throw error.error;
        }

        throw await this.errorMapper(error);
      }

      throw error;
    }
  }

  /**
   * Emits as soon as \`signal\` aborts, for \`takeUntil\`.
   *
   * Rejects with an \`AbortError\` (matching the \`fetch\` transport), so
   * cancellation stays recognisable across both transports.
   */
  private abortOn(signal: AbortSignal): Observable<never> {
    return new Observable<never>((subscriber) => {
      if (signal.aborted) {
        subscriber.error(abortError());
        return;
      }

      const onAbort = () => subscriber.error(abortError());
      signal.addEventListener('abort', onAbort, {once: true});

      return () => signal.removeEventListener('abort', onAbort);
    });
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
   * - Plain objects: passed directly; HttpClient serializes as JSON.
   */
  private prepareBody(options: ApiRequestOptions): { body: unknown; contentType: string | undefined } {
    // FormData takes precedence over body.
    if (options.formData !== undefined) {
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
      // Pass through FormData, Blob, ArrayBuffer, URLSearchParams.
      if (
        options.body instanceof FormData ||
        options.body instanceof Blob ||
        options.body instanceof ArrayBuffer ||
        options.body instanceof URLSearchParams
      ) {
        return { body: options.body, contentType: options.contentType };
      }
      // Default: let HttpClient handle JSON serialization.
      return { body: options.body, contentType: options.contentType ?? 'application/json' };
    }

    return { body: undefined, contentType: undefined };
  }

  /**
   * Maps the responseType to Angular's HttpClient responseType.
   *
   * 'stream' maps to 'blob' since Angular HttpClient has no native stream
   * support. Consumers can call .stream() on the returned Blob.
   */
  private mapResponseType(
    responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream',
  ): 'json' | 'text' | 'blob' | 'arraybuffer' | undefined {
    if (!responseType) {
      return undefined;
    }
    switch (responseType) {
      case 'arrayBuffer':
        return 'arraybuffer';
      case 'stream':
        return 'blob';
      default:
        return responseType;
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
