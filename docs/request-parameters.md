# Request parameters

Query parameter serialization (`style`/`explode`) and header parameters.

Back to the [runtime overview](./RUNTIME.md). Configuration:
[CONFIGURATION.md](./CONFIGURATION.md#runtime).

---

## Query parameter serialization

For parameters with non-default OpenAPI `style`/`explode`, the generated code
wraps the value with metadata so the runtime can serialize it correctly:

```ts
query: {
  tags: { value: params.tags, style: 'spaceDelimited', explode: false },
  q: params.q,  // default style: form + explode:true — plain value
}
```

The runtime `buildUrl` method serializes according to the style. Arrays and
objects are flattened per the OpenAPI 3.0.3 style table:

| Style            | `explode: true`                     | `explode: false`                              |
| ---------------- | ----------------------------------- | --------------------------------------------- |
| `form`           | `key=val1&key=val2` / `R=100&G=200` | `key=val1,val2` / `color=R,100,G,200`         |
| `spaceDelimited` | `key=val1&key=val2` / `R=100&G=200` | `key=val1%20val2` / `color=R%20100%20G%20200` |
| `pipeDelimited`  | `key=val1&key=val2` / `R=100&G=200` | `key=val1\|val2` / `color=R\|100\|G\|200`     |
| `deepObject`     | `key[prop]=val`                     | `key[prop]=val` (always exploded)             |

Object properties resolving to `undefined` or `null` are omitted.

Parameters with default style (`form` + `explode: true`) are passed as plain
values for backward compatibility. Non-default styles are wrapped with
metadata: `{ value: params.tags, style: 'spaceDelimited', explode: false }`.

The defaults for parameters without `style`/`explode` are controlled by
`runtime.defaultQueryStyle` and `runtime.defaultQueryExplode`.

### Values that cannot be serialized

Query parameters whose value cannot be expressed by the declared OpenAPI style
(a nested object under `form`, `spaceDelimited` or `pipeDelimited`, or a second
nesting level under `deepObject`) throw a `TypeError` instead of being sent as
`[object Object]`. Arrays are joined with the style separator, and
`application/x-www-form-urlencoded` bodies repeat the key per array element.

---

## Header parameters

Header parameters (`in: header`) are generated as method arguments and merged
into the request `headers` object.
Header names with hyphens (e.g. `X-Request-Id`) are properly quoted in TypeScript.

Header parameters accept `MaybeSignal<T>` like every other parameter (see
[generated-api.md](./generated-api.md#maybesignalt)).

---

## Request bodies

Multipart, `x-www-form-urlencoded`, custom content types and body passthrough:
[request-bodies.md](./request-bodies.md).
