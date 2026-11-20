import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Several suites run the full generator (parse + hoist + Prettier over the
    // whole output tree, sometimes twice for `--check`). That comfortably
    // exceeds the 5s default when the file-parallel workers compete for CPU,
    // so a slower machine would fail with a timeout rather than a real defect.
    testTimeout: 20_000,
  },
});
