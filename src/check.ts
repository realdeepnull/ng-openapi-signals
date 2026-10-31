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
 * - `missing` — generated files that do not exist on disk yet.
 * - `stale`   — files on disk that are no longer produced by the spec.
 */
export interface CheckResult {
  matched: string[];
  outdated: string[];
  missing: string[];
  stale: string[];
}

/** Whether the check passed (no outdated or missing files). */
export function checkPassed(result: CheckResult): boolean {
  return result.outdated.length === 0 && result.missing.length === 0;
}

/**
 * Compares the in-memory generated output against the existing files on
 * disk, without writing anything. Used by `--check` for CI verification.
 */
export async function checkFiles(config: GeneratorConfig): Promise<CheckResult> {
  const generated = await formatFiles(await generateFiles(config));

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

      return {
        fileName,
        state: onDisk === generated[fileName] ? ('matched' as const) : ('outdated' as const),
      };
    }),
  );

  const matched: string[] = [];
  const outdated: string[] = [];
  const missing: string[] = [];

  for (const {fileName, state} of comparisons) {
    if (state === 'matched') {
      matched.push(fileName);
    } else if (state === 'outdated') {
      outdated.push(fileName);
    } else {
      missing.push(fileName);
    }
  }

  const stale = diskFiles.filter((name) => !generatedNames.has(name));

  return {matched, outdated, missing, stale};
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
