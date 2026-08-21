/**
 * Authentication use cases (P1-14): login, logout, session read, password reset.
 *
 * These are the only services that run **without** an authenticated context,
 * which is exactly what makes them the most dangerous surface in the phase. Four
 * rules govern everything below.
 *
 * **1. Every failure answers the same way.** Unknown tenant, unknown address,
 * wrong password, unconfirmed identity, disabled provider identity, `invited`,
 * `locked`, `archived`, soft-deleted, tenant mismatch — all of them produce
 * `ERR-IAM-002` with the same message. The distinction is written to the
 * structured log with the correlation ID, where it is useful to an operator and
 * useless to an attacker. Anything else turns login into an account and tenant
 * enumeration oracle.
 *
 * **2. The provider is always asked.** Even when no local account exists. Short
 * -circuiting on a missing account would make "this address is unknown here"
 * measurably faster than "this password is wrong", which is the same oracle
 * again, delivered by stopwatch.
 *
 * **3. The tenant is a lookup key, never a grant.** It is now resolved
 * server-side from the identity the provider verified, and `tenantId` in the
 * request body is optional: supplying it asserts an expectation that is
 * cross-checked, and omitting it is the normal case. Either way it only scopes
 * the account lookup — the account must still exist inside that tenant, hold the
 * provider subject the provider just verified, and be active. A caller who
 * guesses a tenant learns nothing, because the answer is the same generic
 * failure. See `resolveTenant` for why the database cannot answer this question
 * and the provider must.
 *
 * **4. Nothing that could be a credential is written anywhere.** Passwords are
 * forwarded to the provider and never stored, logged, or echoed. Access and
 * refresh tokens are returned to the caller once and never persisted —
 * `iam.user_sessions.session_ref` holds the provider's *session identifier*,
 * which authorizes nothing on its own.
 *
 * ## Automatic account locking is deliberately not implemented
 *
 * Locking an account writes `iam.user_accounts.status` and appends to
 * `iam.user_status_history`. Both are gated on `iam.user.manage` by the
 * protected policies, and `iam.has_permission` returns false for a principal
 * who is not yet authenticated — so the failing principal cannot lock itself,
 * and no request path holds a permission that would let it. Implementing it
 * would require a `SECURITY DEFINER` routine; the platform has zero of those and
 * that invariant is asserted in CI.
 *
 * The security objective is met by throttling instead: `auth-adjacent` rate
 * limiting keyed by operation and client IP, plus durable failure evidence in
 * `iam.login_audit`, plus a security event when a principal crosses the
 * configured threshold so an operator can lock the account through the
 * administrative path. That is also the safer control — an automatic persistent
 * lock is itself a denial-of-service primitive, which the phase's own
 * "prevent cheap lockout denial-of-service" requirement warns about.
 */
import { createHash } from 'node:crypto';
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import { buildRequestContext, type RequestContext } from '@/server/context/request-context';
import { withTransaction, type DbHandle } from '@/server/db/transaction';
import { backendConfig } from '@/server/config/backend-config';
import { log } from '@/server/observability/logger';
import { metrics, METRICS } from '@/server/observability/metrics';
import { recordSecurityEvent } from '@/server/audit/security-events';
import { IdentityRepository, type AccountRow } from '../data/identity-repository';
import { AuthorizationRepository } from '../data/authorization-repository';
import { IdentityPolicy } from '../domain/identity-policy';
import { CredentialPolicy } from '../domain/credential-policy';
import type { IdentityProvider, ProviderSession } from '../provider/identity-provider';
import { ProviderFailure } from '../provider/identity-provider';
import { toAppFailureFromProvider } from '../provider/provider-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The tenant an unresolvable login attempt runs against.
 *
 * A well-formed v4 UUID that no tenant holds, so `sel_user_accounts_tenant`
 * matches nothing and the lookup returns no account — the same outcome as an
 * unknown address inside a real tenant, reached by the same amount of work.
 * Its absence from `org.tenants` is asserted by test rather than assumed.
 */
const UNRESOLVED_TENANT = '00000000-0000-4000-8000-000000000000';

/** The single answer every authentication failure produces. */
function authenticationFailed(): AppFailure {
  return new AppFailure('ERR-IAM-002', { message: 'Authentication failed' });
}

