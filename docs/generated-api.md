# Generated API Style

How generated service methods look and behave: GET endpoints as Angular
`resource()`, mutating endpoints as Promises, and the opt-in signal-based
mutations.

Back to the [runtime overview](./RUNTIME.md).

---

## GET endpoints

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

Full example: [`usage/resource-usage.ts`](./usage/resource-usage.ts).

## Mutating endpoints

POST, PUT, PATCH and DELETE endpoints are generated as Promise-based methods using `fetch()`.

Example:

```ts
await this.usersApi.createUser({
  name: 'John Doe',
  email: 'john@example.com',
});
```

This keeps read operations reactive while keeping write operations explicit and predictable.

Full example: [`usage/mutation-usage.ts`](./usage/mutation-usage.ts).

---

## Signal-based mutations (opt-in)

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

### Basic usage

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

### Endpoints with parameters

For endpoints with path/query/header parameters, the parameters are bound at
construction time (captured in the closure) and accept plain values or signals
(like the `resource()` variants). Only the request body is passed to `mutate()`.
The signals are read when `mutate()` dispatches the request, and the Promise
method that `…Mutation()` delegates to accepts the same `MaybeSignal` params,
so it can be called directly as well:

```ts
readonly userId = signal('usr_123');

readonly uploading = this.usersApi.uploadUserAvatarMutation({
  id: this.userId,  // signal — read when `mutate()` is invoked
});

upload(): void {
  this.uploading.mutate({ file: this.file, caption: 'Profile photo' });
}
```

Parameter keys are the OpenAPI parameter names, quoted when they are not valid
identifiers (`'X-Request-Id'`, `'filter[name]'`). OpenAPI only requires
`(name, in)` to be unique, so the same name may legally appear in several
locations. When it does, the key is suffixed by location — `idPath`,
`idQuery`, `idHeader` — to keep the params type unambiguous:

```yaml
parameters:
  - {name: id, in: path, required: true, schema: {type: string}}
  - {name: id, in: query, schema: {type: string}}
```

```ts
this.usersApi.getUserResource({idPath: this.userId, idQuery: 'full'});
```

Names that occur only once keep their verbatim key, so no existing call site
changes. A location suffix never renames a parameter that is literally called
that: if the spec also declares a parameter named `idPath`, the literal name
keeps its key and the colliding parameter becomes `idPath2` instead.

### Reset

Call `reset()` to clear `result` and `error` and return the mutation to the
`'idle'` status — useful when navigating away or re-opening a form:

```ts
ngOnDestroy(): void {
  this.creating.reset();
}
```

### Enabling the feature

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

### `Mutation` interface

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

More examples:
[`usage/mutation-signal-usage.ts`](./usage/mutation-signal-usage.ts) and
[`usage/mutation-signal-params-usage.ts`](./usage/mutation-signal-params-usage.ts).

---

## `MaybeSignal<T>`

Generated resource _and_ mutation methods accept both plain values and Angular
signals for path, query and header parameters.

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

Both shapes work for the Promise-based mutations too — the method reads each
parameter once with `readSignalOrValue()` at call time, so a signal is
dereferenced when the request is dispatched:

```ts
await api.doAction(body, {id: this.userId, verbose: true});
await api.doAction(body, {id: this.userId, verbose: this.verbose});
```
