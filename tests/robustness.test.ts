import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import ts from 'typescript';
import {formatFiles, generateFiles, generate} from '../src/generate.js';
import {checkFiles} from '../src/check.js';
import {extractOperations} from '../src/codegen/generate-api.js';
import {schemaToTsType} from '../src/codegen/schema-to-ts.js';
import {loadOpenApi} from '../src/openapi.js';
import {hoistInlineSchemas} from '../src/codegen/inline-schemas.js';
import type {GeneratorConfig} from '../src/codegen/types.js';

const FIXTURE = 'tests/fixtures/robustness.yml';
const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-robustness');

const BASE_CONFIG: GeneratorConfig = {
  input: FIXTURE,
  output: OUTPUT_DIR,
  clean: true,
  groupBy: 'tag',
};

/**
 * ECMAScript keywords that cannot be an interface/type-alias name.
 *
 * `RESERVED_TYPE_NAMES` is not exported, so the test spells the list out:
 * asserting against the implementation's own set would pass even if the set
 * lost an entry.
 */
const ECMAScript_KEYWORDS = [
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
];

describe('identifier sanitizing', () => {
  it('escapes parameter names that are not valid identifiers', async () => {
    const files = await formatFiles(await generateFiles(BASE_CONFIG));
    const api = files['resources/probe.api.ts']!;

    // `user-id` and `filter[name]` must be quoted properties and bracket accesses.
    expect(api).toContain("'user-id'");
    expect(api).toContain("['user-id']");
    expect(api).toContain("'filter[name]'");
    expect(api).toContain("['filter[name]']");
  });

  it('preserves valid operationIds verbatim', async () => {
    // `operationId` is public API surface: a valid identifier must not be
    // renamed (`UsersController_rangeUsers` is legal TypeScript).
    const files = await formatFiles(
      await generateFiles({...BASE_CONFIG, input: 'tests/fixtures/duplicate-operation-ids.yml'}),
    );

    expect(files['resources/duplicates.api.ts']).toContain('getUserResource(');
  });

  it('sanitizes operationIds that are not valid identifiers', async () => {
    const files = await formatFiles(await generateFiles(BASE_CONFIG));
    const api = files['resources/probe.api.ts']!;

    // `get-user` → `getUser`.
    expect(api).toContain('getUserResource(');
    expect(api).not.toContain('get-userResource(');
  });

  it('sanitizes schema names that start with a digit', async () => {
    const files = await formatFiles(await generateFiles(BASE_CONFIG));
    const modelFiles = Object.entries(files).filter(([name]) => name.startsWith('models/'));

    // `200Response` is not a valid identifier; the declaration must be renamed
    // while the model stays reachable through the barrel file.
    const sanitized = modelFiles.find(([, content]) =>
      content.includes('export interface _200Response'),
    );

    expect(sanitized).toBeDefined();
    expect(files['models/index.ts']).toContain(`'./${sanitized![0].replace('models/', '').replace('.ts', '')}'`);
  });

  it('quotes interface property names that are not valid identifiers', async () => {
    const files = await formatFiles(await generateFiles(BASE_CONFIG));

    expect(files['models/user.ts']).toContain("'user-name'?: string;");
  });

  it('renames schema names that are reserved words', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/reserved-schema-names.yml',
      }),
    );

    const modelFiles = Object.entries(files).filter(([name]) => name.startsWith('models/'));

    // Reserved words cannot name a declaration, so they are PascalCased.
    expect(modelFiles.some(([, c]) => c.includes('export interface Default {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export interface Class {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export type Enum ='))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export type As ='))).toBe(true);

    // Strict-mode future reserved words (`implements`, `interface`, `let`,
    // `package`, `private`, `protected`, `public`, `static`) and `type` are
    // renamed the same way. Left verbatim, `tsc` fails with TS1214/TS1213.
    expect(modelFiles.some(([, c]) => c.includes('export interface Interface {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export interface Implements {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export interface Package {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export interface Private {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export interface Protected {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export interface Public {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export interface Static {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export interface Let {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export type Type ='))).toBe(true);

    // Primitive type keywords are legal OpenAPI schema keys but illegal
    // declaration names (TS2427/TS2457).
    expect(modelFiles.some(([, c]) => c.includes('export interface String {'))).toBe(true);
    expect(modelFiles.some(([, c]) => c.includes('export type Number = number;'))).toBe(true);

    // The original reserved word must never appear as a declaration name —
    // Prettier would throw and the output would not compile.
    for (const [, content] of modelFiles) {
      expect(content).not.toMatch(
        /^export (interface|type) (default|class|enum|as|new|implements|interface|package|private|protected|public|static|let|type) /m,
      );
    }
  });

  it('keeps a legal contextual keyword as a declaration name', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/reserved-schema-names.yml',
      }),
    );

    // `export interface namespace {}` compiles, and renaming it would change
    // the generated API. Only illegal names may be renamed.
    expect(files['models/namespace.ts']).toContain('export interface namespace {');
  });

  it('emits every declaration with a name that is legal TypeScript', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/reserved-schema-names.yml',
      }),
    );

    // A declaration name is legal when it parses and is not rejected by the
    // grammar checks TypeScript applies to interface/type-alias names.
    // `ts.createSourceFile` alone does not run those checks, so parse the
    // declarations explicitly: anything else regressed to `interface private`.
    const illegal = new Set([
      ...ECMAScript_KEYWORDS,
      'implements',
      'interface',
      'let',
      'package',
      'private',
      'protected',
      'public',
      'static',
      'yield',
      'await',
      'any',
      'bigint',
      'boolean',
      'never',
      'number',
      'object',
      'string',
      'symbol',
      'undefined',
      'unknown',
      'as',
      'type',
    ]);

    for (const [name, content] of Object.entries(files)) {
      if (!name.startsWith('models/')) {
        continue;
      }

      for (const match of content.matchAll(/^export (?:interface|type) ([\w$]+)/gm)) {
        expect(illegal.has(match[1]!)).toBe(false);
      }
    }
  });

  it('resolves $refs to renamed reserved-word schemas', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/reserved-schema-names.yml',
      }),
    );

    // The response `$ref` and the nested property reference must both point at
    // the renamed declaration, not at a name that no longer exists.
    expect(files['resources/default.api.ts']).toContain('request<Default>');
    expect(files['models/new.ts']).toContain('ref?: Default;');

    // Same for a mutation body/response `$ref` and its path param local.
    expect(files['resources/items.api.ts']).toContain('body: Interface');
    expect(files['resources/items.api.ts']).toContain('request<Private>');

    // And for a renamed primitive-keyword schema used as a param and response.
    expect(files['resources/items.api.ts']).toContain('filter?: MaybeSignal<String>');
    expect(files['resources/items.api.ts']).toContain('request<Number>');
  });

  it('keeps reserved words usable as property and member names', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/reserved-schema-names.yml',
      }),
    );

    const api = files['resources/default.api.ts']!;

    // `default` as a *parameter* is legal TypeScript and must not be renamed.
    expect(api).toContain('default?: MaybeSignal<string>');
    expect(api).toContain('params.default');
  });

  it('resolves a $ref whose sanitized name collides with a literal key', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/schema-name-collision.yml',
      }),
    );

    // `200Response` sanitizes to `_200Response`, which is already taken by a
    // literal key → declarations are `_200Response` / `_200Response2`.
    expect(files['models/200response.ts']).toContain('export interface _200Response {');
    expect(files['models/200response2.ts']).toContain('export interface _200Response2 {');

    // The reference must bind to the *renamed* declaration. Re-deriving the
    // name from the pointer would silently select `_200Response` (wrong type).
    expect(files['resources/default.api.ts']).toContain('request<_200Response2>');
  });
});

