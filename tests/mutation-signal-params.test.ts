import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate, formatFiles, generateFiles} from '../src/generate.js';

const FIXTURE = 'tests/fixtures/mutation-signal-params.yml';
const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-mutation-signal-params');

/**
 * Slices one method out of a generated service class. Prettier separates
 * members with a blank line, and the next member starts with exactly two
 * spaces of indentation.
 */
function methodBody(content: string, signature: string): string {
  const start = content.indexOf(signature);

  expect(start).toBeGreaterThanOrEqual(0);

  const method = content.slice(start);
  const end = method.search(/\n\n {2}\w/);

  return end === -1 ? method : method.slice(0, end);
}

describe('Promise mutation methods unwrap MaybeSignal params', () => {
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

  async function readApiFile(): Promise<string> {
    return readFile(join(OUTPUT_DIR, 'resources', 'actions.api.ts'), 'utf8');
  }

  it('reads path, query and header params through readSignalOrValue', async () => {
    const content = await readApiFile();

    expect(content).toContain('const resolved_id = readSignalOrValue(params.id);');
    expect(content).toContain('const resolved_verbose = readSignalOrValue(params.verbose);');
    expect(content).toContain("const resolved_xTrace = readSignalOrValue(params['X-Trace']);");
  });

  it('uses the resolved locals in the path template, query and headers', async () => {
    const content = await readApiFile();

    expect(content).toContain('path: `/users/${encodeURIComponent(String(resolved_id))}/action`');
    expect(content).toContain('verbose: resolved_verbose');
    expect(content).toContain("'X-Trace': resolved_xTrace");
  });

  it('never stringifies a raw MaybeSignal path param', async () => {
    const content = await readApiFile();

    // `String(params.id)` on a signal produced `/users/%5BSignal%3A…%5D`.
    expect(content).not.toMatch(/String\(params\.(id|verbose)\)/);
    expect(content).not.toContain('query: { verbose: params.verbose }');
  });

  it('keeps the resolved locals unique when param names collide', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'colliding.api.ts'), 'utf8');
    const locals = [...content.matchAll(/const (resolved_userId\w*) = /g)].map((match) => match[1]);

    expect(locals).toHaveLength(3);
    expect(new Set(locals).size).toBe(3);
    expect(content).toContain('${encodeURIComponent(String(resolved_userId))}');
    expect(content).toContain('userId: resolved_userId2');
    expect(content).toContain('user_id: resolved_userId3');
  });

  it('does not let a query param steal the path param local when names match', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'same-name.api.ts'), 'utf8');
    const method = methodBody(content, 'touchSameName(');

    // The path template must interpolate the *path* param's local; the query
    // object must use the query param's own local. A name-keyed lookup made
    // the query entry win and left `resolved_id` unused (TS6133). The public
    // keys are location-suffixed (`idPath` / `idQuery`) because `id` occurs in
    // two locations.
    expect(method).toContain('const resolved_id = readSignalOrValue(params.idPath);');
    expect(method).toContain('const resolved_id2 = readSignalOrValue(params.idQuery);');
    expect(method).toContain('path: `/same-name/${encodeURIComponent(String(resolved_id))}/touch`');
    expect(method).toMatch(/query:\s*\{\s*id:\s*resolved_id2,?\s*\}/);

    // Every local is referenced beyond its own declaration.
    const locals = [...method.matchAll(/const (resolved_\w*) = readSignalOrValue/g)].map(
      (match) => match[1]!,
    );
    expect(locals.length).toBeGreaterThan(0);

    for (const local of locals) {
      expect(method.split(new RegExp(`\\b${local}\\b`)).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not unwrap params twice in the signal mutation wrapper', async () => {
    const files = await formatFiles(
      await generateFiles({
        input: FIXTURE,
        output: OUTPUT_DIR,
        clean: true,
        groupBy: 'tag',
        runtime: {signalMutations: true},
      }),
    );
    const content = files['resources/actions.api.ts']!;
    const wrapper = content.slice(content.indexOf('doActionMutation('));

    // The wrapper forwards `params` as-is: the Promise method performs the one
    // and only read, so a signal is read exactly when `mutate()` runs.
    expect(wrapper).toMatch(/this\.doAction\(\s*mutationBody,\s*params,\s*mutationSignal,?\s*\)/);
    expect(wrapper).not.toContain('readSignalOrValue');
  });
});

