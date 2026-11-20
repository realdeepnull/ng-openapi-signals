# Error handling

Every rejection from a generated method is an `Error` subclass, so
`error instanceof Error` holds for all failure modes.

Back to the [runtime overview](./RUNTIME.md). Configuration:
[runtime-configuration.md](./runtime-configuration.md).

---

## Error table

| Failure                              | `fetch` transport               | `httpClient` transport   |
| ------------------------------------ | ------------------------------- | ------------------------ |
| Non-2xx response                     | `ApiError`                      | `ApiError`               |
| Offline, DNS, CORS, connection reset | `ApiNetworkError` (`status: 0`) | `ApiError` (`status: 0`) |
| Timeout (`timeoutMs`)                | `TimeoutError`                  | `TimeoutError`           |
| Caller abort (`abortSignal`)         | `AbortError`                    | `AbortError`             |

`ApiError` exposes `status`, `statusText`, `body`, `headers` and a
`retryAfterSeconds` getter that parses the `Retry-After` header (seconds or
HTTP date) — handy for a 429 retry loop:

```ts
try {
  await api.getEvents();
} catch (error) {
  if (error instanceof ApiError && error.retryAfterSeconds) {
    await new Promise((r) => setTimeout(r, error.retryAfterSeconds! * 1000));
  }
}
```

Timeouts and caller aborts are **not** wrapped by either transport, so
`error.name` distinguishes them from a network failure: `'TimeoutError'` for a
timeout, `'AbortError'` for cancellation. `ApiError.name` is always
`'ApiError'`.

`httpClient` reports network failures as `HttpErrorResponse` with `status: 0`
through the `errorMapper`, so both transports use `status === 0` for
"no response".

## Custom error mapping

`errorMapper` in `provideNgOpenapiSignals()` replaces the default mapper — see
[runtime-configuration.md](./runtime-configuration.md#options).
