import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Backend foundation harness (P1-13-BE-022).
//
// Split from the default `npm test` for one reason: these suites need a live
// PostgreSQL with the Release 2 migrations applied, exactly like `test:db`.
// Keeping them separate means `npm test` stays runnable with no database, which
// is what makes the unit tier usable during ordinary development.
//
//   local: npm run supabase:start && npm run supabase:reset
//   CI:    the postgres service container + scripts/db/apply-migrations.mjs
//
// Connection comes from DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, shared with
// tests/db/helpers.ts so there is one connection convention, not two.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/backend/**/*.test.ts'],
    // Fixtures are stateful (tenants, grants, outbox rows). Files run
    // sequentially so one suite's cleanup cannot race another's provisioning;
    // concurrency is exercised *inside* tests, deliberately.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Coverage for the database-bound tier. Reported into its OWN directory:
    // merging it with the unit tier's number would overstate both, because the
    // two tiers exercise disjoint code through completely different harnesses.
    // Consumed by scripts/ci/coverage-gate.mjs against
    // .github/ci-baselines/coverage-baseline.backend.json.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'json'],
      reportsDirectory: './coverage/backend',
      // The modules whose behaviour only exists once a real PostgreSQL is
      // attached. Anything measurable without a database belongs to the unit
      // tier's include list, not here.
      include: ['src/modules/**', 'src/server/**'],
      exclude: ['src/server/openapi/**', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