/**
 * Pseudonymises a client attribute for `ip_hash` / `user_agent_hash`.
 *
 * SHA-256 with no key. Stated plainly: for a low-entropy input such as an IPv4
 * address this is **pseudonymisation, not anonymisation** — the space is small
 * enough to enumerate, so a reader who holds the table can recover the address.
 * It is used because the column contract asks for a hash and because storing the
 * raw value would be worse; it is not claimed to be irreversible.
 */
function pseudonymise(value: string | null): string | null {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex');
}

export interface LoginRequest {
  /**
   * Optional since the login-identity contract change.
   *
   * A caller that supplies it is asserting which tenant it expects; the value is
   * cross-checked against the binding the provider reports and a disagreement is
   * refused. A caller that omits it — every RootLco client — has the tenant
   * resolved server-side. Either way it is a lookup key, never a grant.
   */
  readonly tenantId?: string | undefined;
  readonly email: string;
  readonly password: string;
}

export interface RequestMetadata {
  readonly correlationId: string;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
}

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly tenantId: string;
  };
}

export interface SessionSummary {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  readonly permissions: readonly string[];
}

export class AuthenticationService extends ApplicationService {
  protected readonly module = 'iam';

  constructor(
    private readonly provider: IdentityProvider,
    private readonly identities: IdentityRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly identityPolicy: IdentityPolicy,
    private readonly credentialPolicy: CredentialPolicy
  ) {
    super();
  }

  /**
   * Builds the bootstrap context an unauthenticated flow runs under.
   *
   * The tenant claim fills the principal slot only because the builder requires
   * a UUID there; `app.user_id` is blanked as the first statement of every
   * transaction that uses it, so no user-scoped policy can be satisfied by it.
   */
  private bootstrapContext(
    tenantId: string,
    correlationId: string,
    operation: string
  ): RequestContext {
    return buildRequestContext({
      correlationId,
      principal: { userId: tenantId, tenantId },
      operation,
      module: 'iam',
    });
  }

