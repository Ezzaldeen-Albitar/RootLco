/**
 * Identity-provider port (P1-14, ADR-019).
 *
 * ADR-019 selects Supabase Auth as the authentication and session provider and
 * requires that no application service, domain service, repository, or Route
 * Handler depend on a provider SDK type. This interface is that boundary: it
 * declares the eleven capabilities the phase needs, in RootLco's own vocabulary,
 * with RootLco's own error model.
 *
 * Three rules the port exists to make structural rather than advisory:
 *
 *  1. **Nothing here returns authorization.** The port answers questions about
 *     *identity* — does this credential verify, does this token verify, which
 *     subject is it. What that subject may do is decided by the database, on
 *     every request, and no method below can influence it.
 *  2. **Credential material never crosses back.** A password goes in; no
 *     password, hash, reset link, or refresh token is ever returned in a shape
 *     an application service could accidentally log or persist. Where a token is
 *     unavoidable (the access token a client needs), it is returned once, to the
 *     login handler, and is never written to the database.
 *  3. **Every failure is a cataloged RootLco error.** Adapters translate
 *     provider exceptions into `ProviderFailure` with a stable reason; nothing
 *     upstream ever sees an SDK error object, an HTTP status from the provider,
 *     or a provider message. See `toAppFailure` in each service.
 *
 * The deterministic double is `FakeIdentityProvider`. CI runs against it: a
 * suite that needs a live provider is a suite that cannot run on a clean
 * checkout, and provider credentials in CI would be a secret with no purpose.
 */

/** Why a provider call failed, in RootLco's vocabulary rather than the SDK's. */
export type ProviderFailureReason =
  /** Credentials did not verify, or the identity does not exist. Deliberately one reason. */
  | 'invalid-credentials'
  /** The token failed verification: signature, issuer, audience, algorithm, or expiry. */
  | 'invalid-token'
  /** The identity exists but the provider refuses it (banned, unconfirmed where required). */
  | 'identity-unavailable'
  /** The identity already exists and the operation required it not to. */
  | 'identity-conflict'
  /** The provider was unreachable, timed out, or returned a fault. */
  | 'provider-unavailable'
  /** The provider rejected the request as malformed. Always an application defect. */
  | 'provider-rejected';

/**
 * A provider failure, carrying a reason and never a provider message.
 *
 * The message is written by us, for operators. Forwarding the provider's own
 * text is how "user not found" ends up in a login response and turns the
 * endpoint into an account-enumeration oracle.
 */
export class ProviderFailure extends Error {
  public override readonly name = 'ProviderFailure';
  constructor(
    public readonly reason: ProviderFailureReason,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
  }
}

/** A provider identity, as much of it as RootLco is ever told. */
export interface ProviderIdentity {
  /** Provider subject (`sub`). Matches `iam.user_accounts.provider_subject`. */
  readonly subject: string;
  readonly email: string;
  /** True once the identity has confirmed its address / accepted its invitation. */
  readonly confirmed: boolean;
  /** True when the provider currently refuses sign-in for this identity. */
  readonly disabled: boolean;
  /**
   * Tenant the identity is bound to, written by the service role at invitation.
   * A lookup key, never authorization truth — ADR-019 rule 3.
   */
  readonly tenantId: string | null;
}

/** A session the provider issued. Tokens are returned once and never stored. */
export interface ProviderSession {
  readonly subject: string;
  readonly email: string;
  /** Bearer token the client presents on subsequent requests. */
  readonly accessToken: string;
  /** Refresh token, where the provider issues one. Never persisted by RootLco. */
  readonly refreshToken: string | null;
  /** Absolute expiry of the access token. */
  readonly expiresAt: Date;
  /**
   * Provider session identifier, used as `iam.user_sessions.session_ref`.
   * Falls back to a derived value when the provider does not expose one.
   */
  readonly sessionRef: string;
  readonly tenantId: string | null;
}

/** Claims taken from a verified token. Nothing here is trusted for authorization. */
export interface VerifiedToken {
  readonly subject: string;
  readonly email: string | null;
  readonly tenantId: string | null;
  readonly sessionRef: string | null;
  readonly expiresAt: Date;
}

export interface InviteRequest {
  readonly email: string;
  /** Written into provider metadata the end user cannot modify. */
  readonly tenantId: string;
  /** Absolute destination the invitation link returns to. Already allow-listed. */
  readonly redirectTo: string;
}

