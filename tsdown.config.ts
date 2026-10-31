import {readFileSync} from 'node:fs';
import {defineConfig} from 'tsdown';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/cli.ts', 'src/config.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
  sourcemap: false,
  define: {
    // Single source of truth for `--version`: the CLI banner is replaced with
    // the version from package.json at build time.
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
