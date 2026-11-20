import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Every module-level binding a generated `.ts` file exports.
 *
 * The generated output only uses the declaration forms below (`models/*.ts`:
 * `interface` / `type`; `resources/*.api.ts`: `class`; the runtime modules:
 * `const` / `type` / `interface` / `class` / `function` / `async function`), so
 * a line-anchored scan is exact. Bare `export * from './x';` re-export lines
 * deliberately do not match: they name a module, not a binding.
 */
const DECLARATION =
  /^export (?:declare )?(?:abstract )?(?:async )?(?:class|interface|type|const|let|var|function|enum) (\w+)/gm;

/** Matches one `export * from './module';` line. */
const STAR_EXPORT = /^export \* from '\.\/(?<module>[^']+)';$/gm;

/** Names declared by one generated source file (not transitively). */
export function declaredNames(source: string): string[] {
  return [...source.matchAll(DECLARATION)].map((match) => match[1]!);
}

/**
 * Resolves a generated barrel and every module it star-re-exports into
 * `name → modules that export it`.
 *
 * Barrels are plain `export * from './x';` lines, one per module, so resolution
 * is a directory walk: `'./models'` is `models/index.ts`, whose own lines are
 * resolved relative to `models/`. Only star exports are followed — the
 * generator never emits named re-exports.
 */
async function resolveBarrel(
  barrelFile: string,
  directory: string,
): Promise<Map<string, string[]>> {
  const exportsByName = new Map<string, string[]>();
  const barrel = await readFile(barrelFile, 'utf8');
  const modules = [...barrel.matchAll(STAR_EXPORT)].map((line) => line.groups!['module']!);

  for (const module of modules) {
    // A star export may target a leaf module (`./user`) or a nested barrel
    // (`./models` → `models/index.ts`).
    const leaf = join(directory, `${module}.ts`);
    const leafSource = await readFile(leaf, 'utf8').catch(() => undefined);

    if (leafSource !== undefined) {
      for (const name of declaredNames(leafSource)) {
        exportsByName.set(name, [...(exportsByName.get(name) ?? []), leaf]);
      }
      continue;
    }

    for (const [name, origins] of await resolveBarrel(
      join(directory, module, 'index.ts'),
      join(directory, module),
    )) {
      exportsByName.set(name, [...(exportsByName.get(name) ?? []), ...origins]);
    }
  }

  return exportsByName;
}

/**
 * The names a generated barrel (`directory/index.ts`) re-exports, resolved
 * through nested barrels. Used for the `models/` and `resources/` barrels.
 */
export async function exportedNames(directory: string): Promise<string[]> {
  return [...(await resolveBarrel(join(directory, 'index.ts'), directory)).keys()];
}

/**
 * Names the generated package exports more than once, with the modules that
 * export them. An empty array means the root barrel is disjoint.
 *
 * The root `index.ts` star-re-exports every runtime module next to `./models`
 * and `./resources`, which is exactly the relationship that produces TS2308
 * ("Module './models' has already exported a member named 'X'"): a name
 * reaching two modules is an error for every consumer of the package, even
 * though each module compiles on its own and the CLI, Prettier and the
 * generator all succeed.
 */
export async function duplicateRootExports(outputDir: string): Promise<[string, string[]][]> {
  const exportsByName = await resolveBarrel(join(outputDir, 'index.ts'), outputDir);

  return [...exportsByName.entries()]
    .filter(([, modules]) => modules.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));
}
