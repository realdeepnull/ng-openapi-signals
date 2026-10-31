import type {PartialGeneratorConfig, RuntimeConfig} from './codegen/types';
import {isGroupBy, isQueryStyle, isTransport} from './config';

/**
 * Raw `generate` command option values as passed by commander.
 *
 * Strings for enum-like options are validated here before they are promoted
 * to the typed `PartialGeneratorConfig`.
 */
export interface CliGenerateOptions {
  input?: string;
  output?: string;
  clean?: boolean;
  groupBy?: string;
  transport?: string;
  defaultQueryStyle?: string;
  defaultQueryExplode?: string;
  preferContentType?: string;
  signalMutations?: boolean;
  dateTransformer?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  check?: boolean;
}

/**
 * Converts raw CLI option values into a `PartialGeneratorConfig` that can be
 * merged over the file config via `resolveConfig`.
 *
 * All `runtime.*` flags are collected into a **single** `runtime` object.
 * Spreading multiple `{runtime: {...}}` fragments instead would make later
 * fragments silently discard earlier ones (last spread wins), losing flags
 * like `--transport httpClient --signal-mutations --date-transformer`.
 *
 * Invalid enum-like values are rejected with a clear error rather than silently
 * dropped: a typo such as `--transport httpclient` would otherwise fall back to
 * the file/default value and produce output the caller did not ask for.
 */
export function buildCliConfig(options: CliGenerateOptions): PartialGeneratorConfig {
  if (options.transport !== undefined && !isTransport(options.transport)) {
    throw new Error(
      `Invalid --transport value '${options.transport}'. Must be 'fetch' or 'httpClient'.`,
    );
  }

  if (options.groupBy !== undefined && !isGroupBy(options.groupBy)) {
    throw new Error(`Invalid --group-by value '${options.groupBy}'. Must be 'tag' or 'path'.`);
  }

  if (options.defaultQueryStyle !== undefined && !isQueryStyle(options.defaultQueryStyle)) {
    throw new Error(
      `Invalid --default-query-style value '${options.defaultQueryStyle}'. Must be 'form', 'spaceDelimited', 'pipeDelimited', or 'deepObject'.`,
    );
  }

  let defaultQueryExplode: boolean | undefined;

  if (options.defaultQueryExplode !== undefined) {
    if (options.defaultQueryExplode !== 'true' && options.defaultQueryExplode !== 'false') {
      throw new Error(
        `Invalid --default-query-explode value '${options.defaultQueryExplode}'. Must be 'true' or 'false'.`,
      );
    }
    defaultQueryExplode = options.defaultQueryExplode === 'true';
  }

  // Validation above narrows the raw CLI strings; the casts document that for
  // the type system, which cannot see through the boolean guards.
  const transport = options.transport as RuntimeConfig['transport'];
  const defaultQueryStyle = options.defaultQueryStyle as RuntimeConfig['defaultQueryStyle'];

  const runtime: Partial<RuntimeConfig> = {
    ...(transport !== undefined ? {transport} : {}),
    ...(defaultQueryStyle !== undefined ? {defaultQueryStyle} : {}),
    ...(defaultQueryExplode !== undefined ? {defaultQueryExplode} : {}),
    ...(options.preferContentType !== undefined
      ? {preferContentType: options.preferContentType}
      : {}),
    ...(options.signalMutations === true ? {signalMutations: true} : {}),
    ...(options.dateTransformer === true ? {dateTransformer: true} : {}),
  };

  const groupBy = options.groupBy as PartialGeneratorConfig['groupBy'];

  return {
    ...(options.input ? {input: options.input} : {}),
    ...(options.output ? {output: options.output} : {}),
    ...(options.clean !== undefined ? {clean: options.clean} : {}),
    ...(groupBy !== undefined ? {groupBy} : {}),
    ...(Object.keys(runtime).length > 0 ? {runtime} : {}),
  };
}