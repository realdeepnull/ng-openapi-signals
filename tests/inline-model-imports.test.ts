import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-inline-model-imports');
const FIXTURE = 'tests/fixtures/inline-model-imports.yml';

/**
 * The import collector answers one question: *which identifiers in this type
 * expression are declared models?* `never`, `Record`, object-literal keys and
 * punctuation are only ever imported if the document really declares them.
 *
 * These cases exercise inline type expressions that are not hoisted, so they
 * reach the resource file exactly as `schemaToTsType()` rendered them.
 */
describe('model imports for inline type expressions', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({input: FIXTURE, output: OUTPUT_DIR, clean: true, groupBy: 'tag'});
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  async function readApiFile(): Promise<string> {
    return readFile(join(OUTPUT_DIR, 'resources', 'shapes.api.ts'), 'utf8');
  }

  it('never imports `never` for an empty enum or a closed empty object', async () => {
    const content = await readApiFile();

    // `enum: []` renders `never` and `additionalProperties: false` without
    // members renders `Record<string, never>`; both are emitted keywords.
    expect(content).toContain('MaybeSignal<never>');
    expect(content).toContain('request<Record<string, never>>');
    expect(content).not.toContain('import type {never');
    expect(content).not.toMatch(/import type \{[^}]*\bnever\b[^}]*\} from/);
  });

  it('renders an inline nullable object and keeps its $ref import', async () => {
    const content = await readApiFile();

    // The object literal's spaces are type syntax, not union separators. The
    // rendered type must appear verbatim and the referenced model must still
    // be imported (the token scan must not lose inner references).
    expect(content).toContain('request<');
    expect(content).toContain('| null>');
    expect(content).toMatch(/request<\{[^}]*user\?: User[^}]*\} \| null>/);
    expect(content).toContain("import type {Tag, User} from '../models';");
  });

  it('renders an inline nullable object parameter and keeps its $ref import', async () => {
    const content = await readApiFile();

    expect(content).toMatch(/filter\?: MaybeSignal<\{[^}]*tag\?: Tag[^}]*\} \| null>/);
    expect(content).toContain("import type {Tag, User} from '../models';");
  });

  it('does not emit type-operator fragments as imports', async () => {
    const content = await readApiFile();

    // The pre-token-scan collector split `{ user?: User } | null` on spaces and
    // imported the resulting fragments. Prettier then threw on
    // `import type {{, user?:, } }`.
    for (const fragment of ['import type {{', 'user?:,', '}, ', 'id?:']) {
      expect(content).not.toContain(fragment);
    }
  });

  it('does not treat object-literal keys or enum values as model references', async () => {
    // `Shadow` is a group of its own: its only occurrences of `User`/`Tag` are a
    // property key and an enum member. Importing them would be an unused import
    // (TS6133 under `noUnusedLocals` in the compile guard).
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'shadow.api.ts'), 'utf8');

    expect(content).toMatch(/shape\?: MaybeSignal<\{[^}]*User\?: string[^}]*\} \| null>/);
    expect(content).toContain("state?: MaybeSignal<'User' | 'active'>");
    expect(content).not.toContain("from '../models'");
  });

  it('still imports models referenced next to object-literal keys', async () => {
    const content = await readApiFile();

    // The `Shapes` group references both models through real `$ref`s; the
    // object-literal key suppression must not lose those.
    expect(content).toContain("import type {Tag, User} from '../models';");
  });
});
