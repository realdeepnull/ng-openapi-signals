# ng-openapi-signals

Signal-first OpenAPI client generator for Angular using `resource()` and `fetch()`.

`ng-openapi-signals` generates lightweight Angular API clients from OpenAPI specifications.
GET endpoints are generated as Angular `resource()` APIs, while mutating endpoints such as POST, PUT, PATCH and DELETE are generated as Promise-based `fetch()` methods.

## Features

- Typed Angular API clients from OpenAPI 3.x specifications
- GET endpoints as Angular `resource()` (signal-first, reactive)
- POST / PUT / PATCH / DELETE as Promise-based `fetch()` methods
- Lightweight runtime based on native `fetch()` — no `HttpClient`, no RxJS
  (an optional `httpClient` transport is available)
- Path, query and header parameters, including OpenAPI `style`/`explode`
  query serialization
- JSON, multipart/form-data (file upload), `x-www-form-urlencoded` and custom
  request content types
- JSON, text, `Blob`, `ArrayBuffer` and stream responses, including file download
- Runtime extension points: base URL, default headers, auth hook, middleware,
  request/response hooks, timeout and custom error mapping
- Opt-in signal-based mutations for reactive write state

## Requirements

- Node.js 22.19 or newer
- Angular 22 or newer
- TypeScript
- OpenAPI 3.x JSON or YAML specification

---

## How to Start

Get up and running in four steps.

### 1. Install

```bash
npm install -D ng-openapi-signals
```

Or run it directly with `npx` (no install needed):

```bash
npx ng-openapi-signals generate --input openapi.json --output src/generated/api
```

### 2. Generate the API client

Create a config file `ng-openapi-signals.config.ts` in your project root (recommended):

```ts
import {defineConfig} from 'ng-openapi-signals/config';

export default defineConfig({
  input: './openapi.json',
  output: 'src/generated/api',
});
```

Then run:

```bash
ng-openapi-signals generate --config ng-openapi-signals.config.ts
```

Or generate without a config file:

```bash
ng-openapi-signals generate \
  --input ./openapi.json \
  --output ./src/generated/api
```

This generates an Angular API client in `src/generated/api`:

```text
src/generated/api/
  api-fetch-client.ts        # or api-http-client.ts (depends on transport)
  api-error.ts
  signal-utils.ts
  providers.ts
  index.ts
  models/
    user.ts
    create-user-request.ts
    index.ts
  resources/
    users.api.ts
    index.ts
```

### 3. Configure Angular

Provide the API base URL in your application config:

```ts
import {ApplicationConfig} from '@angular/core';
import {provideNgOpenapiSignals} from './generated/api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgOpenapiSignals({
      basePath: 'https://api.example.com',
    }),
  ],
};
```

### 4. Use the generated API

```ts
import {Component, inject, signal} from '@angular/core';
import {UsersApi} from './generated/api';

@Component({
  selector: 'app-user-detail',
  template: `
    @if (user.isLoading()) {
      <p>Loading...</p>
    }

    @if (user.error()) {
      <p>Something went wrong.</p>
    }

    @if (user.hasValue()) {
      <h1>{{ user.value().name }}</h1>
    }
  `,
})
export class UserDetailComponent {
  private readonly usersApi = inject(UsersApi);

  readonly userId = signal('123');

  readonly user = this.usersApi.getUserByIdResource({
    id: this.userId,
  });
}
```

That's it — you now have a fully typed, signal-first Angular API client.

GET endpoints return Angular `resource()` objects; POST/PUT/PATCH/DELETE return
Promises. Step 3 shows the minimum runtime configuration (`basePath`); all other
options live in the documentation below.

---

## Optional Features

- **Signal-based mutations** — `runtime: {signalMutations: true}` adds
  `${operationId}Mutation()` methods exposing `result`, `error`, `status` and
  `isLoading` signals.
  → [docs/generated-api.md](./docs/generated-api.md)
- **Date transformer** — `runtime: {dateTransformer: true}` converts ISO-8601
  date-time strings in JSON responses to `Date` instances.
  → [docs/request-responses.md](./docs/request-responses.md)
- **Runtime extension** — default headers, auth hook, middleware,
  request/response hooks, timeout, error mapping.
  → [docs/RUNTIME.md](./docs/RUNTIME.md)
- **`httpClient` transport** — use Angular `HttpClient` and `HttpInterceptor`
  instead of native `fetch()`.
  → [docs/transports.md](./docs/transports.md)

---

## Documentation

- [docs/CLI.md](./docs/CLI.md) — all CLI flags, `--check` (CI), `--dry-run`
- [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) — config file, generator
  options, `httpClient` transport
- [docs/RUNTIME.md](./docs/RUNTIME.md) — generated runtime overview and topic
  index (`generated-api.md`, `transports.md`, `runtime-configuration.md`,
  `middleware.md`, `errors.md`, `request-parameters.md`, `request-bodies.md`,
  `request-responses.md`, `model-names.md`)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — generator internals, pipeline,
  invariants
- [docs/ROADMAP.md](./docs/ROADMAP.md) — milestones and planned features
- [docs/PUBLISHING.md](./docs/PUBLISHING.md) — release checklist
- [docs/usage/](./docs/usage/) — standalone usage examples (not in the npm
  package)
- [CHANGELOG.md](./CHANGELOG.md) — version history

## Generated Code

Generated files include this header:

```ts
// Auto-generated by ng-openapi-signals.
// Do not edit manually.
```

Do not manually edit generated files.
Change your OpenAPI specification or generator configuration instead.

## License

MIT
