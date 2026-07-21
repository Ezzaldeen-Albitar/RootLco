/**
 * Authentication port (P1-13-BE-004).
 *
 * P1-13 owns *context resolution*, not *authentication* — login, sessions, and
 * the identity-provider decision are Phase 1-14 and its approved provider
 * decision. What the foundation must fix now is the contract between them, so
 * P1-14 plugs in without any later phase reinventing scope resolution.
 *
 * The contract is deliberately minimal and consists only of claims that a
 * verified session can vouch for:
 *
 *   identityProvider + providerSubject  → the external identity
 *   tenantId                            → the tenant the session was issued for
 *
 * Everything else — the internal user id, the companies and branches the caller
 * may act in — is resolved **from the database**, never accepted from the
 * caller. The claimed `tenantId` is not trusted either: it is used as a lookup
 * key and must contain the claimed subject, so a forged tenant claim finds no
 * account and is denied (`resolve-context.ts`).
 *
 * The default authenticator returns `null`, so every authenticated operation
 * answers `ERR-IAM-002` until P1-14 installs a real one. That is the correct
 * behaviour for a phase with no login: fail closed, and never pretend.
 */

/** Claims a verified session vouches for. Nothing here comes from a request body. */
export interface PrincipalClaims {
  /** Matches `iam.user_accounts.identity_provider`. */
  readonly identityProvider: string;
  /** Matches `iam.user_accounts.provider_subject`. */
  readonly providerSubject: string;
  /** Tenant the session was issued for. Verified against the account row. */
  readonly tenantId: string;
}

/** Resolves claims from an inbound request, or null when unauthenticated. */
export interface SessionAuthenticator {
  authenticate(request: Request): Promise<PrincipalClaims | null>;
}

/**
 * Fails closed. Installed until Phase 1-14 provides the real authenticator.
 * Named for what it is, so nobody mistakes it for a working auth path.
 */
export class UnconfiguredAuthenticator implements SessionAuthenticator {
  async authenticate(): Promise<PrincipalClaims | null> {
    return null;
  }
}

/** Test double: returns fixed claims. Never exported into a runtime path. */
export class StaticClaimsAuthenticator implements SessionAuthenticator {
  constructor(private readonly claims: PrincipalClaims | null) {}
  async authenticate(): Promise<PrincipalClaims | null> {
    return this.claims;
  }
}

let authenticator: SessionAuthenticator = new UnconfiguredAuthenticator();

export function sessionAuthenticator(): SessionAuthenticator {
  return authenticator;
}

/** Installed by composition (Phase 1-14) or by a test harness. */
export function setSessionAuthenticator(next: SessionAuthenticator): void {
  authenticator = next;
}

export function __resetAuthenticatorForTests(): void {
  authenticator = new UnconfiguredAuthenticator();
}
