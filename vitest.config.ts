import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // Phase 1-1 has almost no application code by design. A coverage THRESHOLD
      // here would be theatre: it would measure an empty app. Real thresholds are
      // set when the Phase 1-2 schema and the first modules exist.
      include: ['src/config/**', 'src/lib/logging/**', 'src/shared/errors/**'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
