import { defineConfig } from 'vitest/config';
import { API_SRC_ROOT } from './scripts/lib/repository-paths.mjs';

// Database test harness configuration (P1-02-QA-001..005).
// Requires a running PostgreSQL with migrations applied:
//   local: a disposable database, per CONTRIBUTING §8 "Pre-push step for schema
//          and seed changes": a throwaway postgres:17-alpine container on
//          127.0.0.1:55440, then DB_PORT=55440 with `npm run db:apply-migrations`.
//          Never `supabase:reset` the shared stack that holds the acceptance data.
//   CI:    the postgres service container + scripts/db/apply-migrations.mjs
// Connection comes from DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
// (defaults match the Supabase local stack). See tests/db/helpers.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    // ONE file is excluded, by name, and the exclusion is a requirement rather
    // than a preference. `tests/db/p1-31-export-fixture.test.ts` installs
    // privileged role grants, so it REFUSES to run when `current_database()` is
    // `postgres` — the name `tests/db/helpers.ts` defaults to and the name every
    // hosted database job supplies. Left in this list it would turn this tier red
    // on every branch and in every job that runs it, and the honest answer is a
    // separate runner rather than a weakened refusal or a silent skip: it runs
    // under `vitest.config.db-fixture.ts` (`npm run test:db-fixture`) against a
    // disposable database the operator names. Nothing else is excluded.
    exclude: ['tests/db/p1-31-export-fixture.test.ts', 'node_modules/**'],
    // Database fixtures are stateful: files run sequentially so cleanup in one
    // file can never race provisioning in another. Concurrency is exercised
    // INSIDE the tests (50 parallel connections), not by the runner.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { '@api': API_SRC_ROOT, '@': API_SRC_ROOT },
  },
});
