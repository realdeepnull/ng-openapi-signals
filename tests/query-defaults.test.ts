import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const FIXTURE = 'tests/fixtures/query-styles.yml';
const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-query-defaults');

describe('runtime.defaultQueryStyle / defaultQueryExplode / preferContentType', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('applies defaultQueryStyle to params without an explicit style', async () => {
    await generate({
      input: FIXTURE,
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {defaultQueryStyle: 'pipeDelimited'},
    });

    // `q` has no explicit style in the fixture. With the default config it is
    // passed as a plain value; with defaultQueryStyle=pipeDelimited it must be
    // wrapped with serialization metadata.
    const content = await readFile(join(OUTPUT_DIR, 'resources', 'query.api.ts'), 'utf8');
    expect(content).toMatch(/q: \{value: params\.q, style: 'pipeDelimited', explode: true\}/);
  });

  it('keeps spec-explicit styles and only overrides missing ones', async () => {
    await generate({
      input: FIXTURE,
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {defaultQueryStyle: 'pipeDelimited'},
    });

    const content = await readFile(join(OUTPUT_DIR, 'resources', 'query.api.ts'), 'utf8');
    // `tags` explicitly declares spaceDelimited — the config default must not
    // clobber an explicit spec value.
    expect(content).toMatch(
      /tags: \{[\s\S]*?style: 'spaceDelimited',[\s\S]*?explode: false[\s\S]*?\}/,
    );
  });

  it('applies defaultQueryExplode=false to params without an explicit explode', async () => {
    await generate({
      input: FIXTURE,
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {defaultQueryExplode: false},
    });

    const content = await readFile(join(OUTPUT_DIR, 'resources', 'query.api.ts'), 'utf8');
    // `q` has no explicit explode → wrapped with explode: false.
    expect(content).toMatch(/q: \{value: params\.q, style: 'form', explode: false\}/);
  });

  it('passes default-form params as plain values when defaults are unchanged', async () => {
    await generate({
      input: FIXTURE,
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
    });

    const content = await readFile(join(OUTPUT_DIR, 'resources', 'query.api.ts'), 'utf8');
    // Look at the request's `query: { ... }` block specifically: the params
    // factory (above) reads each signal once into a `resolved_*` local, so a
    // bare `q:` search would hit the wrong block.
    const queryBlock = content.slice(content.indexOf('query: {'));

    expect(queryBlock).toMatch(/q: params\.q/);
  });

  it('selects the preferred content type for request bodies', async () => {
    // The fixture offers application/json and multipart/form-data; the JSON
    // entry would win by default — preferContentType must flip the selection.
    await generate({
      input: 'tests/fixtures/multi-content-type.yml',
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {preferContentType: 'multipart/form-data'},
    });

    const content = await readFile(join(OUTPUT_DIR, 'resources', 'upload.api.ts'), 'utf8');
    // With preferContentType=multipart/form-data, the multipart body must be
    // selected (formData: body) instead of the JSON body.
    expect(content).toContain('formData: body');
    expect(content).toContain("contentType: 'multipart/form-data'");

    // The selected multipart schema has a binary `file` part (hoisted as
    // UploadAvatarRequest2 — the JSON variant is hoisted first).
    const multipartModel = await readFile(
      join(OUTPUT_DIR, 'models', 'upload-avatar-request2.ts'),
      'utf8',
    );
    expect(multipartModel).toContain('file: Blob');
  });

  it('falls back to application/json when the preferred type is not offered', async () => {
    await generate({
      input: 'tests/fixtures/multi-content-type.yml',
      output: OUTPUT_DIR,
      clean: true,
      groupBy: 'tag',
      runtime: {preferContentType: 'text/plain'},
    });

    const content = await readFile(join(OUTPUT_DIR, 'resources', 'upload.api.ts'), 'utf8');
    // text/plain is not offered → fall back to application/json.
    expect(content).toContain('body,');

    // No formData path: the JSON body is used directly.
    expect(content).not.toContain('formData: body');
  });
});
