import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const FIXTURE = 'tests/fixtures/empty-object.yml';
const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-empty-object');

describe('bare type: object schemas (Object shadowing)', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: FIXTURE,
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
    });
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('emits a Record<string, unknown> type alias instead of an empty interface', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'object.ts'), 'utf8');
    expect(content).toContain('export type Object = Record<string, unknown>;');
  });

  it('does not emit `export interface Object {}`', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'object.ts'), 'utf8');
    expect(content).not.toContain('interface Object');
  });

  it('keeps the Object import reference from resources consistent', async () => {
    // The deepObject filter param references the Object schema by $ref —
    // the generated service must import the type alias from models and use
    // it as the param type (not the global Object type).
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'ping.api.ts'), 'utf8');
    expect(content).toContain("import type {Object} from '../models';");
    expect(content).toContain('filter?: MaybeSignal<Object>');
  });
});
