/**
 * Offline bearer-token verification (P1-14, ADR-019).
 *
 * Every protected request presents a provider-issued JWT. Verifying it against
 * the provider over the network on every request would make authentication as
 * available as the provider and as fast as a round trip; verifying it locally
 * against the signing key is the standard answer, and it is only safe if the
 * verifier is strict about the things JWT libraries are historically lax about:
 *
 *  - **The verifier chooses the algorithm, not the token.** The `alg` header is
 *    attacker-controlled. `alg: none` and RS256→HS256 confusion both work
 *    against verifiers that read the algorithm out of the token and then do what
 *    it says. Here the header must appear in a configured allow-list, and the
 *    verification routine is selected from the allow-list entry.
 *  - **Signature comparison is timing-safe** and length-checked before
 *    comparison, because `timingSafeEqual` throws on a length mismatch and a
 *    naive `===` leaks the prefix length.
 *  - **`iss`, `aud`, and `exp` are all required**, and `nbf`/`iat` are honoured
 *    when present. A token that omits `exp` is rejected rather than treated as
 *    eternal.
 *  - **Clock skew is bounded** by configuration. Unbounded skew turns `exp` into
 *    a suggestion.
 *
 * Only HMAC algorithms are implemented. That is a deliberate limit, not an
 * oversight: the provider of record issues HS256, and an unexercised RSA path
 * with an unfetched JWKS would be untested code on the authentication boundary.
 * An asymmetric algorithm in the allow-list is refused explicitly, so
 * misconfiguration fails closed instead of silently accepting.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderFailure, type VerifiedToken } from './identity-provider';

/** HMAC algorithms this verifier implements, mapped to their digest. */
const HMAC_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
});

export interface TokenVerifierOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: readonly string[];
  readonly clockSkewSeconds: number;
  /** Injectable clock so expiry behaviour is deterministic under test. */
  readonly now?: () => number;
}

interface JwtHeader {
  readonly alg?: unknown;
  readonly typ?: unknown;
}

interface JwtPayload {
  readonly sub?: unknown;
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly nbf?: unknown;
  readonly iat?: unknown;
  readonly email?: unknown;
  readonly session_id?: unknown;
  readonly app_metadata?: unknown;
}

function invalid(detail: string): ProviderFailure {
  // One reason for every verification failure. Telling a caller *which* check
  // failed hands an attacker a free oracle for iterating on a forged token.
  return new ProviderFailure('invalid-token', `Bearer token rejected: ${detail}`);
}

function decodeSegment(segment: string, label: string): unknown {
  let json: string;
  try {
    json = Buffer.from(segment, 'base64url').toString('utf8');
  } catch {
    throw invalid(`${label} is not base64url`);
  }
  try {
    return JSON.parse(json);
  } catch {
    throw invalid(`${label} is not JSON`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads a numeric claim, rejecting non-finite and non-numeric values. */
function numericClaim(value: unknown, label: string, required: boolean): number | null {
  if (value === undefined || value === null) {
    if (required) throw invalid(`${label} is missing`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${label} is not a number`);
  }
  return value;
}

/**
 * Matches the audience claim, which JWT allows to be a string or an array.
 * An array containing the expected audience is a match; anything else is not.
 */
function audienceMatches(claim: unknown, expected: string): boolean {
  if (typeof claim === 'string') return claim === expected;
  if (Array.isArray(claim)) return claim.some((entry) => entry === expected);
  return false;
}

/**
 * Verifies a compact JWS and returns the claims RootLco reads from it.
 *
 * Returns identity only. Nothing in the returned value is treated as
 * authorization: `tenantId` is a lookup key, and `sessionRef` is checked against
 * `iam.user_sessions` before it means anything.
 */
export function verifyBearerToken(token: string, options: TokenVerifierOptions): VerifiedToken {
  const nowMs = (options.now ?? Date.now)();
  const nowSeconds = Math.floor(nowMs / 1000);
  const skew = Math.max(0, Math.trunc(options.clockSkewSeconds));

  const parts = token.split('.');
  if (parts.length !== 3) throw invalid('not a three-part compact JWS');
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  const header = asRecord(decodeSegment(headerSegment, 'header')) as JwtHeader | null;
  if (!header) throw invalid('header is not an object');

  const alg = header.alg;
  if (typeof alg !== 'string') throw invalid('header declares no algorithm');
  // The allow-list is consulted before anything is computed, so `alg: none`
  // never reaches a code path that could decide to skip verification.
  if (!options.algorithms.includes(alg)) throw invalid('algorithm is not permitted');

  const digest = HMAC_DIGESTS[alg];
  if (!digest) {
    // Configured but unimplemented. Refusing loudly beats accepting quietly.
    throw new ProviderFailure(
      'provider-rejected',
      `Signing algorithm "${alg}" is allow-listed but this build implements HMAC algorithms only.`
    );
  }
  if (options.secret.length === 0) {
    throw new ProviderFailure(
      'provider-unavailable',
      'No signing secret is configured; bearer tokens cannot be verified.'
    );
  }

  const expected = createHmac(digest, options.secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest();
  const presented = Buffer.from(signatureSegment, 'base64url');
  // Length is compared first because timingSafeEqual throws on mismatched
  // lengths; the length of a signature is not a secret.
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw invalid('signature does not verify');
  }

  const payload = asRecord(decodeSegment(payloadSegment, 'payload')) as JwtPayload | null;
  if (!payload) throw invalid('payload is not an object');

  if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
    throw invalid('subject is missing');
  }
  if (payload.iss !== options.issuer) throw invalid('issuer does not match');
  if (!audienceMatches(payload.aud, options.audience)) throw invalid('audience does not match');

  const exp = numericClaim(payload.exp, 'expiry', true) as number;
  if (exp + skew <= nowSeconds) throw invalid('token has expired');

  const nbf = numericClaim(payload.nbf, 'not-before', false);
  if (nbf !== null && nbf - skew > nowSeconds) throw invalid('token is not yet valid');

  const iat = numericClaim(payload.iat, 'issued-at', false);
  if (iat !== null && iat - skew > nowSeconds) throw invalid('token was issued in the future');

  // `app_metadata` is provider-owned and not writable by the end user. It is
  // read as a lookup key only; ADR-019 rule 3.
  const appMetadata = asRecord(payload.app_metadata) ?? {};
  const tenantId = typeof appMetadata.tenant_id === 'string' ? appMetadata.tenant_id : null;

  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    tenantId,
    sessionRef: typeof payload.session_id === 'string' ? payload.session_id : null,
    expiresAt: new Date(exp * 1000),
  };
}
