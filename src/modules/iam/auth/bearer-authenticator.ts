/**
 * The real `SessionAuthenticator` (P1-14, fills the P1-13-BE-004 seam).
 *
 * Phase 1-13 installed `UnconfiguredAuthenticator`, which returns `null` so
 * every authenticated operation answers `ERR-IAM-002`. This replaces it.
 *
 * ## Bearer, not cookie
 *
 * Credentials are carried in `Authorization: Bearer <access_token>`, never in an
 * ambient cookie. That choice removes CSRF from the threat model by
 * construction: a cross-site form post cannot attach a header, so there is no
 * ambient authority to forge a request with. The phase requires CSRF controls
 * "where applicable"; with no ambient credential they are not applicable, and a
 * token pattern is what an API-only phase should ship. A browser session-cookie
 * design, with the SameSite/HttpOnly/Secure and double-submit machinery it
 * needs, is a decision for the phase that introduces a browser client — recorded
 * as an open decision rather than pre-empted here.
 *
 * ## What this returns, and what it deliberately does not
 *
 * It returns identity claims only: provider, subject, the tenant binding, and
 * the session reference. It performs **no** authorization, reads **no**
 * permission, and touches **no** business table. `resolveRequestContext()` then
 * resolves the account, the scope, and the session state from the database, and
 * `requirePermissions()` evaluates permissions inside the request transaction.
 *
 * ## Failing closed
 *
 * Returning `null` means "no session", which the pipeline turns into
 * `ERR-IAM-002`. Every failure path here returns `null` rather than throwing,
 * with one exception: a provider *outage* throws `ERR-DEP-001`, because "the
 * provider is down" and "your token is bad" are different operational facts and
 * collapsing them would make an outage look like a wave of bad credentials.
 * Local verification means an outage cannot normally reach this path at all.
 */
import type { PrincipalClaims, SessionAuthenticator } from '@/server/context/principal';
import { AppFailure } from '@/server/errors/app-failure';
import { log } from '@/server/observability/logger';
import { ProviderFailure, type IdentityProvider } from '../provider/identity-provider';

// Plain capture group rather than a named one: the compiler target predates
// named groups, and this is not the place to change a project-wide setting.
const BEARER = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/;

export class BearerSessionAuthenticator implements SessionAuthenticator {
  constructor(private readonly provider: IdentityProvider) {}

  async authenticate(request: Request): Promise<PrincipalClaims | null> {
    const header = request.headers.get('authorization');
    if (!header) return null;

    const token = BEARER.exec(header.trim())?.[1];
    if (!token) return null;

    let verified;
    try {
      verified = await this.provider.verifyToken(token);
    } catch (error) {
      if (error instanceof ProviderFailure && error.reason === 'provider-unavailable') {
        throw new AppFailure('ERR-DEP-001', {
          message: 'The authentication provider is unavailable',
          cause: error,
        });
      }
      // Everything else is an unusable token. Logged without the token, the
      // header, or any fragment of either — a truncated JWT is still a JWT
      // header and payload in cleartext.
      log.warn('Bearer token rejected', {
        module: 'iam',
        operation: 'iam.session.verify',
        result: 'denied',
        errorCode: 'ERR-IAM-002',
        context: { reason: error instanceof ProviderFailure ? error.reason : 'unknown' },
      });
      return null;
    }

    // A token with no tenant binding cannot be resolved to an account: the
    // binding is written by the service role at invitation, so its absence means
    // the identity was created outside the RootLco flow. Fail closed rather than
    // guessing a tenant.
    if (!verified.tenantId) {
      log.warn('Bearer token carries no tenant binding', {
        module: 'iam',
        operation: 'iam.session.verify',
        result: 'denied',
        errorCode: 'ERR-IAM-002',
      });
      return null;
    }

    return {
      identityProvider: this.provider.name,
      providerSubject: verified.subject,
      tenantId: verified.tenantId,
      // Null when the provider issues no session identifier. The context
      // resolver then performs no session-state check, which is why
      // `iam.user_sessions` rows are written with the same reference the token
      // carries — see `SessionService`.
      sessionRef: verified.sessionRef,
    };
  }
}
