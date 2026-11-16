import {describe, it, expect, vi, afterEach} from 'vitest';

// Tests mirror the generated api-http-client.ts template logic without Angular DI.
// Dependencies that would be injected are passed explicitly to `createClient`.
// Angular's HttpClient, HttpResponse, HttpErrorResponse, and rxjs Observables
// are stubbed locally to avoid adding @angular/common and rxjs as test deps.

interface HttpHeadersStub {
  get(name: string): string | null;
}

interface HttpResponseStub<T> {
  status: number;
  body: T;
}

interface HttpErrorResponseStub {
  status: number;
  statusText: string;
  error: unknown;
  headers: HttpHeadersStub;
}

/** Simple Observable-like stub that mimics firstValueFrom via toPromise(). */
class ObservableStub<T> {
  constructor(
    private readonly value: T | unknown,
    private readonly shouldReject = false,
  ) {}

  toPromise(): Promise<T> {
    if (this.shouldReject) {
      return Promise.reject(this.value);
    }
    return Promise.resolve(this.value as T);
  }
}

function of<T>(value: T): ObservableStub<T> {
  return new ObservableStub(value);
}

function throwError(error: unknown): ObservableStub<never> {
  return new ObservableStub(error, true) as ObservableStub<never>;
}

function httpResponse<T>(body: T, status: number): HttpResponseStub<T> {
  return {status, body};
}

function httpError(status: number, statusText: string, error: unknown): HttpErrorResponseStub {
  return {
    status,
    statusText,
    error,
    headers: {get: () => null},
  };
}

interface QueryParamOptions {
  value: unknown;
  style: 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject';
  explode: boolean;
}

interface ApiRequestOptions {
  method: string;
  path: string;
  query?: Record<string, unknown | QueryParamOptions>;
  headers?: Record<string, string>;
  body?: unknown;
  formData?: Record<string, unknown>;
  contentType?: string;
  signal?: AbortSignal | undefined;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
}

interface ApiRequestContext {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

type ApiAuthHook = () => Record<string, string> | Promise<Record<string, string>>;
type ApiErrorMapper = (
  error: HttpErrorResponseStub,
) => Promise<ApiError | Error> | ApiError | Error;
type ApiRequestHook = (request: ApiRequestContext) => void | Promise<void>;
type ApiResponseHook = (response: HttpResponseStub<unknown>) => void | Promise<void>;

class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;
  readonly headers: HttpHeadersStub;

