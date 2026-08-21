import { join, resolve } from 'node:path';

/**
 * The browser suite's origin, in one place.
 *
 * `playwright.config.ts` and `authenticated/auth.setup.ts` both need it, and
 * they used to state it separately — the config built the base URL, the setup
 * hard-coded the path it wrote the captured session to. Two statements of one
 * fact is how they drift, and this pair drifting is not a visible failure: the
 * setup writes a jar the projects never read, so every authenticated spec starts
 * signed out and fails as though authentication had regressed.
 *
 * `localhost`, not the loopback literal, because that is the canonical local
 * origin (`P1-26-F-062`). A browser suite pointed at an origin the Owner is told
 * never to open is testing a configuration nobody uses.
 */
export const E2E_HOST = 'localhost';

/**
 * 3210, deliberately not the 3100 development port: this is a separate
 * `next start` production server, kept clear of the dev server so the two can
 * never contend for a port or a build directory.
 */
export const E2E_PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3210);

export const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`;

/**
 * The API the authenticated specs talk to directly.
 *
 * The API is started with `--hostname localhost`, so the loopback literal here
 * would not merely be a different origin — it would refuse the connection
 * outright. `scripts/dev/dev-config.mjs` holds the same value as `API_ORIGIN`;
 * a root test asserts the two agree.
 */
export const E2E_API_ORIGIN = process.env.ROOTLCO_API_BASE_URL ?? `http://${E2E_HOST}:3000`;

/** Playwright runs with the config directory as cwd, which is `apps/web`. */
export const REPO_ROOT = resolve(process.cwd(), '..', '..');

/**
 * The captured session, named after the origin it belongs to.
 *
 * Cookies are scoped by host string: a jar captured against `127.0.0.1`
 * presents nothing to `localhost`. Encoding the origin in the filename means
 * changing the origin cannot silently reuse a foreign jar — the file is simply
 * absent and `auth.setup` captures a fresh one.
 */
export const E2E_STORAGE_STATE = join(
  REPO_ROOT,
  '.local',
  'e2e',
  `owner-state-${E2E_HOST}-${E2E_PORT}.json`
);
