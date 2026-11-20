import {describe, it, expect} from 'vitest';
import {collectModelReferences} from '../src/codegen/model-refs.js';

const MODELS = new Set(['User', 'Tag', 'Record', 'active']);

function references(type: string): string[] {
  const output = new Set<string>();

  collectModelReferences(type, MODELS, output);

  return [...output].sort();
}

describe('collectModelReferences', () => {
  it('collects model names in type position', () => {
    expect(references('User | Tag')).toEqual(['Tag', 'User']);
    expect(references('{ user?: User } | null')).toEqual(['User']);
    expect(references('[User, Tag]')).toEqual(['Tag', 'User']);
  });

  it('ignores object-literal member names', () => {
    // `{ User?: string }` declares a property, not a reference to the model.
    expect(references('{ User?: string }')).toEqual([]);
    expect(references('Record<string, User>')).toEqual(['Record', 'User']);
  });

  it('strips single-quoted string-literal types, including escaped quotes', () => {
    expect(references("'active' | User")).toEqual(['User']);
    // The single-quote branch needs its own escape handling: without it the
    // regex matches the *inner* `'User'` and the surrounding literal text leaks
    // `User` into the scan (an unused import under `noUnusedLocals`).
    expect(references("'a\\'User\\'b'")).toEqual([]);
    expect(references("'a\\'User\\'b' | Tag")).toEqual(['Tag']);
  });

  it('strips double-quoted string-literal types, including escaped quotes', () => {
    expect(references('"active" | User')).toEqual(['User']);
    expect(references('"a\\"User\\""')).toEqual([]);
  });
});
