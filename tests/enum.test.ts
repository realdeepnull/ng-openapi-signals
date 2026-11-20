import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-enum');
const FIXTURE = 'tests/fixtures/enum.yml';

describe('enum generation', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({input: FIXTURE, output: OUTPUT_DIR, clean: true, groupBy: 'tag'});
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('generates a named union type for string enums', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'user-status.ts'), 'utf8');
    expect(content).toContain('export type UserStatus =');
    expect(content).toContain("'active'");
    expect(content).toContain("'invited'");
    expect(content).toContain("'disabled'");
  });

  it('generates a named union type for integer enums', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'status-code.ts'), 'utf8');
    expect(content).toContain('export type StatusCode =');
    expect(content).toContain('100');
    expect(content).toContain('200');
    expect(content).toContain('300');
  });

  it('re-exports enum types from models/index.ts', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'index.ts'), 'utf8');
    expect(content).toContain("export * from './user-status';");
    expect(content).toContain("export * from './status-code';");
  });

  it('references enum types by name in the interface', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'status-response.ts'), 'utf8');
    expect(content).toContain('status: UserStatus;');
    expect(content).toContain('code: StatusCode;');
    // Enums are emitted as `type` aliases, so the import must be type-only and
    // point at the defining file rather than the barrel. Formatting follows the
    // project's own Prettier config, hence the compact braces.
    expect(content).toContain("import type {StatusCode} from './status-code';");
    expect(content).toContain("import type {UserStatus} from './user-status';");
  });

  it('wraps inline enum arrays in parentheses so [] binds to the whole union', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'status-response.ts'), 'utf8');
    // Must be `('A' | 'B' | ...)[]`, NOT `'A' | 'B' | ... | 'XY_Z'[]`.
    // The generator emits a multiline parenthesized union, so verify structurally.
    expect(content).toContain("'A_BC'");
    expect(content).toContain("'XY_Z'");
    // The opening paren must appear before the first enum value and the [] after the last.
    expect(content).toMatch(/\([\s\S]*'A_BC'[\s\S]*'XY_Z'[\s\S]*\)\s*\[\]/);
    expect(content).not.toContain("'XY_Z'[]");
  });
});