  constructor(status: number, statusText: string, body: unknown, headers: HttpHeadersStub) {
    super(`HTTP ${status}${statusText ? ': ' + statusText : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.headers = headers;
  }
}

interface ClientDeps {
  baseUrl: string;
  auth?: ApiAuthHook;
  defaultHeaders?: Record<string, string>;
  errorMapper?: ApiErrorMapper;
  onRequest?: ApiRequestHook;
  onResponse?: ApiResponseHook;
  http: {request: (...args: unknown[]) => unknown};
}

function separatorFor(style: 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject'): string {
  return style === 'spaceDelimited' ? ' ' : style === 'pipeDelimited' ? '|' : ',';
}

function appendQueryParam(
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
      url.searchParams.set(key, value.map((v) => String(v)).join(separatorFor(style)));
    }
    return;
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, val]) => val !== undefined && val !== null);

    if (style === 'deepObject') {
      for (const [prop, val] of entries) {
        url.searchParams.append(`${key}[${prop}]`, String(val));
      }
      return;
    }

    if (explode) {
      for (const [prop, val] of entries) {
        url.searchParams.append(prop, String(val));
      }
      return;
    }

    const sep = separatorFor(style);
    url.searchParams.set(
      key,
      entries.map(([prop, val]) => `${prop}${sep}${String(val)}`).join(sep),
    );
    return;
  }

  url.searchParams.set(key, String(value));
}
function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, unknown | QueryParamOptions>,
): string {
  const url = new URL(path, baseUrl);

  for (const [key, raw] of Object.entries(query ?? {})) {
    if (raw === undefined || raw === null) {
      continue;
    }

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
      appendQueryParam(url, key, opts.value, opts.style, opts.explode);
    } else {
      appendQueryParam(url, key, raw, 'form', true);
    }
  }

  return url.toString();
}

function mapResponseType(
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

function toApiErrorFromHttpErrorResponse(error: HttpErrorResponseStub): ApiError {
  return new ApiError(error.status, '', error.error, error.headers);
}

function prepareBody(options: ApiRequestOptions): {body: unknown; contentType: string | undefined} {
  if (options.formData !== undefined) {
    if (options.contentType === 'application/x-www-form-urlencoded') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.formData)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      }
      return {body: params.toString(), contentType: 'application/x-www-form-urlencoded'};
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
    return {body: formData, contentType: undefined};
  }

  if (options.body !== undefined && options.body !== null) {
    if (
      options.body instanceof FormData ||
      options.body instanceof Blob ||
      options.body instanceof ArrayBuffer ||
      options.body instanceof URLSearchParams
    ) {
      return {body: options.body, contentType: options.contentType};
    }
    return {body: options.body, contentType: options.contentType ?? 'application/json'};
  }

  return {body: undefined, contentType: undefined};
}

function createClient(deps: ClientDeps) {
  const defaultHeaders = deps.defaultHeaders ?? {};
  const errorMapper = deps.errorMapper ?? toApiErrorFromHttpErrorResponse;

  async function request<T>(options: ApiRequestOptions): Promise<T> {
    const url = buildUrl(deps.baseUrl, options.path, options.query);

    const authHeaders = deps.auth ? await deps.auth() : {};

    const {body, contentType} = prepareBody(options);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...defaultHeaders,
      ...authHeaders,
      ...(contentType ? {'Content-Type': contentType} : {}),
      ...options.headers,
    };

    const context: ApiRequestContext = {
      url,
      method: options.method,
      headers,
      body,
    };

    if (deps.onRequest) {
      await deps.onRequest(context);
    }

    const responseType = mapResponseType(options.responseType);

    try {
      const observable = (await deps.http.request(context.method, context.url, {
        headers: context.headers,
        ...(context.body !== undefined ? {body: context.body} : {}),
        observe: 'response',
        ...(responseType
          ? {responseType: responseType as 'json' | 'text' | 'blob' | 'arraybuffer'}
          : {}),
        ...(options.signal ? {signal: options.signal} : {}),
      })) as ObservableStub<unknown>;
      const response = (await observable.toPromise()) as HttpResponseStub<unknown>;

      if (deps.onResponse) {
        await deps.onResponse(response);
      }

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      return response.body as T;
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && 'statusText' in error) {
        throw await errorMapper(error as HttpErrorResponseStub);
      }
      throw error;
    }
  }

  return {request};
}

/** Creates a mock HttpClient whose request() returns an Observable. */
function mockHttp(response: HttpResponseStub<unknown>) {
  return {
    request: vi.fn().mockReturnValue(of(response)),
  };
}

/** Creates a mock HttpClient whose request() returns an error Observable. */
function mockHttpError(error: HttpErrorResponseStub) {
  return {
    request: vi.fn().mockReturnValue(throwError(error)),
  };
}

describe('ApiHttpClient request logic', () => {
  const baseUrl = 'https://api.example.com';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('URL building', () => {
    it('builds URL with path parameters', () => {
      const url = buildUrl(baseUrl, '/users/123');
      expect(url).toBe('https://api.example.com/users/123');
    });

    it('builds URL with query parameters', () => {
      const url = buildUrl(baseUrl, '/users', {q: 'john', limit: 10});
      expect(url).toContain('q=john');
      expect(url).toContain('limit=10');
    });

    it('skips undefined and null query parameters', () => {
      const url = buildUrl(baseUrl, '/users', {q: 'test', skip: undefined, limit: null});
      expect(url).toContain('q=test');
      expect(url).not.toContain('skip');
      expect(url).not.toContain('limit');
    });

    it('handles array query parameters', () => {
      const url = buildUrl(baseUrl, '/users', {tags: ['admin', 'active']});
      expect(url).toContain('tags=admin');
      expect(url).toContain('tags=active');
    });
  });

  describe('responseType mapping', () => {
    it('maps arrayBuffer to arraybuffer (Angular lowercase)', () => {
      expect(mapResponseType('arrayBuffer')).toBe('arraybuffer');
    });

    it('passes json, text, blob unchanged', () => {
      expect(mapResponseType('json')).toBe('json');
      expect(mapResponseType('text')).toBe('text');
      expect(mapResponseType('blob')).toBe('blob');
    });

    it('returns undefined when no responseType', () => {
      expect(mapResponseType(undefined)).toBeUndefined();
    });
  });

  describe('response parsing', () => {
    it('returns parsed JSON body for successful responses', async () => {
      const response = httpResponse({id: 1, name: 'John'}, 200);
      const client = createClient({baseUrl, http: mockHttp(response)});

      const result = await client.request<{id: number; name: string}>({
        method: 'GET',
        path: '/users/1',
      });

      expect(result).toEqual({id: 1, name: 'John'});
    });

    it('returns undefined for 204 No Content', async () => {
      const response = httpResponse(null, 204);
      const client = createClient({baseUrl, http: mockHttp(response)});

      const result = await client.request<void>({method: 'DELETE', path: '/users/1'});

      expect(result).toBeUndefined();
    });
  });

  describe('headers', () => {
    it('sends JSON body with Content-Type header', async () => {
      const response = httpResponse({id: 1}, 201);
      const http = mockHttp(response);
      const client = createClient({baseUrl, http});

      await client.request({method: 'POST', path: '/users', body: {name: 'John'}});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.headers).toHaveProperty('Content-Type', 'application/json');
      expect(opts.body).toEqual({name: 'John'});
    });

    it('does not set Content-Type when body is undefined', async () => {
      const response = httpResponse([], 200);
      const http = mockHttp(response);
      const client = createClient({baseUrl, http});

      await client.request({method: 'GET', path: '/users'});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.headers).not.toHaveProperty('Content-Type');
    });

    it('merges default headers into every request', async () => {
      const response = httpResponse({}, 200);
      const http = mockHttp(response);
      const client = createClient({
        baseUrl,
        defaultHeaders: {'X-Client': 'ng-openapi-signals'},
        http,
      });

      await client.request({method: 'GET', path: '/users'});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.headers).toHaveProperty('X-Client', 'ng-openapi-signals');
      expect(opts.headers).toHaveProperty('Accept', 'application/json');
    });

    it('per-request headers override default headers', async () => {
      const response = httpResponse({}, 200);
      const http = mockHttp(response);
      const client = createClient({
        baseUrl,
        defaultHeaders: {'X-Client': 'default'},
        http,
      });

      await client.request({method: 'GET', path: '/users', headers: {'X-Client': 'override'}});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.headers).toHaveProperty('X-Client', 'override');
    });
  });

  describe('auth hook', () => {
    it('merges auth headers into every request', async () => {
      const response = httpResponse({}, 200);
      const http = mockHttp(response);
      const client = createClient({
        baseUrl,
        auth: () => ({Authorization: 'Bearer token-123'}),
        http,
      });

      await client.request({method: 'GET', path: '/users'});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.headers).toHaveProperty('Authorization', 'Bearer token-123');
    });

    it('supports async auth hooks', async () => {
      const response = httpResponse({}, 200);
      const http = mockHttp(response);
      const client = createClient({
        baseUrl,
        auth: async () => {
          await Promise.resolve();
          return {Authorization: 'Bearer async'};
        },
        http,
      });

      await client.request({method: 'GET', path: '/users'});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.headers).toHaveProperty('Authorization', 'Bearer async');
    });

    it('does not add auth headers when no auth hook is provided', async () => {
      const response = httpResponse({}, 200);
      const http = mockHttp(response);
      const client = createClient({baseUrl, http});

      await client.request({method: 'GET', path: '/users'});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.headers).not.toHaveProperty('Authorization');
    });
  });

  describe('error handling', () => {
    it('throws ApiError on non-OK responses using the default error mapper', async () => {
      const error = httpError(404, 'Not Found', 'Not Found');
      const client = createClient({baseUrl, http: mockHttpError(error)});

      await expect(client.request({method: 'GET', path: '/users/999'})).rejects.toMatchObject({
        status: 404,
        statusText: '',
      });
    });

    it('uses a custom error mapper when provided', async () => {
      const error = httpError(403, 'Forbidden', 'Forbidden');
      const customMapper: ApiErrorMapper = (err) => new Error(`Custom ${err.status}`);
      const client = createClient({
        baseUrl,
        errorMapper: customMapper,
        http: mockHttpError(error),
      });

      await expect(client.request({method: 'GET', path: '/secret'})).rejects.toThrow('Custom 403');
    });
  });

  describe('request and response hooks', () => {
    it('calls onRequest before the HTTP call', async () => {
      const calls: string[] = [];
      const response = httpResponse({}, 200);
      const http = {
        request: vi.fn().mockImplementation(() => {
          calls.push('http');
          return of(response);
        }),
      };
      const client = createClient({
        baseUrl,
        onRequest: () => {
          calls.push('onRequest');
        },
        http,
      });

      await client.request({method: 'GET', path: '/users'});

      expect(calls).toEqual(['onRequest', 'http']);
    });

    it('calls onResponse after a successful response', async () => {
      const calls: string[] = [];
      const response = httpResponse({}, 200);
      const http = {
        request: vi.fn().mockImplementation(() => {
          calls.push('http');
          return of(response);
        }),
      };
      const client = createClient({
        baseUrl,
        onResponse: () => {
          calls.push('onResponse');
        },
        http,
      });

      await client.request({method: 'GET', path: '/users'});

      expect(calls).toEqual(['http', 'onResponse']);
    });

    it('onRequest can mutate the request context', async () => {
      const response = httpResponse({}, 200);
      const http = mockHttp(response);
      const client = createClient({
        baseUrl,
        onRequest: (ctx) => {
          ctx.headers = {...ctx.headers, 'X-Hook': 'yes'};
        },
        http,
      });

      await client.request({method: 'GET', path: '/users'});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.headers).toHaveProperty('X-Hook', 'yes');
    });
  });

  describe('query parameter styles', () => {
    it('serializes spaceDelimited with explode:false as space-separated', () => {
      const url = buildUrl(baseUrl, '/search', {
        tags: {value: ['a', 'b'], style: 'spaceDelimited', explode: false},
      });
      // URLSearchParams encodes spaces as +
      expect(url).toContain('tags=a+b');
    });

    it('serializes pipeDelimited with explode:false as pipe-separated', () => {
      const url = buildUrl(baseUrl, '/search', {
        categories: {value: ['x', 'y'], style: 'pipeDelimited', explode: false},
      });
      expect(url).toContain('categories=x%7Cy');
    });

    it('serializes deepObject with explode:true as nested keys', () => {
      const url = buildUrl(baseUrl, '/search', {
        filters: {value: {status: 'active', role: 'admin'}, style: 'deepObject', explode: true},
      });
      expect(url).toContain('filters%5Bstatus%5D=active');
      expect(url).toContain('filters%5Brole%5D=admin');
    });

    // Object params are legal for `form` (the OpenAPI default style) and for the
    // delimited styles; before this was handled they serialized as
    // `[object Object]`. Expected values follow the OAS 3.0.3 style table.
    it('serializes a form object with explode:true as one param per property', () => {
      const url = buildUrl(baseUrl, '/search', {
        color: {value: {R: 100, G: 200, B: 150}, style: 'form', explode: true},
      });
      expect(url).toContain('?R=100&G=200&B=150');
      expect(url).not.toContain('Object');
    });

    it('serializes a form object with explode:false as key/value pairs', () => {
      const url = buildUrl(baseUrl, '/search', {
        color: {value: {R: 100, G: 200, B: 150}, style: 'form', explode: false},
      });
      expect(url).toContain('color=R%2C100%2CG%2C200%2CB%2C150');
    });

    it('serializes a form object passed as a plain value (default explode:true)', () => {
      const url = buildUrl(baseUrl, '/search', {color: {R: 100, G: 200}});
      expect(url).toContain('?R=100&G=200');
    });

    it('serializes spaceDelimited and pipeDelimited objects', () => {
      const spaced = buildUrl(baseUrl, '/search', {
        color: {value: {R: 100, G: 200}, style: 'spaceDelimited', explode: false},
      });
      expect(spaced).toContain('color=R+100+G+200');

      const piped = buildUrl(baseUrl, '/search', {
        color: {value: {R: 100, G: 200}, style: 'pipeDelimited', explode: false},
      });
      expect(piped).toContain('color=R%7C100%7CG%7C200');
    });

    it('serializes a deepObject regardless of explode', () => {
      const notExploded = buildUrl(baseUrl, '/search', {
        color: {value: {R: 100, G: 200}, style: 'deepObject', explode: false},
      });
      expect(notExploded).toContain('color%5BR%5D=100');
    });
  });

  describe('FormData and binary body handling', () => {
    it('builds FormData from formData object for multipart', async () => {
      const response = httpResponse({url: 'ok'}, 200);
      const http = mockHttp(response);
      const client = createClient({baseUrl, http});

      const blob = new Blob(['file-content'], {type: 'image/png'});
      await client.request({
        method: 'POST',
        path: '/upload',
        formData: {file: blob, caption: 'test'},
        contentType: 'multipart/form-data',
      });

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.body).toBeInstanceOf(FormData);
    });

    it('builds URLSearchParams for application/x-www-form-urlencoded', async () => {
      const response = httpResponse({created: 1}, 200);
      const http = mockHttp(response);
      const client = createClient({baseUrl, http});

      await client.request({
        method: 'POST',
        path: '/bulk',
        formData: {names: 'a,b', count: 1},
        contentType: 'application/x-www-form-urlencoded',
      });

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.body).toBe('names=a%2Cb&count=1');
      expect(opts.headers).toHaveProperty('Content-Type', 'application/x-www-form-urlencoded');
    });

    it('passes Blob body through without JSON serialization', async () => {
      const response = httpResponse({}, 200);
      const http = mockHttp(response);
      const client = createClient({baseUrl, http});

      const blob = new Blob(['binary'], {type: 'application/octet-stream'});
      await client.request({
        method: 'POST',
        path: '/upload',
        body: blob,
        contentType: 'application/octet-stream',
      });

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.body).toBe(blob);
      expect(opts.headers).toHaveProperty('Content-Type', 'application/octet-stream');
    });
  });

  describe('stream responseType mapping', () => {
    it('maps stream to blob (Angular HttpClient has no native stream)', () => {
      expect(mapResponseType('stream')).toBe('blob');
    });
  });

  describe('body: null handling', () => {
    it('does not send a body when body is null', async () => {
      const response = httpResponse({ok: true}, 200);
      const http = mockHttp(response);
      const client = createClient({baseUrl, http});

      await client.request({method: 'POST', path: '/users', body: null});

      const callArgs = (http.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = callArgs?.[2];
      expect(opts.body).toBeUndefined();
      expect(opts.headers).not.toHaveProperty('Content-Type');
    });
  });
});
