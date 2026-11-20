# Responses

How the generated client parses responses.

Back to the [runtime overview](./RUNTIME.md).
Transport: [transports.md](./transports.md).

---

## Response parsing

Generated methods emit a `responseType` hint derived from the OpenAPI response
`content` type, so the runtime picks the right parser:

| OpenAPI content type                                           | `responseType` | TypeScript return type             |
| -------------------------------------------------------------- | -------------- | ---------------------------------- |
| `application/json` (and `*+json`)                              | `'json'`       | inferred from schema               |
| `text/*`                                                       | `'text'`       | `string`                           |
| `text/event-stream`                                            | `'stream'`     | fetch: `ReadableStream<Uint8Array> \| null`, httpClient: `Blob` |
| `image/*`, `audio/*`, `video/*`, `octet-stream`, `multipart/*` | `'blob'`       | `Blob`                             |

For responses without a known content type the runtime falls back to
content-type sniffing. Set `runtime.responseTypeHints: false` in the config
file to disable hints and rely solely on runtime sniffing.

## Downloads and streams

Binary responses (`image/*`, `application/octet-stream`, etc.) are handled as `Blob` or `ArrayBuffer`.
`text/event-stream` responses are handled as `ReadableStream` (fetch transport) or `Blob` (httpClient transport).

## Date transformer

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

Example: [`usage/date-transform-usage.ts`](./usage/date-transform-usage.ts).