  /**
   * Verifies credentials, records the outcome, and opens a RootLco session.
   *
   * Ordering is the security design: the provider is called before any local
   * lookup so the latency of a failure does not depend on whether the address is
   * known here.
   */
  async login(input: LoginRequest, meta: RequestMetadata): Promise<LoginResult> {
    const config = backendConfig();

    if (input.tenantId !== undefined && !UUID.test(input.tenantId)) {
      // Same answer as every other failure. A malformed tenant must not be
      // distinguishable from a valid tenant with no matching account.
      this.noteFailure(meta, 'malformed-tenant');
      throw authenticationFailed();
    }

    let session: ProviderSession | null = null;
    let providerReason = 'none';
    try {
      session = await this.provider.authenticate(input.email, input.password);
    } catch (error) {
      if (error instanceof ProviderFailure && error.reason === 'provider-unavailable') {
        // An outage is an operational fact, not a credential verdict. Reporting
        // it as a failed login would hide an incident inside a metric that looks
        // like ordinary user error.
        this.noteFailure(meta, 'provider-unavailable');
        toAppFailureFromProvider(error);
      }
      providerReason = error instanceof ProviderFailure ? error.reason : 'unknown';
    }

    const resolved = await this.resolveTenant(input, session);

    // Deliberately NOT an early return.
    //
    // Answering here would skip the transaction every other failure performs,
    // making "this address is unknown to RootLco" measurably faster than "this
    // password is wrong" — the same stopwatch oracle rule 2 above exists to
    // prevent, reintroduced one layer up. An unresolved attempt instead proceeds
    // against a tenant that cannot match, does the same work, and is denied as
    // `no-account` exactly like an unknown address under a real tenant.
    const context = this.bootstrapContext(
      resolved ?? UNRESOLVED_TENANT,
      meta.correlationId,
      'iam.auth.login'
    );

    const outcome = await withTransaction(context, async (db) => {
      await db.query("SELECT set_config('app.user_id', '', true)");
      const account = await this.identities.findByEmail(db, this.provider.name, input.email);

      // No local account: record nothing (there is no principal to record it
      // against, and `ins_login_audit_self` correctly refuses an anonymous row)
      // and answer generically.
      if (!account) return { kind: 'denied', reason: 'no-account' } as const;

      // From here the principal is known, so its own audit rows become writable.
      await db.query("SELECT set_config('app.user_id', $1, true)", [account.id]);

      if (!session) {
        await this.recordFailure(db, account, meta, config);
        return { kind: 'denied', reason: `provider:${providerReason}` } as const;
      }
      if (session.subject !== account.providerSubject) {
        // The address resolved to a different provider identity than the one
        // that just authenticated — an address reused across identities. Refuse.
        await this.recordFailure(db, account, meta, config);
        return { kind: 'denied', reason: 'subject-mismatch' } as const;
      }
      if (session.tenantId !== null && session.tenantId !== account.tenantId) {
        await this.recordFailure(db, account, meta, config);
        return { kind: 'denied', reason: 'tenant-binding-mismatch' } as const;
      }
      if (account.status !== 'active') {
        // `invited`, `locked`, and `archived` are all indistinguishable to the
        // caller. Recorded as a failure so an operator sees attempts against a
        // locked account rather than silence.
        await this.recordFailure(db, account, meta, config);
        return { kind: 'denied', reason: `status:${account.status}` } as const;
      }

      await this.identities.insertSession(db, {
        userId: account.id,
        sessionRef: session.sessionRef,
        expiresAt: session.expiresAt,
        ipHash: pseudonymise(meta.clientIp),
        userAgentHash: pseudonymise(meta.userAgent),
      });
      await this.identities.appendLoginAudit(db, {
        userId: account.id,
        eventType: 'success',
        ipHash: pseudonymise(meta.clientIp),
        userAgentHash: pseudonymise(meta.userAgent),
        detail: null,
      });

      return { kind: 'granted', account } as const;
    });

    if (outcome.kind === 'denied') {
      // The distinction an operator needs, kept out of the response. "No account
      // in a tenant we could not resolve" and "no account in a real tenant" are
      // the same answer to the caller and different facts in the log.
      this.noteFailure(
        meta,
        resolved === null ? `${outcome.reason}:unresolved-tenant` : outcome.reason
      );
      throw authenticationFailed();
    }

    metrics().increment(METRICS.requestCount, {
      operation: 'iam.auth.login',
      result: 'success',
    });
    log.info('Login succeeded', {
      module: 'iam',
      operation: 'iam.auth.login',
      correlationId: meta.correlationId,
      tenantRef: outcome.account.tenantId,
      actorRef: outcome.account.id,
      result: 'success',
    });

    const granted = session as ProviderSession;
    return {
      accessToken: granted.accessToken,
      refreshToken: granted.refreshToken,
      expiresAt: granted.expiresAt.toISOString(),
      user: {
        id: outcome.account.id,
        email: outcome.account.email,
        displayName: outcome.account.displayName,
        tenantId: outcome.account.tenantId,
      },
    };
  }

  /**
   * Decides which tenant this attempt is scoped to, without asking the caller.
   *
   * The tenant cannot be resolved from the database: `sel_user_accounts_tenant`
   * restricts SELECT on `iam.user_accounts` to `tenant_id =
   * iam.current_tenant_id()`, and the platform holds zero `SECURITY DEFINER`
   * routines by CI-asserted invariant. A lookup that does not yet know its tenant
   * therefore has nowhere in the database it is permitted to run, and the
   * provider is the only tenant-agnostic directory that exists.
   *
   * `app_metadata.tenant_id` is written by the service role at invitation and is
   * not editable by the end user (ADR-019 §3), which is what makes it usable as a
   * lookup key. `uq_user_accounts_provider_identity_active` is unique on
   * `(identity_provider, provider_subject)` with **no tenant in the key**, so a
   * verified subject resolves to exactly one account and therefore one tenant.
   * The resolution is unambiguous by construction, not by convention.
   *
   * Resolving nothing returns null, and the caller answers with the same generic
   * failure as everything else. Resolving a tenant grants nothing on its own: the
   * account must still exist inside it, hold the subject the provider just
   * verified, and be active.
   */
  private async resolveTenant(
    input: LoginRequest,
    session: ProviderSession | null
  ): Promise<string | null> {
    const bound = session ? session.tenantId : await this.directoryTenant(input.email);

    if (bound !== null && UUID.test(bound)) {
      // A caller that named a tenant must have named the one the identity is
      // actually bound to. Steering the lookup at a different tenant is refused
      // rather than silently ignored, so a client cannot probe bindings.
      if (input.tenantId !== undefined && input.tenantId !== bound) return null;
      return bound;
    }

    // The identity carries no binding — an identity created outside `invite`.
    // Fall back to what the caller asserted, which is exactly the pre-change
    // behaviour and is why existing callers keep working unchanged.
    return input.tenantId ?? null;
  }

