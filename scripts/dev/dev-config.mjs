/**
 * The one place the local topology is written down.
 *
 * API on 3000 because the web tier's default API base is `API_ORIGIN` below
 * (`apps/web/src/lib/env.ts`) — the two values must agree, and this file plus
 * that schema are the complete list of places the port lives. Web on 3100: out
 * of the way of the API, of Supabase (54321–54324) and of the Playwright web
 * server (3210).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const API_PORT = 3000;
export const WEB_PORT = 3100;
export const API_READY_PATH = '/api/v1/health/ready';

/**
 * The web route used to decide "is the web tier serving?".
 *
 * `/en` is a redirect for an anonymous caller, and a redirect is a perfectly
 * good answer from a server that is up — but it is also what a half-configured
 * proxy returns, so it is a weak witness. `/en/login` renders a real page for
 * anyone and returns 200.
 */
export const WEB_READY_PATH = '/en/login';

/**
 * The host the BROWSER must use — and it must be `localhost`, not `127.0.0.1`
 * (`P1-26-F-048`).
 *
 * Next 16 refuses cross-origin requests for development resources, and it
 * decides "cross-origin" by comparing the request Host with its own. `next dev`
 * reports itself as `localhost`, so a browser on `http://127.0.0.1:3100` is a
 * different origin by that test: the hot-reload WebSocket handshake is refused
 * and the browser reports `ERR_INVALID_HTTP_RESPONSE`.
 *
 * The damage is far larger than a lost hot reload. Next's development client
 * retries that socket for ever, and while it does the App Router client never
 * becomes interactive — so **no `useEffect` in any client component runs**.
 * Every server-driven table stays at `aria-busy="true"` with no rows, on every
 * screen. The application looks fully rendered and is completely inert.
 *
 * The launcher previously advertised `127.0.0.1`, so the address a developer or
 * the Product Owner was told to open was precisely the one that does not work.
 * Nothing caught it: the browser suite runs `next start` against a production
 * build, which has no development socket, and the jsdom tier has no server at
 * all. The single configuration people actually use was the one nothing
 * exercised — it was found by signing in and looking at a table.
 *
 * Fixing the PRINTED address was only half of it. The launcher went on
 * *configuring* the loopback literal — `NEXT_PUBLIC_API_BASE_URL`, the browser's
 * API address and the source of the CSP `connect-src` — and so did the Owner's
 * own handoff file, the acceptance status command and the entire browser suite.
 * The address was advertised one way and configured another for a further two
 * rounds (`P1-26-F-062`). One name, everywhere, is the only version of this that
 * stays true.
 *
 * `next.config.ts`'s `allowedDevOrigins` is the documented alternative and was
 * tried first: on this Next version it made every route answer 500 with a JSON
 * parse failure inside the framework, twice, reproducibly. Serving the origin
 * Next already trusts is the smaller and safer correction.
 */
export const DEV_HOST = 'localhost';

/**
 * There is deliberately no second host constant any more.
 *
 * There used to be: `PROBE_HOST = '127.0.0.1'`, on the reasoning that a
 * server-to-server readiness probe is not subject to any origin rule and should
 * not depend on name resolution. That reasoning was sound only while the
 * servers bound `0.0.0.0`, which answers on every loopback address at once and
 * so forgave the mismatch.
 *
 * The servers are now started with `--hostname localhost` (`P1-26-F-062`),
 * because relying on a default bind is exactly the "configured one way,
 * advertised another" shape this whole finding is about. **A hostname binds one
 * address family, not both.** Measured on the Owner's machine:
 *
 *     dns.lookup('localhost', {all:true}) -> [::1, 127.0.0.1]   (verbatim order)
 *     server.listen(port, 'localhost')    -> bound ::1
 *     fetch('http://127.0.0.1:port')      -> ECONNREFUSED
 *     fetch('http://localhost:port')      -> 200
 *
 * So a probe on the literal against a server bound by name does not merely
 * bypass an origin check — it cannot connect at all, and the launcher waits its
 * full readiness timeout before failing. The two constants had to agree, and a
 * pair of values that must always agree is one value.
 *
 * Using ONE NAME everywhere is also what makes this portable. A name resolves
 * the same way for the bind and for the probe on any machine, so it does not
 * matter which family wins; a name for one and a literal for the other is a
 * coin toss that lands differently on Windows and on a Linux runner.
 *
 * Loopback SECURITY GUARDS are a different thing entirely and still accept
 * `127.0.0.1`, `localhost` and `::1` — see `owner-acceptance/context.mjs`.
 * Widening what a guard accepts is not the same as choosing what to advertise.
 */
export const API_HOST = DEV_HOST;
export const WEB_HOST = DEV_HOST;

/** The canonical local origins. Everything that names an address derives from these. */
export const API_ORIGIN = `http://${API_HOST}:${API_PORT}`;
export const WEB_ORIGIN = `http://${WEB_HOST}:${WEB_PORT}`;

/**
 * Retained name for the host a browser must open, now one of several views of
 * `DEV_HOST`. A test asserts every host constant is the same string, so they
 * cannot drift back apart.
 */
export const BROWSER_HOST = DEV_HOST;

/**
 * The build directory `next dev` uses, isolated from the production one —
 * `P1-26-F-055`.
 *
 * `next dev`, `next build` and `next start` all default to `<app>/.next` and
 * write incompatible manifests into it. Running one after the other in the same
 * checkout leaves the second reading the first one's output.
 *
 * That produced two real failures in a single evening. It took the local stack
 * down in the middle of the authenticated suite, because the browser tier's
 * `next start` and the launcher's `next dev` were fighting over one directory.
 * Then it manufactured a defect that did not exist: with a production build left
 * behind in `.next`, `next dev` answered **404** on the nested administration
 * routes while `/administration` answered 307 — so the sign-in redirect appeared
 * broken in development and correct in production. The routes were right the
 * whole time. A fix was written and very nearly shipped before the contradiction
 * gave it away: removing a locale guard made a page that had been fine start
 * failing too, which is not how a real fix behaves.
 *
 * `apps/web/next.config.ts` reads this through `ROOTLCO_DIST_DIR`, defaulting to
 * `.next` so `next build`, `next start`, Docker, the browser suite and CI are
 * untouched. Only the development launcher opts into a separate directory.
 */
export const DEV_DIST_DIR = '.next-dev';

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export const STATE_FILE = resolve(repoRoot(), '.local', 'dev-state.json');

/**
 * The single-instance lock (`P1-26-F-063`).
 *
 * Beside the state file and equally ignored, but a different thing: the state
 * file describes a stack, the lock describes a LAUNCHER. One can be valid while
 * the other is stale, which is why they are separate and why neither is taken
 * as proof of the other.
 */
export const LOCK_FILE = resolve(repoRoot(), '.local', 'dev-launch.lock');
