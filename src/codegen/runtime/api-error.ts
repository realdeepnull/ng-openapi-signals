import type {GeneratorConfig} from '../types';

/**
 * Shared message-extraction logic used by both the fetch and httpClient
 * transports. Emits the template string that extracts a human-readable
 * message from a variety of error body shapes:
 *
 * - NestJS:  { message: 'User u_4 not found', error: 'Not Found', statusCode: 404 }
 * - NestJS validation pipe: { message: ['name must be a string'], error: 'Bad Request', statusCode: 400 }
 * - FastAPI / Django / Express: { detail: '...' } | { errors: [...] }
 * - RFC 7807 Problem Details: { title: '...', detail: '...' }
 * - Simple string bodies
 * - Unknown shapes (falls back to status + statusText)
 */
function extractMessageTemplate(): string {
  return `function extractApiErrorMessage(status: number, statusText: string, body: unknown): string {
  if (body === null || body === undefined) {
    return \`HTTP \${status}\${statusText ? ': ' + statusText : ''}\`;
  }

  if (typeof body === 'string') {
    return body.length > 0 ? body : \`HTTP \${status}\${statusText ? ': ' + statusText : ''}\`;
  }

  if (typeof body === 'object') {
    const b = body as Record<string, unknown>;

    // NestJS: { message: string | string[], error, statusCode }
    const message = b['message'];
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
    if (Array.isArray(message) && message.length > 0) {
      return message.map((m) => String(m)).join(', ');
    }

    // FastAPI / generic: { detail: string | { msg }[] }
    // (RFC 7807 Problem Details with a title field is handled below to produce
    // a richer "title: detail" message.)
    const detail = b['detail'];
    if (typeof detail === 'string' && detail.length > 0 && typeof b['title'] !== 'string') {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first === 'object' && 'msg' in first) {
        return String((first as Record<string, unknown>)['msg']);
      }
      return String(detail[0]);
    }

    // Express validator / generic: { errors: [{ msg }] }
    const errors = b['errors'];
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (first && typeof first === 'object' && 'msg' in first) {
        return String((first as Record<string, unknown>)['msg']);
      }
      return String(first);
    }

    // RFC 7807 Problem Details: { title, detail }
    const problemDetail = b['detail'];
    if (typeof problemDetail === 'string' && problemDetail.length > 0) {
      const title = typeof b['title'] === 'string' ? (b['title'] as string) : '';
      return title ? \`\${title}: \${problemDetail}\` : problemDetail;
    }
    const problemTitle = b['title'];
    if (typeof problemTitle === 'string' && problemTitle.length > 0) {
      return problemTitle;
    }

    // Generic { error: string }
    const errorField = b['error'];
    if (typeof errorField === 'string' && errorField.length > 0) {
      return errorField;
    }
  }

  return \`HTTP \${status}\${statusText ? ': ' + statusText : ''}\`;
}`;
}

export function generateApiError(config: GeneratorConfig): string {
  const transport = config.runtime?.transport ?? 'fetch';

  if (transport === 'httpClient') {
    return `import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';

${extractMessageTemplate()}

/**
 * Error thrown for non-2xx HTTP responses. Extends \`Error\` so Angular's
 * \`resource()\` (and native try/catch handlers) treat it as a real error
 * instead of wrapping it in "Resource returned an error that's not an Error
 * instance: [object Object]".
 *
 * The original response body is preserved on \`body\`, and the HTTP status /
 * statusText / headers are available for structured error handling.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;
  readonly headers: HttpHeaders;

  constructor(status: number, statusText: string, body: unknown, headers: HttpHeaders) {
    super(extractApiErrorMessage(status, statusText, body));
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.headers = headers;
  }
}

export function toApiErrorFromHttpErrorResponse(error: HttpErrorResponse): ApiError {
  return new ApiError(
    error.status,
    '',  // statusText from HttpErrorResponse is deprecated
    error.error,
    error.headers,
  );
}
`;
  }

  return `${extractMessageTemplate()}

/**
 * Error thrown for non-2xx HTTP responses. Extends \`Error\` so Angular's
 * \`resource()\` (and native try/catch handlers) treat it as a real error
 * instead of wrapping it in "Resource returned an error that's not an Error
 * instance: [object Object]".
 *
 * The original response body is preserved on \`body\`, and the HTTP status /
 * statusText / headers are available for structured error handling.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;
  readonly headers: Headers;

  constructor(status: number, statusText: string, body: unknown, headers: Headers) {
    super(extractApiErrorMessage(status, statusText, body));
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.headers = headers;
  }
}

export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;

  try {
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }
  } catch {
    body = null;
  }

  return new ApiError(
    response.status,
    response.statusText,
    body,
    response.headers,
  );
}
`;
}
