import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
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

  it('produces valid, parseable generated files', async () => {
    // `formatFiles()` runs Prettier, which throws on syntactically invalid
    // output — this is the end-to-end guard for the sanitizing above.
    await expect(formatFiles(await generateFiles(BASE_CONFIG))).resolves.toBeDefined();
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
