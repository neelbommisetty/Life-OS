import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    passWithNoTests: true,
    dir,
  },
  resolve: {
    alias: {
      '~': resolve(dir, 'src'),
      '@writers-block/ai-core': resolve(dir, '..', 'ai-core', 'src', 'index.ts'),
      '@writers-block/logger': resolve(dir, '..', 'logger', 'src', 'index.ts'),
    },
  },
});
