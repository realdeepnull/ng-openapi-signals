import {describe, it, expect, vi, afterEach} from 'vitest';
import {
  createEnvironmentInjector,
  runInInjectionContext,
  Injector,
  type EnvironmentInjector,
  type Provider,
} from '@angular/core';
import {ApiFetchClient, type QueryParamOptions} from '../examples/generated/api-fetch-client';
import {
  NG_OPENAPI_SIGNALS_BASE_PATH,
  NG_OPENAPI_SIGNALS_MIDDLEWARE,
  NG_OPENAPI_SIGNALS_AUTH,
  NG_OPENAPI_SIGNALS_DEFAULT_HEADERS,
  NG_OPENAPI_SIGNALS_ERROR_MAPPER,
  NG_OPENAPI_SIGNALS_REQUEST_HOOK,
  NG_OPENAPI_SIGNALS_RESPONSE_HOOK,
  type ApiMiddlewareEntry,
  type ApiAuthHook,
  type ApiErrorMapper,
  type ApiRequestHook,
  type ApiResponseHook,
} from '../examples/generated/providers';
import {toApiError} from '../examples/generated/api-error';

const BASE_URL = 'https://api.example.com';

interface ClientOverrides {
  basePath?: string;
  middleware?: ReadonlyArray<ApiMiddlewareEntry>;
  auth?: ApiAuthHook;
  defaultHeaders?: Record<string, string>;
  errorMapper?: ApiErrorMapper;
  onRequest?: ApiRequestHook;
  onResponse?: ApiResponseHook;
}

function createClient(overrides: ClientOverrides = {}): ApiFetchClient {
  const providers: Provider[] = [
    {provide: NG_OPENAPI_SIGNALS_BASE_PATH, useValue: overrides.basePath ?? BASE_URL},
    {
      provide: NG_OPENAPI_SIGNALS_DEFAULT_HEADERS,
      useValue: overrides.defaultHeaders ?? {},
    },
    {
      provide: NG_OPENAPI_SIGNALS_ERROR_MAPPER,
      useValue: overrides.errorMapper ?? toApiError,
    },
  ];

  if (overrides.middleware) {
    for (const mw of overrides.middleware) {
      providers.push({
        provide: NG_OPENAPI_SIGNALS_MIDDLEWARE,
        multi: true,
        useValue: mw,
      });
    }
  }

  if (overrides.auth) {
    providers.push({provide: NG_OPENAPI_SIGNALS_AUTH, useValue: overrides.auth});
  }

  if (overrides.onRequest) {
    providers.push({provide: NG_OPENAPI_SIGNALS_REQUEST_HOOK, useValue: overrides.onRequest});
  }

  if (overrides.onResponse) {
    providers.push({provide: NG_OPENAPI_SIGNALS_RESPONSE_HOOK, useValue: overrides.onResponse});
  }

  const injector: EnvironmentInjector = createEnvironmentInjector(
    providers,
    Injector.NULL as EnvironmentInjector,
  );

  return runInInjectionContext(injector, () => new ApiFetchClient());
}

