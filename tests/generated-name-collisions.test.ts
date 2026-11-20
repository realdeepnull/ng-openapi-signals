import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';
import {duplicateRootExports, exportedNames} from './helpers/barrel-exports.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-generated-name-collisions');
const OUTPUT_DIR_UNIMPORTED = join(process.cwd(), 'tests', '.tmp-name-collisions-unimported');
const FIXTURE = 'tests/fixtures/generated-name-collisions.yml';
const FIXTURE_UNIMPORTED = 'tests/fixtures/generated-name-collisions-unimported.yml';

/**
 * Two generated names are *derived* rather than taken from the spec, so a legal
 * schema name can collide with them:
 *
 * - `models/index.ts` is the barrel. A schema named `Index` used to map to that
 *   file name and be overwritten by the barrel, which then re-exported itself
 *   (`export * from './index';` → TS2305 at every consumer).
 * - `resources/*.api.ts` declares a class derived from the tag
 *   (`Users` → `UsersApi`). A schema of the same name is imported into that
 *   module, producing two module-scope bindings (TS2440/TS2395). More generally,
 *   the root `index.ts` re-exports `./models` and `./resources`, so *any* class
 *   name that equals *any* document model name is a duplicate export (TS2308) —
 *   whether or not the group imports that model.
 *
 * Both defects produced non-compiling output while generation, Prettier and the
 * CLI exited 0. `robustness.test.ts` compiles this fixture as a guard; the
 * assertions here pin the exact names so a regression is also readable.
 */
describe('schema names that collide with generated file and class names', () => {
  let modelsIndex: string;
  let indexModel: string;
  let usersResource: string;
  let indexesResource: string;
  let ordersResource: string;

  beforeAll(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({input: FIXTURE, output: OUTPUT_DIR, clean: true, groupBy: 'tag'});

    modelsIndex = await readFile(join(OUTPUT_DIR, 'models', 'index.ts'), 'utf8');
    indexModel = await readFile(join(OUTPUT_DIR, 'models', 'index2.ts'), 'utf8');
    usersResource = await readFile(join(OUTPUT_DIR, 'resources', 'users.api.ts'), 'utf8');
    indexesResource = await readFile(join(OUTPUT_DIR, 'resources', 'indexes.api.ts'), 'utf8');
    ordersResource = await readFile(join(OUTPUT_DIR, 'resources', 'orders.api.ts'), 'utf8');
  });

  afterAll(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('never lets a schema take the barrel file name', async () => {
    // The barrel exports models; a self-export is not a module to re-export.
    expect(modelsIndex).not.toContain("export * from './index';");
    expect(modelsIndex).toContain("export * from './index2';");
  });

  it('keeps the `Index` declaration under a deduplicated file name', async () => {
    expect(indexModel).toContain('export interface Index {');
    expect(indexModel).toContain('value?: string;');
  });

  it('binds `$ref`s to the `Index` declaration', async () => {
    expect(indexesResource).toMatch(
      /import type \{[^}]*\bIndex\b[^}]*\} from '\.\.\/models';/,
    );
    expect(indexesResource).toContain('request<Index>');
  });

  it('renames the derived class instead of the model', async () => {
    // The class name is generator-synthesized, so it is the one that moves:
    // tag `Users` derives `UsersApi`, which the model of that name already
    // holds, so the class takes the dedupe suffix and the model keeps its
    // spelling (`request<UsersApi>`).
    expect(usersResource).toContain('export class UsersApi2 {');
    expect(usersResource).toContain("import type {UsersApi, Wrapper} from '../models';");
    expect(usersResource).toContain('request<UsersApi>');
  });

  it('binds `UsersApi` exactly once at module scope', async () => {
    const bindings = [
      ...usersResource.matchAll(/^(?:import (?:type )?\{([^}]*)\}|export class (\w+))/gm),
    ].flatMap((match) =>
      match[1] !== undefined
        ? match[1]
            .split(',')
            .map((name) => name.replace(/^\s*type\s+/, '').trim())
            .filter(Boolean)
        : [match[2]!],
    );

    // One binding named `UsersApi` (the imported model) and one named
    // `UsersApi2` (the class) — never two of the same name, which is the
    // TS2440/TS2395 this fix prevents.
    expect(bindings.filter((name) => name === 'UsersApi')).toHaveLength(1);
    expect(bindings.filter((name) => name === 'UsersApi2')).toHaveLength(1);
    expect(bindings.filter((name) => name.startsWith('UsersApi'))).toHaveLength(2);
  });

  it('renames a class that would collide with any document model at the root barrel', async () => {
    // The constraint is document-wide, not per-module: the generated root
    // `index.ts` re-exports both `./models` and `./resources`, so a model named
    // `OrdersApi` anywhere in the document makes a class of that name a
    // duplicate export (TS2308, "Module './models' has already exported a member
    // named 'OrdersApi'") — even though the `Orders` group never imports it.
    expect(ordersResource).toContain('export class OrdersApi2 {');
    expect(ordersResource).not.toContain('export class OrdersApi {');
    expect(ordersResource).toContain('request<Wrapper>');

    // The schema is imported by another group's module (`Indexes`); there the
    // class is `IndexesApi`, so it keeps its name and imports the model verbatim.
    expect(indexesResource).toContain("import type {Index, OrdersApi} from '../models';");
    expect(indexesResource).toContain('request<OrdersApi>');
    expect(indexesResource).toContain('export class IndexesApi {');
  });

  it('does not rename models that merely coexist with a renamed class', async () => {
    // The `Users` group's class *is* suffixed (`UsersApi2`) in this fixture, so
    // the value of this assertion is the model side: `Wrapper` collides with
    // nothing and keeps its spelling in the resource signature. A class rename
    // must not spill over into the models it references.
    expect(usersResource).toContain('request<Wrapper>');
  });

  it('never emits a class name that the root barrel would export twice', async () => {
    // The root `index.ts` re-exports `./models` and `./resources`. A name that
    // appears in both barrels is TS2308 ("Module './models' has already exported
    // a member named 'X'"), so the two exported name sets must be disjoint. The
    // `Orders`/`UsersApi`/`OrdersApi` schemas are not imported by every group, so
    // this is exactly the document-wide case a per-module rule would miss.
    const rootIndex = await readFile(join(OUTPUT_DIR, 'index.ts'), 'utf8');
    // The `resources` barrel exports nothing but the generated service classes.
    const classNames = await exportedNames(join(OUTPUT_DIR, 'resources'));
    const modelNames = await exportedNames(join(OUTPUT_DIR, 'models'));

    expect(rootIndex).toContain("export * from './models';");
    expect(rootIndex).toContain("export * from './resources';");
    expect(classNames).toEqual(expect.arrayContaining(['OrdersApi2', 'UsersApi2', 'IndexesApi']));
    expect(modelNames).toEqual(
      expect.arrayContaining(['OrdersApi', 'UsersApi', 'Wrapper', 'Index']),
    );
    expect(classNames.filter((name) => modelNames.includes(name))).toEqual([]);

    // The barrel-level rule, checked over the whole package entry point rather
    // than just the model/resource pair.
    expect(await duplicateRootExports(OUTPUT_DIR)).toEqual([]);
  });
});

