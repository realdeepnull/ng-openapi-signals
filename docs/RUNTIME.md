# Generated API Style & Runtime

Detailed reference for the generated API patterns and runtime internals.

## Generated API Style

### GET endpoints

GET endpoints are generated as Angular `resource()` APIs.

Example OpenAPI operation:

```text
GET /users/{id}
```

Generated usage:

```ts
readonly user = this.usersApi.getUserByIdResource({
  id: this.userId
});
```

The generated method accepts regular values or signals:

```ts
readonly user = this.usersApi.getUserByIdResource({
  id: '123'
});
```

or:

```ts
readonly userId = signal('123');

readonly user = this.usersApi.getUserByIdResource({
  id: this.userId
});
```

### Mutating endpoints

POST, PUT, PATCH and DELETE endpoints are generated as Promise-based methods using `fetch()`.

Example:

```ts
await this.usersApi.createUser({
  name: 'John Doe',
  email: 'john@example.com',
});
```

This keeps read operations reactive while keeping write operations explicit and predictable.

### Signal-based mutations (opt-in)

When `runtime.signalMutations` is enabled (default `false`, CLI `--signal-mutations`),
the generator additionally emits a `${operationId}Mutation()` method for every
POST/PUT/PATCH/DELETE endpoint, alongside the existing Promise-based method.
The feature is strictly additive — the Promise-based methods remain unchanged.

The mutation method returns a `Mutation<TBody, TResult>` object exposing
reactive signals:

| Member      | Type                                  | Description                                                   |
| ----------- | ------------------------------------- | ------------------------------------------------------------- |
| `result`    | `Signal<TResult \| undefined>`        | Last successful response value (or `undefined`)               |
| `error`     | `Signal<unknown \| undefined>`        | Last thrown error (or `undefined`)                            |
| `status`    | `Signal<MutationStatus>`              | `'idle' \| 'loading' \| 'success' \| 'error'`                 |
| `isLoading` | `Signal<boolean>`                     | `computed(() => status() === 'loading')`                      |
| `mutate`    | `(body, signal?) => Promise<TResult>` | Triggers the request, updates signals, resolves to the result |
| `reset`     | `() => void`                          | Clears `result`/`error` and returns `status` to `'idle'`      |

#### Basic usage

```ts
readonly creating = this.usersApi.createUserMutation();

create(): void {
  // `mutate()` returns a Promise (you can `await` it), but the reactive
  // signals update regardless of whether you await.
  this.creating.mutate({ name: 'John Doe', email: 'john@example.com' });
}
```

Template:

```html
<button (click)="create()" [disabled]="creating.isLoading()">
  {{ creating.isLoading() ? 'Creating…' : 'Create user' }}
</button>

@if (creating.error()) {
<p class="error">Failed to create user.</p>
} @if (creating.result(); as user) {
<p>Created user: {{ user.name }} ({{ user.email }})</p>
}
```

#### Endpoints with parameters

For endpoints with path/query/header parameters, the parameters are bound at
construction time (captured in the closure) and accept plain values or signals
(like the `resource()` variants). Only the request body is passed to `mutate()`:

```ts
readonly userId = signal('usr_123');

readonly uploading = this.usersApi.uploadUserAvatarMutation({
  id: this.userId,  // signal — read when `mutate()` is invoked
});

upload(): void {
  this.uploading.mutate({ file: this.file, caption: 'Profile photo' });
}
```

#### Reset

Call `reset()` to clear `result` and `error` and return the mutation to the
`'idle'` status — useful when navigating away or re-opening a form:

```ts
ngOnDestroy(): void {
  this.creating.reset();
}
```

#### Enabling the feature

Via config file:

```ts
export default defineConfig({
  // ...
  runtime: {signalMutations: true},
});
```

Or via CLI:

```bash
ng-openapi-signals generate --signal-mutations
```

When enabled, the generator emits an additional `mutation-utils.ts` runtime
file containing the `Mutation` interface and `createMutation` factory.

#### `Mutation` interface

```ts
export type MutationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface Mutation<TBody, TResult> {
  readonly result: Signal<TResult | undefined>;
  readonly error: Signal<unknown | undefined>;
  readonly status: Signal<MutationStatus>;
  readonly isLoading: Signal<boolean>;
  mutate(body: TBody, signal?: AbortSignal): Promise<TResult>;
  reset(): void;
}
```

