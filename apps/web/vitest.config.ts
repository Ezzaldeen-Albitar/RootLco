import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Two PROJECTS, because the two tiers need different environments and one
 * `environment` setting would force a compromise on both.
 *
 * - `logic` — money, table state, navigation, i18n, the API client, the
 *   Stylelint policy. No DOM, so these stay fast and cannot quietly start
 *   depending on one.
 * - `dom` — component and accessibility tests, which need a document.
 *
 * The split also stops a component test becoming the only thing exercising a
 * pure function: the logic tier runs with no DOM at all, so a helper that
 * secretly reaches for `window` fails there rather than passing everywhere.
 */
const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

/**
 * The instrumented surface — the P1-27 CRM and Vehicle screens, the routes that
 * mount them, and the shared library they are built on (`P1-27-QA-001`).
 *
 * ## The escaping is load-bearing, not decoration
 *
 * The dashboard pages live at `src/app/[locale]/(dashboard)/`. Written into a
 * glob as it appears on disk, that is NOT a path: `[locale]` is a character
 * class matching one of `l o c a e`, and `(dashboard)` is a group. Measured
 * against this tree, the unescaped pattern matches **0 files** and the escaped
 * one matches **26** — so the obvious spelling would have dropped every route
 * out of the measurement while the percentage went UP and nothing said a word.
 * That is the silent-narrowing failure `criticalModulesNote` in
 * `.github/ci-baselines/coverage-baseline.unit.json` already records once.
 *
 * `apps/web/tests/security.test.ts` expands these patterns against the real
 * tree and asserts each root resolves to files, so the trap cannot come back by
 * somebody "tidying" the backslashes away.
 */
export const COVERAGE_INCLUDE = [
  'src/features/crm/**',
  'src/features/vehicles/**',
  'src/app/\\[locale\\]/\\(dashboard\\)/**',
  'src/lib/**',
];

/**
 * Excluded: nothing.
 *
 * This is a decision, not an oversight, and it is recorded here because an
 * empty exclusion list is exactly what a reader assumes was forgotten.
 *
 * The four roots above were searched for the classes that genuinely cannot be
 * executed by a unit tier, and this tree contains none of them: no `.d.ts`
 * (declarations emit no runtime statement), no barrel `index.ts` (v8 attributes
 * a re-export to the defining module as well, so counting a barrel counts the
 * same statement twice), no generated output, and no non-TypeScript file.
 * Adding those patterns anyway would be worse than useless — `coverage-gate.mjs`
 * refuses a critical-module rule that matches nothing precisely because a rule
 * matching nothing is indistinguishable from a rule that works.
 *
 * The `'use server'` action modules are NOT excluded even though they are server
 * code: sixteen of them sit under `features/crm` and `features/vehicles` and the
 * suite already drives them to 96-98%, so "server code cannot be unit-tested"
 * would be a false claim about this repository.
 *
 * What is left in and scores badly stays in. `src/app/[locale]/(dashboard)/**`
 * is async React Server Components at near zero, and `src/lib/format.ts` and
 * `src/lib/use-persisted-flag.ts` are at zero outright. Those zeros are the
 * finding; excluding them would delete the finding and raise the number, which
 * is the one way a coverage configuration can lie.
 */
export const COVERAGE_EXCLUDE: readonly string[] = [];

export default defineConfig({
  test: {
    /**
     * Coverage is declared HERE, at the root of the config, not inside either
     * project: with `projects`, Vitest reads `coverage` from the root
     * configuration only, and a per-project block is ignored WITHOUT a warning.
     * One provider, one report, both tiers merged — which is right, because
     * `logic` and `dom` are two environments over one application, not two
     * applications.
     *
     * `provider: 'v8'` with the `json-summary` reporter follows the API tier
     * (repository-root `vitest.config.ts`) rather than inventing a second style:
     * `scripts/ci/coverage-gate.mjs` reads `coverage-summary.json` and compares
     * it to a committed baseline, and a second provider would mean two sets of
     * rounding conventions for one gate to interpret.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'json'],
      reportsDirectory: 'coverage/web',
      /**
       * Files no test imports are still measured, at 0%. Without this a screen
       * nothing loads simply leaves the denominator, and the tier reports a
       * flattering number for the small part of itself it happens to touch.
       * It also arms the trap this project has already written down: a
       * percentage can FALL because v8 newly ENTERS code that was never loaded
       * before. With `all`, that code was in the denominator all along, so the
       * fall shows up as the coverage work it is rather than as a surprise.
       */
      all: true,
      include: [...COVERAGE_INCLUDE],
      exclude: [...COVERAGE_EXCLUDE],
    },
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'logic',
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
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.dom.test.ts', 'tests/**/*.dom.test.tsx'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          testTimeout: 30_000,
          hookTimeout: 30_000,
          environment: 'jsdom',
          include: ['tests/**/*.dom.test.tsx', 'tests/**/*.dom.test.ts'],
          setupFiles: ['./tests/setup.dom.ts'],
        },
      },
    ],
  },
});
