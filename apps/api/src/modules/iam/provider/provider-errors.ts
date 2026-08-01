/**
 * Provider failure → cataloged RootLco error (P1-14, ADR-019).
 *
 * One translation, used by every service that touches the provider, so no
 * handler invents its own mapping and no provider message reaches a caller.
 *
 * The mapping is deliberately lossy in one direction: `invalid-credentials`,
 * `invalid-token`, and `identity-unavailable` all become the same 401. A caller
 * learns that authentication failed and nothing else — not whether the address
 * exists, not whether the password was wrong, not whether the account is
 * suspended. The distinction is preserved in the structured log, keyed by
 * correlation ID, where it is useful and not exploitable.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { ProviderFailure, type ProviderFailureReason } from './identity-provider';

/** Coarse reason recorded in logs and metric labels. Never returned to a caller. */
export function providerReasonOf(error: unknown): ProviderFailureReason | 'unknown' {
  return error instanceof ProviderFailure ? error.reason : 'unknown';
}

/**
 * Converts a provider failure into a cataloged error.
 *
 * Anything that is not a `ProviderFailure` is rethrown unchanged — swallowing an
 * unrelated fault here would turn a genuine bug into a misleading 401.
 */
export function toAppFailureFromProvider(error: unknown): never {
  if (!(error instanceof ProviderFailure)) throw error;

  switch (error.reason) {
    case 'invalid-credentials':
    case 'invalid-token':
    case 'identity-unavailable':
      throw new AppFailure('ERR-IAM-002', {
        message: 'Authentication failed',
        cause: error,
      });
    case 'identity-conflict':
      throw new AppFailure('ERR-RES-002', {
        message: 'An identity already exists for that address',
        cause: error,
      });
    case 'provider-unavailable':
      throw new AppFailure('ERR-DEP-001', {
        message: 'The authentication provider is unavailable',
        cause: error,
      });
    case 'provider-rejected':
      // An application defect: we sent something the provider would not accept.
      // 500, not 400 — the caller cannot fix it by changing their request.
      throw new AppFailure('ERR-SYS-001', {
        message: 'The authentication provider rejected the request',
        cause: error,
      });
  }
}
