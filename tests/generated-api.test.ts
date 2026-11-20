import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-api');

describe('generated API', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: 'examples/openapi.json',
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
    });
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  async function readApiFile(): Promise<string> {
    return readFile(join(OUTPUT_DIR, 'resources', 'users.api.ts'), 'utf8');
  }

  it('imports model types (User, CreateUserRequest)', async () => {
    const content = await readApiFile();
    expect(content).toContain('CreateUserRequest');
    expect(content).toContain('User');
    expect(content).toContain("from '../models'");
  });

  it('uses User as the response type for getUserById', async () => {
    const content = await readApiFile();
    expect(content).toContain('this.client.request<User>');
  });

  it('uses User[] as the response type for searchUsers', async () => {
    const content = await readApiFile();
    expect(content).toContain('this.client.request<User[]>');
  });

  it('uses CreateUserRequest as the body type for createUser', async () => {
    const content = await readApiFile();
    expect(content).toContain('body: CreateUserRequest');
  });

  it('does not emit params: void in createUser', async () => {
    const content = await readApiFile();
    expect(content).not.toContain('params: void');
  });

  it('does not use as any casts', async () => {
    const content = await readApiFile();
    expect(content).not.toContain('as any');
  });

  it('createUser signature has body and signal only', async () => {
    const content = await readApiFile();
    expect(content).toContain(
      'createUser(body: CreateUserRequest, signal?: AbortSignal): Promise<User>',
    );
  });

  it('imports resource from @angular/core', async () => {
    const content = await readApiFile();
    expect(content).toContain('resource');
    expect(content).toContain("from '@angular/core'");
  });

  it('imports MaybeSignal and readSignalOrValue from signal-utils', async () => {
    const content = await readApiFile();
    expect(content).toContain('MaybeSignal');
    expect(content).toContain('readSignalOrValue');
    expect(content).toContain("from '../signal-utils'");
  });

  it('params factory for required-param GET returns undefined when required param is undefined', async () => {
    const content = await readApiFile();
    // getUserById has a required `id` path param → params() must be able to
    // return undefined to preserve Angular resource() idle state. The signal is
    // read once into a local, so the guard compares the local.
    expect(content).toContain('| undefined =>');
    expect(content).toMatch(/resolved_id === undefined/);
    expect(content).toMatch(/readSignalOrValue\(params\.id\)/);
  });

  it('params factory for optional-only GET always resolves (no undefined guard)', async () => {
    const content = await readApiFile();
    // searchUsers has only optional query params → no idle guard needed.
    const searchIndex = content.indexOf('searchUsersResource');
    const searchSection = content.slice(searchIndex);
    const searchEnd = searchSection.indexOf('  }');
    const searchBlock = searchSection.slice(0, searchEnd);
    expect(searchBlock).not.toContain('=== undefined ? undefined');
  });

  it('loader params type excludes undefined for idle-capable resources', async () => {
    const content = await readApiFile();
    // The loader's inline `params` type must be the concrete (non-undefined)
    // shape, since Angular only invokes the loader when params() is defined.
    // Verify the loader block for getUserByIdResource does not declare
    // `params` as `| undefined`.
    const loaderIndex = content.indexOf('getUserByIdResource');
    const loaderSection = content.slice(loaderIndex);
    // Slice only from the `loader:` keyword onward to exclude the params
    // factory (which legitimately contains `| undefined`).
    const loaderStart = loaderSection.indexOf('loader:');
    const loaderBlock = loaderSection.slice(loaderStart, loaderStart + 400);
    // The loader's params type annotation should be the concrete object.
    expect(loaderBlock).toMatch(/params:\s*\{/);
    expect(loaderBlock).not.toContain('| undefined');
  });
});

