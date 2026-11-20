import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-records');
const FIXTURE = 'tests/fixtures/records.yml';

describe('record / additionalProperties', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({input: FIXTURE, output: OUTPUT_DIR, clean: true, groupBy: 'tag'});
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('generates Record<string, string> for typed additionalProperties', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'config.ts'), 'utf8');
    expect(content).toContain('metadata: Record<string, string>;');
  });

  it('generates Record<string, Tag> for $ref additionalProperties', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'config.ts'), 'utf8');
    expect(content).toContain('tags: Record<string, Tag>;');
  });

  it('generates Record<string, unknown> for additionalProperties: true', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'config.ts'), 'utf8');
    expect(content).toContain('settings: Record<string, unknown>;');
  });

  it('generates Record<string, number> for integer additionalProperties', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'config.ts'), 'utf8');
    expect(content).toContain('counts?: Record<string, number>;');
  });

  it('imports Tag when used in a record', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'config.ts'), 'utf8');
    expect(content).toContain('import type {Tag} from');
  });
});
