import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BROWSER_HOST, PROBE_HOST, API_PORT, WEB_PORT } from '../../scripts/dev/dev-config.mjs';

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
