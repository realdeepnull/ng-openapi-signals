# Generated API Style & Runtime

Reference for the client that `ng-openapi-signals` **generates** — the shape of
the generated API, the runtime files, their configuration and all extension
points.

> For the generator's own structure (CLI, config, codegen pipeline and
> invariants), see [ARCHITECTURE.md](./ARCHITECTURE.md). For installation and a
> first working example, see the [README](../README.md). For CLI flags and the
> config file, see [CLI.md](./CLI.md) and [CONFIGURATION.md](./CONFIGURATION.md).

## Topics

- [generated-api.md](./generated-api.md) — generated API shape, signal mutations,
  `MaybeSignal<T>`
- [transports.md](./transports.md) — `ApiFetchClient` / `ApiHttpClient`,
  `ApiRequestOptions`
- [runtime-configuration.md](./runtime-configuration.md) —
  `provideNgOpenapiSignals()` options
- [middleware.md](./middleware.md) — middleware kinds, DI, feature modules
- [errors.md](./errors.md) — error types and retry handling
- [request-parameters.md](./request-parameters.md) — query serialization and
  header parameters
- [request-bodies.md](./request-bodies.md) — multipart, urlencoded, custom
  content types
- [request-responses.md](./request-responses.md) — response parsing, downloads,
  date transformer
- [model-names.md](./model-names.md) — schema renames and import rules

## At a glance

- **`ApiFetchClient`** — wraps native `fetch()`, handles base URL, JSON/text/Blob
  responses, query params, abort signals, middleware (function-based and
  class-based with DI), hooks, and error mapping.
- **`ApiHttpClient`** — wraps Angular `HttpClient` (when `transport: 'httpClient'`),
  same feature set, integrates with `HttpInterceptors`.
- **`provideNgOpenapiSignals()`** — configures the runtime (base URL, headers,
  auth, function-based middleware array, hooks, error mapper). Class-based
  middleware is registered separately via the `NG_OPENAPI_SIGNALS_MIDDLEWARE`
  multi-provider token.

```ts
import {provideNgOpenapiSignals} from './generated/api';

providers: [
  provideNgOpenapiSignals({
    basePath: 'https://api.example.com',
  }),
];
```

All options: [runtime-configuration.md](./runtime-configuration.md).
All examples: [usage/](./usage/).

## Runtime files

The generated client includes a small runtime:

```text
api-fetch-client.ts   (or api-http-client.ts)
api-error.ts
signal-utils.ts
mutation-utils.ts     (only when runtime.signalMutations is enabled)
date-utils.ts         (only when runtime.dateTransformer is enabled)
providers.ts
```

`index.ts` re-exports `providers.ts`, `api-error.ts`, the client,
`signal-utils.ts` (plus `mutation-utils.ts` / `date-utils.ts` when enabled) and
`models/`.

> Schema names that clash with declarations from these modules are renamed
> during generation — see [model-names.md](./model-names.md).