describe('$ref resolution in operations', () => {
  it('keeps params, body and response type of a fully-$ref operation', async () => {
    const api = (await loadOpenApi(FIXTURE)) as unknown as Parameters<
      typeof hoistInlineSchemas
    >[0];

    hoistInlineSchemas(api);

    const operations = extractOperations(api);
    const get = operations.find((op) => op.operationId === 'getUser')!;
    const post = operations.find((op) => op.operationId === 'createUser')!;

    expect(get.pathParams.map((param) => param.name)).toEqual(['user-id']);
    expect(get.queryParams.map((param) => param.name)).toEqual(['page', 'filter[name]']);
    expect(get.responseType).toBe('User');

    expect(post.requestBody?.type).toContain('name');
    expect(post.responseType).toBe('User');
  });
});

describe('invalid type shapes', () => {
  it('never emits an empty type for an empty composition', () => {
    expect(schemaToTsType({oneOf: [{}]})).toBe('unknown');
    expect(schemaToTsType({allOf: [{}, {}]})).toBe('unknown');
    expect(schemaToTsType({oneOf: []})).toBe('unknown');
  });

  it('never emits an empty union for an empty enum', () => {
    expect(schemaToTsType({type: 'string', enum: []})).toBe('never');
  });

  it('decodes JSON Pointer escapes in $ref', () => {
    // `~1` is a literal `/` in a JSON Pointer; the resulting name must still be
    // a valid TypeScript identifier.
    expect(schemaToTsType({$ref: '#/components/schemas/User~1Profile'})).toBe('UserProfile');
  });

  it('keeps declared properties alongside additionalProperties', () => {
    const type = schemaToTsType({
      type: 'object',
      properties: {id: {type: 'string'}},
      additionalProperties: {type: 'number'},
    });

    expect(type).toContain('id?: string');
    expect(type).toContain('Record<string, number>');
  });

  it('keeps declared properties for additionalProperties: true', () => {
    const type = schemaToTsType({
      type: 'object',
      properties: {id: {type: 'string'}},
      additionalProperties: true,
    });

    expect(type).toBe('{ id?: string } & Record<string, unknown>');
  });

  it('closes the object for additionalProperties: false', () => {
    const type = schemaToTsType({
      type: 'object',
      properties: {id: {type: 'string'}},
      additionalProperties: false,
    });

    expect(type).toBe('{ id?: string }');
  });

  it('emits declared properties and the index signature in the model file', async () => {
    const files = await formatFiles(await generateFiles(BASE_CONFIG));

    // `MapWithProps` combines `properties` and `additionalProperties`; an
    // interface would silently drop the index signature. Match the two halves
    // separately so the assertion does not depend on Prettier's brace spacing.
    const model = files['models/map-with-props.ts']!;

    expect(model).toContain('export type MapWithProps =');
    expect(model).toContain('id?: string');
    expect(model).toContain('Record<string, number>');
    expect(model).not.toContain('export interface MapWithProps');
  });

  it('emits a closed object for additionalProperties: false', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/additional-properties.yml',
      }),
    );

    expect(files['models/closed-with-props.ts']).toContain(
      'export type ClosedWithProps = {id: string};',
    );
    expect(files['models/closed-with-props.ts']).not.toContain('Record<');
  });

  it('emits Record<string, never> for a closed object without properties', async () => {
    // `additionalProperties: false` with no declared member is an *empty,
    // closed* object. `{}` would accept anything and `Record<string, unknown>`
    // would re-open it; only `Record<string, never>` rejects every key.
    expect(schemaToTsType({type: 'object', additionalProperties: false})).toBe(
      'Record<string, never>',
    );

    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/additional-properties.yml',
      }),
    );

    expect(files['models/closed-empty.ts']).toContain(
      'export type ClosedEmpty = Record<string, never>;',
    );
  });

  it('emits declared properties intersected with Record<string, unknown>', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/additional-properties.yml',
      }),
    );

    expect(files['models/open-with-props.ts']).toContain(
      'export type OpenWithProps = {id?: string} & Record<string, unknown>;',
    );
  });

  it('imports referenced models used next to additionalProperties', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/additional-properties.yml',
      }),
    );

    // The alias is `{ owner?: User } & Record<string, Tag>`; both types must be
    // imported even though the rendered alias is an intersection of an object
    // literal and a generic. `collectModelReferences()` scans this shape
    // correctly: it strips object-member names (`owner:`) and quoted regions,
    // then keeps only tokens present in the model-name set, so `Record` (a
    // global) is skipped while `User` and `Tag` are imported.
    const model = files['models/mixed-with-refs.ts']!;

    expect(model).toContain("import type {Tag} from './tag';");
    expect(model).toContain("import type {User} from './user';");
    expect(model).toContain('{owner: User} & Record<string, Tag>');
  });

  it('treats object-like type spellings like `type: object`', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/additional-properties.yml',
      }),
    );

    // OpenAPI 3.1 spells nullability as a type array; without an explicit
    // `type` the keywords alone still describe an object.
    expect(files['models/nullable-with-props.ts']).toContain(
      'export type NullableWithProps = ({id?: string} & Record<string, number>) | null;',
    );
    expect(files['models/untyped-with-props.ts']).toContain(
      'export type UntypedWithProps = {id?: string} & Record<string, number>;',
    );
  });

  it('keeps pure maps and bare objects as plain aliases', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/additional-properties.yml',
      }),
    );

    expect(files['models/pure-map.ts']).toContain('export type PureMap = Record<string, number>;');
    expect(files['models/bare-object.ts']).toContain(
      'export type BareObject = Record<string, unknown>;',
    );
    expect(files['models/plain-interface.ts']).toContain('export interface PlainInterface {');
  });

  it('produces valid, parseable generated files', async () => {
    // `formatFiles()` runs Prettier, which throws on syntactically invalid
    // output — this is the end-to-end guard for the sanitizing above.
    await expect(formatFiles(await generateFiles(BASE_CONFIG))).resolves.toBeDefined();
  });
});

