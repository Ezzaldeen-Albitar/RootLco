/**
 * Protects the single most common rate-limiting defect: trusting
 * `X-Forwarded-For`.
 *
 * Any caller can set that header, so an unconditional read hands every caller the
 * ability to choose their own rate-limit identity — one header and the limit is
 * gone. Two rules make it safe, and both are only real if the negative case is
 * tested: forwarded headers are read *only* when the immediate peer is an
 * explicitly configured proxy, and the client is the **right-most untrusted**
 * entry rather than the left-most one the client itself wrote.
 *
 * The configured list is empty by default, so the un-configured deployment — the
 * one that actually exists today — is the case asserted first.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { normalizeIp, resolveClientAddress } from '@/server/http/trusted-proxy';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';

const PROXY = '10.0.0.1';
const SECOND_PROXY = '10.0.0.2';
const REAL_CLIENT = '198.51.100.5';
const FORGED_CLIENT = '203.0.113.9';

const originalTrustedProxies = process.env.TRUSTED_PROXY_IPS;

/** Sets the allow-list for one test and rebuilds the memoised configuration. */
function withTrustedProxies(value: string | undefined): void {
  if (value === undefined) delete process.env.TRUSTED_PROXY_IPS;
  else process.env.TRUSTED_PROXY_IPS = value;
  __resetBackendConfigForTests();
}

afterEach(() => {
  withTrustedProxies(originalTrustedProxies);
});

describe('un-configured deployment', () => {
  it('ignores a forged X-Forwarded-For and uses the peer address', () => {
    withTrustedProxies('');

    const resolved = resolveClientAddress({
      peerAddress: REAL_CLIENT,
      headers: new Headers({ 'x-forwarded-for': FORGED_CLIENT }),
    });

    expect(resolved.ip).toBe(REAL_CLIENT);
    expect(resolved.viaTrustedProxy).toBe(false);
  });

  it('ignores the header even when it names a plausible chain', () => {
    withTrustedProxies('');

    const resolved = resolveClientAddress({
      peerAddress: PROXY,
      headers: new Headers({ 'x-forwarded-for': `${FORGED_CLIENT}, ${REAL_CLIENT}` }),
    });

    expect(resolved.ip).toBe(PROXY);
    expect(resolved.viaTrustedProxy).toBe(false);
  });

  it('returns null rather than bucketing every caller under a fabricated address', () => {
    withTrustedProxies('');

    const resolved = resolveClientAddress({ peerAddress: null, headers: new Headers() });
    expect(resolved.ip).toBeNull();
    expect(resolved.viaTrustedProxy).toBe(false);
  });
});

describe('configured trusted proxy', () => {
  it('takes the right-most untrusted entry, not the left-most one the client wrote', () => {
    withTrustedProxies(`${PROXY},${SECOND_PROXY}`);

    const resolved = resolveClientAddress({
      peerAddress: PROXY,
      headers: new Headers({
        'x-forwarded-for': `${FORGED_CLIENT}, ${REAL_CLIENT}, ${SECOND_PROXY}`,
      }),
    });

    expect(resolved.ip).toBe(REAL_CLIENT);
    expect(resolved.ip).not.toBe(FORGED_CLIENT);
    expect(resolved.viaTrustedProxy).toBe(true);
  });

  it('still ignores the header when the peer is not the configured proxy', () => {
    withTrustedProxies(PROXY);

    const resolved = resolveClientAddress({
      peerAddress: '192.0.2.10',
      headers: new Headers({ 'x-forwarded-for': FORGED_CLIENT }),
    });

    expect(resolved.ip).toBe('192.0.2.10');
    expect(resolved.viaTrustedProxy).toBe(false);
  });

  it('falls back to the peer when the trusted proxy sent no forwarded header', () => {
    withTrustedProxies(PROXY);

    const resolved = resolveClientAddress({ peerAddress: PROXY, headers: new Headers() });
    expect(resolved.ip).toBe(PROXY);
    expect(resolved.viaTrustedProxy).toBe(false);
  });

  it('falls back to the peer when every chain entry is itself a trusted proxy', () => {
    withTrustedProxies(`${PROXY},${SECOND_PROXY}`);

    const resolved = resolveClientAddress({
      peerAddress: PROXY,
      headers: new Headers({ 'x-forwarded-for': `${SECOND_PROXY}, ${PROXY}` }),
    });

    expect(resolved.ip).toBe(PROXY);
    expect(resolved.viaTrustedProxy).toBe(true);
  });

  it('tolerates whitespace and an IPv6-mapped peer in the configured list', () => {
    withTrustedProxies(` ::ffff:${PROXY} , ${SECOND_PROXY} `);

    const resolved = resolveClientAddress({
      peerAddress: `::ffff:${PROXY}`,
      headers: new Headers({ 'x-forwarded-for': `${FORGED_CLIENT}, ${REAL_CLIENT}` }),
    });

    expect(resolved.ip).toBe(REAL_CLIENT);
    expect(resolved.viaTrustedProxy).toBe(true);
  });
});

describe('normalizeIp', () => {
  it('unwraps an IPv6-mapped IPv4 address', () => {
    expect(normalizeIp('::ffff:192.0.2.128')).toBe('192.0.2.128');
  });

  it('unwraps a bracketed IPv6 address and keeps its colons', () => {
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIp('[2001:DB8::1]')).toBe('2001:db8::1');
  });

  it('strips a port suffix from an IPv4 address only', () => {
    expect(normalizeIp('203.0.113.7:5555')).toBe('203.0.113.7');
    // A bare IPv6 address is full of colons and must survive intact.
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('trims surrounding whitespace and lower-cases', () => {
    expect(normalizeIp('  2001:DB8::AB  ')).toBe('2001:db8::ab');
  });
});
