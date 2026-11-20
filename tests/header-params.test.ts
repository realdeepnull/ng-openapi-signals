import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const FIXTURE = 'tests/fixtures/header-params.yml';
const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-header-params');

describe('header parameter generation', () => {
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
    return readFile(join(OUTPUT_DIR, 'resources', 'header.api.ts'), 'utf8');
  }

  it('includes header params in the params type with quoted names', async () => {
    const content = await readApiFile();
    expect(content).toContain("'X-Request-Id'");
    expect(content).toContain("'X-Client-Version'");
  });

  it('generates headers object in the request', async () => {
    const content = await readApiFile();
    expect(content).toContain('headers: {');
    expect(content).toContain("'X-Request-Id': params['X-Request-Id']");
  });

  it('uses bracket notation for header param access', async () => {
    const content = await readApiFile();
    expect(content).toContain("params['X-Request-Id']");
    expect(content).toContain("params['X-Client-Version']");
  });

  it('includes header params in resource params factory', async () => {
    const content = await readApiFile();
    // The GET method should have header params in the params factory
    expect(content).toContain("readSignalOrValue(params['X-Request-Id'])");
  });

  it('includes header params in mutation method signatures', async () => {
    const content = await readApiFile();
    // deleteUserWithHeader should have params argument
    expect(content).toContain('deleteUserWithHeader(');
    expect(content).toMatch(/deleteUserWithHeader\([\s\S]*params:/);
  });

  it('unwraps header params into resolved locals in mutation methods', async () => {
    const content = await readApiFile();
    // Mutation methods receive MaybeSignal<T>. Each value is read once into a
    // local before the request object, and the headers object uses that local:
    // `'X-Request-Id': params['X-Request-Id']` would assign a signal and send
    // `[Signal: …]` instead of its value.
    expect(content).toContain(
      "const resolved_xRequestId = readSignalOrValue(params['X-Request-Id']);",
    );
    expect(content).toContain("'X-Request-Id': resolved_xRequestId");
  });

  it('does not double-unwrap header params in GET resource methods', async () => {
    const content = await readApiFile();
    // GET resource methods already resolve signals in the paramsFactory, so the
    // headers expression must pass the already-resolved plain value directly.
    expect(content).toContain("'X-Request-Id': params['X-Request-Id']");
  });

  it('types mutation header params as MaybeSignal', async () => {
    const content = await readApiFile();
    // The mutation params type must accept signals for header values.
    expect(content).toMatch(/'X-Request-Id'\?:\s*MaybeSignal<string>/);
  });

  it('emits unique local names when params normalize to the same identifier', async () => {
    const content = await readApiFile();
    // `user-id`, `userId` and `user_id` all normalize to `userId`. Deriving the
    // local name from the param name alone emitted three identical `const`
    // declarations (TS2451 "Cannot redeclare block-scoped variable").
    // Match the declaration only: Prettier may wrap a long
    // `readSignalOrValue(params['…'])` call onto the next line.
    const locals = [...content.matchAll(/const (resolved\w*) =/g)].map((match) => match[1]);

    const colliding = locals.filter((name) => name?.startsWith('resolved_userId'));
    expect(colliding).toHaveLength(3);
    expect(new Set(colliding).size).toBe(3);

    // The mutation method resolves the same three params before its request.
    const mutation = content.slice(content.indexOf('deleteUserWithHeader('));
    expect(mutation).toContain('readSignalOrValue');
  });

  it('maps each colliding local to its own property', async () => {
    const content = await readApiFile();
    // Each GET property must read the local derived from its own name, not a
    // renamed one that happens to be in scope.
    expect(content).toMatch(/'user-id':\s*resolved_userId,/);
    expect(content).toMatch(/userId:\s*resolved_userId2,/);
    expect(content).toMatch(/user_id:\s*resolved_userId3,/);
  });

  it('keeps verbatim keys for names that do not collide across locations', async () => {
    const content = await readApiFile();

    // `user-id` (path), `userId` (query) and `user_id` (header) are three
    // *different* names — only their normalized identifiers collide. Their
    // public keys must stay verbatim, with no location suffix.
    expect(content).toMatch(/params: \{\s*'user-id': MaybeSignal<string>;/);
    expect(content).toMatch(/userId\?: MaybeSignal<string>;/);
    expect(content).toMatch(/user_id: MaybeSignal<string>;/);
    expect(content).not.toContain('user-idPath');
    expect(content).not.toContain('userIdQuery');
    expect(content).not.toContain('user_idHeader');

    // A single `id` path param keeps its plain key as well.
    expect(content).toMatch(/deleteUserWithHeader\(\s*params: \{\s*id: MaybeSignal<string>;/);
  });
});

describe('path-item parameters overridden by the operation', () => {
  const OVERRIDE_FIXTURE = 'tests/fixtures/path-item-override.yml';
  const OVERRIDE_OUTPUT = join(process.cwd(), 'tests', '.tmp-path-item-override');

  beforeEach(async () => {
    await rm(OVERRIDE_OUTPUT, {recursive: true, force: true});
    await generate({
      input: OVERRIDE_FIXTURE,
      output: OVERRIDE_OUTPUT,
      clean: true,
      groupBy: 'tag',
    });
  });

  afterEach(async () => {
    await rm(OVERRIDE_OUTPUT, {recursive: true, force: true});
  });

  async function readOverrideApiFile(): Promise<string> {
    return readFile(join(OVERRIDE_OUTPUT, 'resources', 'override.api.ts'), 'utf8');
  }

  it('merges an overridden path-item param into a single key', async () => {
    const content = await readOverrideApiFile();
    const params = content.slice(
      content.indexOf('overrideParam('),
      content.indexOf('): Promise<void>'),
    );

    // `id` occurs once after the merge, so `assignParamKeys()` sees no
    // cross-location collision: no `id2`, `idPath` or `idQuery` suffix.
    expect(params.match(/\bid\??:/g)).toHaveLength(1);
    expect(params).not.toContain('id2');
    expect(params).not.toContain('idPath');
    expect(params).not.toContain('idQuery');
  });

  it('lets the operation-level definition win without renaming the key', async () => {
    const content = await readOverrideApiFile();

    // The operation declares `id` as required `integer`, the path item as an
    // optional `string`: the emitted key must be non-optional and typed with
    // the operation's schema.
    expect(content).toMatch(/params: \{\s*id: MaybeSignal<number>;/);
    expect(content).toMatch(/page: MaybeSignal<number>;/);
    // Neither key carries the path-item definition (`string`, optional).
    expect(content).not.toMatch(/id\?: MaybeSignal<string>/);
    expect(content).not.toMatch(/page\?: MaybeSignal<string>/);

    // Both overrides are read once and used by the request.
    expect(content).toContain('const resolved_id = readSignalOrValue(params.id);');
    expect(content).toContain('const resolved_page = readSignalOrValue(params.page);');
    expect(content).toContain(
      'path: `/override/${encodeURIComponent(String(resolved_id))}`',
    );
    expect(content).toMatch(/query:\s*\{\s*page:\s*resolved_page,?\s*\}/);
  });

  it('keeps a path-item param that the operation does not override', async () => {
    const content = await readOverrideApiFile();

    // `X-Trace` stays on the operation, at its path-item position, with its
    // verbatim (quoted) key and header wire name.
    expect(content).toMatch(/'X-Trace'\?: MaybeSignal<string>;/);
    expect(content).toContain("const resolved_xTrace = readSignalOrValue(params['X-Trace']);");
    expect(content).toMatch(/headers:\s*\{\s*'X-Trace':\s*resolved_xTrace,?\s*\}/);
  });

  it('emits no duplicate property keys', async () => {
    const content = await readOverrideApiFile();

    // TS1117 came from `query: {id: params.idQuery, id: params.idQuery2}`:
    // every object literal must declare each key at most once.
    for (const block of content.matchAll(/\{([^{}]*)\}/g)) {
      const keys = [...block[1]!.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*|'[^']*')\s*\??:/g)].map(
        (match) => match[1]!.replace(/^'|'$/g, ''),
      );

      expect(new Set(keys).size, `duplicate key in ${block[1]}`).toBe(keys.length);
    }
  });
});

describe('the same parameter name in different locations', () => {
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

  async function readCollideApiFile(): Promise<string> {
    return readFile(join(OUTPUT_DIR, 'resources', 'collide.api.ts'), 'utf8');
  }

  /**
   * Slices one method out of the generated class.
   *
   * Prettier separates members with a blank line; the body itself has no line
   * starting with exactly two spaces and an identifier after a blank line, so
   * that boundary ends the method.
   */
  function methodBody(content: string, signature: string): string {
    const start = content.indexOf(signature);

    expect(start).toBeGreaterThanOrEqual(0);

    const method = content.slice(start);
    const end = method.search(/\n\n {2}\w/);

    return end === -1 ? method : method.slice(0, end);
  }

  it('interpolates the path param, not the query param that shares its name', async () => {
    const content = await readCollideApiFile();
    const mutation = methodBody(content, 'deleteCollidingName(');

    // `/colliding-name/{id}` may only interpolate the `in: path` entry. A
    // name-keyed lookup let the query param win, rendering `resolved_id2`
    // (the query value) in the URL.
    expect(mutation).toContain(
      'path: `/colliding-name/${encodeURIComponent(String(resolved_id))}`',
    );
    // ...and the query object must use the query param's own local.
    expect(mutation).toMatch(/query:\s*\{\s*id:\s*resolved_id2,?\s*\}/);
  });

  it('keeps both locals used in the Promise mutation method', async () => {
    const content = await readCollideApiFile();
    const mutation = methodBody(content, 'deleteCollidingName(');

    // The path param's local renders the template, the query param's local
    // populates the query object — neither steals the other, and neither is
    // left unused. The public keys are location-suffixed because `id` occurs
    // in two locations; the *locals* stay name-derived (`resolved_id`,
    // `resolved_id2`).
    expect(mutation).toContain('const resolved_id = readSignalOrValue(params.idPath);');
    expect(mutation).toContain('const resolved_id2 = readSignalOrValue(params.idQuery);');
    expect(mutation).toContain(
      'path: `/colliding-name/${encodeURIComponent(String(resolved_id))}`',
    );
    expect(mutation).toMatch(/query:\s*\{\s*id:\s*resolved_id2,?\s*\}/);
  });

  it('references every emitted resolved_* local in the same method', async () => {
    const content = await readCollideApiFile();

    // Guards the TS6133 class of bug directly, for both the GET factory and
    // the Promise mutation method: a local that is declared but not used (or
    // used only by a *different* param's expression) fails here.
    for (const signature of ['getCollidingNameResource(', 'deleteCollidingName(']) {
      const method = methodBody(content, signature);
      const locals = [...method.matchAll(/const (resolved_\w*) = readSignalOrValue/g)].map(
        (match) => match[1]!,
      );

      expect(locals.length).toBeGreaterThan(0);

      for (const local of locals) {
        const references = method.split(new RegExp(`\\b${local}\\b`)).length - 1;
        // One occurrence is the declaration itself; at least one more is a use.
        expect(references).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('emits each param local once and references it in the resource factory', async () => {
    const content = await readCollideApiFile();
    const resource = methodBody(content, 'getCollidingNameResource(');

    // The factory reads both params into distinct locals (`resolved_id` for
    // the path param, `resolved_id2` for the query param) and both are
    // referenced by the returned object — neither is left unused.
    const locals = [...resource.matchAll(/const (resolved_\w*) = readSignalOrValue/g)].map(
      (match) => match[1]!,
    );

    expect(locals).toHaveLength(3);
    expect(new Set(locals).size).toBe(3);

    for (const local of locals) {
      expect(resource.split(new RegExp(`\\b${local}\\b`)).length - 1).toBeGreaterThanOrEqual(2);
    }

    // The resolved params object and the loader accesses use the
    // location-suffixed public key for the colliding name.
    expect(resource).toContain(
      'path: `/colliding-name/${encodeURIComponent(String(params.idPath))}`',
    );
    expect(resource).toMatch(/query:\s*\{\s*id:\s*params\.idQuery,?\s*\}/);
    expect(resource).toMatch(/'X-Id':\s*params\['X-Id'\],?/);
  });

  it('emits location-suffixed public keys only for the colliding name', async () => {
    const content = await readCollideApiFile();
    const resource = methodBody(content, 'getCollidingNameResource(');

    // Params type, resolved params object and loader annotation all agree.
    expect(resource).toMatch(/idPath:\s*MaybeSignal<string>/);
    expect(resource).toMatch(/idQuery\?:\s*MaybeSignal<string>/);
    expect(resource).toMatch(/idPath:\s*resolved_id,/);
    expect(resource).toMatch(/idQuery:\s*resolved_id2,/);

    // `X-Id` occurs once, so it keeps its verbatim (quoted) key everywhere.
    expect(resource).toMatch(/'X-Id'\?:\s*MaybeSignal<string>/);
    expect(resource).toMatch(/'X-Id'\?:\s*string \| undefined/);
    expect(resource).not.toContain('X-IdHeader');
    expect(resource).not.toContain('idHeader');
  });

  it('emits the disambiguated keys in the Promise mutation too', async () => {
    const content = await readCollideApiFile();
    const mutation = methodBody(content, 'deleteCollidingName(');

    expect(mutation).toMatch(/idPath:\s*MaybeSignal<string>/);
    expect(mutation).toMatch(/idQuery\?:\s*MaybeSignal<string>/);
    expect(mutation).toMatch(/'X-Id'\?:\s*MaybeSignal<string>/);
    expect(mutation).not.toContain('X-IdHeader');
  });

  it('suffixes path, query and header when the same name collides in all three', async () => {
    const content = await readCollideApiFile();
    const mutation = methodBody(content, 'putCollidingThree(');

    // `id` in path + query + header → all three get their location suffix.
    expect(mutation).toMatch(/idPath:\s*MaybeSignal<string>/);
    expect(mutation).toMatch(/idQuery\?:\s*MaybeSignal<string>/);
    expect(mutation).toMatch(/idHeader:\s*MaybeSignal<string>/);

    // Each key resolves to its own local, and each local is used exactly by
    // its own wire-level expression.
    expect(mutation).toContain('const resolved_id = readSignalOrValue(params.idPath);');
    expect(mutation).toContain('const resolved_id2 = readSignalOrValue(params.idQuery);');
    expect(mutation).toContain('const resolved_id3 = readSignalOrValue(params.idHeader);');
    expect(mutation).toContain(
      'path: `/colliding-three/${encodeURIComponent(String(resolved_id))}`',
    );
    expect(mutation).toMatch(/query:\s*\{\s*id:\s*resolved_id2,?\s*\}/);
    expect(mutation).toMatch(/headers:\s*\{\s*id:\s*resolved_id3,?\s*\}/);
  });

  it('does not let a generated suffix steal a literal parameter name', async () => {
    const content = await readCollideApiFile();
    const mutation = methodBody(content, 'postCollidingSuffix(');

    // `id` (path + query) suffixes to `idPath`/`idQuery`; a parameter literally
    // named `idPath` already occupies that key. The literal name wins and the
    // path param is deduplicated (`idPath2`) instead of emitting a duplicate
    // property (TS2300).
    expect(mutation).toMatch(/idPath2:\s*MaybeSignal<string>/);
    expect(mutation).toMatch(/idQuery\?:\s*MaybeSignal<string>/);
    expect(mutation).toMatch(/idPath\?:\s*MaybeSignal<string>/);

    expect(mutation).toContain('const resolved_id = readSignalOrValue(params.idPath2);');
    expect(mutation).toContain('const resolved_id2 = readSignalOrValue(params.idQuery);');
    expect(mutation).toContain('const resolved_idPath = readSignalOrValue(params.idPath);');
    expect(mutation).toContain(
      'path: `/colliding-suffix/${encodeURIComponent(String(resolved_id))}`',
    );
    expect(mutation).toMatch(
      /query:\s*\{\s*id:\s*resolved_id2,\s*idPath:\s*resolved_idPath,?\s*\}/,
    );
  });

  it('quotes a location-suffixed key that is not a valid identifier', async () => {
    const content = await readCollideApiFile();
    const resource = methodBody(content, 'getCollidingBracketResource(');

    // `user-id` occurs as path + query, so both keys are suffixed *and* still
    // not identifiers → quoted properties and bracket accesses.
    expect(resource).toMatch(/'user-idPath':\s*MaybeSignal<string>/);
    expect(resource).toMatch(/'user-idQuery'\?:\s*MaybeSignal<string>/);
    expect(resource).toContain("readSignalOrValue(params['user-idPath'])");
    expect(resource).toContain("readSignalOrValue(params['user-idQuery'])");
    expect(resource).toMatch(/'user-idPath':\s*resolved_userId,/);
    expect(resource).toMatch(/'user-idQuery':\s*resolved_userId2,/);
    expect(resource).toContain(
      "path: `/colliding-bracket/${encodeURIComponent(String(params['user-idPath']))}`",
    );
    // The wire-level query key is still the verbatim spec name.
    expect(resource).toMatch(/query:\s*\{\s*'user-id':\s*params\['user-idQuery'\],?\s*\}/);
  });

  it('keeps undeclared placeholders literal and resolves bracketed path names', async () => {
    const content = await readCollideApiFile();
    const resource = methodBody(content, 'getLiteralPlaceholderResource(');

    // `{missing}` has no `in: path` parameter: keep the literal placeholder
    // instead of emitting `params.missing` (which does not exist). `{user-id}`
    // is declared and must resolve through the model to a quoted access.
    expect(resource).toContain(
      "path: `/literal/{missing}/${encodeURIComponent(String(params['user-id']))}`",
    );
    expect(resource).not.toContain('params.missing');
  });
});

describe('signal mutation wrappers over colliding params', () => {
  const SIGNAL_OUTPUT = join(process.cwd(), 'tests', '.tmp-collide-signal-mutations');

  beforeEach(async () => {
    await rm(SIGNAL_OUTPUT, {recursive: true, force: true});
    await generate({
      input: FIXTURE,
      output: SIGNAL_OUTPUT,
      clean: true,
      groupBy: 'tag',
      runtime: {signalMutations: true},
    });
  });

  afterEach(async () => {
    await rm(SIGNAL_OUTPUT, {recursive: true, force: true});
  });

  it('reuses the disambiguated keys in the …Mutation() signature', async () => {
    const content = await readFile(join(SIGNAL_OUTPUT, 'resources', 'collide.api.ts'), 'utf8');
    const start = content.indexOf('deleteCollidingNameMutation(');

    expect(start).toBeGreaterThanOrEqual(0);

    const wrapper = content.slice(start, content.indexOf('): Mutation<', start));

    // The wrapper takes the same params type as the Promise method: one `id`
    // per location, never a duplicate key. Its body forwards `params`
    // unchanged (the Promise method performs the single read).
    expect(wrapper).toMatch(/idPath: MaybeSignal<string>/);
    expect(wrapper).toMatch(/idQuery\?: MaybeSignal<string>/);
    expect(wrapper).toMatch(/'X-Id'\?: MaybeSignal<string>/);
    expect(wrapper).not.toMatch(/\bid:\s*MaybeSignal/);

    expect(content).toMatch(
      /this\.deleteCollidingName\(\s*params,\s*mutationSignal,?\s*\)/,
    );
  });
});