---

## Runtime

The generated client includes a small runtime:

```text
api-fetch-client.ts   (or api-http-client.ts)
api-error.ts
signal-utils.ts
mutation-utils.ts     (only when runtime.signalMutations is enabled)
date-utils.ts        (only when runtime.dateTransformer is enabled)
providers.ts
```

### `ApiFetchClient`

The generated `ApiFetchClient` wraps native `fetch()` and handles:

- Base URL handling
- JSON request bodies
- Multipart form data (`FormData`) and `application/x-www-form-urlencoded` (`URLSearchParams`)
- `Blob`/`ArrayBuffer` body passthrough (no JSON serialization)
- Custom request content types
- JSON, text, `Blob`, `ArrayBuffer` and `ReadableStream` responses (spec-driven with content-type fallback)
- Query parameters with OpenAPI `style`/`explode` serialization
- Header parameters
- Abort signals
- Default headers (static via config + runtime via `auth` hook)
- Onion-style fetch middleware
- Request and response hooks
- Custom error mapping

### `ApiHttpClient`

When `transport: 'httpClient'` is selected, the generator emits `ApiHttpClient`
instead of `ApiFetchClient`. It wraps Angular `HttpClient` and handles:

- Base URL handling
- JSON request bodies
- Multipart form data (`FormData`) and `application/x-www-form-urlencoded` (`URLSearchParams`)
- `Blob`/`ArrayBuffer` body passthrough
- Custom request content types
- JSON, text, `Blob`, `ArrayBuffer` and stream responses (`stream` maps to `blob` — Angular `HttpClient` has no native stream; call `.stream()` on the returned `Blob`)
- Query parameters with OpenAPI `style`/`explode` serialization
- Header parameters
- Abort signals
- Default headers (static via config + runtime via `auth` hook)
- Request and response hooks
- Custom error mapping (via `toApiErrorFromHttpErrorResponse`)

`provideNgOpenapiSignals()` does **not** include `provideHttpClient()` — when
using the `httpClient` transport, register `provideHttpClient()` yourself (e.g.
`provideHttpClient(withInterceptors([...]))`) so you keep full control over
interceptors and their order.

### `provideNgOpenapiSignals()`