/**
 * The same rule, for a model that the colliding group never imports.
 *
 * `Users` derives `UsersApi` and the document declares a schema of that name,
 * but the `Users` operations only reference `User` — the `UsersApi` schema is
 * reachable only from the `Reports` group. Since the root `index.ts` re-exports
 * both barrels, `export class UsersApi` would be TS2308 at the root even though
 * the `users.api.ts` module never binds the model. The class must therefore be
 * `UsersApi2`; `ReportsApi` is unrelated and keeps its name.
 */
describe('document-wide class-name dedupe for unimported models', () => {
  let usersResource: string;
  let reportsResource: string;
  let rootIndex: string;

  beforeAll(async () => {
    await rm(OUTPUT_DIR_UNIMPORTED, {recursive: true, force: true});
    await generate({
      input: FIXTURE_UNIMPORTED,
      output: OUTPUT_DIR_UNIMPORTED,
      clean: true,
      groupBy: 'tag',
    });

    usersResource = await readFile(
      join(OUTPUT_DIR_UNIMPORTED, 'resources', 'users.api.ts'),
      'utf8',
    );
    reportsResource = await readFile(
      join(OUTPUT_DIR_UNIMPORTED, 'resources', 'reports.api.ts'),
      'utf8',
    );
    rootIndex = await readFile(join(OUTPUT_DIR_UNIMPORTED, 'index.ts'), 'utf8');
  });

  afterAll(async () => {
    await rm(OUTPUT_DIR_UNIMPORTED, {recursive: true, force: true});
  });

  it('renames the class although its group never imports the colliding model', async () => {
    expect(usersResource).toContain('export class UsersApi2 {');
    // `UsersApi2` itself contains `UsersApi`, so the negative assertion needs a
    // digit boundary rather than a plain substring test.
    expect(usersResource).not.toMatch(/\bUsersApi(?!\d)\b/);
    // The unimported model must not be pulled into the module just because the
    // class was renamed away from it.
    expect(usersResource).toContain("import type {User} from '../models';");
  });

  it('leaves unrelated classes untouched', async () => {
    expect(reportsResource).toContain('export class ReportsApi {');
    expect(reportsResource).toContain("import type {UsersApi} from '../models';");
    expect(reportsResource).toContain('request<UsersApi>');
  });

  it('exports no name twice from the root barrel', async () => {
    const classNames = await exportedNames(join(OUTPUT_DIR_UNIMPORTED, 'resources'));
    const modelNames = await exportedNames(join(OUTPUT_DIR_UNIMPORTED, 'models'));

    expect(rootIndex).toContain("export * from './models';");
    expect(rootIndex).toContain("export * from './resources';");
    expect(classNames.sort()).toEqual(['ReportsApi', 'UsersApi2']);
    expect(modelNames.sort()).toEqual(['User', 'UsersApi']);
    expect(await duplicateRootExports(OUTPUT_DIR_UNIMPORTED)).toEqual([]);
  });
});
