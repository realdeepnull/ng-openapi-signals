# Transports: `ApiFetchClient` and `ApiHttpClient`

The generated client has two interchangeable transports. Both implement the
same `request<T>(options)` interface, so the generated service methods
(`resource()` loaders, mutations) are identical.

- Default: `fetch` → `api-fetch-client.ts`
- Optional: `httpClient` → `api-http-client.ts`
  (`runtime.transport: 'httpClient'` or `--transport httpClient`)

Back to the [runtime overview](./RUNTIME.md). Configuration:
[CONFIGURATION.md](./CONFIGURATION.md#using-the-httpclient-transport).

---

## `ApiFetchClient`

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

## `ApiHttpClient`

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

Setup: [`usage/http-client-usage.ts`](./usage/http-client-usage.ts).

### What changes with `httpClient`

When `httpClient` is selected:

- The generator emits `ApiHttpClient` instead of `ApiFetchClient`.
- `provideNgOpenapiSignals()` does **not** include `provideHttpClient()` — register it yourself in your app config (e.g. `provideHttpClient(withInterceptors([...]))`) so you keep full control over interceptors and their order.
- The `NG_OPENAPI_SIGNALS_MIDDLEWARE` token and `ApiMiddleware` interface are not emitted. Use `HttpInterceptorFn` or class-based `HttpInterceptor` instead
  (see [middleware.md](./middleware.md)).
- Generated API service methods (`resource()` loaders, mutations) remain identical — only the underlying client changes.

---

## `ApiRequestOptions`

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

See also [request-responses.md](./request-responses.md) and
[request-parameters.md](./request-parameters.md).
