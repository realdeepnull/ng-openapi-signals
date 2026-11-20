# Request bodies

Request body formats the generated client supports.

Back to the [runtime overview](./RUNTIME.md).
Parameters: [request-parameters.md](./request-parameters.md).

---

## Multipart form data and file upload

When a request body uses `multipart/form-data`, the generated method passes
`formData: body` instead of `body:`. The runtime builds a `FormData` object:

- `Blob` values are appended directly (no serialization)
- Other values are converted to strings
- The browser sets the `Content-Type` with the multipart boundary automatically

Binary parts (`format: binary`) are typed as `Blob`.

```ts
// OpenAPI: multipart/form-data with file + caption
await this.usersApi.uploadUserAvatar({file: blob, caption: 'Profile photo'}, {id: 'usr_123'});
```

Full example: [`usage/multipart-upload.ts`](./usage/multipart-upload.ts).

## `application/x-www-form-urlencoded`

For URL-encoded form bodies, the runtime builds `URLSearchParams` from the typed object.
Arrays repeat the key per element.

## Custom content types

When a request body uses a non-JSON content type (e.g. `application/octet-stream`),
the generator emits a `contentType` field. The runtime passes `Blob`/`ArrayBuffer` bodies
through without JSON serialization.

When an operation offers several content types, the generator picks the one
from `runtime.preferContentType` (default: `application/json`, CLI
`--prefer-content-type`).

## JSON bodies

All other bodies are JSON-serialized unless they are `FormData`,
`URLSearchParams`, `Blob` or `ArrayBuffer`. The default `Content-Type` for them
is `application/json`; an explicit `contentType` on the request overrides it.
