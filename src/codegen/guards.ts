import type {GroupBy, HttpTransport, QueryStyle} from './types';

/**
 * Runtime type guards for the config unions.
 *
 * Kept in their own module so the pure codegen layer can validate
 * spec/config values without importing the CLI-facing `config.ts` (which
 * loads `jiti` and touches the filesystem). `config.ts` re-exports them for
 * backwards compatibility.
 */

/** Type guard for the `GroupBy` union. */
export function isGroupBy(value: unknown): value is GroupBy {
  return value === 'tag' || value === 'path';
}

/** Type guard for the `HttpTransport` union. */
export function isTransport(value: unknown): value is HttpTransport {
  return value === 'fetch' || value === 'httpClient';
}

/** Type guard for the `QueryStyle` union. */
export function isQueryStyle(value: unknown): value is QueryStyle {
  return (
    value === 'form' ||
    value === 'spaceDelimited' ||
    value === 'pipeDelimited' ||
    value === 'deepObject'
  );
}
