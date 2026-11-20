import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-named-records');
const FIXTURE = 'tests/fixtures/named-records.yml';

describe('named schemas with additionalProperties', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({input: FIXTURE, output: OUTPUT_DIR, clean: true, groupBy: 'tag'});
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('generates Record<string, User> type alias for $ref additionalProperties', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'users-map.ts'), 'utf8');
    expect(content).toContain('export type UsersMap = Record<string, User>;');
  });

  it('imports User in users-map.ts', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'users-map.ts'), 'utf8');
    expect(content).toContain("import type {User} from './user';");
  });

  it('generates Record<string, unknown> type alias for additionalProperties: true', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'settings-map.ts'), 'utf8');
    expect(content).toContain('export type SettingsMap = Record<string, unknown>;');
  });

  it('does not generate an empty interface for UsersMap', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'users-map.ts'), 'utf8');
    expect(content).not.toContain('interface UsersMap');
  });

  it('re-exports named record models from index.ts', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'index.ts'), 'utf8');
    expect(content).toContain("export * from './users-map';");
    expect(content).toContain("export * from './settings-map';");
  });
});
