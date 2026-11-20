# Runtime Configuration

`provideNgOpenapiSignals()` configures the generated runtime. All options are
optional — without them the client behaves as a plain `fetch()` wrapper.

Back to the [runtime overview](./RUNTIME.md).
See also [middleware.md](./middleware.md), [errors.md](./errors.md) and
[transports.md](./transports.md).

```ts
import {provideNgOpenapiSignals} from './generated/api';

providers: [
  provideNgOpenapiSignals({
    basePath: 'https://api.example.com',
  }),
];
```

---

## Options

```ts
provideNgOpenapiSignals({
  basePath: 'https://api.example.com',

  // Static default headers merged into every request.
  defaultHeaders: {'X-Client': 'my-app'},

  // Called once per request to add auth headers (e.g. a bearer token).
  auth: () => ({Authorization: `Bearer ${token()}`}),

  // Onion-style middleware: (request, next) => Promise<Response>.
  middleware: [
    async (req, next) => {
      console.log('→', req.init.method, req.url);
      const res = await next();
      console.log('←', res.status);
      return res;
    },
  ],

  // Called before the middleware pipeline runs. Can mutate the request.
  onRequest: (ctx) => {
    ctx.init.headers = {...ctx.init.headers, 'X-Trace-Id': crypto.randomUUID()};
  },

  // Called after a successful response is received.
  onResponse: (res) => console.log('response', res.status),

  // Aborts requests taking longer than this (0 = unbounded, the default).
  // `fetch` uses AbortSignal.timeout(); `httpClient` uses its native `timeout`
  // option. Both reject with a `TimeoutError`.
  timeoutMs: 30_000,

  // Replaces the default `toApiError` error mapper.
  errorMapper: async (res) => new MyApiError(await res.json()),
});
```

- `basePath` — base URL, see below
- `defaultHeaders` — static headers inherited by every request
- `auth` — per-request callback returning auth headers
- `middleware` — array of function-based middleware (see
  [middleware.md](./middleware.md))
- `onRequest` — hook before the middleware pipeline; may mutate the request
- `onResponse` — hook after a successful response
- `timeoutMs` — timeout in milliseconds, `0` = unbounded
- `errorMapper` — replaces the default error mapping

Auth example: [`usage/auth-interceptor.ts`](./usage/auth-interceptor.ts).

---

## Absolute and relative base paths

`basePath` may be absolute (`https://api.example.com/v1`), root-relative
(`/api` — typical for a dev-server proxy) or empty. The base is treated as a
**directory**, so its last segment is preserved: with
`basePath: 'https://api.example.com/api'` a `/events` operation requests
`https://api.example.com/api/events`. A trailing slash makes no difference.

Relative values are resolved without a `document` dependency, so server-side
rendering works: `basePath: '/api'` yields the relative request URL
`/api/events`, and `basePath: ''` yields `/events`. Previously `new URL()`
received the relative base directly, which threw `Invalid URL` in SSR and
silently dropped the `/api` segment.

```ts
// Proxy setup: `ng serve` forwards /api to the backend.
provideNgOpenapiSignals({basePath: '/api'});

// Same-origin requests.
provideNgOpenapiSignals({basePath: ''});
```

## `Accept` header

The runtime sends an `Accept` header derived from the operation's response
type hint, so non-JSON endpoints are not rejected with `406 Not Acceptable`:

| `responseType` hint      | `Accept`            |
| ------------------------ | ------------------- |
| `'json'` (or absent)     | `application/json`  |
| `'text'`                 | `text/*`            |
| `'stream'`               | `text/event-stream` |
| `'blob'`/`'arrayBuffer'` | `*/*`               |

Override it per request via `ApiRequestOptions.headers.Accept`, or globally
via `defaultHeaders`.
