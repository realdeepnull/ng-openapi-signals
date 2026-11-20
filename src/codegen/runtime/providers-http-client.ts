import type {GeneratorConfig} from '../types';
import {objectLiteral} from './shared';

export function generateProvidersHttpClient(config: GeneratorConfig): string {
  const defaultHeaders = config.runtime?.defaultHeaders ?? {};
  const defaultHeadersLiteral = objectLiteral(defaultHeaders);

  return `import {
  InjectionToken,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from '@angular/core';
import { type HttpErrorResponse, type HttpResponse } from '@angular/common/http';
import { toApiErrorFromHttpErrorResponse, type ApiError } from './api-error';

export const NG_OPENAPI_SIGNALS_BASE_PATH = new InjectionToken<string>('NG_OPENAPI_SIGNALS_BASE_PATH');

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
 * Per-request timeout in milliseconds. \`0\` (the default) disables it.
 *
 * Without a timeout a hanging upstream blocks \`resource()\` indefinitely —
 * there is no built-in signal to recover from it.
 */
export const NG_OPENAPI_SIGNALS_TIMEOUT = new InjectionToken<number>(
  'NG_OPENAPI_SIGNALS_TIMEOUT',
  {
    factory: () => 0,
  },
);

/**
 * Hook that returns additional headers to merge into every request.
 * Called once per request. Useful for auth tokens that may rotate.
 */
export type ApiAuthHook = () => Record<string, string> | Promise<Record<string, string>>;

/**
 * Maps a non-OK \`HttpErrorResponse\` to an error. Defaults to \`toApiErrorFromHttpErrorResponse\`.
 */
export type ApiErrorMapper = (
  response: HttpErrorResponse,
) => Promise<ApiError | Error> | ApiError | Error;

/**
 * Called before the request is sent. Can mutate the request context
 * (e.g. add headers, change the URL). Return value is ignored.
 */
export type ApiRequestHook = (request: ApiRequestContext) => void | Promise<void>;

/**
 * Called after a successful response is received, before the body is returned.
 * Receives the raw \`HttpResponse\`. Return value is ignored.
 */
export type ApiResponseHook = (response: HttpResponse<unknown>) => void | Promise<void>;

export interface ApiRequestContext {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface NgOpenapiSignalsOptions {
  basePath: string;
  auth?: ApiAuthHook;
  defaultHeaders?: Record<string, string>;
  errorMapper?: ApiErrorMapper;
  onRequest?: ApiRequestHook;
  /**
   * Aborts requests that take longer than this many milliseconds.
   * \`0\` (default) leaves requests unbounded, preserving previous behaviour.
   */
  timeoutMs?: number;
  onResponse?: ApiResponseHook;
}

export function provideNgOpenapiSignals(
  options: NgOpenapiSignalsOptions,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: NG_OPENAPI_SIGNALS_BASE_PATH,
      useValue: options.basePath,
    },
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
      useValue: options.errorMapper ?? toApiErrorFromHttpErrorResponse,
    },
    {
      provide: NG_OPENAPI_SIGNALS_REQUEST_HOOK,
      useValue: options.onRequest,
    },
    {
      provide: NG_OPENAPI_SIGNALS_RESPONSE_HOOK,
      useValue: options.onResponse,
    },
    {
      provide: NG_OPENAPI_SIGNALS_TIMEOUT,
      useValue: options.timeoutMs ?? 0,
    },
  ]);
}
`;
}
