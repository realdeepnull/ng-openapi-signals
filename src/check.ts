import {readFile, readdir} from 'node:fs/promises';
import type {Dirent} from 'node:fs';
import {join} from 'node:path';
import {generateFiles, formatFiles} from './generate';
import type {GeneratorConfig} from './codegen/types';

/**
 * Result of comparing generated files against the files on disk.
 *
 * - `matched` — generated files whose disk content is identical.
 * - `outdated` — generated files that exist on disk but differ.
 * - `outdatedEol` — generated files that differ *only* in line endings. Kept
 *   separate so Windows checkouts (`core.autocrlf=true`) do not report a
 *   content diff that does not exist.
 * - `missing` — generated files that do not exist on disk yet.
 * - `stale`   — files on disk that are no longer produced by the spec.
 */
export interface CheckResult {
  matched: string[];
  outdated: string[];
  outdatedEol: string[];
  missing: string[];
  stale: string[];
}

/**
 * Whether the check passed.
 *
 * `outdatedEol` does not fail: the content is identical and the next
 * `generate` rewrites it with LF line endings. `stale` does not fail either
 * unless `failOnStale` is set — the default is tolerant for backwards
 * compatibility, but a CI gate can opt in.
 */
export function checkPassed(result: CheckResult, failOnStale = false): boolean {
  return (
    result.outdated.length === 0 &&
    result.missing.length === 0 &&
    (!failOnStale || result.stale.length === 0)
  );
}

/** Normalizes line endings so a CRLF checkout is not reported as outdated. */
function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Compares the in-memory generated output against the existing files on
 * disk, without writing anything. Used by `--check` for CI verification.
 */
export async function checkFiles(config: GeneratorConfig): Promise<CheckResult> {
  const generated = await formatFiles(await generateFiles(config), config.output);

  const diskFiles = await listFiles(config.output);
  const generatedNames = new Set(Object.keys(generated));
  const diskSet = new Set(diskFiles);

  // Read in parallel: sequential reads on a large generated tree dominate the
  // runtime of `--check` in CI.
  const comparisons = await Promise.all(
    Object.keys(generated).map(async (fileName) => {
      if (!diskSet.has(fileName)) {
        return {fileName, state: 'missing' as const};
      }

      const onDisk = await readFile(join(config.output, fileName), 'utf8');
      const expected = generated[fileName]!;

      // Compare raw first, then line-ending-insensitively. The latter keeps a
      // `core.autocrlf=true` checkout from reporting every file as outdated
      // while still surfacing the (harmless) CRLF difference separately.
      const state =
        onDisk === expected
          ? ('matched' as const)
          : normalizeEol(onDisk) === normalizeEol(expected)
            ? ('outdatedEol' as const)
            : ('outdated' as const);

      return {fileName, state};
    }),
  );

  const matched: string[] = [];
  const outdated: string[] = [];
  const outdatedEol: string[] = [];
  const missing: string[] = [];

  for (const {fileName, state} of comparisons) {
    if (state === 'matched') {
      matched.push(fileName);
    } else if (state === 'outdatedEol') {
      outdatedEol.push(fileName);
    } else if (state === 'outdated') {
      outdated.push(fileName);
    } else {
      missing.push(fileName);
    }
  }

  const stale = diskFiles.filter((name) => !generatedNames.has(name));

  return {matched, outdated, outdatedEol, missing, stale};
}

/** Recursively lists all files under `dir` as paths relative to `dir` (forward slashes). */
async function listFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = await readdir(dir, {withFileTypes: true});
  } catch {
    // Missing directory, permission error, or a file instead of a directory:
    // there is nothing to compare against.
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const nested = await listFiles(fullPath);
        return nested.map((nestedFile) => `${entry.name}/${nestedFile}`);
      }

      // Symlinks and other special entries are not generated files; reading
      // them could fail or escape the output directory.
      return entry.isFile() ? [entry.name] : [];
    }),
  );

  return files.flat();
}
