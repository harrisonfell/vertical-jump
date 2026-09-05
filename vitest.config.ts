import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The app's '@/' alias (apps/mobile/tsconfig.json paths), so tests that
    // import app modules at runtime collect under vitest as well as Metro.
    alias: { '@': fileURLToPath(new URL('./apps/mobile/src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: [
      'packages/engine/**/*.test.ts',
      'apps/mobile/**/*.test.ts',
      'apps/mobile/**/*.test.tsx',
      'apps/server/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.expo/**', '**/.next/**'],
  },
});