describe('generated model files compile', () => {
  const OUTPUT = join(process.cwd(), 'tests', '.tmp-generated-tsc');
  const RESERVED_FIXTURE = 'tests/fixtures/reserved-schema-names.yml';

  /** Compiler options deliberately free of Angular typings and project files. */
  const COMPILER_OPTIONS: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: true,
    // The generated models are self-contained (`import type` between model
    // files only); pulling in `@types/node` or the test globals would make the
    // check slow and unrelated to the output.
    types: [],
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };

  function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string[] {
    return diagnostics.map(
      (diagnostic) =>
        `TS${diagnostic.code} ${relative(process.cwd(), diagnostic.file?.fileName ?? '')}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
  }

  /**
   * Compiles the given files and returns syntactic + semantic errors.
   *
   * The reserved-word failures (TS1214/TS1213/TS2427/TS2457) are *semantic*:
   * they pass `createSourceFile` and `transpileModule` without a diagnostic,
   * so Prettier parsing the file proves nothing about them.
   */
  function compile(rootNames: string[]): {
    syntactic: readonly ts.Diagnostic[];
    semantic: readonly ts.Diagnostic[];
  } {
    const program = ts.createProgram(rootNames, COMPILER_OPTIONS);

    return {
      syntactic: program.getSyntacticDiagnostics(),
      semantic: program.getSemanticDiagnostics(),
    };
  }

  afterEach(async () => {
    await rm(OUTPUT, {recursive: true, force: true});
  });

  it('has no syntactic or semantic errors in the emitted model declarations', async () => {
    await generate({...BASE_CONFIG, input: RESERVED_FIXTURE, output: OUTPUT});

    const modelFiles = (await readdir(join(OUTPUT, 'models')))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(OUTPUT, 'models', name));

    expect(modelFiles.length).toBeGreaterThan(0);

    // Guard against the check silently inspecting nothing: every model file
    // must parse, and at least one declaration must be present.
    let declarations = 0;

    for (const file of modelFiles) {
      const sourceFile = ts.createSourceFile(
        file,
        await readFile(file, 'utf8'),
        ts.ScriptTarget.ES2022,
        true,
      );

      for (const statement of sourceFile.statements) {
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
          declarations++;
          // Also assert the declaration name is an identifier node, not a
          // missing/error node produced by a failed parse.
          expect(ts.isIdentifier(statement.name)).toBe(true);
        }
      }
    }

    expect(declarations).toBeGreaterThan(0);

    const {syntactic, semantic} = compile(modelFiles);

    expect(formatDiagnostics(syntactic)).toEqual([]);
    expect(formatDiagnostics(semantic)).toEqual([]);
  });

  it('reports the D1 diagnostics for an illegal declaration name (control)', async () => {
    // Negative control: without it, a misconfigured `createProgram` (e.g. an
    // empty root list or `skipLibCheck` swallowing everything) would make the
    // assertion above pass for any input. The exact names D1 was about must
    // produce TS1214/TS2457 in *this* setup.
    const controlDir = join(OUTPUT, 'control');
    const controlFile = join(controlDir, 'illegal-names.ts');

    await mkdir(controlDir, {recursive: true});
    await writeFile(controlFile, 'export interface private {}\nexport type number = number;\n', {
      encoding: 'utf8',
      flag: 'w',
    });

    const codes = compile([controlFile]).semantic.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(expect.arrayContaining([1214, 2457]));
  });
});

describe('generated resource files compile', () => {
  const OUTPUT = join(process.cwd(), 'tests', '.tmp-generated-resources-tsc');

  /**
   * Angular types (`@angular/core`) and the generated runtime are resolved
   * from `node_modules`; `skipLibCheck` keeps that cost bounded (~1s for the
   * whole tree).
   *
   * `noUnusedLocals` / `noUnusedParameters` are enabled so the TS6133 class
   * (an unused `resolved_*` local, an unused `readSignalOrValue` import, an
   * unused callback parameter) is compiler-guarded instead of only
   * string-asserted. The program contains generated files only, so these
   * options cannot be tripped by the test harness itself.
   */
  const COMPILER_OPTIONS: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: true,
    types: [],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };

  interface GuardFixture {
    /** Directory name and diagnostic label. */
    name: string;
    input: string;
    runtime?: GeneratorConfig['runtime'];
    /**
     * Resource files that must exist, so the guard cannot inspect nothing,
     * plus the substrings each must contain (regression anchors).
     */
    resources: {file: string; contains: string[]}[];
  }

  /**
   * Fixtures whose full generated tree (runtime + resources + models) the
   * guard compiles. It is a regression net for the shapes that used to emit
   * duplicate property keys or unused locals — cross-location collisions and
   * path-item overrides — not a global guarantee for arbitrary specs.
   */
  const GUARD_FIXTURES: GuardFixture[] = [
    {
      name: 'header-params',
      // `signalMutations` also compiles the `…Mutation()` wrappers, whose
      // signature must use the same disambiguated keys (N-D).
      input: 'tests/fixtures/header-params.yml',
      runtime: {signalMutations: true},
      resources: [
        {
          file: 'resources/collide.api.ts',
          contains: [
            'idPath: MaybeSignal<string>',
            'idQuery?: MaybeSignal<string>',
            'idHeader: MaybeSignal<string>',
          ],
        },
      ],
    },
    {
      name: 'additional-properties',
      input: 'tests/fixtures/additional-properties.yml',
      resources: [{file: 'resources/records.api.ts', contains: ['MixedWithRefs']}],
    },
    {
      name: 'mutation-signal-params',
      input: 'tests/fixtures/mutation-signal-params.yml',
      resources: [{file: 'resources/actions.api.ts', contains: ['readSignalOrValue']}],
    },
    {
      name: 'mutation-import-only',
      // A declared path param with no placeholder in the path template: the
      // params type references `MaybeSignal` but no value is ever read, so the
      // signal helpers must be imported type-only (unused `readSignalOrValue`
      // is TS6133 under `noUnusedLocals`) *and* `params` itself is unused
      // (TS6133 under `noUnusedParameters`) — hence `_params`.
      //
      // `signalMutations` compiles the generated `…Mutation()` wrapper next to
      // the `_params` shape: `generateSignalMutationMethod()` forwards its
      // arguments positionally (`_params` is a *parameter name*, not part of the
      // signature), so the wrapper's `this.createThing(params, mutationSignal)`
      // must still line up with `(_params, signal)`.
      input: 'tests/fixtures/mutation-import-only.yml',
      runtime: {signalMutations: true},
      resources: [
        {
          file: 'resources/things.api.ts',
          contains: [
            "import type {MaybeSignal} from '../signal-utils';",
            'ghost?: MaybeSignal<string>',
            '_params: {',
            'createThingMutation(',
          ],
        },
      ],
    },
    {
      name: 'mutation-body-only',
      // A mutation with no path/query/header params: neither `MaybeSignal` nor
      // `readSignalOrValue` is referenced, so `signal-utils` must not be
      // imported at all (TS6133 under `noUnusedLocals`).
      input: 'tests/fixtures/mutation-body-only.yml',
      resources: [{file: 'resources/things.api.ts', contains: ['body: CreateThingRequest']}],
    },
    {
      name: 'path-item-override',
      // Covers both the inline path-item override and the `$ref`'d one (the
      // merge must compare resolved `name`/`in`). Operation-level definitions
      // win (`number`, required); `X-Trace` has no override and survives.
      input: 'tests/fixtures/path-item-override.yml',
      resources: [
        {
          file: 'resources/override.api.ts',
          contains: [
            'id: MaybeSignal<number>',
            'page: MaybeSignal<number>',
            "'X-Trace'?: MaybeSignal<string>",
          ],
        },
        {
          file: 'resources/ref-override.api.ts',
          contains: ['id: MaybeSignal<number>', "'X-Trace'?: MaybeSignal<string>"],
        },
      ],
    },
    {
      name: 'nullable',
      // N3: named nullable object schemas. An interface branch that drops
      // `| null` still compiles — the shape only fails when a *consumer* relies
      // on the null member, which this compile cannot detect. The anchor here
      // keeps the generated alias (rather than an interface) in the program,
      // and `global-type-names` below guards the aliasing in a compiling tree.
      input: 'tests/fixtures/nullable.yml',
      resources: [{file: 'resources/items.api.ts', contains: ['request<Item>']}],
    },
    {
      name: 'global-type-names',
      // N6: schemas named `Record`/`Promise`/`Blob`/`ReadableStream`. Without
      // the rename this tree fails with TS2456/TS2315 (circular `Record` alias,
      // non-generic `Record`/`Promise`) and TS2740/TS2322 (a model `AbortSignal`
      // shadowing the DOM type in the `signal` argument position).
      //
      // N7: schemas named `Service`/`Mutation`/`inject`/`resource`/
      // `ApiFetchClient`/`ApiHttpClient`/`readSignalOrValue`/`MaybeSignal`/
      // `createMutation`, i.e. identifiers the resource template imports.
      // Without the rename the resource file declares the same module-scope
      // name twice (TS2300) while generation, Prettier and the CLI all report
      // success. `signalMutations` is enabled so the `Bindings` group imports
      // `createMutation`/`Mutation` as well.
      //
      // N8: schemas named exactly like a module-level export of a runtime module
      // (`ApiError`, `ApiRequestOptions`, `transformDates`,
      // `provideNgOpenapiSignals`, …). Each generated module compiles on its own;
      // the duplicate only appears at the package entry point, where the root
      // `index.ts` re-exports the runtime module and `./models` under one name
      // (TS2308). `dateTransformer` is enabled so `./date-utils` is part of this
      // tree, and the `RuntimeExports` group `$ref`s the renamed declarations.
      input: 'tests/fixtures/global-type-names.yml',
      // `dateTransformer` emits `date-utils.ts`; `signalMutations` emits
      // `mutation-utils.ts`. Both modules are re-exported by the root barrel, so
      // the union in `RESERVED_ROOT_EXPORT_NAMES` is compiled against a tree that
      // really contains them.
      runtime: {signalMutations: true, dateTransformer: true},
      resources: [
        {
          file: 'resources/records.api.ts',
          contains: [
            'request<ReadableStream<Uint8Array> | null>',
            'Promise<PromiseModel>',
            'signal?: AbortSignal',
            // `Uint8Array`/`AbortSignal` are declared as models *and* imported
            // by this file: without the rename the `ReadableStream<Uint8Array>`
            // and `signal?: AbortSignal` annotations above resolve to the
            // imported interfaces (TS2740/TS2322).
            'request<Uint8ArrayModel>',
            'body: AbortSignalModel',
          ],
        },
        {
          file: 'resources/bindings.api.ts',
          contains: [
            // All nine `RESERVED_RESOURCE_BINDING_NAMES` entries are imported
            // by this one resource file; the template's own bindings must stay
            // the only occurrence of each of those names (TS2300 otherwise).
            'request<ServiceModel>',
            'body: MutationModel',
            'request<ApiFetchClientModel>',
            'request<ApiHttpClientModel>',
            'request<MaybeSignalModel>',
            'request<readSignalOrValueModel>',
            'request<injectModel>',
            'request<resourceModel>',
            'body: createMutationModel',
          ],
        },
        {
          // N6 follow-up: `File`/`ArrayBuffer` are not emitted by the generator,
          // so they must be imported like any other model. The import itself is
          // the only observable difference — without it the emitted
          // `request<File>` still compiles against the DOM global, which is why
          // this compile guard alone cannot catch the regression (the string
          // assertions in `global-type-names.test.ts` do).
          file: 'resources/files.api.ts',
          contains: [
            'request<File>',
            'request<ArrayBuffer>',
            'encodeURIComponent(String(params.id))',
            // Same class of defect: `FormData`/`URLSearchParams` are DOM globals
            // the generator never emits, so a model with either name must be
            // imported rather than bound to the global.
            'request<FormData>',
            'body: URLSearchParams',
          ],
        },
        {
          // N8: every root-barrel collision is renamed, and the names are used
          // in the resource signature. Without the rename this file compiles and
          // the *root* barrel reports TS2308.
          file: 'resources/runtime-exports.api.ts',
          contains: [
            'request<ApiErrorModel>',
            'request<ApiRequestOptionsModel>',
            'request<transformDatesModel>',
            'request<provideNgOpenapiSignalsModel>',
            'request<MutationStatusModel>',
            'request<NG_OPENAPI_SIGNALS_BASE_PATHModel>',
          ],
        },
      ],
    },
    {
      name: 'inline-model-imports',
      // N1/N2/N3: inline (non-hoisted) type expressions reach the resource file
      // verbatim. The positive import rule must (a) not import emitted keywords
      // (`never`, `id?:`, `}`) and (b) still import the `$ref`s nested inside an
      // inline nullable object literal. Reverting to the split-based collector
      // makes Prettier throw on `import type {{, user?:, } }`, so this fixture
      // also compiles the resulting tree.
      input: 'tests/fixtures/inline-model-imports.yml',
      resources: [
        {
          file: 'resources/shapes.api.ts',
          contains: [
            'MaybeSignal<never>',
            'request<Record<string, never>>',
            "import type {Tag, User} from '../models';",
          ],
        },
      ],
    },
    {
      name: 'tuples',
      // N4: a tuple of `$ref`s (`pair: [User, Tag]`) must import both members.
      input: 'tests/fixtures/tuples.yml',
      resources: [{file: 'resources/pairs.api.ts', contains: ['PairList']}],
    },
    {
      name: 'generated-name-collisions',
      // A schema named `Index` used to claim `models/index.ts`, so the barrel
      // overwrote the declaration and re-exported itself
      // (`export * from './index';` → TS2305 at every consumer). A schema equal
      // to the derived class name (`UsersApi` for tag `Users`) was imported into
      // that same module, giving two module-scope bindings (TS2440/TS2395).
      //
      // The class rule is document-wide, not per-module: the root `index.ts`
      // re-exports `./models` and `./resources`, so `OrdersApi` (a model this
      // group never imports) would be a duplicate export there (TS2308). Both
      // colliding classes are therefore suffixed in this fixture.
      input: 'tests/fixtures/generated-name-collisions.yml',
      resources: [
        {
          file: 'resources/indexes.api.ts',
          contains: [
            "import type {Index, OrdersApi} from '../models';",
            'request<Index>',
            'request<OrdersApi>',
            'export class IndexesApi {',
          ],
        },
        {
          file: 'resources/users.api.ts',
          contains: ['export class UsersApi2 {', 'request<UsersApi>'],
        },
        {
          file: 'resources/orders.api.ts',
          contains: ['export class OrdersApi2 {', 'request<Wrapper>'],
        },
      ],
    },
    {
      name: 'generated-name-collisions-unimported',
      // The document-wide rule for a model the colliding group never imports:
      // `Users` derives `UsersApi`, the document declares a schema of that name,
      // but only `Reports` references it. A per-module rule would emit `export
      // class UsersApi`, which the root barrel then exports twice (TS2308).
      input: 'tests/fixtures/generated-name-collisions-unimported.yml',
      resources: [
        {
          file: 'resources/users.api.ts',
          contains: ['export class UsersApi2 {', "import type {User} from '../models';"],
        },
        {
          file: 'resources/reports.api.ts',
          contains: ['export class ReportsApi {', "import type {UsersApi} from '../models';"],
        },
      ],
    },
  ];

  async function listTsFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, {withFileTypes: true});
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await listTsFiles(fullPath)));
      } else if (entry.name.endsWith('.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  function compile(rootNames: string[]): readonly ts.Diagnostic[] {
    const program = ts.createProgram(rootNames, COMPILER_OPTIONS);

    return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  }

  function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string[] {
    return diagnostics.map(
      (diagnostic) =>
        `TS${diagnostic.code} ${relative(process.cwd(), diagnostic.file?.fileName ?? '')}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
  }

  afterEach(async () => {
    await rm(OUTPUT, {recursive: true, force: true});
  });

  it('emits compilable resources for the guard fixtures', async () => {
    // The `/colliding-name/{id}` and `/colliding-three/{id}` shapes declared
    // the same parameter name in several locations; `/override/{id}` declares
    // a parameter on the path item and re-declares it on the operation. Both
    // produced duplicate properties (TS2300 / TS2687 / TS2717 / TS1117) and
    // unused locals (TS6133) while the CLI still exited 0. Prettier parses
    // such files happily, so only a real compile can catch a regression.
    const rootNames: string[] = [];

    for (const fixture of GUARD_FIXTURES) {
      const output = join(OUTPUT, fixture.name);

      await generate({
        input: fixture.input,
        output,
        clean: true,
        groupBy: 'tag',
        ...(fixture.runtime ? {runtime: fixture.runtime} : {}),
      });

      const files = await listTsFiles(output);
      const resourcesDir = join(output, 'resources');
      const resourceFiles = files.filter((file) => file.startsWith(resourcesDir));

      expect(files.length).toBeGreaterThan(0);
      expect(resourceFiles.length).toBeGreaterThan(0);

      // Guard against a vacuous pass: each fixture resource must be part of
      // the program and still contain the shapes under test.
      for (const expectedResource of fixture.resources) {
        const source = await readFile(join(output, expectedResource.file), 'utf8');
        const absolute = join(output, expectedResource.file);

        // Only a file that is actually in the program is compiled.
        expect(files, `${fixture.name}: ${expectedResource.file}`).toContain(absolute);

        for (const expected of expectedResource.contains) {
          expect(source, `${fixture.name}/${expectedResource.file}: ${expected}`).toContain(
            expected,
          );
        }
      }

      rootNames.push(...files);
    }

    // One program for every fixture tree: the options that make this check
    // meaningful are per-program, and a single createProgram keeps the guard
    // at a few seconds instead of paying the Angular/lib parse cost per
    // fixture.
    expect(formatDiagnostics(compile(rootNames))).toEqual([]);
  });

  it('reports duplicate property keys and duplicate parameter names (control)', async () => {
    // Negative control for the compile above: without it, an accidentally
    // empty root list (or options that hide semantic diagnostics) would make
    // the assertion pass for any output. Both the type-level and object-literal
    // failure modes this fix addresses must be reported here.
    const controlDir = join(OUTPUT, 'control');
    const controlFile = join(controlDir, 'duplicate-keys.ts');

    await mkdir(controlDir, {recursive: true});
    await writeFile(
      controlFile,
      [
        'export interface Params { id: string; id?: string; }',
        'export const params: Params = {id: "1", id: "2"};',
        'export function mutate(params: {id: string; id?: string}): void {',
        '  void params;',
        '}',
      ].join('\n'),
      {encoding: 'utf8', flag: 'w'},
    );

    const codes = compile([controlFile]).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(expect.arrayContaining([2300, 1117]));
  });
});

describe('duplicate names', () => {
  it('deduplicates duplicate operationIds into distinct methods', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/duplicate-operation-ids.yml',
      }),
    );
    const api = files['resources/duplicates.api.ts']!;

    expect(api).toContain('getUserResource(');
    expect(api).toContain('getUser2Resource(');
  });

  it('deduplicates tags that map to the same file name', async () => {
    const files = await formatFiles(
      await generateFiles({
        ...BASE_CONFIG,
        input: 'tests/fixtures/duplicate-tags.yml',
      }),
    );

    const exports = files['resources/index.ts']!
      .split('\n')
      .filter((line) => line.startsWith('export'));

    expect(new Set(exports).size).toBe(exports.length);
    expect(exports.length).toBe(2);
  });
});

describe('--check', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('reports no missing/outdated files after a clean generate', async () => {
    // A successful generate + check also proves the sanitized output is valid
    // TypeScript: `formatFiles()` throws on syntax errors.
    await generate(BASE_CONFIG);

    const result = await checkFiles(BASE_CONFIG);

    expect(result.missing).toEqual([]);
    expect(result.outdated).toEqual([]);
  });
});

describe('writeFiles safety', () => {
  it('refuses to clean the working directory', async () => {
    await expect(generate({...BASE_CONFIG, output: '.', clean: true})).rejects.toThrow(
      /Refusing to clean/,
    );
  });

  it('refuses to clean an ancestor of the working directory', async () => {
    await expect(generate({...BASE_CONFIG, output: '..', clean: true})).rejects.toThrow(
      /Refusing to clean/,
    );
  });
});

describe('generated runtime files', () => {
  it('writes a URL builder that tolerates a relative base path', async () => {
    const files = await formatFiles(await generateFiles(BASE_CONFIG));
    const client = files['api-fetch-client.ts']!;

    expect(client).toContain('document.baseURI');
    expect(client).toContain("path.startsWith('/')");
  });

  it('derives the Accept header from the response type hint', async () => {
    const files = await formatFiles(await generateFiles(BASE_CONFIG));
    const client = files['api-fetch-client.ts']!;

    expect(client).toContain('acceptForResponseType(options.responseType)');
    expect(client).not.toContain("Accept: 'application/json'");
  });
});
