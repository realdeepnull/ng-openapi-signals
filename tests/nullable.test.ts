import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from '../src/generate.js';

const OUTPUT_DIR = join(process.cwd(), 'tests', '.tmp-nullable');
const FIXTURE = 'tests/fixtures/nullable.yml';

describe('nullable handling', () => {
  beforeEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
    await generate({input: FIXTURE, output: OUTPUT_DIR, clean: true, groupBy: 'tag'});
  });

  afterEach(async () => {
    await rm(OUTPUT_DIR, {recursive: true, force: true});
  });

  it('adds | null for nullable: true on string property', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'item.ts'), 'utf8');
    expect(content).toContain('label?: string | null;');
  });

  it('adds | null for nullable: true on array property', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'item.ts'), 'utf8');
    expect(content).toContain('tags?: string[] | null;');
  });

  it('adds | null for nullable: true on $ref property', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'item.ts'), 'utf8');
    expect(content).toContain('ref?: Item | null;');
  });

  it('handles OpenAPI 3.1 type: [string, null]', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'item.ts'), 'utf8');
    expect(content).toContain('typedNull?: string | null;');
  });

  it('keeps null for anyOf: [$ref, {type: null}]', async () => {
    // Inline schemas are hoisted into named aliases, so the `| null` lives in
    // the alias while the property references it.
    const alias = await readFile(join(OUTPUT_DIR, 'models', 'any-of-object-value.ts'), 'utf8');
    expect(alias).toContain('export type AnyOfObjectValue = Item | null;');

    const owner = await readFile(join(OUTPUT_DIR, 'models', 'any-of-object.ts'), 'utf8');
    expect(owner).toContain('value?: AnyOfObjectValue;');
  });

  it('keeps null for a required anyOf of two members', async () => {
    const alias = await readFile(join(OUTPUT_DIR, 'models', 'required-nullable-value.ts'), 'utf8');
    expect(alias).toContain('export type RequiredNullableValue = number | null;');

    const owner = await readFile(join(OUTPUT_DIR, 'models', 'required-nullable.ts'), 'utf8');
    // Required stays required (no `?`) when the union carries null.
    expect(owner).toContain('value: RequiredNullableValue;');
  });

  it('emits exactly one | null when anyOf and nullable: true are combined', async () => {
    const alias = await readFile(join(OUTPUT_DIR, 'models', 'double-nullable-value.ts'), 'utf8');
    expect(alias).toContain('export type DoubleNullableValue = string | null;');
    expect(alias).not.toContain('| null | null');
  });

  it('emits exactly one | null for duplicate null members', async () => {
    const alias = await readFile(join(OUTPUT_DIR, 'models', 'duplicate-null-value.ts'), 'utf8');
    expect(alias).toContain('export type DuplicateNullValue = null;');
  });

  it('renders anyOf with only null as null', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'null-only.ts'), 'utf8');
    expect(content).toContain('export type NullOnly = null;');
  });

  it('does not narrow a union that contains an unconstrained member', async () => {
    const alias = await readFile(join(OUTPUT_DIR, 'models', 'opaque-union-value.ts'), 'utf8');
    expect(alias).toContain('export type OpaqueUnionValue = unknown;');
  });

  it('treats {enum: [null]} inside anyOf as the null member', async () => {
    const alias = await readFile(join(OUTPUT_DIR, 'models', 'null-enum-value.ts'), 'utf8');
    expect(alias).toContain('export type NullEnumValue = string | null;');
  });

  it('keeps null for oneOf: [T, {type: null}]', async () => {
    const alias = await readFile(join(OUTPUT_DIR, 'models', 'one-of-nullable-value.ts'), 'utf8');
    expect(alias).toContain('export type OneOfNullableValue = number | null;');
  });

  it('adds | null to a named nullable object (OpenAPI 3.0 `nullable: true`)', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'nullable-object.ts'), 'utf8');

    // The named object used to emit `export interface NullableObject { … }`,
    // which silently drops `| null`.
    expect(content).toContain('export type NullableObject = {id: string; meta?: Item} | null;');
    expect(content).not.toContain('export interface NullableObject');
    // Members (and the reference they carry) survive the alias.
    expect(content).toContain("import type {Item} from './item';");
  });

  it('adds | null to a named nullable object (OpenAPI 3.1 `type: [object, null]`)', async () => {
    const content = await readFile(join(OUTPUT_DIR, 'models', 'nullable-object31.ts'), 'utf8');

    expect(content).toContain('export type NullableObject31 = {id?: string} | null;');
    expect(content).not.toContain('export interface NullableObject31');
  });

  it('keeps members, index signature and null on a nullable map', async () => {
    const content30 = await readFile(join(OUTPUT_DIR, 'models', 'nullable-map.ts'), 'utf8');
    const content31 = await readFile(join(OUTPUT_DIR, 'models', 'nullable-map31.ts'), 'utf8');

    expect(content30).toContain(
      'export type NullableMap = ({id?: string} & Record<string, number>) | null;',
    );
    expect(content31).toContain(
      'export type NullableMap31 = ({id?: string} & Record<string, number>) | null;',
    );
  });

  it('keeps | null on a nullable object with an empty `properties` map', async () => {
    const content30 = await readFile(join(OUTPUT_DIR, 'models', 'empty-nullable30.ts'), 'utf8');
    const content31 = await readFile(join(OUTPUT_DIR, 'models', 'empty-nullable31.ts'), 'utf8');

    // `{type: object, nullable: true, properties: {}}` used to fall into the
    // bare-object branch and emit only `Record<string, unknown>`.
    expect(content30).toContain('export type EmptyNullable30 = Record<string, unknown> | null;');
    // `{type: [object, 'null'], properties: {}}` used to fall into the
    // interface branch and emit `export interface EmptyNullable31 {}`.
    expect(content31).toContain('export type EmptyNullable31 = Record<string, unknown> | null;');
    expect(content31).not.toContain('export interface EmptyNullable31');
  });

  it('keeps a non-nullable empty object as a bare record alias', async () => {
    // Regression guard for the control shape: widening the nullable branch
    // must not add `| null` (or an interface) here.
    const content = await readFile(join(OUTPUT_DIR, 'models', 'empty-plain.ts'), 'utf8');

    expect(content).toContain('export type EmptyPlain = Record<string, unknown>;');
    expect(content).not.toContain('| null');
  });

  it('keeps a non-nullable object as an interface', async () => {
    // Regression guard: only nullable (or additionalProperties-bearing) object
    // schemas may move to the alias branch. The common shape must not change.
    const content = await readFile(join(OUTPUT_DIR, 'models', 'plain-object.ts'), 'utf8');

    expect(content).toContain('export interface PlainObject {');
    expect(content).not.toContain('| null');
  });
});
