import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as devConfig from '../../scripts/dev/dev-config.mjs';
import {
  API_HOST,
  API_ORIGIN,
  API_PORT,
  BROWSER_HOST,
  DEV_DIST_DIR,
  DEV_HOST,
  WEB_HOST,
  WEB_ORIGIN,
  WEB_PORT,
} from '../../scripts/dev/dev-config.mjs';

/**
 * `P1-26-F-048` — the launcher must advertise `localhost`, never `127.0.0.1`.
 *
 * Next 16 refuses cross-origin requests for its own development resources and
 * decides "cross-origin" by comparing the request Host with its own. `next dev`
 * reports itself as `localhost`, so a browser on `http://127.0.0.1:3100` is a
 * different origin by that test: the hot-reload WebSocket handshake is refused
 * with `ERR_INVALID_HTTP_RESPONSE`, Next's dev client retries for ever, and
 * while it does the App Router client never becomes interactive.
 *
 * The visible symptom is not a missing hot reload. It is that **no `useEffect`
 * in any client component runs**, so every server-driven table sits at
 * `aria-busy="true"` with no rows, on every screen, permanently — an
 * application that looks completely rendered and does nothing.
 *
 * The launcher used to print `127.0.0.1`, so the address a developer or the
 * Product Owner was told to open was exactly the one that does not work.
 *
 * These cases exist because no other tier can catch it: the browser suite runs
 * `next start` against a production build, which has no development socket, and
 * the jsdom tier has no server at all. The one configuration people actually
 * use is the one nothing exercises, so the guard has to be here.
 */

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Comments are stripped before any forbidden-pattern scan.
 *
 * Every file below EXPLAINS the hazard, and the explanation necessarily names
 * the address being forbidden. A scanner that cannot tell prose from code would
 * be satisfied only by deleting the reasoning.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/(^|\n)\s*#.*$/gm, '$1');

/**
 * Everything that is allowed to state a local origin.
 *
 * The previous version of this gate scanned two files for one pattern — a
 * printed `http://127.0.0.1:${WEB_PORT}` in `start-local.mjs` or
 * `status-local.mjs`. That is why `P1-26-F-062` survived it in five separate
 * places at once: the launcher's `NEXT_PUBLIC_API_BASE_URL` used the API port,
 * not the web port; and nothing under `scripts/dev/owner-acceptance/`,
 * `apps/web/src/lib/`, or the browser configuration was scanned at all.
 */
const ACTIVE_ORIGIN_AUTHORITIES = [
  'scripts/dev/dev-config.mjs',
  'scripts/dev/start-local.mjs',
  'scripts/dev/status-local.mjs',
  'scripts/dev/stop-local.mjs',
  'scripts/dev/owner-acceptance/full-cycle.mjs',
  'scripts/dev/owner-acceptance/create-owner-account.mjs',
  'scripts/dev/owner-acceptance/status-owner-account.mjs',
  'apps/web/src/lib/env.ts',
  'apps/web/.env.example',
  'apps/web/playwright.config.ts',
  'apps/web/tests/e2e/origin.ts',
];

