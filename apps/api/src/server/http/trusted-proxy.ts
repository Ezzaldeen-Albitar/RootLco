/**
 * Trusted-proxy client-IP resolution (load-balancer readiness, P1-13-SEC-003).
 *
 * `X-Forwarded-For` is caller-controlled input. Behind a load balancer it is the
 * only way to see the real client; in front of one it is a free-form string an
 * attacker sets to whatever they like. Trusting it unconditionally means every
 * IP-keyed rate limit can be bypassed by adding one header — the single most
 * common rate-limiting defect.
 *
 * The rule here:
 *
 *  - forwarded headers are read **only** when the immediate peer is in the
 *    configured `TRUSTED_PROXY_IPS` allow-list;
 *  - the list is **empty by default**, so an un-configured deployment ignores
 *    forwarded headers entirely and falls back to the peer address;
 *  - the client IP is taken as the **right-most untrusted** entry, walking the
 *    chain from the proxy inward. Taking the left-most (the usual mistake) takes
 *    the first value the *client* wrote.
 *
 * When no peer address is available at all, resolution returns `null` and the
 * rate limiter degrades to its non-IP dimensions rather than bucketing every
 * caller together under a fabricated address.
 */
import { backendConfig } from '../config/backend-config';

export interface ClientAddressInput {
  /** The immediate peer address, from the platform (never from a header). */
  readonly peerAddress?: string | null;
  readonly headers: Headers;
}

export interface ClientAddress {
  readonly ip: string | null;
  /** True when the value came from a forwarded header via a trusted proxy. */
  readonly viaTrustedProxy: boolean;
}

function splitForwardedFor(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Normalises IPv6-mapped IPv4 and strips a port suffix. */
export function normalizeIp(value: string): string {
  let ip = value.trim();
  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end > 0) ip = ip.slice(1, end);
  } else if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }
  // Strip a trailing :port only for IPv4 — a bare IPv6 address is full of colons.
  const colonCount = (ip.match(/:/g) ?? []).length;
  if (colonCount === 1) ip = ip.slice(0, ip.indexOf(':'));
  return ip.toLowerCase();
}

/** Resolves the client address under the trusted-proxy policy. */
export function resolveClientAddress(input: ClientAddressInput): ClientAddress {
  const trusted = backendConfig().TRUSTED_PROXY_IPS.map(normalizeIp);
  const peer = input.peerAddress ? normalizeIp(input.peerAddress) : null;

  if (trusted.length === 0 || !peer || !trusted.includes(peer)) {
    // Not behind a configured proxy: forwarded headers are ignored completely.
    return { ip: peer, viaTrustedProxy: false };
  }

  const forwarded = input.headers.get('x-forwarded-for');
  if (!forwarded) return { ip: peer, viaTrustedProxy: false };

  const chain = splitForwardedFor(forwarded).map(normalizeIp);
  // Walk from the right (nearest proxy) and take the first address that is not
  // itself a trusted proxy: that is the outermost hop we still believe.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index];
    if (candidate && !trusted.includes(candidate)) {
      return { ip: candidate, viaTrustedProxy: true };
    }
  }
  return { ip: peer, viaTrustedProxy: true };
}
