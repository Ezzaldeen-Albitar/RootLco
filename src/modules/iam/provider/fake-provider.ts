/**
 * Deterministic identity provider for tests (P1-14, ADR-019).
 *
 * ADR-019 requires that CI run without provider credentials and without network
 * access. This double satisfies the same port as the Supabase adapter and
 * behaves the same way at the boundary — including failing the same way.
 *
 * Two properties make it evidence rather than decoration:
 *
 *  1. **It mints real JWTs and verifies them with the real verifier.** Tokens
 *     are HMAC-signed over the same secret the verifier is configured with, so
 *     signature, issuer, audience, algorithm, and expiry checks are genuinely
 *     exercised. A double that returned a pre-parsed claims object would leave
 *     the entire verification path untested, which is the part that matters.
 *  2. **It stores no plaintext password comparison shortcut.** Passwords are
 *     compared against what the test set, and a wrong password produces the same
 *     single `invalid-credentials` reason a real provider produces — so a test
 *     cannot accidentally depend on a distinguishable failure that the real
 *     provider deliberately hides.
 *
 * It is exported from the module's test surface only. Nothing in a runtime path
 * imports it, and `composeIamModule()` never selects it.
 */
import { createHmac, randomUUID } from 'node:crypto';
import {
  ProviderFailure,
  type IdentityProvider,
  type InviteRequest,
  type PasswordResetRequest,
  type ProviderIdentity,
  type ProviderSession,
  type VerifiedToken,
} from './identity-provider';
import { verifyBearerToken } from './token-verifier';

export interface FakeIdentityRecord {
  subject: string;
  email: string;
  password: string | null;
  confirmed: boolean;
  disabled: boolean;
  tenantId: string | null;
  /** Outstanding single-use recovery token, if a reset was requested. */
  recoveryToken: string | null;
}

export interface FakeProviderOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  /** Access-token lifetime in seconds. */
  readonly tokenTtlSeconds?: number;
  /** Injectable clock, so expiry is deterministic. */
  readonly now?: () => number;
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Records every reset/invite mail the double "sent", for assertions. */
export interface FakeDelivery {
  readonly kind: 'invite' | 'password-reset';
  readonly email: string;
  readonly redirectTo: string;
  /** The single-use token that the real provider would embed in the link. */
  readonly token: string;
}

export class FakeIdentityProvider implements IdentityProvider {
  readonly name = 'supabase';
  readonly supportsDisable = true;

  private readonly identities = new Map<string, FakeIdentityRecord>();
  private readonly revokedSessions = new Set<string>();
  /** Sessions issued but not revoked, keyed by access token. */
  private readonly sessionsByToken = new Map<string, string>();
  private readonly refreshTokens = new Map<string, string>();
  readonly deliveries: FakeDelivery[] = [];
  /** Set to make the next call fail as though the provider were down. */
  outage = false;

  constructor(private readonly options: FakeProviderOptions) {}

  private clock(): number {
    return (this.options.now ?? Date.now)();
  }

  private assertUp(): void {
    if (this.outage) {
      throw new ProviderFailure('provider-unavailable', 'Identity provider is unreachable.', true);
    }
  }

  /** Seeds an identity. Test-only setup; never a provider capability. */
  seed(record: Partial<FakeIdentityRecord> & { email: string }): FakeIdentityRecord {
    const identity: FakeIdentityRecord = {
      subject: record.subject ?? randomUUID(),
      email: record.email.toLowerCase(),
      password: record.password ?? null,
      confirmed: record.confirmed ?? false,
      disabled: record.disabled ?? false,
      tenantId: record.tenantId ?? null,
      recoveryToken: record.recoveryToken ?? null,
    };
    this.identities.set(identity.subject, identity);
    return identity;
  }

  private byEmail(email: string): FakeIdentityRecord | undefined {
    const wanted = email.toLowerCase();
    return [...this.identities.values()].find((identity) => identity.email === wanted);
  }

  private toIdentity(record: FakeIdentityRecord): ProviderIdentity {
    return {
      subject: record.subject,
      email: record.email,
      confirmed: record.confirmed,
      disabled: record.disabled,
      tenantId: record.tenantId,
    };
  }

