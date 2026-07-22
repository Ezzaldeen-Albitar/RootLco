import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Database tests need a running local PostgreSQL (Supabase stack or the CI
    // service container) and run separately via `npm run test:db`
    // (vitest.config.db.ts). Keeping them out of the default suite keeps
    // `npm test` green in environments without a database.
    // `tests/backend/**` also needs a database and runs via
    // `npm run test:backend` (vitest.config.backend.ts).
    exclude: ['tests/db/**', 'tests/backend/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // Phase 1-1 has almost no application code by design. A coverage THRESHOLD
      // here would be theatre: it would measure an empty app. Real thresholds are
      // set when the Phase 1-2 schema and the first modules exist.
      // Phase 1-13 adds the backend foundation. Coverage is reported for the
      // pure-logic modules the unit tier actually exercises; the database-bound
      // paths are covered by `test:backend`, whose coverage is not merged here
      // because a merged number across two runners would overstate both.
      include: [
        'src/config/**',
        'src/lib/logging/**',
        'src/shared/errors/**',
        'src/server/errors/**',
        'src/server/observability/**',
        'src/server/cache/**',
        'src/server/http/rate-limit.ts',
        'src/server/http/trusted-proxy.ts',
        'src/server/http/validation.ts',
        'src/server/db/pagination.ts',
        'src/server/db/concurrency.ts',
        'src/server/worker/backoff.ts',
      ],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
