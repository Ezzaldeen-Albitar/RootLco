import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_HOST,
  PROBE_HOST,
  API_PORT,
  DEV_DIST_DIR,
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

describe('the local launcher advertises an origin Next will serve', () => {
  it('names localhost as the browser host', () => {
    expect(BROWSER_HOST).toBe('localhost');
  });

  it('keeps the loopback literal for server-to-server probes only', () => {
    // Probes are not subject to the origin rule and should not depend on name
    // resolution, so they stay on the literal.
    expect(PROBE_HOST).toBe('127.0.0.1');
    expect(BROWSER_HOST).not.toBe(PROBE_HOST);
  });

  it('still agrees with the ports the web tier defaults to', () => {
    // A launcher that advertises the right host on the wrong port is no better.
    expect(API_PORT).toBe(3000);
    expect(WEB_PORT).toBe(3100);
    expect(read('apps/web/src/lib/env.ts')).toContain(`127.0.0.1:${API_PORT}`);
  });

  it('prints no bare 127.0.0.1 URL for a human to open', () => {
    // The decisive assertion. A printed `http://127.0.0.1:<web port>` is the
    // defect itself: it is an instruction to open the broken origin.
    for (const file of ['scripts/dev/start-local.mjs', 'scripts/dev/status-local.mjs']) {
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
      expect(source, `${file} must not print a browser URL on the loopback literal`).not.toMatch(
        /`http:\/\/127\.0\.0\.1:\$\{WEB_PORT\}/
      );
    }
  });

  it('scans real files, so the rule above is not vacuous', () => {
    for (const file of ['scripts/dev/start-local.mjs', 'scripts/dev/status-local.mjs']) {
      expect(read(file).length, file).toBeGreaterThan(500);
    }
    // And the pattern it forbids is one that really can appear.
    //
    // The sample is a template literal with the `$` escaped, so it is the exact
    // text `http://127.0.0.1:${WEB_PORT}/en` without being a quoted string that
    // merely looks interpolated — `js/template-syntax-in-string-literal` flags
    // that shape, and here it would be flagging the one place the shape is the
    // point.
    const sample = `\`http://127.0.0.1:\${WEB_PORT}/en\``;
    expect(/`http:\/\/127\.0\.0\.1:\$\{WEB_PORT\}/.test(sample)).toBe(true);
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

  it('clears a stale production build only after the ports are proven free', () => {
    // Deleting a build directory a running server is reading would be a worse
    // bug than the one being fixed. `assertPortFree` returning is the proof that
    // nothing is listening, so the clear must come after both calls.
    const source = read('scripts/dev/start-local.mjs');
    const lastAssert = source.lastIndexOf('await assertPortFree');
    const clear = source.indexOf('clearStaleProductionBuild(');
    const callSite = source.indexOf("clearStaleProductionBuild('api')");
    expect(lastAssert, 'the launcher must assert both ports are free').toBeGreaterThan(0);
    expect(clear, 'the launcher must be able to clear a stale build').toBeGreaterThan(0);
    expect(callSite, 'the API build directory must actually be checked').toBeGreaterThan(
      lastAssert
    );
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
});