describe('generated API with httpClient transport', () => {
  const HTTP_OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-api-http');

  beforeEach(async () => {
    await rm(HTTP_OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: 'examples/openapi.json',
      output: HTTP_OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {transport: 'httpClient'},
    });
  });

  afterEach(async () => {
    await rm(HTTP_OUTPUT_DIR, {recursive: true, force: true});
  });

  it('imports ApiHttpClient from api-http-client', async () => {
    const content = await readFile(join(HTTP_OUTPUT_DIR, 'resources', 'users.api.ts'), 'utf8');
    expect(content).toContain("import {ApiHttpClient} from '../api-http-client';");
    expect(content).toContain('inject(ApiHttpClient)');
    expect(content).not.toContain('ApiFetchClient');
  });

  it('uses the same request method shape as fetch transport', async () => {
    const content = await readFile(join(HTTP_OUTPUT_DIR, 'resources', 'users.api.ts'), 'utf8');
    expect(content).toContain('this.client.request<User>');
    expect(content).toContain('this.client.request<User[]>');
    expect(content).toContain('body: CreateUserRequest');
  });
});

describe('generated API with signal mutations', () => {
  const MUT_OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-api-mut');

  beforeEach(async () => {
    await rm(MUT_OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: 'examples/openapi.json',
      output: MUT_OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {signalMutations: true},
    });
  });

  afterEach(async () => {
    await rm(MUT_OUTPUT_DIR, {recursive: true, force: true});
  });

  it('imports Mutation and createMutation from mutation-utils', async () => {
    const content = await readFile(join(MUT_OUTPUT_DIR, 'resources', 'users.api.ts'), 'utf8');
    expect(content).toContain('Mutation');
    expect(content).toContain('createMutation');
    expect(content).toContain("from '../mutation-utils'");
  });

  it('generates createUserMutation alongside createUser', async () => {
    const content = await readFile(join(MUT_OUTPUT_DIR, 'resources', 'users.api.ts'), 'utf8');
    expect(content).toContain(
      'createUser(body: CreateUserRequest, signal?: AbortSignal): Promise<User>',
    );
    expect(content).toContain('createUserMutation(): Mutation<CreateUserRequest, User>');
    expect(content).toContain('createMutation<CreateUserRequest, User>');
  });

  it('generates uploadUserAvatarMutation with unwrapped path params', async () => {
    const content = await readFile(join(MUT_OUTPUT_DIR, 'resources', 'users.api.ts'), 'utf8');
    expect(content).toContain('uploadUserAvatarMutation(params: {');
    expect(content).toContain('Mutation<UploadUserAvatarRequest2, UploadUserAvatarResponse>');
    expect(content).toContain('readSignalOrValue(params.id)');
  });

  it('emits mutation-utils.ts runtime file', async () => {
    const content = await readFile(join(MUT_OUTPUT_DIR, 'mutation-utils.ts'), 'utf8');
    expect(content).toContain('export interface Mutation<TBody, TResult>');
    expect(content).toContain('export function createMutation<TBody, TResult>');
    expect(content).toContain('isLoading');
    expect(content).toContain('mutate');
  });

  it('exports mutation-utils from index.ts', async () => {
    const content = await readFile(join(MUT_OUTPUT_DIR, 'index.ts'), 'utf8');
    expect(content).toContain("export * from './mutation-utils';");
  });
});

describe('generated API without signal mutations (default)', () => {
  const DEFAULT_OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-api-default');

  beforeEach(async () => {
    await rm(DEFAULT_OUTPUT_DIR, {recursive: true, force: true});
    await generate({
      input: 'examples/openapi.json',
      output: DEFAULT_OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
    });
  });

  afterEach(async () => {
    await rm(DEFAULT_OUTPUT_DIR, {recursive: true, force: true});
  });

  it('does not generate …Mutation() methods by default', async () => {
    const content = await readFile(join(DEFAULT_OUTPUT_DIR, 'resources', 'users.api.ts'), 'utf8');
    expect(content).not.toContain('createUserMutation');
    expect(content).not.toContain('createMutation');
  });

  it('does not emit mutation-utils.ts by default', async () => {
    await expect(readFile(join(DEFAULT_OUTPUT_DIR, 'mutation-utils.ts'), 'utf8')).rejects.toThrow();
  });

  it('does not export mutation-utils from index.ts by default', async () => {
    const content = await readFile(join(DEFAULT_OUTPUT_DIR, 'index.ts'), 'utf8');
    expect(content).not.toContain("export * from './mutation-utils';");
  });
});
