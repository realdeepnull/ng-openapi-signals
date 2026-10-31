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
import { firstValueFrom } from 'rxjs';
import {
  NG_OPENAPI_SIGNALS_BASE_PATH,
  NG_OPENAPI_SIGNALS_AUTH,
  NG_OPENAPI_SIGNALS_DEFAULT_HEADERS,
  NG_OPENAPI_SIGNALS_ERROR_MAPPER,
  NG_OPENAPI_SIGNALS_REQUEST_HOOK,
  NG_OPENAPI_SIGNALS_RESPONSE_HOOK,
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

    try {
      let response: HttpResponse<unknown>;

      if (responseType === 'arraybuffer') {
        response = await firstValueFrom(
          this.http.request(context.method, context.url, {
            headers: context.headers,
            ...(context.body !== undefined ? { body: context.body } : {}),
            observe: 'response',
            responseType: 'arraybuffer',
            ...(options.signal ? { signal: options.signal } : {}),
          }),
        );
      } else if (responseType === 'blob') {
        response = await firstValueFrom(
          this.http.request(context.method, context.url, {
            headers: context.headers,
            ...(context.body !== undefined ? { body: context.body } : {}),
            observe: 'response',
            responseType: 'blob',
            ...(options.signal ? { signal: options.signal } : {}),
          }),
        );
      } else if (responseType === 'text') {
        response = await firstValueFrom(
          this.http.request(context.method, context.url, {
            headers: context.headers,
            ...(context.body !== undefined ? { body: context.body } : {}),
            observe: 'response',
            responseType: 'text',
            ...(options.signal ? { signal: options.signal } : {}),
          }),
        );
      } else {
        response = await firstValueFrom(
          this.http.request<unknown>(context.method, context.url, {
            headers: context.headers,
            ...(context.body !== undefined ? { body: context.body } : {}),
            observe: 'response',
            responseType: 'json',
            ...(options.signal ? { signal: options.signal } : {}),
          }),
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
      if (error instanceof HttpErrorResponse) {
        throw await this.errorMapper(error);
      }
      throw error;
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
   * - Plain objects: passed directly; HttpClient serializes as JSON.
   */
  private prepareBody(options: ApiRequestOptions): { body: unknown; contentType: string | undefined } {
    // FormData takes precedence over body.
    if (options.formData !== undefined) {
      if (options.contentType === 'application/x-www-form-urlencoded') {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options.formData)) {
          if (value !== undefined && value !== null) {
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
   * new URL(path, base) requires an absolute base. Relative base paths
   * (e.g. /api for a dev-server proxy) are common, so they are resolved
   * against the current document base. A path without a leading slash would
   * otherwise be appended to the last base segment instead of replacing it.
   */
  private buildUrl(path: string, query?: Record<string, unknown | QueryParamOptions>): string {
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    const base = this.baseUrl || (typeof document === 'undefined' ? '/' : document.baseURI);
    const url = new URL(normalizedPath, base);

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

    return url.toString();
  }

  /**
   * Appends a query parameter using the specified OpenAPI style/explode.
   *
   * - form + explode:true  → key=val1&key=val2 (repeated keys)
   * - form + explode:false → key=val1,val2 (comma-separated)
   * - spaceDelimited + explode:false → key=val1%20val2
   * - spaceDelimited + explode:true  → key=val1&key=val2
   * - pipeDelimited + explode:false  → key=val1|val2
   * - pipeDelimited + explode:true   → key=val1&key=val2
   * - deepObject (explode:true only)  → key[prop]=val
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
          url.searchParams.append(key, String(item));
        }
      } else {
        const sep = style === 'spaceDelimited' ? ' ' : style === 'pipeDelimited' ? '|' : ',';
        url.searchParams.set(key, value.map((v) => String(v)).join(sep));
      }
    } else if (typeof value === 'object' && value !== null && style === 'deepObject' && explode) {
      for (const [prop, val] of Object.entries(value)) {
        if (val !== undefined && val !== null) {
          url.searchParams.append(\`\${key}[\${prop}]\`, String(val));
        }
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}
`;
}
