# Configuration

`ng-openapi-signals` supports an optional config file for project-level
defaults. This page documents the config file, all generator options and the
`runtime` block.

For the CLI flags that override these values, see [CLI.md](./CLI.md).
For the runtime behaviour controlled by `runtime`, see
[RUNTIME.md](./RUNTIME.md).

---

## Config file

Create `ng-openapi-signals.config.ts` in your project root:

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

---

## Using the `httpClient` transport

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

Full details and differences between the two transports:
[transports.md](./transports.md).

---

## Grouping

By default, APIs are grouped by OpenAPI tag (`groupBy: 'tag'`).
Each tag becomes one service file: `resources/<tag>.api.ts`.

Set `groupBy: 'path'` to group by the first path segment instead.
For example, `/users/{id}` and `/users` are grouped into `resources/users.api.ts`.

## Preserving output

Set `clean: false` to preserve existing files in the output directory:

```ts
export default defineConfig({
  input: './openapi.json',
  output: './src/generated/api',
  clean: false,
});
```

---

## Schema names

Schemas whose names collide with globals, resource bindings or generated
runtime exports are renamed during generation (`Record` → `RecordModel`, …).
The rule set and the import behaviour are documented in
[model-names.md](./model-names.md).

## Output structure

The files written to `output` are described in
[ARCHITECTURE.md](./ARCHITECTURE.md#generated-output-layout) and listed in
[RUNTIME.md](./RUNTIME.md#runtime-files).
