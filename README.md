# ng-openapi-signals

Signal-first OpenAPI client generator for Angular using `resource()` and `fetch()`.

`ng-openapi-signals` generates lightweight Angular API clients from OpenAPI specifications.
GET endpoints are generated as Angular `resource()` APIs, while mutating endpoints such as POST, PUT, PATCH and DELETE are generated as Promise-based `fetch()` methods.

## Features

- Generate Angular API clients from OpenAPI 3.x specifications
- Signal-first read APIs using Angular `resource()`
- Lightweight runtime based on native `fetch()`
- No dependency on Angular `HttpClient` (optional `httpClient` transport available)
- Typed models generated from OpenAPI schemas
- Path parameter support
- Query parameter support
- Advanced query parameter serialization (OpenAPI `style`/`explode`: `form`, `spaceDelimited`, `pipeDelimited`, `deepObject`)
- Header parameter support
- JSON request body support
- Multipart form data (`multipart/form-data`) and file upload support
- `application/x-www-form-urlencoded` request body support
- Custom request content types
- JSON, text, `Blob`, `ArrayBuffer` and `ReadableStream` response handling
- File download support
- Fetch middleware (onion-style `(request, next) => response`)
- Class-based middleware with constructor DI via `NG_OPENAPI_SIGNALS_MIDDLEWARE` multi-provider
- Auth header hooks
- Custom default headers
- Custom error mapping
- Request and response hooks
- Base URL configuration via `provideNgOpenapiSignals()`
- Optional signal-based mutations — reactive `result`/`error`/`status`/`isLoading` signals for POST/PUT/PATCH/DELETE

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

---

## CLI Usage

### Generate

```bash
ng-openapi-signals generate --input <openapi-file> --output <output-directory>
```

### Options

| Option                            | Description                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `-i, --input <path>`              | Path to the OpenAPI JSON or YAML file                                            |
| `-o, --output <path>`             | Output directory for the generated Angular client                                |
| `-c, --config <path>`             | Path to config file (default: `ng-openapi-signals.config.ts`)                    |
| `--clean`                         | Clean output directory before generation (default: true)                         |
| `--no-clean`                      | Preserve existing files in output directory                                      |
| `--group-by <tag\|path>`          | Group APIs by tag or path (default: tag)                                         |
| `--transport <fetch\|httpClient>` | HTTP transport (default: fetch)                                                  |
| `--default-query-style <style>`   | Default query param style: form, spaceDelimited, pipeDelimited, or deepObject    |
| `--default-query-explode <bool>`  | Default query param explode (true/false)                                         |
| `--prefer-content-type <type>`    | Preferred request content type when multiple are offered                         |
| `--signal-mutations`              | Enable signal-based mutation methods (default: false)                            |
| `--date-transformer`              | Convert ISO-8601 date strings in JSON responses to Date objects (default: false) |
| `--dry-run`                       | Print the files that would be generated without writing to disk                  |
| `--check`                         | Verify generated output is up to date (exits 1 on mismatch; for CI)              |
| `--verbose`                       | Show detailed progress and file lists                                            |

### CI: verify generated output

Use `--check` in CI to verify the generated client is up to date:

```bash
ng-openapi-signals generate --input ./openapi.json --output ./src/generated/api --check
```

The command exits with code `1` when generated files are outdated or missing. Stale files (on disk but no longer in the spec) are reported as warnings but do not fail the check.

### Preview without writing: `--dry-run`

```bash
ng-openapi-signals generate --input ./openapi.json --output ./src/generated/api --dry-run --verbose
```

Generates the client in memory and lists the files (path + line count) without touching disk.

### Recommended: use a config file

Using a config file keeps your setup reproducible and version-controllable.

```ts
// ng-openapi-signals.config.ts
import {defineConfig} from 'ng-openapi-signals/config';

export default defineConfig({
  input: './openapi.json',
  output: './src/generated/api',
  clean: true,
  groupBy: 'tag',
});
```

Then add a script to your `package.json`:

