import { defineConfig } from 'vitest/config';
import { API_SRC_ROOT, API_SRC_PATH } from './scripts/lib/repository-paths.mjs';

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
        `${API_SRC_PATH}/config/**`,
        `${API_SRC_PATH}/lib/logging/**`,
        `${API_SRC_PATH}/server/errors/**`,
        `${API_SRC_PATH}/server/observability/**`,
        `${API_SRC_PATH}/server/cache/**`,
        `${API_SRC_PATH}/server/http/rate-limit.ts`,
        `${API_SRC_PATH}/server/http/trusted-proxy.ts`,
        `${API_SRC_PATH}/server/http/validation.ts`,
        `${API_SRC_PATH}/server/db/pagination.ts`,
        `${API_SRC_PATH}/server/db/concurrency.ts`,
        `${API_SRC_PATH}/server/worker/backoff.ts`,
      ],
    },
  },
  // The repository-level tiers test the API application, so `@` resolves to the
  // API's source here — and ONLY here. `apps/web` has its own runner, where the
  // same specifier resolves into the web source. One alias, one meaning, per
  // resolver. `@api` is the unambiguous spelling for anything written from now
  // on; `@/` is kept because rewriting it across 131 test files would be a
  // 131-file diff inside a migration whose whole value is that it is a rename.
  resolve: {
    alias: { '@api': API_SRC_ROOT, '@': API_SRC_ROOT },
  },
});