function mockFetch(response: Response) {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function getFetchCall(fetchMock: typeof fetch, index = 0): {url: string; init: RequestInit} {
  const mock = fetchMock as unknown as ReturnType<typeof vi.fn>;
  const call = mock.mock.calls[index];
  return {url: call?.[0] as string, init: call?.[1] as RequestInit};
}

describe('generated ApiFetchClient (runtime via DI)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('URL building', () => {
    it('builds URL with path parameters', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'GET', path: '/users/123'});

      expect(getFetchCall(fetchMock).url).toBe('https://api.example.com/users/123');
    });

    it('builds URL with query parameters', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'GET', path: '/users', query: {q: 'john', limit: 10}});

      const url = getFetchCall(fetchMock).url;
      expect(url).toContain('q=john');
      expect(url).toContain('limit=10');
    });

    it('skips undefined and null query parameters', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({
        method: 'GET',
        path: '/users',
        query: {q: 'test', skip: undefined, limit: null},
      });

      const url = getFetchCall(fetchMock).url;
      expect(url).toContain('q=test');
      expect(url).not.toContain('skip');
      expect(url).not.toContain('limit');
    });

    it('handles array query parameters (form + explode:true by default)', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'GET', path: '/users', query: {tags: ['admin', 'active']}});

      const url = getFetchCall(fetchMock).url;
      expect(url).toContain('tags=admin');
      expect(url).toContain('tags=active');
    });
  });

  describe('query parameter styles', () => {
    it('serializes spaceDelimited with explode:false as space-separated', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const opts: QueryParamOptions = {value: ['a', 'b'], style: 'spaceDelimited', explode: false};
      await client.request({method: 'GET', path: '/search', query: {tags: opts}});

      expect(getFetchCall(fetchMock).url).toContain('tags=a+b');
    });

    it('serializes pipeDelimited with explode:false as pipe-separated', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const opts: QueryParamOptions = {value: ['x', 'y'], style: 'pipeDelimited', explode: false};
      await client.request({method: 'GET', path: '/search', query: {categories: opts}});

      expect(getFetchCall(fetchMock).url).toContain('categories=x%7Cy');
    });

    it('serializes form with explode:false as comma-separated', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const opts: QueryParamOptions = {value: [1, 2, 3], style: 'form', explode: false};
      await client.request({method: 'GET', path: '/search', query: {ids: opts}});

      expect(getFetchCall(fetchMock).url).toContain('ids=1%2C2%2C3');
    });

    it('serializes deepObject with explode:true as nested keys', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const opts: QueryParamOptions = {
        value: {status: 'active', role: 'admin'},
        style: 'deepObject',
        explode: true,
      };
      await client.request({method: 'GET', path: '/search', query: {filters: opts}});

      const url = getFetchCall(fetchMock).url;
      expect(url).toContain('filters%5Bstatus%5D=active');
      expect(url).toContain('filters%5Brole%5D=admin');
    });

    it('serializes form with explode:true as repeated keys', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const opts: QueryParamOptions = {value: ['a', 'b'], style: 'form', explode: true};
      await client.request({method: 'GET', path: '/search', query: {tags: opts}});

      const url = getFetchCall(fetchMock).url;
      expect(url).toContain('tags=a');
      expect(url).toContain('tags=b');
      expect(url).not.toContain('tags=a%2Cb');
    });

    // Objects are legal for `form` (the OpenAPI default) and for the delimited
    // styles. They used to fall through to `String(value)` → `[object Object]`.
    // These exercise the *generated* runtime, so a template regression is caught
    // even if the hand-mirrored unit tests drift.
    it('serializes a form object with explode:true as one param per property', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const opts: QueryParamOptions = {
        value: {R: 100, G: 200, B: 150},
        style: 'form',
        explode: true,
      };
      await client.request({method: 'GET', path: '/search', query: {color: opts}});

      const url = getFetchCall(fetchMock).url;
      expect(url).toContain('R=100');
      expect(url).toContain('G=200');
      expect(url).toContain('B=150');
      expect(url).not.toContain('Object');
    });

    it('serializes a form object with explode:false as key/value pairs', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const opts: QueryParamOptions = {
        value: {R: 100, G: 200, B: 150},
        style: 'form',
        explode: false,
      };
      await client.request({method: 'GET', path: '/search', query: {shade: opts}});

      const url = getFetchCall(fetchMock).url;
      expect(url).toContain('shade=R%2C100%2CG%2C200%2CB%2C150');
      expect(url).not.toContain('Object');
    });

    it('serializes spaceDelimited and pipeDelimited objects', async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => jsonResponse({})) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({
        method: 'GET',
        path: '/search',
        query: {spaced: {value: {R: 100, G: 200}, style: 'spaceDelimited', explode: false}},
      });
      expect(getFetchCall(fetchMock).url).toContain('spaced=R+100+G+200');

      await client.request({
        method: 'GET',
        path: '/search',
        query: {piped: {value: {R: 100, G: 200}, style: 'pipeDelimited', explode: false}},
      });
      expect(getFetchCall(fetchMock, 1).url).toContain('piped=R%7C100%7CG%7C200');
    });

    it('serializes deepObject object properties', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const opts: QueryParamOptions = {
        value: {R: 100, G: 200},
        style: 'deepObject',
        explode: true,
      };
      await client.request({method: 'GET', path: '/search', query: {color: opts}});

      const url = getFetchCall(fetchMock).url;
      expect(url).toContain('color%5BR%5D=100');
      expect(url).toContain('color%5BG%5D=200');
    });
  });

  describe('response parsing', () => {
    it('returns parsed JSON for successful responses', async () => {
      vi.stubGlobal('fetch', mockFetch(jsonResponse({id: 1, name: 'John'})));
      const client = createClient();

      const result = await client.request<{id: number; name: string}>({
        method: 'GET',
        path: '/users/1',
      });

      expect(result).toEqual({id: 1, name: 'John'});
    });

    it('returns undefined for 204 No Content', async () => {
      vi.stubGlobal('fetch', mockFetch(new Response(null, {status: 204})));
      const client = createClient();

      const result = await client.request<void>({method: 'DELETE', path: '/users/1'});

      expect(result).toBeUndefined();
    });

    it('parses text response when responseType is text', async () => {
      const response = new Response('hello world', {
        status: 200,
        headers: {'content-type': 'text/plain'},
      });
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<string>({
        method: 'GET',
        path: '/readme',
        responseType: 'text',
      });

      expect(result).toBe('hello world');
    });

    it('parses blob response when responseType is blob', async () => {
      const response = new Response(new Blob(['binary'], {type: 'image/png'}), {
        status: 200,
        headers: {'content-type': 'image/png'},
      });
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<Blob>({
        method: 'GET',
        path: '/avatar.png',
        responseType: 'blob',
      });

      expect(result).toBeInstanceOf(Blob);
      expect(result!.type).toBe('image/png');
    });

    it('parses arrayBuffer response when responseType is arrayBuffer', async () => {
      const response = new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {'content-type': 'application/octet-stream'},
      });
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<ArrayBuffer>({
        method: 'GET',
        path: '/data.bin',
        responseType: 'arrayBuffer',
      });

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('returns response.body for responseType: stream', async () => {
      const stream = new ReadableStream();
      const response = new Response(stream, {
        status: 200,
        headers: {'content-type': 'text/event-stream'},
      });
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<ReadableStream>({
        method: 'GET',
        path: '/events',
        responseType: 'stream',
      });

      expect(result).toBe(response.body);
    });

    it('returns null when response.body is null (204-like body)', async () => {
      // A Response with a null body cannot have a content-type, so we
      // simulate the null-body edge case directly: a stream request whose
      // response has no body yields null — matching the honest generated
      // type `request<ReadableStream<Uint8Array> | null>`.
      const response = new Response(null, {status: 200});
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<ReadableStream | null>({
        method: 'GET',
        path: '/events',
        responseType: 'stream',
      });

      expect(result).toBeNull();
    });

    it('falls back to content-type sniffing for text/* without responseType', async () => {
      const response = new Response('plain', {
        status: 200,
        headers: {'content-type': 'text/plain'},
      });
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<string>({method: 'GET', path: '/x'});

      expect(result).toBe('plain');
    });

    it('falls back to blob for binary content-type without responseType', async () => {
      const response = new Response(new Blob(['x'], {type: 'image/png'}), {
        status: 200,
        headers: {'content-type': 'image/png'},
      });
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<Blob>({method: 'GET', path: '/x'});

      expect(result).toBeInstanceOf(Blob);
    });

    it('returns undefined when content-type is missing and no responseType', async () => {
      const response = new Response('', {status: 200});
      response.headers.delete('content-type');
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<unknown>({method: 'GET', path: '/x'});

      expect(result).toBeUndefined();
    });
  });

  describe('empty JSON body edge cases', () => {
    it('returns undefined for empty body with json content-type', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch(
          new Response('', {
            status: 200,
            headers: {'content-type': 'application/json'},
          }),
        ),
      );
      const client = createClient();

      const result = await client.request<unknown>({method: 'GET', path: '/x'});

      expect(result).toBeUndefined();
    });

    it('returns raw text when responseType: json but server returns text/html', async () => {
      const response = new Response('Hello World!', {
        status: 200,
        headers: {'content-type': 'text/html; charset=utf-8'},
      });
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<string>({method: 'GET', path: '/', responseType: 'json'});

      expect(result).toBe('Hello World!');
    });

    it('returns raw text when JSON.parse fails on application/json content-type', async () => {
      const response = new Response('not json at all', {
        status: 200,
        headers: {'content-type': 'application/json'},
      });
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      const result = await client.request<string>({
        method: 'GET',
        path: '/x',
        responseType: 'json',
      });

      expect(result).toBe('not json at all');
    });
  });

  describe('headers', () => {
    it('sends JSON body with Content-Type header', async () => {
      const fetchMock = mockFetch(jsonResponse({id: 1}, 201));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'POST', path: '/users', body: {name: 'John'}});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('Content-Type', 'application/json');
      expect(init.body).toBe(JSON.stringify({name: 'John'}));
    });

    it('does not set Content-Type when body is undefined', async () => {
      const fetchMock = mockFetch(jsonResponse([]));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'GET', path: '/users'});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Content-Type');
    });

    it('merges default headers into every request', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({defaultHeaders: {'X-Client': 'ng-openapi-signals'}});

      await client.request({method: 'GET', path: '/users'});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('X-Client', 'ng-openapi-signals');
      expect(headers).toHaveProperty('Accept', 'application/json');
    });

    it('per-request headers override default headers', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({defaultHeaders: {'X-Client': 'default'}});

      await client.request({method: 'GET', path: '/users', headers: {'X-Client': 'override'}});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('X-Client', 'override');
    });

    it('strips undefined header values', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({
        method: 'GET',
        path: '/users',
        headers: {'X-Optional': undefined, 'X-Set': 'yes'},
      });

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('X-Optional');
      expect(headers).toHaveProperty('X-Set', 'yes');
    });
  });

  describe('auth hook', () => {
    it('merges auth headers into every request', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({auth: () => ({Authorization: 'Bearer token-123'})});

      await client.request({method: 'GET', path: '/users'});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('Authorization', 'Bearer token-123');
    });

    it('supports async auth hooks', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({
        auth: async () => {
          await Promise.resolve();
          return {Authorization: 'Bearer async'};
        },
      });

      await client.request({method: 'GET', path: '/users'});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('Authorization', 'Bearer async');
    });

    it('does not add auth headers when no auth hook is provided', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'GET', path: '/users'});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Authorization');
    });
  });

  describe('middleware', () => {
    it('runs middleware in onion order (first wraps second)', async () => {
      const order: string[] = [];
      vi.stubGlobal('fetch', mockFetch(jsonResponse({ok: true})));
      const client = createClient({
        middleware: [
          async (_req, next) => {
            order.push('mw1-before');
            const res = await next();
            order.push('mw1-after');
            return res;
          },
          async (_req, next) => {
            order.push('mw2-before');
            const res = await next();
            order.push('mw2-after');
            return res;
          },
        ],
      });

      await client.request({method: 'GET', path: '/users'});

      expect(order).toEqual(['mw1-before', 'mw2-before', 'mw2-after', 'mw1-after']);
    });

    it('passes the request context to middleware', async () => {
      let capturedUrl: string | undefined;
      vi.stubGlobal('fetch', mockFetch(jsonResponse({ok: true})));
      const client = createClient({
        middleware: [
          async (req, next) => {
            capturedUrl = req.url;
            return next();
          },
        ],
      });

      await client.request({method: 'GET', path: '/users'});

      expect(capturedUrl).toBe('https://api.example.com/users');
    });

    it('allows middleware to mutate the request init', async () => {
      const fetchMock = mockFetch(jsonResponse({ok: true}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({
        middleware: [
          async (req, next) => {
            const headers = req.init.headers as Record<string, string>;
            req.init = {...req.init, headers: {...headers, 'X-Mw': 'added'}};
            return next();
          },
        ],
      });

      await client.request({method: 'GET', path: '/users'});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('X-Mw', 'added');
    });

    it('allows middleware to short-circuit with a custom response', async () => {
      const fetchMock = vi.fn() as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({
        middleware: [async () => jsonResponse({custom: true})],
      });

      const result = await client.request<{custom: boolean}>({method: 'GET', path: '/users'});

      expect(result).toEqual({custom: true});
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('calls core fetch when no middleware is provided', async () => {
      const fetchMock = mockFetch(jsonResponse({ok: true}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'GET', path: '/users'});

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('runs class-based middleware via handle()', async () => {
      const order: string[] = [];
      vi.stubGlobal('fetch', mockFetch(jsonResponse({ok: true})));

      class LoggingMiddleware {
        async handle(_req: {url: string; init: RequestInit}, next: () => Promise<Response>) {
          order.push('class-before');
          const res = await next();
          order.push('class-after');
          return res;
        }
      }

      const client = createClient({middleware: [new LoggingMiddleware() as never]});

      await client.request({method: 'GET', path: '/users'});

      expect(order).toEqual(['class-before', 'class-after']);
    });

    it('runs mixed function and class middleware in onion order', async () => {
      const order: string[] = [];
      vi.stubGlobal('fetch', mockFetch(jsonResponse({ok: true})));

      class ClassMw {
        async handle(_req: {url: string; init: RequestInit}, next: () => Promise<Response>) {
          order.push('class-before');
          const res = await next();
          order.push('class-after');
          return res;
        }
      }

      const client = createClient({
        middleware: [
          async (_req, next) => {
            order.push('fn-before');
            const res = await next();
            order.push('fn-after');
            return res;
          },
          new ClassMw() as never,
        ],
      });

      await client.request({method: 'GET', path: '/users'});

      expect(order).toEqual(['fn-before', 'class-before', 'class-after', 'fn-after']);
    });
  });

  describe('error handling', () => {
    it('throws ApiError on non-OK responses using the default error mapper', async () => {
      const response = new Response('Not Found', {status: 404, statusText: 'Not Found'});
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient();

      // The generated toApiError extracts the message from the body when it
      // is a non-empty string, so the error message is the body text itself.
      await expect(client.request({method: 'GET', path: '/users/999'})).rejects.toThrow(
        'Not Found',
      );
    });

    it('uses a custom error mapper when provided', async () => {
      const response = new Response('Forbidden', {status: 403, statusText: 'Forbidden'});
      vi.stubGlobal('fetch', mockFetch(response));
      const client = createClient({
        errorMapper: async (res) => new Error(`Custom ${res.status}`),
      });

      await expect(client.request({method: 'GET', path: '/secret'})).rejects.toThrow('Custom 403');
    });
  });

  describe('request and response hooks', () => {
    it('calls onRequest before fetch', async () => {
      const calls: string[] = [];
      const fetchMock = vi.fn().mockImplementation(async () => {
        calls.push('fetch');
        return jsonResponse({});
      }) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({
        onRequest: () => {
          calls.push('onRequest');
        },
      });

      await client.request({method: 'GET', path: '/users'});

      expect(calls).toEqual(['onRequest', 'fetch']);
    });

    it('calls onResponse after a successful response', async () => {
      const calls: string[] = [];
      const fetchMock = vi.fn().mockImplementation(async () => {
        calls.push('fetch');
        return jsonResponse({});
      }) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({
        onResponse: () => {
          calls.push('onResponse');
        },
      });

      await client.request({method: 'GET', path: '/users'});

      expect(calls).toEqual(['fetch', 'onResponse']);
    });

    it('onRequest can mutate the request context', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient({
        onRequest: (ctx) => {
          const headers = ctx.init.headers as Record<string, string>;
          ctx.init = {...ctx.init, headers: {...headers, 'X-Hook': 'yes'}};
        },
      });

      await client.request({method: 'GET', path: '/users'});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('X-Hook', 'yes');
    });

    it('onResponse receives a clone so the body can still be parsed', async () => {
      const received: Response[] = [];
      vi.stubGlobal('fetch', mockFetch(jsonResponse({ok: true})));
      const client = createClient({
        onResponse: (res) => {
          received.push(res);
        },
      });

      const result = await client.request<{ok: boolean}>({method: 'GET', path: '/x'});

      expect(received).toHaveLength(1);
      expect(result).toEqual({ok: true});
    });

    it('allows onResponse to consume the clone body without breaking parseBody', async () => {
      const consumed: unknown[] = [];
      vi.stubGlobal('fetch', mockFetch(jsonResponse({data: 42})));
      const client = createClient({
        onResponse: async (res) => {
          consumed.push(await res.json());
        },
      });

      const result = await client.request<{data: number}>({method: 'GET', path: '/x'});

      expect(consumed).toEqual([{data: 42}]);
      expect(result).toEqual({data: 42});
    });
  });

  describe('FormData and binary body handling', () => {
    it('builds FormData from formData object for multipart', async () => {
      const fetchMock = mockFetch(jsonResponse({url: 'ok'}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const blob = new Blob(['file-content'], {type: 'image/png'});
      await client.request({
        method: 'POST',
        path: '/upload',
        formData: {file: blob, caption: 'test'},
        contentType: 'multipart/form-data',
      });

      const {init} = getFetchCall(fetchMock);
      expect(init.body).toBeInstanceOf(FormData);
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Content-Type');
    });

    it('builds URLSearchParams for application/x-www-form-urlencoded', async () => {
      const fetchMock = mockFetch(jsonResponse({created: 1}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({
        method: 'POST',
        path: '/bulk',
        formData: {names: 'a,b', count: 1},
        contentType: 'application/x-www-form-urlencoded',
      });

      const {init} = getFetchCall(fetchMock);
      expect(init.body).toBe('names=a%2Cb&count=1');
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('Content-Type', 'application/x-www-form-urlencoded');
    });

    it('passes Blob body through without JSON.stringify', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      const blob = new Blob(['binary'], {type: 'application/octet-stream'});
      await client.request({
        method: 'POST',
        path: '/upload',
        body: blob,
        contentType: 'application/octet-stream',
      });

      const {init} = getFetchCall(fetchMock);
      expect(init.body).toBe(blob);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('Content-Type', 'application/octet-stream');
    });

    it('uses custom contentType for JSON body when provided', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({
        method: 'POST',
        path: '/data',
        body: {key: 'value'},
        contentType: 'application/vnd.custom+json',
      });

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).toHaveProperty('Content-Type', 'application/vnd.custom+json');
    });
  });

  describe('body: null handling', () => {
    it('does not send a body when body is null', async () => {
      const fetchMock = mockFetch(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'POST', path: '/users', body: null});

      const {init} = getFetchCall(fetchMock);
      expect(init.body).toBeUndefined();
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Content-Type');
    });

    it('does not send Content-Type when body is null (DELETE)', async () => {
      const fetchMock = mockFetch(new Response(null, {status: 204}));
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient();

      await client.request({method: 'DELETE', path: '/users/1', body: null});

      const {init} = getFetchCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Content-Type');
    });
  });

  describe('date transformer integration', () => {
    it('converts ISO-8601 date strings to Date objects in JSON responses', async () => {
      vi.stubGlobal('fetch', mockFetch(jsonResponse({createdAt: '2026-07-15T12:00:00Z'})));
      const client = createClient();

      const result = await client.request<{createdAt: unknown}>({method: 'GET', path: '/x'});

      expect(result).toEqual({createdAt: new Date('2026-07-15T12:00:00Z')});
    });
  });
});