describe('signal-utils import usage', () => {
  const OUTPUT = join(process.cwd(), 'tests', '.tmp-signal-imports');

  afterEach(async () => {
    await rm(OUTPUT, {recursive: true, force: true});
  });

  it('emits readSignalOrValue when a mutation resolves its params', async () => {
    const files = await formatFiles(
      await generateFiles({
        input: FIXTURE,
        output: OUTPUT,
        clean: true,
        groupBy: 'tag',
      }),
    );

    // `Colliding` has a mutation with path/query/header params and no GET, so
    // the import used to be emitted even though only the type was used.
    const content = files['resources/colliding.api.ts']!;

    expect(content).toContain('readSignalOrValue');
    expect(content).toContain('MaybeSignal');
    expect(content).toMatch(/readSignalOrValue\(params\[/);
  });

  it('uses the import it emits for a mutation without header params', async () => {
    const files = await formatFiles(
      await generateFiles({
        input: FIXTURE,
        output: OUTPUT,
        clean: true,
        groupBy: 'tag',
      }),
    );

    // `QueryOnly` has a single mutation with path + query params and no GET.
    // Previously the file imported `readSignalOrValue` but never called it.
    const content = files['resources/query-only.api.ts']!;

    expect(content).toContain(
      "import {readSignalOrValue, type MaybeSignal} from '../signal-utils';",
    );
    expect(content).toContain('const resolved_projectId = readSignalOrValue(params.projectId);');
    expect(content).toContain('const resolved_dryRun = readSignalOrValue(params.dryRun);');
  });

  it('does not import signal helpers for a body-only mutation', async () => {
    const files = await formatFiles(
      await generateFiles({
        input: 'tests/fixtures/mutation-body-only.yml',
        output: OUTPUT,
        clean: true,
        groupBy: 'tag',
      }),
    );

    expect(files['resources/things.api.ts']).not.toContain('signal-utils');
  });

  it('imports MaybeSignal type-only when no value is read', async () => {
    const files = await formatFiles(
      await generateFiles({
        input: 'tests/fixtures/mutation-import-only.yml',
        output: OUTPUT,
        clean: true,
        groupBy: 'tag',
      }),
    );

    // The declared path param has no placeholder in the path template, so no
    // value is read. Importing `readSignalOrValue` would fail `noUnusedLocals`,
    // and the whole `params` parameter is never read either — it is named
    // `_params` so `noUnusedParameters` stays quiet (robustness.test.ts
    // compiles this fixture).
    const content = files['resources/things.api.ts']!;

    expect(content).toContain("import type {MaybeSignal} from '../signal-utils';");
    expect(content).not.toContain('readSignalOrValue');
    expect(content).toContain('ghost?: MaybeSignal<string>');
    expect(content).toContain('_params: {');
    // `_params` *contains* `params`, so the negative assertion must exclude the
    // prefixed form explicitly: without the lookbehind this can never fail and
    // a revert to the unused `params` would pass green (TS6133 under
    // `noUnusedParameters`).
    expect(content).not.toMatch(/(?<!_)\bparams: \{/);
  });

  it('keeps the readSignalOrValue import and call in sync', async () => {
    const files = await formatFiles(
      await generateFiles({
        input: 'tests/fixtures/robustness.yml',
        output: OUTPUT,
        clean: true,
        groupBy: 'tag',
      }),
    );

    // Sanity check on the other direction: a file that calls
    // `readSignalOrValue` must still import it, and the import must be used.
    for (const [name, content] of Object.entries(files)) {
      if (!name.startsWith('resources/') || name.endsWith('index.ts')) {
        continue;
      }

      if (content.includes('readSignalOrValue')) {
        expect(content).toMatch(/import \{[^}]*readSignalOrValue/);
        expect(content).toMatch(/readSignalOrValue\(/);
      }
    }
  });
});