describe('the local launcher advertises an origin Next will serve', () => {
  it('names localhost as the one development host', () => {
    expect(DEV_HOST).toBe('localhost');
    // One value, several names. They existed separately once and drifted.
    expect(API_HOST).toBe(DEV_HOST);
    expect(WEB_HOST).toBe(DEV_HOST);
    expect(BROWSER_HOST).toBe(DEV_HOST);
  });

  it('publishes the canonical origins the whole repository derives from', () => {
    expect(API_ORIGIN).toBe('http://localhost:3000');
    expect(WEB_ORIGIN).toBe('http://localhost:3100');
    expect(API_PORT).toBe(3000);
    expect(WEB_PORT).toBe(3100);
  });

  /**
   * The constant that had to go.
   *
   * `PROBE_HOST = '127.0.0.1'` was defensible while the servers bound
   * `0.0.0.0`, which answers on every loopback address. Once they are started
   * with `--hostname localhost` they bind ONE address family — measured as
   * `::1` on the Owner's machine — and a probe on the literal is refused
   * outright, so the launcher waits its whole readiness timeout and then
   * reports a stack that is running perfectly as dead.
   */
  it('no longer offers a second host constant to disagree with', () => {
    expect(Object.keys(devConfig)).not.toContain('PROBE_HOST');
  });

  it('starts every tier on an explicit hostname rather than a default bind', () => {
    // Next 16 defaults to 0.0.0.0. A default bind answers on every loopback
    // address at once, which is exactly what let the configured host and the
    // advertised host disagree without anything failing.
    //
    // Both tiers used to spell their argv out separately, so this counted two
    // occurrences. `P1-26-F-063` gave them one shared `tierArgs`, so the right
    // assertion is that the single builder pins the host and that both tiers go
    // through it.
    const launcher = code('scripts/dev/start-local.mjs');
    expect(launcher).toMatch(/'--hostname',\s*DEV_HOST/);
    expect(launcher).toMatch(/export function tierArgs/);
    expect(launcher).toMatch(/spawn\(process\.execPath,\s*tierArgs\(tier\)/);
  });

  it('agrees with the API origin the web tier defaults to', () => {
    // A launcher that advertises the right host while the bundle is built for
    // another one is the defect, not the fix.
    expect(read('apps/web/src/lib/env.ts')).toContain(API_ORIGIN);
    expect(read('apps/web/.env.example')).toContain(`NEXT_PUBLIC_API_BASE_URL=${API_ORIGIN}`);
  });

  it('recommends localhost in what dev:all and dev:status actually print', () => {
    for (const file of ['scripts/dev/start-local.mjs', 'scripts/dev/status-local.mjs']) {
      const source = code(file);
      expect(source, `${file} must build its printed URLs from the canonical origins`).toMatch(
        /WEB_ORIGIN|API_ORIGIN/
      );
    }
    // The launcher must name the login route the Owner is told to open. Built
    // from WEB_ORIGIN now rather than written as a bare literal.
    const launcher = code('scripts/dev/start-local.mjs');
    expect(launcher).toMatch(/\/en\/login/);
    expect(launcher).toMatch(/\/ar\/login/);
  });

  it('points the browser suite at the canonical host', () => {
    expect(code('apps/web/tests/e2e/origin.ts')).toContain("E2E_HOST = 'localhost'");
    // And the production server it drives is pinned to the same host, so the
    // suite cannot pass against an address the base URL does not name.
    expect(code('apps/web/playwright.config.ts')).toMatch(/--hostname \$\{HOST\}/);
  });

  it('states no active local origin on the loopback literal', () => {
    // The decisive assertion, and it is decisive only because the list above is
    // wider than the two files the previous version looked at.
    for (const file of ACTIVE_ORIGIN_AUTHORITIES) {
      expect(code(file), `${file} must not name a local origin on 127.0.0.1`).not.toMatch(
        /http:\/\/127\.0\.0\.1:(3000|3100|3210)/
      );
    }
  });

  it('scans real files, so the rule above is not vacuous', () => {
    // A path list that has gone stale scans nothing and reports clean. Each
    // entry must exist and carry real content.
    expect(ACTIVE_ORIGIN_AUTHORITIES.length).toBeGreaterThanOrEqual(11);
    for (const file of ACTIVE_ORIGIN_AUTHORITIES) {
      expect(code(file).length, `${file} is missing or empty`).toBeGreaterThan(120);
    }
    // And the pattern it forbids is one that really can appear.
    expect(/http:\/\/127\.0\.0\.1:(3000|3100|3210)/.test('http://127.0.0.1:3100/en')).toBe(true);
    // Comment stripping must not be so eager that it hides real code.
    expect(code('scripts/dev/dev-config.mjs')).toContain('export const DEV_HOST');
  });

  /**
   * The override no gate can see.
   *
   * `apps/web/.env.local` is git-ignored and Next reads it in preference to the
   * schema default, so a stale one silently reinstates the whole defect on a
   * machine where every tracked file is correct. The launcher cannot fix
   * someone's own file, but it must not let it happen quietly.
   */
  it('notices an untracked .env.local that contradicts the canonical API origin', () => {
    const launcher = code('scripts/dev/start-local.mjs');
    expect(launcher).toContain('apps/web/.env.local');
    expect(launcher).toMatch(/NEXT_PUBLIC_API_BASE_URL\\s\*=/);
    // Compared against the canonical origin, not a literal spelled out again.
    expect(launcher).toMatch(/configured === API_ORIGIN/);
    // And the check must run before the servers are launched, or the warning
    // scrolls past underneath a Next boot log.
    const guard = launcher.indexOf('warnOnContradictingEnvLocal()');
    const launch = launcher.indexOf("launch(\n  'api'");
    expect(guard, 'the guard must be called').toBeGreaterThan(0);
    if (launch > 0) expect(guard).toBeLessThan(launch);
  });

  it('leaves the loopback security guards accepting every loopback form', () => {
    // Widening what a guard ACCEPTS is not the same decision as choosing what to
    // ADVERTISE. These must keep accepting all three, or a legitimate local
    // database target starts being refused.
    const guard = read('scripts/dev/owner-acceptance/context.mjs');
    for (const form of ['127.0.0.1', 'localhost', '::1']) {
      expect(guard, `the loopback allow-set must still accept ${form}`).toContain(`'${form}'`);
    }
  });
});

/**
 * `P1-26-F-055` — development and production must not share a build directory.
 *
 * `next dev`, `next build` and `next start` all default to `<app>/.next` and
 * write incompatible manifests there. Running one after the other in the same
 * checkout leaves the second reading the first one's output.
 *
 * It did real damage twice in one evening. It took the local stack down in the
 * middle of the authenticated suite, because the browser tier's `next start` and
 * the launcher's `next dev` were competing for one directory. Then it
 * manufactured a defect that did not exist: with a production build left in
 * `.next`, `next dev` answered **404** on the nested administration routes while
 * `/administration` answered 307, so the sign-in redirect looked broken in
 * development and correct in production. The routes were correct throughout. A
 * fix was written and nearly shipped before the contradiction gave it away —
 * removing a locale guard made a page that had been working start failing too,
 * which is not how a real fix behaves.
 *
 * Nothing else can catch this class: every automated tier builds once and runs
 * one server, so no suite ever switches modes in one directory. Only a person
 * developing locally does, which is why the guard lives here.
 */
describe('development and production build directories are isolated', () => {
  it('names a development directory that is not the production one', () => {
    expect(DEV_DIST_DIR).toBe('.next-dev');
    expect(DEV_DIST_DIR).not.toBe('.next');
  });

  it('the web config reads the directory from the environment, defaulting to .next', () => {
    // The default must stay `.next` so `next build`, `next start`, Docker, the
    // browser suite and CI are untouched. Only the dev launcher opts out.
    const config = read('apps/web/next.config.ts');
    expect(config).toMatch(/process\.env\.ROOTLCO_DIST_DIR\s*\?\?\s*'\.next'/);
    expect(config).toMatch(/distDir/);
  });

  it('the launcher actually passes the isolated directory to the web server', () => {
    // A configuration that reads an environment variable nobody sets is not
    // isolation — it is a default with extra steps.
    const source = read('scripts/dev/start-local.mjs');
    expect(source).toMatch(/ROOTLCO_DIST_DIR:\s*DEV_DIST_DIR/);
  });

  it('clears a stale production build only for a tier it is about to start', () => {
    // Deleting a build directory a running server is reading would be a worse
    // bug than the one being fixed.
    //
    // The old proof was "after `assertPortFree` returned". That check is gone —
    // it was the `P1-26-F-063` defect, since a bind probe cannot see a listener
    // on another address. The stronger guarantee replacing it: the clear happens
    // inside the loop over the tiers the plan says to START, so a tier that is
    // being ADOPTED is never touched.
    const source = code('scripts/dev/start-local.mjs');
    const decision = source.indexOf('planLocalStack(survey)');
    const loop = source.indexOf('for (const tier of toStart)');
    const clear = source.indexOf('clearStaleProductionBuild(tier)');
    expect(decision, 'the launcher must decide before it clears anything').toBeGreaterThan(0);
    expect(loop, 'the clear must be driven by the tiers being started').toBeGreaterThan(decision);
    expect(clear, 'the clear must happen inside that loop').toBeGreaterThan(loop);
    // And it must never be reachable for an adopted stack.
    expect(source.indexOf("=== 'ADOPT_EXISTING'")).toBeLessThan(clear);
  });

  it('discriminates a production build by a marker next dev never writes', () => {
    // `BUILD_ID` is written by `next build` and never by `next dev`, so its
    // presence is what distinguishes the two. Matching on the directory merely
    // existing would delete a healthy dev cache on every start.
    const source = read('scripts/dev/start-local.mjs');
    expect(source).toMatch(/BUILD_ID/);
  });

  it('keeps the development directory out of Git', () => {
    expect(read('.gitignore')).toMatch(/^\.next-dev\/$/m);
  });

  /**
   * P1-26-F-060. Introducing a second build directory told Git about it and
   * nothing else. ESLint then linted ten thousand generated chunks and Prettier
   * refused the same files — but only for a developer, because CI never runs
   * `next dev` and so never has the directory to trip over. A gate that cannot
   * fail in CI is a gate that only ever fails on someone's machine.
   *
   * Every tool that walks the workspace has to be told, so every tool is named
   * here rather than trusting the one that happened to break first.
   */
  it.each([
    ['apps/web/eslint.config.mjs', /'\.next-dev\/\*\*'/],
    ['apps/web/.prettierignore', /^\.next-dev$/m],
    ['.prettierignore', /^\.next-dev$/m],
    ['eslint.config.mjs', /'\.next-dev\/\*\*'/],
  ])('keeps the development build directory out of %s', (file, pattern) => {
    expect(read(file), `${file} must ignore ${DEV_DIST_DIR}`).toMatch(pattern);
  });

  /**
   * The same omission one directory over. `.local` holds dev state, the
   * acceptance credentials and the dedicated Chrome profile; ESLint walked that
   * profile's bundled scripts and reported 25,508 problems. Git ignores the
   * directory, but neither ESLint nor Prettier reads `.gitignore`.
   */
  it.each([
    ['eslint.config.mjs', /'\.local\/\*\*'/],
    ['.prettierignore', /^\.local$/m],
  ])('keeps the local-only directory out of %s', (file, pattern) => {
    expect(read(file), `${file} must ignore .local`).toMatch(pattern);
  });

  it('names the same directory in every ignore list', () => {
    // The assertions above hard-code `.next-dev`; if DEV_DIST_DIR is ever
    // renamed they would silently keep passing against a directory nothing
    // builds into any more.
    expect(DEV_DIST_DIR).toBe('.next-dev');
  });
});
