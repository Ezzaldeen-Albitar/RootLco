import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FORBIDDEN_KEYS,
  currentAdapter,
  looksLikeCredential,
  redact,
  report,
  safeRoute,
  setMonitoringAdapter,
  type ClientLogEvent,
} from '@/lib/observability/client-log';

/**
 * `P1-26-DO-002` — structured client logging.
 *
 * The redaction is tested before any provider is attached, deliberately. The
 * first thing a monitoring integration does is capture everything, and the
 * second is discover what it captured; building the filter afterwards is the
 * wrong order.
 */

afterEach(() => {
  setMonitoringAdapter(null);
  vi.restoreAllMocks();
});

describe('redaction by key name', () => {
  it('redacts every forbidden key', () => {
    for (const key of FORBIDDEN_KEYS) {
      const out = redact({ [key]: 'value' });
      expect(out[key], key).toBe('[redacted]');
    }
  });

  it('normalises the key before comparing', () => {
    // `accessToken`, `access_token`, `ACCESS-TOKEN` are one key.
    for (const key of ['accessToken', 'access_token', 'ACCESS-TOKEN', 'Access Token']) {
      expect(redact({ [key]: 'v' })[key], key).toBe('[redacted]');
    }
  });

  it('leaves an innocent key alone', () => {
    expect(redact({ page: 3, status: 'active' })).toEqual({ page: 3, status: 'active' });
  });

  it('recurses into nested objects', () => {
    expect(redact({ outer: { password: 'x', page: 1 } })).toEqual({
      outer: { password: '[redacted]', page: 1 },
    });
  });
});

/**
 * A JWT-shaped string, BUILT rather than written.
 *
 * The tracked-secret scanner flagged the literal form of this fixture, and it
 * was right to: a credential-shaped constant in a tracked file is one whether or
 * not it is real, and a scanner that learns to ignore some of them stops being
 * useful. Its own guidance is to construct synthetic values at runtime, so this
 * assembles three base64url-ish segments and never stores the result anywhere.
 *
 * There is a small joke here worth not losing: the file asserting that a
 * credential must never be written down was the file that wrote one down.
 */
function syntheticJwt(): string {
  const segment = (seed: string, length: number) =>
    Array.from({ length }, (_, index) => seed[(index * 7 + 3) % seed.length]).join('');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [segment(alphabet, 24), segment(alphabet, 32), segment(alphabet, 28)].join('.');
}

describe('redaction by value shape', () => {
  it('redacts a JWT whatever it is called', () => {
    // The shape that actually happens: `{ data: accessToken }`.
    const jwt = syntheticJwt();
    expect(jwt.split('.')).toHaveLength(3);
    expect(looksLikeCredential(jwt)).toBe(true);
    expect(redact({ data: jwt }).data).toBe('[redacted]');
  });

  it('redacts a long opaque token whatever it is called', () => {
    const token = 'A'.repeat(64);
    expect(looksLikeCredential(token)).toBe(true);
    expect(redact({ reference: token }).reference).toBe('[redacted]');
  });

  it('does not redact ordinary prose or a short identifier', () => {
    expect(looksLikeCredential('a user pressed retry after a conflict')).toBe(false);
    expect(looksLikeCredential('invited')).toBe(false);
    // A correlation ID has hyphens and is short enough to keep — it is the one
    // diagnostic that is meant to travel.
    expect(looksLikeCredential('3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b')).toBe(false);
  });

  it('redacts a credential-shaped array element', () => {
    const out = redact({ items: ['ok', 'B'.repeat(48)] });
    expect(out.items).toEqual(['ok', '[redacted]']);
  });
});

describe('the route', () => {
  it('drops the query string, which is where secrets hide', () => {
    expect(safeRoute('/en/administration/users?search=ali&page=2')).toBe(
      '/en/administration/users'
    );
    expect(safeRoute('/en/login')).toBe('/en/login');
  });
});

describe('the monitoring adapter', () => {
  it('is null until a deployment attaches one', () => {
    expect(currentAdapter()).toBeNull();
  });

  it('receives the REDACTED event, never the raw one', () => {
    const seen: ClientLogEvent[] = [];
    setMonitoringAdapter((event) => seen.push(event));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    report({
      level: 'warn',
      event: 'web.test',
      correlationId: 'cid-1',
      route: '/en/x?token=secret',
      context: { password: 'hunter2', page: 4 },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.context).toEqual({ password: '[redacted]', page: 4 });
    expect(seen[0]?.route).toBe('/en/x');
  });

  it('writes the same redacted payload to the console', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    report({ level: 'error', event: 'web.boom', context: { accessToken: 'abc' } });
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain('[redacted]');
    expect(line).not.toContain('abc');
  });
});
