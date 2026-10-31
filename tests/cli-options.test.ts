import {describe, it, expect} from 'vitest';
import {buildCliConfig} from '../src/cli-options.js';
import {resolveConfig} from '../src/config.js';

describe('buildCliConfig', () => {
  it('collects all runtime flags into a single runtime object', () => {
    const config = resolveConfig(
      buildCliConfig({
        transport: 'httpClient',
        signalMutations: true,
        dateTransformer: true,
      }),
      {},
    );

    // Regression test: previously each runtime flag created its own
    // {runtime: {...}} fragment and later spreads silently discarded
    // earlier ones (last spread wins), losing all but the last flag.
    expect(config.runtime?.transport).toBe('httpClient');
    expect(config.runtime?.signalMutations).toBe(true);
    expect(config.runtime?.dateTransformer).toBe(true);
  });

  it('merges query style/explode/preferContentType flags together', () => {
    const config = resolveConfig(
      buildCliConfig({
        defaultQueryStyle: 'pipeDelimited',
        defaultQueryExplode: 'false',
        preferContentType: 'multipart/form-data',
      }),
      {},
    );

    expect(config.runtime?.defaultQueryStyle).toBe('pipeDelimited');
    expect(config.runtime?.defaultQueryExplode).toBe(false);
    expect(config.runtime?.preferContentType).toBe('multipart/form-data');
  });

  it('passes through input/output/clean/groupBy', () => {
    const config = resolveConfig(
      buildCliConfig({input: 'spec.yml', output: 'out', clean: false, groupBy: 'path'}),
      {},
    );

    expect(config.input).toBe('spec.yml');
    expect(config.output).toBe('out');
    expect(config.clean).toBe(false);
    expect(config.groupBy).toBe('path');
  });

  it('rejects invalid enum values instead of silently dropping them', () => {
    // A typo such as `--transport grpc` must fail loudly: silently falling back
    // to the file/default value would generate output the caller did not ask for.
    expect(() => buildCliConfig({transport: 'grpc' as string})).toThrow(/--transport/);
    expect(() => buildCliConfig({groupBy: 'cloud' as string})).toThrow(/--group-by/);
    expect(() => buildCliConfig({defaultQueryStyle: 'matrix' as string})).toThrow(
      /--default-query-style/,
    );
    expect(() => buildCliConfig({defaultQueryExplode: 'yes'})).toThrow(
      /--default-query-explode/,
    );
  });

  it('omits the runtime key entirely when no runtime flag is given', () => {
    const cliConfig = buildCliConfig({input: 'spec.yml'});
    expect(cliConfig.runtime).toBeUndefined();
  });

  it('CLI runtime flags override file config', () => {
    const config = resolveConfig(
      buildCliConfig({signalMutations: true}),
      {runtime: {transport: 'httpClient', signalMutations: false}},
    );

    expect(config.runtime?.signalMutations).toBe(true);
    // Non-overlapping file runtime settings are preserved.
    expect(config.runtime?.transport).toBe('httpClient');
  });
});