  private mint(record: FakeIdentityRecord): ProviderSession {
    const ttl = this.options.tokenTtlSeconds ?? 3600;
    const issuedAt = Math.floor(this.clock() / 1000);
    const expiresAt = issuedAt + ttl;
    const sessionRef = randomUUID();
    const header = base64url({ alg: 'HS256', typ: 'JWT' });
    const payload = base64url({
      sub: record.subject,
      iss: this.options.issuer,
      aud: this.options.audience,
      iat: issuedAt,
      exp: expiresAt,
      email: record.email,
      session_id: sessionRef,
      app_metadata: { tenant_id: record.tenantId },
    });
    const signature = createHmac('sha256', this.options.secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    const accessToken = `${header}.${payload}.${signature}`;
    const refreshToken = randomUUID();

    this.sessionsByToken.set(accessToken, sessionRef);
    this.refreshTokens.set(refreshToken, record.subject);

    return {
      subject: record.subject,
      email: record.email,
      accessToken,
      refreshToken,
      expiresAt: new Date(expiresAt * 1000),
      sessionRef,
      tenantId: record.tenantId,
    };
  }

  async authenticate(email: string, password: string): Promise<ProviderSession> {
    this.assertUp();
    const record = this.byEmail(email);
    // One reason for unknown identity, wrong password, unconfirmed, and
    // disabled. The real provider hides the distinction and so must this.
    if (!record || record.password === null || record.password !== password) {
      throw new ProviderFailure('invalid-credentials', 'Credentials did not verify.');
    }
    if (record.disabled || !record.confirmed) {
      throw new ProviderFailure('invalid-credentials', 'Credentials did not verify.');
    }
    return this.mint(record);
  }

  async verifyToken(token: string): Promise<VerifiedToken> {
    this.assertUp();
    const verified = verifyBearerToken(token, {
      secret: this.options.secret,
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: ['HS256'],
      clockSkewSeconds: 0,
      ...(this.options.now ? { now: this.options.now } : {}),
    });
    if (verified.sessionRef && this.revokedSessions.has(verified.sessionRef)) {
      throw new ProviderFailure('invalid-token', 'Bearer token rejected: session was revoked.');
    }
    return verified;
  }

  async refreshSession(refreshToken: string): Promise<ProviderSession> {
    this.assertUp();
    const subject = this.refreshTokens.get(refreshToken);
    if (!subject) throw new ProviderFailure('invalid-token', 'Refresh token is not recognised.');
    // Single use: the old refresh token is consumed, so a stolen copy cannot be
    // replayed after the legitimate holder has used it.
    this.refreshTokens.delete(refreshToken);
    const record = this.identities.get(subject);
    if (!record || record.disabled) {
      throw new ProviderFailure('identity-unavailable', 'Identity is not available.');
    }
    return this.mint(record);
  }

  async revokeSession(accessToken: string): Promise<void> {
    this.assertUp();
    const sessionRef = this.sessionsByToken.get(accessToken);
    // Revoking an unknown session is a no-op, not an error: logout must be
    // idempotent, and reporting "no such session" would be an oracle.
    if (sessionRef) this.revokedSessions.add(sessionRef);
  }

  async revokeAllSessions(subject: string): Promise<void> {
    this.assertUp();
    for (const [token, sessionRef] of this.sessionsByToken) {
      const verified = token.split('.')[1];
      if (!verified) continue;
      const payload = JSON.parse(Buffer.from(verified, 'base64url').toString('utf8')) as {
        sub?: string;
      };
      if (payload.sub === subject) this.revokedSessions.add(sessionRef);
    }
    for (const [refresh, owner] of this.refreshTokens) {
      if (owner === subject) this.refreshTokens.delete(refresh);
    }
  }

  async requestPasswordReset(request: PasswordResetRequest): Promise<void> {
    this.assertUp();
    const record = this.byEmail(request.email);
    // Deliberately silent for an unknown address: the caller must not be able to
    // tell whether a mail was sent. The delivery log records only real sends.
    if (!record) return;
    record.recoveryToken = randomUUID();
    this.deliveries.push({
      kind: 'password-reset',
      email: record.email,
      redirectTo: request.redirectTo,
      token: record.recoveryToken,
    });
  }

  async completePasswordReset(
    recoveryToken: string,
    newPassword: string
  ): Promise<ProviderIdentity> {
    this.assertUp();
    const record = [...this.identities.values()].find(
      (identity) => identity.recoveryToken !== null && identity.recoveryToken === recoveryToken
    );
    if (!record) throw new ProviderFailure('invalid-token', 'Recovery token is not valid.');
    record.password = newPassword;
    record.confirmed = true;
    // Single use. A replayed link finds no matching token and is refused.
    record.recoveryToken = null;
    await this.revokeAllSessions(record.subject);
    return this.toIdentity(record);
  }

  async invite(request: InviteRequest): Promise<ProviderIdentity> {
    this.assertUp();
    const existing = this.byEmail(request.email);
    if (existing) {
      throw new ProviderFailure(
        'identity-conflict',
        'An identity already exists for that address.'
      );
    }
    const record = this.seed({
      email: request.email,
      tenantId: request.tenantId,
      confirmed: false,
      disabled: false,
    });
    record.recoveryToken = randomUUID();
    this.deliveries.push({
      kind: 'invite',
      email: record.email,
      redirectTo: request.redirectTo,
      token: record.recoveryToken,
    });
    return this.toIdentity(record);
  }

  async findBySubject(subject: string): Promise<ProviderIdentity | null> {
    this.assertUp();
    const record = this.identities.get(subject);
    return record ? this.toIdentity(record) : null;
  }

  async confirmIdentity(subject: string): Promise<ProviderIdentity> {
    this.assertUp();
    const record = this.identities.get(subject);
    if (!record) throw new ProviderFailure('identity-unavailable', 'Identity does not exist.');
    record.confirmed = true;
    return this.toIdentity(record);
  }

  async setDisabled(subject: string, disabled: boolean): Promise<ProviderIdentity> {
    this.assertUp();
    const record = this.identities.get(subject);
    if (!record) throw new ProviderFailure('identity-unavailable', 'Identity does not exist.');
    record.disabled = disabled;
    if (disabled) await this.revokeAllSessions(subject);
    return this.toIdentity(record);
  }

  /** Test helper: simulates the invitee following their link and setting a password. */
  async acceptInvitation(email: string, password: string): Promise<ProviderIdentity> {
    const record = this.byEmail(email);
    if (!record || !record.recoveryToken) {
      throw new ProviderFailure('invalid-token', 'No outstanding invitation for that address.');
    }
    return this.completePasswordReset(record.recoveryToken, password);
  }

  reset(): void {
    this.identities.clear();
    this.revokedSessions.clear();
    this.sessionsByToken.clear();
    this.refreshTokens.clear();
    this.deliveries.length = 0;
    this.outage = false;
  }
}