export interface PasswordResetRequest {
  readonly email: string;
  /** Absolute destination the reset link returns to. Already allow-listed. */
  readonly redirectTo: string;
}

/**
 * The eleven capabilities Phase 1-14 needs from an authentication provider.
 *
 * Adapters implement all of them or fail closed on the ones the concrete
 * provider does not support — never silently succeed. `supportsDisable` exists
 * so a caller can tell "not supported" from "did nothing", which matters when
 * the alternative is believing an account was disabled and it was not.
 */
export interface IdentityProvider {
  /** Stable name, written to `iam.user_accounts.identity_provider`. */
  readonly name: string;
  /** False when this provider cannot disable an identity; callers must not pretend. */
  readonly supportsDisable: boolean;

  /** 1. Verify credentials and issue a session. */
  authenticate(email: string, password: string): Promise<ProviderSession>;
  /** 2. Verify a bearer token offline (signature, iss, aud, alg, exp, skew). */
  verifyToken(token: string): Promise<VerifiedToken>;
  /** 3. Exchange a refresh token for a new session, where the provider allows it. */
  refreshSession(refreshToken: string): Promise<ProviderSession>;
  /** 4. Revoke the session behind a specific access token. */
  revokeSession(accessToken: string): Promise<void>;
  /** 5. Revoke every session of an identity. Privileged; service-role only. */
  revokeAllSessions(subject: string): Promise<void>;
  /** 6. Send a password-reset mail to an allow-listed destination. */
  requestPasswordReset(request: PasswordResetRequest): Promise<void>;
  /**
   * 7. Complete a reset using the provider's own recovery semantics.
   *
   * Deliberately takes the provider's recovery token rather than a RootLco one:
   * the token is minted, bounded, and single-used by the provider, and reissuing
   * it in RootLco would create a second reset path with weaker guarantees.
   */
  completePasswordReset(recoveryToken: string, newPassword: string): Promise<ProviderIdentity>;
  /** 8. Create and invite a provider identity, bound to a tenant. */
  invite(request: InviteRequest): Promise<ProviderIdentity>;
  /** 9. Look an identity up by subject. Returns null when it does not exist. */
  findBySubject(subject: string): Promise<ProviderIdentity | null>;
  /** 10. Confirm an identity administratively, where the provider allows it. */
  confirmIdentity(subject: string): Promise<ProviderIdentity>;
  /** 11. Disable or re-enable provider sign-in for an identity. */
  setDisabled(subject: string, disabled: boolean): Promise<ProviderIdentity>;
}

/**
 * Fails closed on every call.
 *
 * Installed until composition provides a real adapter, mirroring
 * `UnconfiguredAuthenticator` in the foundation. Named for what it is so nobody
 * mistakes it for a working provider.
 */
export class UnconfiguredIdentityProvider implements IdentityProvider {
  readonly name = 'unconfigured';
  readonly supportsDisable = false;

  private fail(): never {
    throw new ProviderFailure(
      'provider-unavailable',
      'No identity provider is configured for this process.'
    );
  }

  async authenticate(): Promise<ProviderSession> {
    this.fail();
  }
  async verifyToken(): Promise<VerifiedToken> {
    this.fail();
  }
  async refreshSession(): Promise<ProviderSession> {
    this.fail();
  }
  async revokeSession(): Promise<void> {
    this.fail();
  }
  async revokeAllSessions(): Promise<void> {
    this.fail();
  }
  async requestPasswordReset(): Promise<void> {
    this.fail();
  }
  async completePasswordReset(): Promise<ProviderIdentity> {
    this.fail();
  }
  async invite(): Promise<ProviderIdentity> {
    this.fail();
  }
  async findBySubject(): Promise<ProviderIdentity | null> {
    this.fail();
  }
  async confirmIdentity(): Promise<ProviderIdentity> {
    this.fail();
  }
  async setDisabled(): Promise<ProviderIdentity> {
    this.fail();
  }
}

let provider: IdentityProvider = new UnconfiguredIdentityProvider();

export function identityProvider(): IdentityProvider {
  return provider;
}

/** Installed by module composition or by a test harness. */
export function setIdentityProvider(next: IdentityProvider): void {
  provider = next;
}

export function __resetIdentityProviderForTests(): void {
  provider = new UnconfiguredIdentityProvider();
}
