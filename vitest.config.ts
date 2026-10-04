import { defineConfig } from 'vitest/config';
import { API_SRC_ROOT, API_SRC_PATH } from './scripts/lib/repository-paths.mjs';

export default defineConfig({
  test: {
    environment: 'node',
    /*
     * H-18. The default five-second case budget is not a budget for a case that
     * loads a module graph.
     *
     * Several cases here dynamically import a feature module, and the first one
     * to do so pays for the whole transform chain. Alone that is under a second;
     * under full-suite load with workers competing it crossed five seconds
     * intermittently, and a different case timed out on each run. A flake that
     * moves is worse than one that does not, because it teaches a reader to
     * re-run rather than to look.
     *
     * Raised deliberately rather than globally disabled, and stated rather than
     * left to be discovered: a case that genuinely hangs still fails, thirty
     * seconds later. The precedent is tests/ci/canonical-documents.test.ts.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,

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
      //
      // `include` IS LOAD-BEARING, and it became more so at vitest 4. Vitest 3
      // spelled the untested-file guarantee `coverage.all: true`; vitest 4
      // REMOVED that option and gave the job to `include`. On a full-tier run
      // the provider now adds every file matching these patterns that no test
      // loaded, at 0%, before writing the report. So NARROWING THIS LIST SHRINKS
      // THE DENOMINATOR: a file dropped from it does not appear as a gap, it
      // stops existing, and every percentage above rises for no reason anybody
      // can see in a diff. `tests/ci/baseline-integrity.test.ts` pins the list
      // for exactly that reason.
      //
      // Each directory root is spelled `**/*.ts` rather than a bare `**`. That
      // is a constraint on what may enter the measurement, not a narrowing of
      // it: every file under these five roots is already `.ts`, none is `.d.ts`,
      // and the instrumented count is unchanged at 19. What it buys is that a
      // stray non-TypeScript file added under one of them cannot silently join
      // the denominator or fail the provider's parser.
      include: [
        `${API_SRC_PATH}/config/**/*.ts`,
        `${API_SRC_PATH}/lib/logging/**/*.ts`,
        `${API_SRC_PATH}/server/errors/**/*.ts`,
        `${API_SRC_PATH}/server/observability/**/*.ts`,
        `${API_SRC_PATH}/server/cache/**/*.ts`,
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