The generated helper configures the runtime. See [Runtime Configuration](#runtime-configuration) for the full options.

```ts
import {provideNgOpenapiSignals} from './generated/api';

providers: [
  provideNgOpenapiSignals({
    basePath: 'https://api.example.com',
  }),
];
```

#### Absolute and relative base paths

`basePath` may be absolute (`https://api.example.com/v1`), root-relative
(`/api` — typical for a dev-server proxy) or empty. Relative values are
resolved against `document.baseURI`, so the client never calls
`new URL()` with a relative base (which throws `Invalid URL`). Operation
paths are always resolved as root-relative, so `/users` replaces the base
path instead of appending to its last segment.

```ts
// Proxy setup: `ng serve` forwards /api to the backend.
provideNgOpenapiSignals({basePath: '/api'});

// Same-origin requests.
provideNgOpenapiSignals({basePath: ''});
```

#### `Accept` header

The runtime sends an `Accept` header derived from the operation's response
type hint, so non-JSON endpoints are not rejected with `406 Not Acceptable`:

| `responseType` hint     | `Accept`            |
| ----------------------- | ------------------- |
| `'json'` (or absent)    | `application/json`  |
| `'text'`                | `text/*`            |
| `'stream'`              | `text/event-stream` |
| `'blob'`/`'arrayBuffer'`| `*/*`               |

Override it per request via `ApiRequestOptions.headers.Accept`, or globally
via `defaultHeaders`.

### `MaybeSignal<T>`

Generated resource methods support both plain values and Angular signals.

```ts
export type MaybeSignal<T> = T | Signal<T>;
```

This allows flexible usage:

```ts
api.getUserByIdResource({
  id: '123',
});
```

or:

```ts
api.getUserByIdResource({
  id: signal('123'),
});
```

### Response parsing

Generated methods emit a `responseType` hint derived from the OpenAPI response
`content` type, so the runtime picks the right parser:

| OpenAPI content type                                           | `responseType` | TypeScript return type                                 |
| -------------------------------------------------------------- | -------------- | ------------------------------------------------------ |
| `application/json` (and `*+json`)                              | `'json'`       | inferred from schema                                   |
| `text/*`                                                       | `'text'`       | `string`                                               |
| `text/event-stream`                                            | `'stream'`     | fetch: `ReadableStream<Uint8Array> | null`, httpClient: `Blob` |
| `image/*`, `audio/*`, `video/*`, `octet-stream`, `multipart/*` | `'blob'`       | `Blob`                                                 |

For responses without a known content type the runtime falls back to
content-type sniffing. Set `runtime.responseTypeHints: false` in the config
file to disable hints and rely solely on runtime sniffing.

#### Date Transformer (`runtime.dateTransformer`)

When `runtime.dateTransformer` is enabled (default `false`, CLI `--date-transformer`),
the generator emits a `date-utils.ts` runtime file exporting a recursive
`transformDates(body)` function. It is wired into the JSON parsing path of
both transports:

- **fetch**: applied inside `parseJson()` after `JSON.parse(text)`.
- **httpClient**: applied to `response.body` when `options.responseType === 'json'`.

`transformDates` walks arrays and plain objects, converting strings that
match the ISO-8601 date-time pattern (e.g. `2026-07-15T12:00:00Z`,
`2026-07-15T12:00:00.123+02:00`) to `Date` instances. Date-only strings
(`2026-07-15`), non-string values, and existing `Date` instances are left
unchanged. Invalid dates (matching pattern but un-parseable) fall back to
the original string.

Non-JSON responses (`text`, `blob`, `arrayBuffer`, `stream`) are never
transformed.

> **Note**: For `httpClient`, the transformer only applies when
> `options.responseType === 'json'`. If `responseTypeHints` is disabled
> and no hint is emitted, the transformer will not run. Keep
> `responseTypeHints: true` (the default) to ensure the transformer
> covers all JSON endpoints.

### `ApiRequestOptions`

The generated methods call `this.client.request<T>(options)` with these fields:

| Field          | Type                                                      | Description                                                              |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `method`       | `string`                                                  | HTTP method (`'GET'`, `'POST'`, ...)                                     |
| `path`         | `string`                                                  | URL path (with path params interpolated)                                 |
| `query`        | `Record<string, unknown \| QueryParamOptions>`            | Query params (plain values or wrapped with style/explode metadata)       |
| `headers`      | `Record<string, string>`                                  | Per-request headers (merged over defaults)                               |
| `body`         | `unknown`                                                 | Request body (JSON-serialized unless `FormData`/`Blob`/`ArrayBuffer`)    |
| `formData`     | `Record<string, unknown>`                                 | Form data object (built into `FormData` or `URLSearchParams` by runtime) |
| `contentType`  | `string`                                                  | Explicit Content-Type (defaults to `application/json` for JSON bodies)   |
| `signal`       | `AbortSignal`                                             | Abort signal for cancellation                                            |
| `responseType` | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'stream'` | Response parser hint                                                     |

### Query Parameter Serialization

For parameters with non-default OpenAPI `style`/`explode`, the generated code
wraps the value with metadata so the runtime can serialize it correctly:

```ts
query: {
  tags: { value: params.tags, style: 'spaceDelimited', explode: false },
  q: params.q,  // default style: form + explode:true — plain value
}
```

The runtime `buildUrl` method serializes according to the style:

| Style            | `explode: true`     | `explode: false`  |
| ---------------- | ------------------- | ----------------- |
| `form`           | `key=val1&key=val2` | `key=val1,val2`   |
| `spaceDelimited` | `key=val1&key=val2` | `key=val1%20val2` |
| `pipeDelimited`  | `key=val1&key=val2` | `key=val1\|val2`  |
| `deepObject`     | `key[prop]=val`     | —                 |

### Multipart Form Data

When a request body uses `multipart/form-data`, the generated method passes
`formData: body` instead of `body:`. The runtime builds a `FormData` object:

- `Blob` values are appended directly (no serialization)
- Other values are converted to strings
- The browser sets the `Content-Type` with the multipart boundary automatically

For `application/x-www-form-urlencoded`, the runtime builds `URLSearchParams`.

---

## Runtime Configuration

`provideNgOpenapiSignals()` accepts optional runtime extension points. All are
optional — without them the client behaves as a plain `fetch()` wrapper.

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

  // Replaces the default `toApiError` error mapper.
  errorMapper: async (res) => new MyApiError(await res.json()),
});
```

## Middleware

Middleware lets you intercept every request/response cycle in onion-style
order: each middleware receives the request context and a `next` function
that calls the next middleware (or the core `fetch()`). Middleware can
mutate the request, short-circuit, transform the response, or handle errors.

There are two kinds of middleware, both registered on the same
`NG_OPENAPI_SIGNALS_MIDDLEWARE` multi-provider token:

| Kind               | Shape                                               | DI?                     | When to use                                    |
| ------------------ | --------------------------------------------------- | ----------------------- | ---------------------------------------------- |
| **Function-based** | `(req, next) => Promise<Response>`                  | ❌ no injection context | Simple, stateless logic (logging, tracing)     |
| **Class-based**    | `implements ApiMiddleware` with `handle(req, next)` | ✅ constructor DI       | Auth, feature flags, anything needing services |

The runtime dispatches via `typeof mw === 'function'`: functions are called
directly as `ApiMiddlewareFn`, objects have their `handle()` method invoked
as class instances.

### Function-based middleware (convenience)

Register plain functions via the `middleware` array in
`provideNgOpenapiSignals()`. The array is flattened into multi-providers,
preserving order:

```ts
provideNgOpenapiSignals({
  basePath: 'https://api.example.com',
  middleware: [
    async (req, next) => {
      console.log('→', req.init.method, req.url);
      const res = await next();
      console.log('←', res.status);
      return res;
    },
  ],
});
```

### Class-based middleware (with DI)

For middleware that needs Angular services, implement the `ApiMiddleware`
interface and register it as a multi-provider. Angular instantiates the
class via DI, so you can inject services through the constructor:

```ts
// auth.middleware.ts
import {Injectable} from '@angular/core';
import {ApiMiddleware, ApiRequestContext} from './generated/api';

@Injectable()
export class AuthMiddleware implements ApiMiddleware {
  constructor(private auth: AuthService) {}

  async handle(req: ApiRequestContext, next: () => Promise<Response>): Promise<Response> {
    const token = this.auth.token(); // signal-based token
    req.init.headers = {
      ...req.init.headers,
      Authorization: `Bearer ${token}`,
    };
    return next();
  }
}
```

Register via `{ provide, multi: true, useClass }` — no need to instantiate
manually:

```ts
// app.config.ts
import {ApplicationConfig} from '@angular/core';
import {provideNgOpenapiSignals, NG_OPENAPI_SIGNALS_MIDDLEWARE} from './generated/api';
import {AuthMiddleware} from './auth.middleware';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgOpenapiSignals({basePath: 'https://api.example.com'}),
    {provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: AuthMiddleware},
  ],
};
```

### Coexistence of both patterns

Function-based and class-based middleware share the same token and run in
the same pipeline. Angular merges `multi: true` providers in registration
order; `reduceRight` means the first registered entry is the outermost
layer (runs first on the request, last on the response):

```ts
provideNgOpenapiSignals({
  basePath: 'https://api.example.com',
  // Function-based convenience entries.
  middleware: [loggingFn],
}),
// Class-based entry from a feature module.
{provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: AuthMiddleware},
```

### Registering from feature modules

Because `NG_OPENAPI_SIGNALS_MIDDLEWARE` is a multi-provider, any feature
module can add middleware without touching the root config:

```ts
// logging.feature.ts
import {EnvironmentProviders, makeEnvironmentProviders} from '@angular/core';
import {NG_OPENAPI_SIGNALS_MIDDLEWARE} from './generated/api';
import {LoggingMiddleware} from './logging.middleware';

export function provideLogging(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: LoggingMiddleware},
  ]);
}
```

> **Note:** Middleware applies to the `fetch` transport only. When using `transport: 'httpClient'`, use Angular `HttpInterceptor`
