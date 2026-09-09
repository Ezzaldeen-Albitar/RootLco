import { defineConfig } from 'vitest/config';
import { API_SRC_ROOT, API_SRC_PATH } from './scripts/lib/repository-paths.mjs';

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
      //
      // `include` IS LOAD-BEARING, and it became more so at vitest 4. Vitest 3
      // spelled the untested-file guarantee `coverage.all: true`; vitest 4
      // REMOVED that option and gave the job to `include`. On a full-tier run
      // the provider now adds every file matching these patterns that no test
      // loaded, at 0%, before writing the report. So NARROWING THIS LIST SHRINKS
      // THE DENOMINATOR: a file dropped from it does not appear as a gap, it
      // stops existing, and the tier's percentages rise for no reason anybody
      // can see in a diff. `tests/ci/baseline-integrity.test.ts` pins the list
      // for exactly that reason.
      //
      // Each root is spelled `**/*.ts` rather than a bare `**`. That is a
      // constraint on what may enter the measurement, not a narrowing of it:
      // `git ls-files apps/api/src/modules apps/api/src/server` is 272 `.ts`
      // files, zero `.d.ts`, and one `.md` (`modules/README.md`) that the
      // provider already leaves out, so the instrumented count is unchanged at
      // 271 — the 272 minus `server/openapi/document.ts`, excluded below. What
      // it buys is that a stray non-TypeScript file added under either root
      // cannot silently join the denominator or fail the provider's parser.
      include: [`${API_SRC_PATH}/modules/**/*.ts`, `${API_SRC_PATH}/server/**/*.ts`],
      exclude: [`${API_SRC_PATH}/server/openapi/**`, '**/*.d.ts'],
    },
  },
  resolve: {
    alias: { '@api': API_SRC_ROOT, '@': API_SRC_ROOT },
  },
});
