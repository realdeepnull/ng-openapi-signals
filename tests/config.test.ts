import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {
  loadConfig,
  resolveConfig,
  validateConfig,
  defineConfig,
  isGroupBy,
  isQueryStyle,
  isTransport,
  DEFAULT_CONFIG,
  DEFAULT_RUNTIME_CONFIG,
} from '../src/config.js';
import {buildCliConfig} from '../src/cli-options.js';

const TMP_DIR = join(process.cwd(), 'tests', '.tmp-config');

describe('config', () => {
  beforeEach(async () => {
    await rm(TMP_DIR, {recursive: true, force: true});
    await mkdir(TMP_DIR, {recursive: true});
  });

  afterEach(async () => {
    await rm(TMP_DIR, {recursive: true, force: true});
  });

  describe('loadConfig', () => {
    it('returns empty object when no config file exists', async () => {
      const originalCwd = process.cwd();
      process.chdir(TMP_DIR);
      try {
        const config = await loadConfig();
        expect(config).toEqual({});
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('loads a config file with default export', async () => {
      const configPath = join(TMP_DIR, 'ng-openapi-signals.config.ts');
      await writeFile(
        configPath,
        `export default {\n  input: './openapi.json',\n  output: './src/generated/api',\n  groupBy: 'path',\n};\n`,
        'utf8',
      );

      const config = await loadConfig(configPath);
      expect(config.input).toBe('./openapi.json');
      expect(config.output).toBe('./src/generated/api');
      expect(config.groupBy).toBe('path');
    });

    it('loads a CommonJS config file (module.exports)', async () => {
      const configPath = join(TMP_DIR, 'ng-openapi-signals.config.cjs');
      await writeFile(configPath, `module.exports = {input: './cjs.json'};\n`, 'utf8');

      const config = await loadConfig(configPath);
      expect(config.input).toBe('./cjs.json');
    });

    it('throws when an explicitly requested config file does not exist', async () => {
      // Silently ignoring a typo in --config would generate output from the
      // wrong (or default) configuration.
      await expect(loadConfig(join(TMP_DIR, 'missing.config.ts'))).rejects.toThrow(
        /config file not found/,
      );
    });
  });

  describe('resolveConfig', () => {
    it('uses defaults when no overrides provided', () => {
      const config = resolveConfig({}, {});
      expect(config.clean).toBe(DEFAULT_CONFIG.clean);
      expect(config.groupBy).toBe(DEFAULT_CONFIG.groupBy);
    });

    it('file config overrides defaults', () => {
      const config = resolveConfig({}, {input: './openapi.json', output: './out'});
      expect(config.input).toBe('./openapi.json');
      expect(config.output).toBe('./out');
    });

    it('CLI options override file config', () => {
      const config = resolveConfig({groupBy: 'path'}, {groupBy: 'tag'});
      expect(config.groupBy).toBe('path');
    });

    it('CLI clean=false overrides file clean=true', () => {
      const config = resolveConfig({clean: false}, {clean: true});
      expect(config.clean).toBe(false);
    });

    it('keeps a file-level clean:false when no clean flag is passed', () => {
      // Regression guard: giving the commander `--clean` option a `.default(true)`
      // would make `clean` always defined by the CLI and silently override the
      // config file. The default belongs to DEFAULT_CONFIG only.
      const cliConfig = buildCliConfig({});
      expect(cliConfig.clean).toBeUndefined();

      const config = resolveConfig(cliConfig, {clean: false});
      expect(config.clean).toBe(false);
    });

    it('CLI groupBy overrides file groupBy', () => {
      const config = resolveConfig({groupBy: 'path'}, {groupBy: 'tag'});
      expect(config.groupBy).toBe('path');
    });

    it('provides default runtime config when no overrides given', () => {
      const config = resolveConfig({}, {});
      expect(config.runtime).toEqual(DEFAULT_RUNTIME_CONFIG);
      expect(config.runtime!.transport).toBe('fetch');
      expect(config.runtime!.defaultHeaders).toEqual({});
      expect(config.runtime!.responseTypeHints).toBe(true);
    });

    it('file runtime.defaultHeaders overrides defaults', () => {
      const config = resolveConfig(
        {},
        {
          runtime: {defaultHeaders: {'X-Client': 'ng-openapi-signals'}},
        },
      );
      expect(config.runtime!.defaultHeaders).toEqual({'X-Client': 'ng-openapi-signals'});
    });

    it('CLI runtime.defaultHeaders merges over file runtime.defaultHeaders', () => {
      const config = resolveConfig(
        {runtime: {defaultHeaders: {'X-Cli': 'cli'}}},
        {runtime: {defaultHeaders: {'X-File': 'file'}}},
      );
      // Deep-merge: CLI keys win, file keys preserved when not overridden.
      expect(config.runtime!.defaultHeaders).toEqual({'X-Cli': 'cli', 'X-File': 'file'});
    });

    it('CLI runtime.defaultHeaders overrides file keys with the same name', () => {
      const config = resolveConfig(
        {runtime: {defaultHeaders: {'X-Shared': 'cli'}}},
        {runtime: {defaultHeaders: {'X-Shared': 'file'}}},
      );
      expect(config.runtime!.defaultHeaders).toEqual({'X-Shared': 'cli'});
    });

    it('deep-merges runtime.defaultHeaders from file and defaults', () => {
      const config = resolveConfig(
        {},
        {
          runtime: {defaultHeaders: {'X-Custom': 'abc'}},
        },
      );
      // default is {} so result equals file override
      expect(config.runtime!.defaultHeaders).toEqual({'X-Custom': 'abc'});
    });

    it('file responseTypeHints=false overrides default true', () => {
      const config = resolveConfig({}, {runtime: {responseTypeHints: false}});
      expect(config.runtime!.responseTypeHints).toBe(false);
    });

    it('CLI responseTypeHints overrides file', () => {
      const config = resolveConfig(
        {runtime: {responseTypeHints: true}},
        {runtime: {responseTypeHints: false}},
      );
      expect(config.runtime!.responseTypeHints).toBe(true);
    });

    it('preserves unrelated runtime fields when partially overridden', () => {
      const config = resolveConfig(
        {runtime: {responseTypeHints: false}},
        {runtime: {defaultHeaders: {'X-A': 'a'}}},
      );
      expect(config.runtime!.responseTypeHints).toBe(false);
      expect(config.runtime!.defaultHeaders).toEqual({'X-A': 'a'});
    });

    it('defaults transport to fetch when not specified', () => {
      const config = resolveConfig({}, {});
      expect(config.runtime!.transport).toBe('fetch');
    });

    it('file runtime.transport overrides default', () => {
      const config = resolveConfig({}, {runtime: {transport: 'httpClient'}});
      expect(config.runtime!.transport).toBe('httpClient');
    });

    it('CLI runtime.transport overrides file', () => {
      const config = resolveConfig(
        {runtime: {transport: 'fetch'}},
        {runtime: {transport: 'httpClient'}},
      );
      expect(config.runtime!.transport).toBe('fetch');
    });

    it('preserves unrelated runtime fields when transport is overridden', () => {
      const config = resolveConfig(
        {runtime: {transport: 'httpClient'}},
        {runtime: {defaultHeaders: {'X-A': 'a'}, responseTypeHints: false}},
      );
      expect(config.runtime!.transport).toBe('httpClient');
      expect(config.runtime!.defaultHeaders).toEqual({'X-A': 'a'});
      expect(config.runtime!.responseTypeHints).toBe(false);
    });

    it('defaults defaultQueryStyle to form', () => {
      const config = resolveConfig({}, {});
      expect(config.runtime!.defaultQueryStyle).toBe('form');
    });

    it('file defaultQueryStyle overrides default', () => {
      const config = resolveConfig({}, {runtime: {defaultQueryStyle: 'pipeDelimited'}});
      expect(config.runtime!.defaultQueryStyle).toBe('pipeDelimited');
    });

    it('CLI defaultQueryStyle overrides file', () => {
      const config = resolveConfig(
        {runtime: {defaultQueryStyle: 'spaceDelimited'}},
        {runtime: {defaultQueryStyle: 'pipeDelimited'}},
      );
      expect(config.runtime!.defaultQueryStyle).toBe('spaceDelimited');
    });

    it('defaults defaultQueryExplode to true', () => {
      const config = resolveConfig({}, {});
      expect(config.runtime!.defaultQueryExplode).toBe(true);
    });

    it('file defaultQueryExplode overrides default', () => {
      const config = resolveConfig({}, {runtime: {defaultQueryExplode: false}});
      expect(config.runtime!.defaultQueryExplode).toBe(false);
    });

    it('defaults preferContentType to application/json', () => {
      const config = resolveConfig({}, {});
      expect(config.runtime!.preferContentType).toBe('application/json');
    });

    it('file preferContentType overrides default', () => {
      const config = resolveConfig({}, {runtime: {preferContentType: 'multipart/form-data'}});
      expect(config.runtime!.preferContentType).toBe('multipart/form-data');
    });

    it('defaults signalMutations to false', () => {
      const config = resolveConfig({}, {});
      expect(config.runtime!.signalMutations).toBe(false);
    });

    it('file signalMutations=true overrides default false', () => {
      const config = resolveConfig({}, {runtime: {signalMutations: true}});
      expect(config.runtime!.signalMutations).toBe(true);
    });

    it('CLI signalMutations overrides file', () => {
      const config = resolveConfig(
        {runtime: {signalMutations: false}},
        {runtime: {signalMutations: true}},
      );
      expect(config.runtime!.signalMutations).toBe(false);
    });

    it('defaults dateTransformer to false', () => {
      const config = resolveConfig({}, {});
      expect(config.runtime!.dateTransformer).toBe(false);
    });

    it('file dateTransformer=true overrides default false', () => {
      const config = resolveConfig({}, {runtime: {dateTransformer: true}});
      expect(config.runtime!.dateTransformer).toBe(true);
    });

    it('CLI dateTransformer overrides file', () => {
      const config = resolveConfig(
        {runtime: {dateTransformer: false}},
        {runtime: {dateTransformer: true}},
      );
      expect(config.runtime!.dateTransformer).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('throws when input is missing', () => {
      expect(() => validateConfig({...DEFAULT_CONFIG, input: ''})).toThrow(
        'no input path provided',
      );
    });

    it('throws when output is missing', () => {
      expect(() =>
        validateConfig({...DEFAULT_CONFIG, input: './openapi.json', output: ''}),
      ).toThrow('no output path provided');
    });

    it('does not throw when input and output are set', () => {
      expect(() =>
        validateConfig({...DEFAULT_CONFIG, input: './openapi.json', output: './out'}),
      ).not.toThrow();
    });

    it('throws when runtime.defaultHeaders is not an object', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {defaultHeaders: 'not-an-object' as unknown as Record<string, string>},
        }),
      ).toThrow('runtime.defaultHeaders must be an object');
    });

    it('throws when runtime.defaultHeaders has a non-string value', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {defaultHeaders: {'X-Num': 123 as unknown as string}},
        }),
      ).toThrow('must be a string, got number');
    });

    it('throws when runtime.responseTypeHints is not a boolean', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {responseTypeHints: 'yes' as unknown as boolean},
        }),
      ).toThrow('runtime.responseTypeHints must be a boolean');
    });

    it('does not throw for valid runtime config', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {defaultHeaders: {'X-Client': 'abc'}, responseTypeHints: false},
        }),
      ).not.toThrow();
    });

    it('does not throw when transport is fetch', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {transport: 'fetch'},
        }),
      ).not.toThrow();
    });

    it('does not throw when transport is httpClient', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {transport: 'httpClient'},
        }),
      ).not.toThrow();
    });

    it('throws when transport is invalid', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {transport: 'axios' as unknown as 'fetch'},
        }),
      ).toThrow('invalid runtime.transport');
    });

    it('throws when defaultQueryStyle is invalid', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {defaultQueryStyle: 'invalid' as unknown as 'form'},
        }),
      ).toThrow('invalid runtime.defaultQueryStyle');
    });

    it('throws when defaultQueryExplode is not a boolean', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {defaultQueryExplode: 'yes' as unknown as boolean},
        }),
      ).toThrow('runtime.defaultQueryExplode must be a boolean');
    });

    it('throws when preferContentType is not a string', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {preferContentType: 123 as unknown as string},
        }),
      ).toThrow('runtime.preferContentType must be a string');
    });

    it('throws when runtime.signalMutations is not a boolean', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {signalMutations: 'yes' as unknown as boolean},
        }),
      ).toThrow('runtime.signalMutations must be a boolean');
    });

    it('throws when runtime.dateTransformer is not a boolean', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {dateTransformer: 'yes' as unknown as boolean},
        }),
      ).toThrow('runtime.dateTransformer must be a boolean');
    });

    it('does not throw for valid new runtime config', () => {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          input: './openapi.json',
          output: './out',
          runtime: {
            defaultQueryStyle: 'deepObject',
            defaultQueryExplode: false,
            preferContentType: 'multipart/form-data',
          },
        }),
      ).not.toThrow();
    });
  });

  describe('defineConfig', () => {
    it('returns the config object as-is', () => {
      const config = defineConfig({input: './openapi.json', output: './out'});
      expect(config.input).toBe('./openapi.json');
      expect(config.output).toBe('./out');
    });
  });

  describe('isGroupBy', () => {
    it('returns true for tag and path', () => {
      expect(isGroupBy('tag')).toBe(true);
      expect(isGroupBy('path')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isGroupBy('invalid')).toBe(false);
      expect(isGroupBy(undefined)).toBe(false);
    });
  });

  describe('isTransport', () => {
    it('returns true for fetch and httpClient', () => {
      expect(isTransport('fetch')).toBe(true);
      expect(isTransport('httpClient')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isTransport('invalid')).toBe(false);
      expect(isTransport(undefined)).toBe(false);
    });
  });

  describe('isQueryStyle', () => {
    it('returns true for valid query styles', () => {
      expect(isQueryStyle('form')).toBe(true);
      expect(isQueryStyle('spaceDelimited')).toBe(true);
      expect(isQueryStyle('pipeDelimited')).toBe(true);
      expect(isQueryStyle('deepObject')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isQueryStyle('invalid')).toBe(false);
      expect(isQueryStyle(undefined)).toBe(false);
    });
  });
});