```json
{
  "scripts": {
    "generate:api": "ng-openapi-signals generate --config ng-openapi-signals.config.ts"
  }
}
```

Run it with:

```bash
npm run generate:api
```

You can also generate the API client before building your Angular app:

```json
{
  "scripts": {
    "generate:api": "ng-openapi-signals generate --config ng-openapi-signals.config.ts",
    "build": "npm run generate:api && ng build",
    "start": "npm run generate:api && ng serve"
  }
}
```

### CLI overrides

CLI flags override config file values. Config file values override defaults.

```bash
ng-openapi-signals generate \
  --input ./openapi.json \
  --output ./src/generated/api \
  --group-by path
```

---

## Generated API Style

- **GET endpoints** → Angular `resource()` APIs (accept plain values or signals)
- **POST / PUT / PATCH / DELETE** → Promise-based `fetch()` methods
- **Signal-based mutations** (opt-in via `runtime.signalMutations`) → `${operationId}Mutation()` methods returning a `Mutation` with `result`/`error`/`status`/`isLoading` signals

```ts
// GET — reactive resource
readonly user = this.usersApi.getUserByIdResource({
  id: this.userId,  // signal or plain value
});

// POST — promise-based mutation (default)
await this.usersApi.createUser({
  name: 'John Doe',
  email: 'john@example.com',
});
```

### Signal-based mutations (opt-in)

When `runtime.signalMutations` is enabled, the generator additionally emits
a `${operationId}Mutation()` method for every POST/PUT/PATCH/DELETE endpoint,
alongside the existing Promise-based method (strictly additive).

```ts
// Signal-based mutation — reactive state, no manual `busy` flag
readonly creating = this.usersApi.createUserMutation();

create(): void {
  this.creating.mutate({ name: 'John Doe', email: 'john@example.com' });
}

// In the template:
//   creating.isLoading()  → boolean signal
//   creating.result()     → the created user (or undefined)
//   creating.error()      → the last error (or undefined)
//   creating.status()     → 'idle' | 'loading' | 'success' | 'error'
//   creating.reset()      → clears result/error, returns to 'idle'
```

For endpoints with path/query/header parameters, the parameters are bound
at construction time (captured in the closure), and only the request body
is passed to `mutate(body)`:

```ts
readonly uploading = this.usersApi.uploadUserAvatarMutation({
  id: this.userId,  // signal or plain value
});

upload(): void {
  this.uploading.mutate({ file: this.file, caption: 'Profile photo' });
}
```

Enable the feature via the config file or CLI:

```ts
// ng-openapi-signals.config.ts
export default defineConfig({
  input: './openapi.json',
  output: './src/generated/api',
  runtime: {signalMutations: true},
});
```

```bash
ng-openapi-signals generate --signal-mutations
```

> See [`docs/RUNTIME.md`](./docs/RUNTIME.md) for full details on `MaybeSignal<T>`, the `Mutation` interface, response parsing, and more.

### Date Transformer

When `runtime.dateTransformer` is enabled (default `false`), the generator emits a `date-utils.ts` runtime file with a recursive `transformDates()` function that converts ISO-8601 date-time strings (e.g. `2026-07-15T12:00:00Z`) found anywhere in a parsed JSON response body into `Date` instances. Non-JSON responses (text, blob, arrayBuffer, stream) are left untouched.

```ts
// ng-openapi-signals.config.ts
import {defineConfig} from 'ng-openapi-signals/config';

export default defineConfig({
  input: './openapi.json',
  output: './src/generated/api',
  runtime: {dateTransformer: true},
});
```

```bash
ng-openapi-signals generate --date-transformer
```

The transformer is applied automatically inside the generated client's JSON parsing path — no additional setup is needed at runtime. Works with both `fetch` and `httpClient` transports.

### Example snippets

The repository includes standalone, commented example files in [`docs/usage/`](./docs/usage/):