  /**
   * Asks the provider directory which tenant an address belongs to.
   *
   * Reached only when the provider **refused** the credentials, so that the
   * attempt can still be attributed to an account and written to
   * `iam.login_audit`. Without it, dropping `tenantId` from the request would
   * have silently turned off failure auditing — and with it the security-event
   * threshold — for every wrong-password attempt.
   *
   * Both "address unknown here" and "password wrong" take this path, so it
   * introduces no oracle between them, and the result is never revealed to the
   * caller in any form.
   *
   * A directory fault is swallowed deliberately. The verdict is already failure;
   * letting a lookup outage change the response would leak that the lookup
   * happened at all.
   */
  private async directoryTenant(email: string): Promise<string | null> {
    try {
      const identity = await this.provider.findByEmail(email);
      return identity?.tenantId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Appends a failure row and raises a security event once the configured
   * threshold is crossed.
   *
   * No status change is attempted: see the header note on automatic locking.
   */
  private async recordFailure(
    db: DbHandle,
    account: AccountRow,
    meta: RequestMetadata,
    config: ReturnType<typeof backendConfig>
  ): Promise<void> {
    await this.identities.appendLoginAudit(db, {
      userId: account.id,
      eventType: 'failure',
      ipHash: pseudonymise(meta.clientIp),
      userAgentHash: pseudonymise(meta.userAgent),
      // Free-form detail is never taken from caller input: it would be stored in
      // an append-only table and read back into an operator's console.
      detail: null,
    });

    const failures = await this.identities.countRecentFailures(
      db,
      account.id,
      config.LOGIN_FAILURE_WINDOW_MINUTES
    );
    const decision = this.identityPolicy.assessFailedLogin({
      recentFailures: failures,
      maxAttempts: config.LOGIN_MAX_FAILED_ATTEMPTS,
      currentState: account.status,
    });
    if (decision.shouldLock) {
      // An operator signal, not an automatic lock. The account reference is an
      // opaque UUID; no address and no attempted password appears.
      await recordSecurityEvent(db, {
        eventType: 'authentication.failure-threshold',
        severity: 'warning',
        detail: `Consecutive failed sign-in attempts reached the configured threshold for account ${account.id}.`,
      });
    }
  }

  /** One place for the "we denied, and here is why, server-side only" record. */
  private noteFailure(meta: RequestMetadata, reason: string): void {
    metrics().increment(METRICS.errorCount, {
      operation: 'iam.auth.login',
      code: 'ERR-IAM-002',
    });
    log.warn('Login failed', {
      module: 'iam',
      operation: 'iam.auth.login',
      correlationId: meta.correlationId,
      result: 'denied',
      errorCode: 'ERR-IAM-002',
      // The reason, never the address, never the tenant, never the password.
      context: { reason },
    });
  }

  /**
   * Ends the caller's own session.
   *
   * Idempotent by construction: revoking an already-revoked session affects zero
   * rows (the policy's `USING` excludes it) and that is treated as success. A
   * logout that failed the second time would be a defect, not a control.
   */
  async logout(accessToken: string, meta: RequestMetadata): Promise<void> {
    // Holding the token is the only authority needed to end the session that
    // token belongs to (finding P1-14-R-001). Requiring a *permission* to log
    // out meant a principal holding no administrative grant — a technician, say
    // — could not end their own session, which is the wrong direction to fail:
    // the inability to sign out is a security problem, not a usability one.
    //
    // Nothing here is trusted from the caller beyond the token itself. The
    // tenant and subject come from the verified token, the account must exist
    // and match, and the revoke statement is scoped to that tenant and to the
    // session reference the token carries — so a caller cannot end anyone
    // else's session, and cannot end one in another tenant.
    let verified;
    try {
      verified = await this.provider.verifyToken(accessToken);
    } catch {
      // An unusable token identifies no session. Logout is idempotent and must
      // succeed for a caller who is already signed out.
      return;
    }
    if (!verified.tenantId || !verified.sessionRef) return;

    const context = this.bootstrapContext(verified.tenantId, meta.correlationId, 'iam.auth.logout');

    await withTransaction(context, async (db) => {
      await db.query("SELECT set_config('app.user_id', '', true)");
      const account = await this.identities.findByProviderSubject(
        db,
        this.provider.name,
        verified.subject
      );
      if (!account) return;

      await db.query("SELECT set_config('app.user_id', $1, true)", [account.id]);
      await this.identities.revokeSessionByRef(
        db,
        verified.sessionRef as string,
        'Signed out by the account holder.'
      );
      await this.identities.appendLoginAudit(db, {
        userId: account.id,
        eventType: 'logout',
        ipHash: pseudonymise(meta.clientIp),
        userAgentHash: pseudonymise(meta.userAgent),
        detail: null,
      });
    });

    try {
      await this.provider.revokeSession(accessToken);
    } catch (error) {
      // The RootLco session row is already revoked, which is what makes the
      // token useless here. A provider that cannot be reached must not turn a
      // successful logout into a failure the caller is tempted to retry.
      log.warn('Provider session revocation failed after local revocation', {
        module: 'iam',
        operation: 'iam.auth.logout',
        correlationId: meta.correlationId,
        result: 'failure',
        context: { reason: error instanceof ProviderFailure ? error.reason : 'unknown' },
      });
    }
  }

  /**
   * Reports the caller's own resolved identity, scope, and permissions.
   *
   * Everything returned was resolved server-side for this request, so it
   * discloses nothing the caller does not already hold. It exists so a client
   * can render itself without guessing, and it is the honest answer to "is my
   * session still valid" — reaching it at all means it was.
   */
  async describeSession(db: DbHandle): Promise<SessionSummary> {
    const context = this.contextOf(db);
    const account = await this.identities.findById(db, context.principal.userId);
    if (!account) {
      // The context resolved but the row is invisible: RLS default-deny. Fail
      // closed rather than describing a session the database will not confirm.
      throw new AppFailure('ERR-CTX-001', {
        message: 'Resolved principal is not visible under the session context',
      });
    }
    const permissions = await this.authorization.effectivePermissionsOfCaller(db);
    return {
      userId: account.id,
      tenantId: account.tenantId,
      email: account.email,
      displayName: account.displayName,
      companyIds: context.companyIds,
      branchIds: context.branchIds,
      // Sorted so the response is deterministic; these are the caller's own
      // permissions, which they already hold, so disclosing them is not a leak.
      permissions: [...permissions].sort(),
    };
  }

  /**
   * Requests a password-reset mail.
   *
   * Unauthenticated and deliberately incurious: it does not look the address up
   * locally, does not tell the caller whether anything was sent, and does not
   * write a database row — there is no principal to write one against. The
   * provider owns the token, its single use, and its lifetime.
   */
  async requestPasswordReset(
    input: { email: string; redirectTo?: string | undefined },
    meta: RequestMetadata
  ): Promise<void> {
    const config = backendConfig();
    const redirectTo = this.credentialPolicy.resolveRedirect(
      input.redirectTo,
      config.AUTH_REDIRECT_ALLOWLIST
    );

    try {
      await this.provider.requestPasswordReset({ email: input.email, redirectTo });
    } catch (error) {
      if (error instanceof ProviderFailure && error.reason === 'provider-unavailable') {
        toAppFailureFromProvider(error);
      }
      // Any other provider outcome is swallowed on purpose. Surfacing it would
      // let a caller distinguish a known address from an unknown one.
      log.warn('Password-reset request did not complete', {
        module: 'iam',
        operation: 'iam.auth.password-reset',
        correlationId: meta.correlationId,
        result: 'failure',
        context: { reason: error instanceof ProviderFailure ? error.reason : 'unknown' },
      });
    }

    log.info('Password-reset requested', {
      module: 'iam',
      operation: 'iam.auth.password-reset',
      correlationId: meta.correlationId,
      result: 'success',
    });
  }

  /**
   * Completes a reset using the provider's recovery token.
   *
   * The token is verified, consumed, and time-bounded by the provider, and the
   * adapter revokes every other session of the identity afterwards — so a
   * session stolen before the reset does not survive it. RootLco writes nothing:
   * no credential state exists here to write.
   */
  async completePasswordReset(input: { token: string; password: string }): Promise<void> {
    this.credentialPolicy.assertPasswordBounds(input.password);
    try {
      await this.provider.completePasswordReset(input.token, input.password);
    } catch (error) {
      toAppFailureFromProvider(error);
    }
  }
}
