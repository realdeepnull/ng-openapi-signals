import type {GeneratorConfig} from '../types';
import {objectLiteral} from './shared';

export function generateProvidersFetch(config: GeneratorConfig): string {
  const defaultHeaders = config.runtime?.defaultHeaders ?? {};
  const defaultHeadersLiteral = objectLiteral(defaultHeaders);

  return `import {
  EnvironmentProviders,
  InjectionToken,
  Provider,
  makeEnvironmentProviders,
} from '@angular/core';
import { toApiError, ApiError } from './api-error';

export const NG_OPENAPI_SIGNALS_BASE_PATH = new InjectionToken<string>('NG_OPENAPI_SIGNALS_BASE_PATH');

/**
 * Multi-provider InjectionToken for fetch middleware.
 *
 * Middleware can be registered from any feature module via:
 *
 * \`\`\`ts
 * { provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: LoggingMiddleware }
 * { provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useValue: myFnMiddleware }
 * \`\`\`
 *
 * Class-based middleware are instantiated by Angular DI, so they can inject
 * services via constructor injection. The convenience array passed to
 * \`provideNgOpenapiSignals({ middleware: [...] })\` is flattened into the same
 * multi-provider stream, preserving registration order.
 */
export const NG_OPENAPI_SIGNALS_MIDDLEWARE = new InjectionToken<readonly ApiMiddlewareEntry[]>(
  'NG_OPENAPI_SIGNALS_MIDDLEWARE',
  {
    factory: () => [],
  },
);

export const NG_OPENAPI_SIGNALS_AUTH = new InjectionToken<ApiAuthHook | undefined>(
  'NG_OPENAPI_SIGNALS_AUTH',
);

export const NG_OPENAPI_SIGNALS_DEFAULT_HEADERS = new InjectionToken<Record<string, string>>(
  'NG_OPENAPI_SIGNALS_DEFAULT_HEADERS',
);

export const NG_OPENAPI_SIGNALS_ERROR_MAPPER = new InjectionToken<ApiErrorMapper>(
  'NG_OPENAPI_SIGNALS_ERROR_MAPPER',
);

export const NG_OPENAPI_SIGNALS_REQUEST_HOOK = new InjectionToken<
  ApiRequestHook | undefined
>('NG_OPENAPI_SIGNALS_REQUEST_HOOK');

export const NG_OPENAPI_SIGNALS_RESPONSE_HOOK = new InjectionToken<
  ApiResponseHook | undefined
>('NG_OPENAPI_SIGNALS_RESPONSE_HOOK');

/**
 * A fetch middleware function in onion-style: receives the request context
 * and a \`next\` function that calls the next middleware (or the core fetch).
 * Can mutate the request, short-circuit, transform the response, or handle errors.
 */
export type ApiMiddlewareFn = (
  request: ApiRequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

/**
 * Class-based fetch middleware. Implementations are decorated with
 * \`@Injectable()\` (or \`@Service()\`) and registered via Angular DI:
 *
 * \`\`\`ts
 * @Injectable()
 * class LoggingMiddleware implements ApiMiddleware {
 *   constructor(private auth: AuthService) {}
 *   async handle(request: ApiRequestContext, next: () => Promise<Response>) {
 *     // ...
 *   }
 * }
 *
 * { provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: LoggingMiddleware }
 * \`\`\`
 *
 * The runtime dispatches via \`typeof mw === 'function'\`: functions are
 * called directly as \`ApiMiddlewareFn\`, objects are treated as class
 * instances and \`handle()\` is invoked. Do not add a \`handle\` property to
 * a function middleware to avoid ambiguity.
 */
export interface ApiMiddleware {
  handle(request: ApiRequestContext, next: () => Promise<Response>): Promise<Response>;
}

/**
 * Either a function-based or class-based middleware entry. The pipeline
 * dispatches via \`typeof mw === 'function'\`: functions are called as
 * \`ApiMiddlewareFn\`, objects have their \`handle()\` method invoked.
 */
export type ApiMiddlewareEntry = ApiMiddlewareFn | ApiMiddleware;

/**
 * Hook that returns additional headers to merge into every request.
 * Called once per request. Useful for auth tokens that may rotate.
 */
export type ApiAuthHook = () => Record<string, string> | Promise<Record<string, string>>;

/**
 * Maps a non-OK \`Response\` to an error. Defaults to \`toApiError\`.
 */
export type ApiErrorMapper = (response: Response) => Promise<ApiError | Error> | ApiError | Error;

/**
 * Called before the middleware pipeline runs. Can mutate the request context
 * (e.g. add headers, change the URL). Return value is ignored.
 */
export type ApiRequestHook = (request: ApiRequestContext) => void | Promise<void>;

/**
 * Called after a successful response is received, before the body is parsed.
 * Receives a cloned \`Response\` so the hook can inspect the body without
 * interfering with the runtime's subsequent body parsing.
 * Return value is ignored.
 *
 * Note: the clone is a one-shot — if you call .json()/.text()/.blob() on it,
 * do so only once. The original response is read by the runtime afterwards.
 */
export type ApiResponseHook = (response: Response) => void | Promise<void>;

export interface ApiRequestContext {
  url: string;
  init: RequestInit;
}

export interface NgOpenapiSignalsOptions {
  basePath: string;
  /**
   * Convenience array of function-based middleware. Entries are registered
   * as \`multi: true\` providers on \`NG_OPENAPI_SIGNALS_MIDDLEWARE\`,
   * preserving their order relative to any class-based providers declared
   * in other feature modules. For class-based middleware with constructor
   * DI, register them separately:
   *
   * \`\`\`ts
   * { provide: NG_OPENAPI_SIGNALS_MIDDLEWARE, multi: true, useClass: MyMiddleware }
   * \`\`\`
   */
  middleware?: readonly ApiMiddlewareFn[];
  auth?: ApiAuthHook;
  defaultHeaders?: Record<string, string>;
  errorMapper?: ApiErrorMapper;
  onRequest?: ApiRequestHook;
  onResponse?: ApiResponseHook;
}

function middlewareProviders(middleware?: readonly ApiMiddlewareFn[]): Provider[] {
  return (middleware ?? []).map((mw) => ({
    provide: NG_OPENAPI_SIGNALS_MIDDLEWARE,
    multi: true,
    useValue: mw,
  }));
}

export function provideNgOpenapiSignals(
  options: NgOpenapiSignalsOptions,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: NG_OPENAPI_SIGNALS_BASE_PATH,
      useValue: options.basePath,
    },
    ...middlewareProviders(options.middleware),
    {
      provide: NG_OPENAPI_SIGNALS_AUTH,
      useValue: options.auth,
    },
    {
      provide: NG_OPENAPI_SIGNALS_DEFAULT_HEADERS,
      useValue: { ...${defaultHeadersLiteral}, ...options.defaultHeaders },
    },
    {
      provide: NG_OPENAPI_SIGNALS_ERROR_MAPPER,
      useValue: options.errorMapper ?? toApiError,
    },
    {
      provide: NG_OPENAPI_SIGNALS_REQUEST_HOOK,
      useValue: options.onRequest,
    },
    {
      provide: NG_OPENAPI_SIGNALS_RESPONSE_HOOK,
      useValue: options.onResponse,
    },
  ]);
}
`;
}