- `resource-usage.ts` — GET endpoint with `resource()` and signals
- `mutation-usage.ts` — POST/PUT/PATCH/DELETE as Promises
- `mutation-signal-usage.ts` — signal-based mutation (`runtime.signalMutations`)
- `mutation-signal-params-usage.ts` — signal-based mutation with path/query/header params
- `auth-interceptor.ts` — auth headers and fetch middleware
- `http-client-usage.ts` — `httpClient` transport setup
- `multipart-upload.ts` — file upload with `FormData`
- `date-transform-usage.ts` — automatic ISO-8601 date string → Date conversion (`runtime.dateTransformer`)

These are illustrative only — adjust the import paths to your generated client directory. They are not included in the npm package.

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

- **`ApiFetchClient`** — wraps native `fetch()`, handles base URL, JSON/text/Blob responses, query params, abort signals, middleware (function-based and class-based with DI), hooks, and error mapping.
- **`ApiHttpClient`** — wraps Angular `HttpClient` (when `transport: 'httpClient'`), same feature set, integrates with `HttpInterceptors`.
- **`provideNgOpenapiSignals()`** — configures the runtime (base URL, headers, auth, function-based middleware array, hooks, error mapper). Class-based middleware is registered separately via the `NG_OPENAPI_SIGNALS_MIDDLEWARE` multi-provider token.

> See [`docs/RUNTIME.md`](./docs/RUNTIME.md) for the full `provideNgOpenapiSignals()` API and all runtime extension points.

---

## Configuration

`ng-openapi-signals` supports an optional config file for project-level defaults.

### Options

| Option    | Type              | Default | Description                                             |
| --------- | ----------------- | ------- | ------------------------------------------------------- |
| `input`   | `string`          | —       | Path to the OpenAPI JSON or YAML file                   |
| `output`  | `string`          | —       | Output directory for the generated Angular client       |
| `clean`   | `boolean`         | `true`  | Clean output directory before generation                |
| `groupBy` | `'tag' \| 'path'` | `'tag'` | Group generated APIs by OpenAPI tag or URL path segment |
| `runtime` | `RuntimeConfig`   | `{}`    | Runtime options (see below)                             |

#### `runtime`

| Option                | Type                                                            | Default              | Description                                                                                      |
| --------------------- | --------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `transport`           | `'fetch' \| 'httpClient'`                                       | `'fetch'`            | HTTP transport (`fetch` = native fetch, `httpClient` = Angular HttpClient)                       |
| `defaultHeaders`      | `Record<string, string>`                                        | `{}`                 | Static default headers baked into `provideNgOpenapiSignals` defaults                             |
| `responseTypeHints`   | `boolean`                                                       | `true`               | Emit `responseType` hints in generated methods based on response content                         |
| `defaultQueryStyle`   | `'form' \| 'spaceDelimited' \| 'pipeDelimited' \| 'deepObject'` | `'form'`             | Default query param serialization style when the spec doesn't specify `style`                    |
| `defaultQueryExplode` | `boolean`                                                       | `true`               | Default `explode` flag for query params when the spec doesn't specify it                         |
| `preferContentType`   | `string`                                                        | `'application/json'` | Preferred content type when a request body offers multiple media types                           |
| `signalMutations`     | `boolean`                                                       | `false`              | Generate `${operationId}Mutation()` methods with reactive signals for POST/PUT/PATCH/DELETE      |
| `dateTransformer`     | `boolean`                                                       | `false`              | Convert ISO-8601 date-time strings in JSON responses to `Date` instances (emits `date-utils.ts`) |

### Using the `httpClient` transport

By default the generated runtime uses native `fetch()`.
To use Angular `HttpClient` instead (e.g. to integrate with `HttpInterceptors`), set `transport: 'httpClient'`:

```ts
// ng-openapi-signals.config.ts
import {defineConfig} from 'ng-openapi-signals/config';

export default defineConfig({
  input: './openapi.json',
  output: './src/generated/api',
  runtime: {
    transport: 'httpClient',
  },
});
```

Or via the CLI:

```bash
ng-openapi-signals generate --input ./openapi.json --output ./src/generated/api --transport httpClient
```

When `httpClient` is selected:

- The generator emits `ApiHttpClient` instead of `ApiFetchClient`.
- `provideNgOpenapiSignals()` does **not** include `provideHttpClient()` — register it yourself in your app config (e.g. `provideHttpClient(withInterceptors([...]))`) so you keep full control over interceptors and their order.
- The `NG_OPENAPI_SIGNALS_MIDDLEWARE` token and `ApiMiddleware` interface are not emitted. Use `HttpInterceptorFn` or class-based `HttpInterceptor` instead.
- Generated API service methods (`resource()` loaders, mutations) remain identical — only the underlying client changes.

### Grouping

By default, APIs are grouped by OpenAPI tag (`groupBy: 'tag'`).
Each tag becomes one service file: `resources/<tag>.api.ts`.

Set `groupBy: 'path'` to group by the first path segment instead.
For example, `/users/{id}` and `/users` are grouped into `resources/users.api.ts`.

### Preserving output

Set `clean: false` to preserve existing files in the output directory:

```ts
export default defineConfig({
  input: './openapi.json',
  output: './src/generated/api',
  clean: false,
});
```

---

## Advanced Request Support

### Query Parameter Serialization

The generator supports OpenAPI parameter `style` and `explode` for query parameters:

| Style            | `explode: true`            | `explode: false`             |
| ---------------- | -------------------------- | ---------------------------- |
| `form` (default) | `tags=a&tags=b` (repeated) | `tags=a,b` (comma-separated) |
| `spaceDelimited` | `tags=a&tags=b` (repeated) | `tags=a b` (space-separated) |
| `pipeDelimited`  | `tags=a&tags=b` (repeated) | `tags=a\|b` (pipe-separated) |
| `deepObject`     | `filters[status]=active`   | —                            |

Parameters with default style (`form` + `explode: true`) are passed as plain values for backward compatibility.
Non-default styles are wrapped with metadata: `{ value: params.tags, style: 'spaceDelimited', explode: false }`.

### Multipart Form Data and File Upload

When a request body uses `multipart/form-data`, the generator emits `formData: body` instead of `body:`.
The runtime builds a `FormData` object from the typed input. Binary parts (`format: binary`) are typed as `Blob`.

```ts
// OpenAPI: multipart/form-data with file + caption
await this.usersApi.uploadUserAvatar({file: blob, caption: 'Profile photo'}, {id: 'usr_123'});
```

The runtime automatically:

- Builds `FormData` from the typed object
- Appends `Blob` values directly (no JSON serialization)
- Lets the browser set the `Content-Type` with the multipart boundary

### `application/x-www-form-urlencoded`

For URL-encoded form bodies, the runtime builds `URLSearchParams` from the typed object.

### Custom Content Types

When a request body uses a non-JSON content type (e.g. `application/octet-stream`),
the generator emits a `contentType` field. The runtime passes `Blob`/`ArrayBuffer` bodies
through without JSON serialization.

### File Download and Stream Responses

Binary responses (`image/*`, `application/octet-stream`, etc.) are handled as `Blob` or `ArrayBuffer`.
`text/event-stream` responses are handled as `ReadableStream` (fetch transport) or `Blob` (httpClient transport).

### Header Parameters

Header parameters (`in: header`) are generated as method arguments and merged into the request `headers` object.
Header names with hyphens (e.g. `X-Request-Id`) are properly quoted in TypeScript.

---

## Current Scope

For the full list of planned features and milestones, see the [Roadmap](./docs/ROADMAP.md).  
For release notes and version history, see the [Changelog](./CHANGELOG.md).

## Design Philosophy

`ng-openapi-signals` follows a simple design:

```text
GET endpoints
→ Angular resource() + fetch()

POST / PUT / PATCH / DELETE endpoints
→ Promise-based fetch() methods
```

The goal is to generate Angular code that feels natural in modern signal-based applications while keeping the runtime small and easy to understand.

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
