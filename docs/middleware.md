# Middleware

Middleware lets you intercept every request/response cycle in onion-style
order: each middleware receives the request context and a `next` function
that calls the next middleware (or the core `fetch()`). Middleware can
mutate the request, short-circuit, transform the response, or handle errors.

Back to the [runtime overview](./RUNTIME.md).

> **Note:** Middleware applies to the `fetch` transport only. When using
> `transport: 'httpClient'`, use Angular `HttpInterceptor` (see
> [transports.md](./transports.md)).

---

## Two kinds of middleware

There are two kinds of middleware, both registered on the same
`NG_OPENAPI_SIGNALS_MIDDLEWARE` multi-provider token:

| Kind               | Shape                                               | DI?                     | When to use                                    |
| ------------------ | --------------------------------------------------- | ----------------------- | ---------------------------------------------- |
| **Function-based** | `(req, next) => Promise<Response>`                  | ❌ no injection context | Simple, stateless logic (logging, tracing)     |
| **Class-based**    | `implements ApiMiddleware` with `handle(req, next)` | ✅ constructor DI       | Auth, feature flags, anything needing services |

The runtime dispatches via `typeof mw === 'function'`: functions are called
directly as `ApiMiddlewareFn`, objects have their `handle()` method invoked
as class instances.

## Function-based middleware (convenience)

Register plain functions via the `middleware` array in
`provideNgOpenapiSignals()`. The array is flattened into multi-providers,
preserving order:

```ts
provideNgOpenapiSignals({
  basePath: 'https://api.example.com',
  middleware: [
    async (req, next) => {
      console.log('→', req.init.method, req.url);
      const res = await next();
      console.log('←', res.status);
      return res;
    },
  ],
});
```

## Class-based middleware (with DI)

For middleware that needs Angular services, implement the `ApiMiddleware`
interface and register it as a multi-provider. Angular instantiates the
class via DI, so you can inject services through the constructor:

```ts
// auth.middleware.ts
import {Injectable} from '@angular/core';
import {ApiMiddleware, ApiRequestContext} from './generated/api';

@Injectable()
export class AuthMiddleware implements ApiMiddleware {
  constructor(private auth: AuthService) {}

  async handle(req: ApiRequestContext, next: () => Promise<Response>): Promise<Response> {
    const token = this.auth.token(); // signal-based token
    req.init.headers = {
      ...req.init.headers,
      Authorization: `Bearer ${token}`,
    };
    return next();
  }
}
```

Register via `{ provide, multi: true, useClass }` — no need to instantiate
manually:

```ts
// app.config.ts
import {ApplicationConfig} from '@angular/core';
import {provideNgOpenapiSignals, NG_OPENAPI_SIGNALS_MIDDLEWARE} from './generated/api';
import {AuthMiddleware} from './auth.middleware';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgOpenapiSignals({basePath: 'https://api.example.com'}),
    {provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: AuthMiddleware},
  ],
};
```

## Coexistence of both patterns

Function-based and class-based middleware share the same token and run in
the same pipeline. Angular merges `multi: true` providers in registration
order; `reduceRight` means the first registered entry is the outermost
layer (runs first on the request, last on the response):

```ts
provideNgOpenapiSignals({
  basePath: 'https://api.example.com',
  // Function-based convenience entries.
  middleware: [loggingFn],
}),
// Class-based entry from a feature module.
{provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: AuthMiddleware},
```

## Registering from feature modules

Because `NG_OPENAPI_SIGNALS_MIDDLEWARE` is a multi-provider, any feature
module can add middleware without touching the root config:

```ts
// logging.feature.ts
import {EnvironmentProviders, makeEnvironmentProviders} from '@angular/core';
import {NG_OPENAPI_SIGNALS_MIDDLEWARE} from './generated/api';
import {LoggingMiddleware} from './logging.middleware';

export function provideLogging(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: LoggingMiddleware},
  ]);
}
```

Auth example:
[`usage/auth-interceptor.ts`](./usage/auth-interceptor.ts).
