import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {checkFiles, checkPassed} from '../src/check.js';
import {generate} from '../src/generate.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-check');

const BASE_CONFIG = {
  input: 'examples/openapi.json',
  output: OUTPUT_DIR,
  clean: true,
  groupBy: 'tag' as const,
};

describe('checkFiles', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('reports all matched when output is up to date', async () => {
    await generate(BASE_CONFIG);

    const result = await checkFiles(BASE_CONFIG);

    expect(result.outdated).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.matched.length).toBeGreaterThan(0);
    expect(checkPassed(result)).toBe(true);
  });

  it('reports outdated when a file differs on disk', async () => {
    await generate(BASE_CONFIG);

    const filePath = join(OUTPUT_DIR, 'index.ts');

    await writeFile(filePath, '// changed content\n', 'utf8');

    const result = await checkFiles(BASE_CONFIG);

    expect(result.outdated).toContain('index.ts');
    expect(checkPassed(result)).toBe(false);
  });

  it('reports missing when a generated file is absent', async () => {
    await generate(BASE_CONFIG);

    const result = await checkFiles({
      ...BASE_CONFIG,
      output: OUTPUT_DIR + '-nonexistent',
    });

    expect(result.matched).toEqual([]);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(checkPassed(result)).toBe(false);
  });

  it('reports stale when a file on disk is no longer in the spec', async () => {
    await generate(BASE_CONFIG);

    const staleDir = join(OUTPUT_DIR, 'models');
    await mkdir(staleDir, {recursive: true});
    await writeFile(join(staleDir, 'stale-extra.ts'), 'export {};\n', 'utf8');

    const result = await checkFiles(BASE_CONFIG);

    expect(result.stale).toContain('models/stale-extra.ts');
    // Stale files do not fail the check by default …
    expect(checkPassed(result)).toBe(true);
    // … but a CI gate can opt in.
    expect(checkPassed(result, true)).toBe(false);
  });

  it('does not report CRLF line endings as outdated', async () => {
    await generate(BASE_CONFIG);

    const filePath = join(OUTPUT_DIR, 'providers.ts');
    const lfContent = await readFile(filePath, 'utf8');

    // Simulate a `core.autocrlf=true` Windows checkout.
    await writeFile(filePath, lfContent.replace(/\n/g, '\r\n'), 'utf8');

    const result = await checkFiles(BASE_CONFIG);

    expect(result.outdated).not.toContain('providers.ts');
    expect(result.outdatedEol).toContain('providers.ts');
    // Content is identical, so the check must pass.
    expect(checkPassed(result)).toBe(true);
  });

  it('still reports a real content diff as outdated next to CRLF', async () => {
    await generate(BASE_CONFIG);

    const filePath = join(OUTPUT_DIR, 'providers.ts');
    const content = await readFile(filePath, 'utf8');

    await writeFile(filePath, content.replace(/\n/g, '\r\n') + '// drift\n', 'utf8');

    const result = await checkFiles(BASE_CONFIG);

    expect(result.outdated).toContain('providers.ts');
    expect(result.outdatedEol).not.toContain('providers.ts');
    expect(checkPassed(result)).toBe(false);
  });

  it('returns empty result when output directory does not exist', async () => {
    const result = await checkFiles({
      ...BASE_CONFIG,
      output: OUTPUT_DIR + '-missing',
    });

    expect(result.matched).toEqual([]);
    expect(result.outdated).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('detects byte-level differences (whitespace drift)', async () => {
    await generate(BASE_CONFIG);

    const filePath = join(OUTPUT_DIR, 'providers.ts');
    const original = await readFile(filePath, 'utf8');

    await writeFile(filePath, original + '\n', 'utf8');

    const result = await checkFiles(BASE_CONFIG);

    expect(result.outdated).toContain('providers.ts');
  });
});
