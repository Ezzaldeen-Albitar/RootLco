/**
 * The one place the local topology is written down.
 *
 * API on 3000 because the web tier's default API base is
 * `http://127.0.0.1:3000` (`apps/web/src/lib/env.ts`) — the two values must
 * agree, and this file plus that schema are the complete list of places the
 * port lives. Web on 3100: out of the way of the API, of Supabase (54321–54324)
 * and of the Playwright web server (3210).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const API_PORT = 3000;
export const WEB_PORT = 3100;
export const API_READY_PATH = '/api/v1/health/ready';

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
 * `next.config.ts`'s `allowedDevOrigins` is the documented alternative and was
 * tried first: on this Next version it made every route answer 500 with a JSON
 * parse failure inside the framework, twice, reproducibly. Serving the origin
 * Next already trusts is the smaller and safer correction.
 */
export const BROWSER_HOST = 'localhost';

/** The loopback literal, for server-to-server probes where origin is irrelevant. */
export const PROBE_HOST = '127.0.0.1';

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
