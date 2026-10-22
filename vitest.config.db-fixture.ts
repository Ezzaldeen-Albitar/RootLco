import { defineConfig } from 'vitest/config';
import { API_SRC_ROOT } from './scripts/lib/repository-paths.mjs';

/*
 * The privileged export-fixture writer's own runner (P1-31-QA-002).
 *
 * ## Why this is a second database configuration and not one more include
 *
 * `tests/db/p1-31-export-fixture.test.ts` is the only database file in this
 * repository that must NOT be pointed at the database the rest of the tier uses.
 * It installs a scoped, expiring privileged role on a real principal, so its
 * `beforeAll` refuses to run when `current_database()` is `postgres`. That
 * refusal is the point of it and is never to be relaxed into a skip: a skip on
 * that condition would report "nothing to see" on precisely the environment the
 * refusal exists to protect.
 *
 * `postgres` is also the name `tests/db/helpers.ts` falls back to and the name
 * every hosted database job supplies, so the file cannot live in
 * `vitest.config.db.ts` without making `npm run test:db` and
 * `npm run verify:database` fail for everybody — on the protected branch, in
 * protected verification, in the clean room, nightly and locally. Separating the
 * runner is the only fix that leaves both true: the shared tier stays green
 * against the shared database, and this file still refuses it.
 *
 * ## What running it costs, stated rather than implied
 *
 * A DISPOSABLE database in the local cluster, built by
 * `scripts/db/apply-migrations.mjs` plus the seven files of `supabase/seeds/` in
 * numeric order, with `DB_NAME` pointing at it:
 *
 *   npm run test:db-fixture
 *
 * NO hosted job runs this configuration, and that is a deliberate consequence of
 * the separation rather than an oversight — no hosted job has a disposable
 * database to give it. It is registered `environment` in
 * `scripts/ci/check-command-coverage.mjs` for exactly that reason, and the
 * closing-run procedure names the command and the database so the proof is taken
 * as an explicit operator step.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/p1-31-export-fixture.test.ts'],
    // One file today, and serial regardless: this configuration is database-bound,
    // so it carries the same rule `vitest.config.db.ts` carries rather than relying
    // on the include list staying a single entry.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { '@api': API_SRC_ROOT, '@': API_SRC_ROOT },
  },
});
