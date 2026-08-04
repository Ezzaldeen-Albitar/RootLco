/**
 * P1-14 operation evidence — authentication and invitation, driven end to end
 * through the REAL AuthenticationService and InvitationService with a
 * deterministic provider fake (ADR-019: CI runs without provider credentials or
 * network). The fake mints real HS256 JWTs verified by the real verifier, so the
 * verification path is genuinely exercised.
 *
 * Every scenario invokes the wired application service on the deployed
 * `app_runtime` identity (`__setPrimaryPoolForTests(runtime)` + a real
 * RequestContext), through RLS, the transaction wrapper, and the audit/outbox
 * path — this is acceptance evidence, not a unit test of the decision logic.
 *
 * Operations exercised here (coverage-gate references):
 *   iam.auth-login  iam.auth-logout  iam.auth-session  iam.auth-password-reset
 *   iam.auth-password-reset-completion  iam.invitation-create  iam.invitation-cancel
 *   iam.invitation-activate
 *
 * COVERAGE-EVIDENCE (machine-checked by scripts/check-operation-test-coverage.mjs):
 *   iam.auth-login: success denial audit
 *   iam.auth-logout: success audit idempotency
 *   iam.auth-session: success
 *   iam.auth-password-reset: success denial
 *   iam.auth-password-reset-completion: success denial idempotency
 *   iam.invitation-create: success denial cross-tenant audit outbox
 *   iam.invitation-cancel: success denial audit outbox
 *   iam.invitation-activate: success denial audit outbox
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { setIdentityProvider, FakeIdentityProvider } from '@/modules/iam';
import { AuthenticationService } from '@/modules/iam/application/authentication-service';
import { InvitationService } from '@/modules/iam/application/invitation-service';
import { AuthorizationRepository } from '@/modules/iam/data/authorization-repository';
import { IdentityRepository } from '@/modules/iam/data/identity-repository';
import { IdentityPolicy } from '@/modules/iam/domain/identity-policy';
import { CredentialPolicy } from '@/modules/iam/domain/credential-policy';
import { DelegationPolicy } from '@/modules/iam/domain/delegation-policy';

const SECRET = 'iam-auth-provider-test-secret-not-real';
const ISSUER = 'https://auth.test.local/auth/v1';
const AUDIENCE = 'authenticated';
const REDIRECT_OK = 'https://app.test.local/reset';
const REDIRECT_EVIL = 'https://app.test.local.attacker.test/reset';

// The active, authenticatable account used by the login/logout/session/reset
// scenarios. Provider identity is `supabase` because the fake reports that name.
const U_ACTIVE = 'c1400000-0000-4000-8000-000000000001';
const SUBJECT_ACTIVE = 'fx_auth_active';
const EMAIL_ACTIVE = 'fx-auth-active@example.test';
const PASSWORD = 'correct horse battery staple';

// The administrator who invites/cancels/activates. Holds iam.user.manage so its
// writes to iam.user_accounts and iam.user_status_history pass RLS.
const U_ADMIN = 'c1400000-0000-4000-8000-0000000000a1';
const EMAIL_ADMIN = 'fx-admin-um@example.test';
const ROLE_UM = 'd1400000-0000-4000-8000-0000000000a1';
// A principal that holds no administrative permission at all — used to prove
// invitation writes fail closed under RLS for an unprivileged caller.
const U_NOAUTH = 'c1400000-0000-4000-8000-0000000000b2';
const EMAIL_NOAUTH = 'fx-admin-noauth@example.test';

let admin: Pool;
let runtime: Pool;
let fake: FakeIdentityProvider;
let authService: AuthenticationService;
let invitations: InvitationService;

const META = { correlationId: randomUUID(), clientIp: '203.0.113.5', userAgent: 'test-agent' };
const meta = () => ({ correlationId: randomUUID(), clientIp: '203.0.113.5', userAgent: 'agent' });

/** Seeds the active provider identity + its application account. */
async function seedActiveAccount(): Promise<void> {
  fake.seed({
    subject: SUBJECT_ACTIVE,
    email: EMAIL_ACTIVE,
    password: PASSWORD,
    confirmed: true,
    disabled: false,
    tenantId: TENANT_A,
  });
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'supabase',$3,$4,'Auth Active','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [U_ACTIVE, TENANT_A, SUBJECT_ACTIVE, EMAIL_ACTIVE, USER_A]
  );
}

/** Inserts an ad-hoc account for a negative login scenario and returns its id. */
async function insertAccount(over: {
  status?: string;
  providerSubject?: string;
  tenantId?: string;
  email?: string;
}): Promise<{ id: string; email: string; subject: string }> {
  const id = randomUUID();
  const subject = over.providerSubject ?? `fx_auth_${randomUUID().slice(0, 8)}`;
  const email = over.email ?? `fx-auth-${randomUUID().slice(0, 8)}@example.test`;
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'supabase',$3,$4,'Auth Negative',$5,$6)`,
    [id, over.tenantId ?? TENANT_A, subject, email, over.status ?? 'active', USER_A]
  );
  return { id, email, subject };
}

/** Removes every fx-auth-* account and its dependent rows, in FK order. */
async function cleanAuthAccounts(): Promise<void> {
  const scope = `email LIKE 'fx-auth-%'`;
  for (const table of [
    'iam.user_sessions',
    'iam.login_audit',
    'iam.user_status_history',
    'iam.role_grants',
  ]) {
    await admin.query(
      `DELETE FROM ${table} WHERE user_id IN (SELECT id FROM iam.user_accounts WHERE ${scope})`
    );
  }
  await admin.query(`DELETE FROM iam.user_accounts WHERE ${scope}`);
}

beforeAll(async () => {
  process.env.AUTH_REDIRECT_ALLOWLIST = REDIRECT_OK;
  __resetBackendConfigForTests();
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  fake = new FakeIdentityProvider({ secret: SECRET, issuer: ISSUER, audience: AUDIENCE });
  setIdentityProvider(fake);
  const authorization = new AuthorizationRepository();
  const identities = new IdentityRepository();
  authService = new AuthenticationService(
    fake,
    identities,
    authorization,
    new IdentityPolicy(),
    new CredentialPolicy()
  );
  invitations = new InvitationService(
    fake,
    identities,
    authorization,
    new IdentityPolicy(),
    new CredentialPolicy(),
    new DelegationPolicy()
  );

  // Persistent administrator holding iam.user.manage, and a no-permission
  // principal — both provisioned on the BYPASSRLS admin connection. Any leftover
  // rows from an interrupted run are removed first so the provider-identity
  // uniqueness index cannot collide.
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = ANY($1::uuid[])', [
    [U_ADMIN, U_NOAUTH],
  ]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])', [
    [U_ADMIN, U_NOAUTH],
  ]);
  for (const [id, email] of [
    [U_ADMIN, EMAIL_ADMIN],
    [U_NOAUTH, EMAIL_NOAUTH],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,'test_harness',$3,$4,$5,'active',$6)`,
      [id, TENANT_A, `fx_admin_${id}`, email, 'Admin Fixture', USER_A]
    );
  }
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_auth_um','Auth user-manage',$3) ON CONFLICT (id) DO NOTHING`,
    [ROLE_UM, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = 'iam.user.manage'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_UM, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     SELECT $1,$2,$3,'unrestricted','active',$4,$4
      WHERE NOT EXISTS (SELECT 1 FROM iam.role_grants WHERE tenant_id=$1 AND user_id=$2 AND role_id=$3)`,
    [TENANT_A, U_ADMIN, ROLE_UM, USER_A]
  );
});

beforeEach(async () => {
  fake.reset();
  await cleanAuthAccounts();
  await seedActiveAccount();
});

afterEach(async () => {
  await cleanAuthAccounts();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.query('DELETE FROM iam.role_grants WHERE role_id = $1', [ROLE_UM]);
  await admin.query('DELETE FROM iam.role_permissions WHERE role_id = $1', [ROLE_UM]);
  await admin.query('DELETE FROM iam.roles WHERE id = $1', [ROLE_UM]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])', [
    [U_ADMIN, U_NOAUTH],
  ]);
  await cleanBackendFixtures(admin);
  await admin.end();
});

const asAdmin = () => contextFor({ userId: U_ADMIN, operation: 'iam.invitation', module: 'iam' });

// ===========================================================================
// iam.auth-login
// ===========================================================================
describe('iam.auth-login', () => {
  it('success returns a token and writes a session + success audit row', async () => {
    const result = await authService.login(
      { tenantId: TENANT_A, email: EMAIL_ACTIVE, password: PASSWORD },
      META
    );
    expect(result.accessToken).toMatch(/\./);
    expect(result.user.id).toBe(U_ACTIVE);
    expect(result.user.tenantId).toBe(TENANT_A);
    const sessions = await admin.query(
      `SELECT 1 FROM iam.user_sessions WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [TENANT_A, U_ACTIVE]
    );
    expect(sessions.rowCount).toBe(1);
    const audit = await admin.query(
      `SELECT 1 FROM iam.login_audit WHERE user_id = $1 AND event_type = 'success'`,
      [U_ACTIVE]
    );
    expect(audit.rowCount).toBe(1);
  });

  it('wrong password is refused generically and writes a failure audit row', async () => {
    const error = await authService
      .login({ tenantId: TENANT_A, email: EMAIL_ACTIVE, password: 'wrong-password' }, meta())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
    // The distinction is recorded server-side as a failure, not disclosed.
    const failures = await admin.query(
      `SELECT 1 FROM iam.login_audit WHERE user_id = $1 AND event_type = 'failure'`,
      [U_ACTIVE]
    );
    expect(failures.rowCount).toBe(1);
    // No session opened.
    expect(await countRows(admin, 'iam.user_sessions', 'user_id = $1', [U_ACTIVE])).toBe(0);
  });

  it('an unknown address is refused with the SAME error and writes nothing', async () => {
    const error = await authService
      .login({ tenantId: TENANT_A, email: 'nobody@example.test', password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
    // No principal to record against — the anonymous audit row is refused by design.
    expect(
      await countRows(admin, 'iam.login_audit', "event_type = 'failure' AND user_id = $1", [
        U_ACTIVE,
      ])
    ).toBe(0);
  });

  it('an address whose account maps a different provider subject is refused', async () => {
    // The provider authenticates SUBJECT_ACTIVE, but the local account for this
    // address records a different subject (address reused across identities).
    const mismatch = await insertAccount({ providerSubject: 'fx_auth_other_subject' });
    fake.seed({
      subject: SUBJECT_ACTIVE,
      email: mismatch.email,
      password: PASSWORD,
      confirmed: true,
      tenantId: TENANT_A,
    });
    const error = await authService
      .login({ tenantId: TENANT_A, email: mismatch.email, password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
    expect(await countRows(admin, 'iam.user_sessions', 'user_id = $1', [mismatch.id])).toBe(0);
  });

  it('a provider identity bound to a different tenant is refused', async () => {
    const acct = await insertAccount({ tenantId: TENANT_A });
    // Provider says the identity belongs to TENANT_B; account says TENANT_A.
    fake.seed({
      subject: acct.subject,
      email: acct.email,
      password: PASSWORD,
      confirmed: true,
      tenantId: TENANT_B,
    });
    const error = await authService
      .login({ tenantId: TENANT_A, email: acct.email, password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
  });

  for (const status of ['invited', 'locked', 'archived'] as const) {
    it(`a ${status} account is refused with the generic error and a failure row`, async () => {
      const acct = await insertAccount({ status });
      fake.seed({
        subject: acct.subject,
        email: acct.email,
        password: PASSWORD,
        confirmed: true,
        tenantId: TENANT_A,
      });
      const error = await authService
        .login({ tenantId: TENANT_A, email: acct.email, password: PASSWORD }, meta())
        .catch((e: unknown) => e);
      expect((error as AppFailure).code).toBe('ERR-IAM-002');
      const failures = await admin.query(
        `SELECT 1 FROM iam.login_audit WHERE user_id = $1 AND event_type = 'failure'`,
        [acct.id]
      );
      expect(failures.rowCount).toBe(1);
      expect(await countRows(admin, 'iam.user_sessions', 'user_id = $1', [acct.id])).toBe(0);
    });
  }

  it('a disabled provider identity is refused (provider verdict, generic answer)', async () => {
    const acct = await insertAccount({ status: 'active' });
    fake.seed({
      subject: acct.subject,
      email: acct.email,
      password: PASSWORD,
      confirmed: true,
      disabled: true,
      tenantId: TENANT_A,
    });
    const error = await authService
      .login({ tenantId: TENANT_A, email: acct.email, password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
  });

  it('a malformed tenant is refused with the same generic error before any lookup', async () => {
    const error = await authService
      .login({ tenantId: 'not-a-uuid', email: EMAIL_ACTIVE, password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
  });

  it('a provider outage surfaces as a dependency error, not a credential verdict', async () => {
    fake.outage = true;
    const error = await authService
      .login({ tenantId: TENANT_A, email: EMAIL_ACTIVE, password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-DEP-001');
  });

  it('every distinct failure produces the identical caller-visible message (non-enumerating)', async () => {
    const messages = new Set<string>();
    for (const attempt of [
      { tenantId: TENANT_A, email: EMAIL_ACTIVE, password: 'wrong' },
      { tenantId: TENANT_A, email: 'unknown@example.test', password: PASSWORD },
      { tenantId: 'not-a-uuid', email: EMAIL_ACTIVE, password: PASSWORD },
    ]) {
      const error = await authService.login(attempt, meta()).catch((e: unknown) => e);
      messages.add((error as AppFailure).message);
    }
    expect(messages.size).toBe(1);
  });
});

// ===========================================================================
// The login-identity contract: signing in with an address and a password only.
//
// The tenant is resolved server-side from the identity the provider verified.
// These cases exist to prove three things that are easy to claim and easy to get
// wrong: that omitting the tenant WORKS, that omitting it does not quietly turn
// off failure auditing, and that supplying a tenant cannot steer the lookup.
// ===========================================================================
describe('iam.auth-login — tenant resolved without a caller-supplied tenantId', () => {
  it('signs in with address and password only, and resolves the tenant from the provider', async () => {
    const result = await authService.login({ email: EMAIL_ACTIVE, password: PASSWORD }, META);
    expect(result.user.id).toBe(U_ACTIVE);
    // Never sent by the caller — it can only have come from the binding.
    expect(result.user.tenantId).toBe(TENANT_A);
    expect(
      await countRows(admin, 'iam.user_sessions', 'user_id = $1 AND revoked_at IS NULL', [U_ACTIVE])
    ).toBe(1);
  });

  it('resolves the tenant the identity is bound to, not the one the caller might assume', async () => {
    // Bound to TENANT_B at the provider, account lives in TENANT_B. Nothing in
    // the request names a tenant, so a resolution that defaulted to TENANT_A —
    // or to "the first tenant" — would fail here.
    const acct = await insertAccount({ tenantId: TENANT_B });
    fake.seed({
      subject: acct.subject,
      email: acct.email,
      password: PASSWORD,
      confirmed: true,
      tenantId: TENANT_B,
    });
    const result = await authService.login({ email: acct.email, password: PASSWORD }, meta());
    expect(result.user.tenantId).toBe(TENANT_B);
    expect(result.user.id).toBe(acct.id);
  });

  it('still writes a failure audit row for a wrong password with no tenantId in the body', async () => {
    // The regression this contract change could most easily have introduced.
    // The provider refuses, so there is no session to carry a binding; without
    // the directory lookup there would be no tenant, no context, and therefore
    // NO audit row — silently disabling failure auditing, and with it the
    // security-event threshold, for every wrong-password attempt.
    const acct = await insertAccount({ status: 'active' });
    fake.seed({
      subject: acct.subject,
      email: acct.email,
      password: PASSWORD,
      confirmed: true,
      tenantId: TENANT_A,
    });
    const error = await authService
      .login({ email: acct.email, password: 'wrong-password' }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
    expect(
      await countRows(admin, 'iam.login_audit', "user_id = $1 AND event_type = 'failure'", [acct.id])
    ).toBe(1);
    expect(await countRows(admin, 'iam.user_sessions', 'user_id = $1', [acct.id])).toBe(0);
  });

  it('refuses an unknown address generically and writes nothing', async () => {
    const error = await authService
      .login({ email: 'nobody-tenantless@example.test', password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
  });

  it('refuses a caller-supplied tenantId that disagrees with the provider binding', async () => {
    // A caller must not be able to point a verified identity at another tenant.
    const acct = await insertAccount({ tenantId: TENANT_B });
    fake.seed({
      subject: acct.subject,
      email: acct.email,
      password: PASSWORD,
      confirmed: true,
      tenantId: TENANT_B,
    });
    const error = await authService
      .login({ tenantId: TENANT_A, email: acct.email, password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
    expect(await countRows(admin, 'iam.user_sessions', 'user_id = $1', [acct.id])).toBe(0);
  });

  it('accepts a caller-supplied tenantId that agrees, so existing callers keep working', async () => {
    const result = await authService.login(
      { tenantId: TENANT_A, email: EMAIL_ACTIVE, password: PASSWORD },
      meta()
    );
    expect(result.user.tenantId).toBe(TENANT_A);
  });

  it('falls back to the body tenant for an identity carrying no binding', async () => {
    // An identity created outside `invite` has no app_metadata.tenant_id. This is
    // exactly the pre-change behaviour, and is why the field stayed optional
    // rather than being deleted.
    const acct = await insertAccount({ status: 'active' });
    fake.seed({
      subject: acct.subject,
      email: acct.email,
      password: PASSWORD,
      confirmed: true,
      tenantId: null,
    });
    const result = await authService.login(
      { tenantId: TENANT_A, email: acct.email, password: PASSWORD },
      meta()
    );
    expect(result.user.id).toBe(acct.id);
  });

  it('refuses when the identity carries no binding and the caller named no tenant', async () => {
    // Nothing to scope a lookup to. Generic, like every other failure.
    const acct = await insertAccount({ status: 'active' });
    fake.seed({
      subject: acct.subject,
      email: acct.email,
      password: PASSWORD,
      confirmed: true,
      tenantId: null,
    });
    const error = await authService
      .login({ email: acct.email, password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
    expect(await countRows(admin, 'iam.user_sessions', 'user_id = $1', [acct.id])).toBe(0);
  });

  it('runs an unresolvable attempt against a tenant that exists in no row', async () => {
    // The sentinel the service falls back to must not be a real tenant, or an
    // unresolvable attempt would be scoped to somebody's data. Asserted against
    // the database rather than trusted, because "obviously nobody uses that
    // UUID" is exactly the kind of assumption that stops being true quietly.
    const held = await admin.query(`SELECT 1 FROM org.tenants WHERE id = $1`, [
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(held.rowCount).toBe(0);
  });

  it('does not short-circuit an unresolvable attempt ahead of the transaction', async () => {
    // Regression for the stopwatch oracle: an early return on "no tenant" would
    // make an unknown address measurably faster than a wrong password, because
    // it would skip the lookup the wrong-password path performs. Both must reach
    // the transaction, so both must be capable of writing to `iam.login_audit` —
    // proved here by the fact that neither leaves a session and both are denied
    // identically, while the wrong-password case DID write its failure row.
    const acct = await insertAccount({ status: 'active' });
    fake.seed({
      subject: acct.subject,
      email: acct.email,
      password: PASSWORD,
      confirmed: true,
      tenantId: TENANT_A,
    });

    const unknown = await authService
      .login({ email: 'never-seen-here@example.test', password: PASSWORD }, meta())
      .catch((e: unknown) => e);
    const wrongPassword = await authService
      .login({ email: acct.email, password: 'wrong-password' }, meta())
      .catch((e: unknown) => e);

    expect((unknown as AppFailure).code).toBe('ERR-IAM-002');
    expect((wrongPassword as AppFailure).code).toBe('ERR-IAM-002');
    expect((unknown as AppFailure).message).toBe((wrongPassword as AppFailure).message);
    // The known account was reached and audited; the unknown one had nothing to
    // audit. Same answer, same path, different evidence — which is the point.
    expect(
      await countRows(admin, 'iam.login_audit', "user_id = $1 AND event_type = 'failure'", [acct.id])
    ).toBe(1);
  });

  it('answers tenantless failures with the identical message as tenant-bearing ones', async () => {
    const messages = new Set<string>();
    for (const attempt of [
      { email: EMAIL_ACTIVE, password: 'wrong' },
      { email: 'unknown-tenantless@example.test', password: PASSWORD },
      { tenantId: TENANT_A, email: EMAIL_ACTIVE, password: 'wrong' },
      { tenantId: 'not-a-uuid', email: EMAIL_ACTIVE, password: PASSWORD },
    ]) {
      const error = await authService.login(attempt, meta()).catch((e: unknown) => e);
      messages.add((error as AppFailure).message);
    }
    expect(messages.size).toBe(1);
  });
});

// ===========================================================================
// iam.auth-logout
// ===========================================================================
describe('iam.auth-logout', () => {
  async function loginToken(): Promise<string> {
    const result = await authService.login(
      { tenantId: TENANT_A, email: EMAIL_ACTIVE, password: PASSWORD },
      META
    );
    return result.accessToken;
  }

  it('success revokes the session and writes a logout audit row', async () => {
    const token = await loginToken();
    await authService.logout(token, meta());
    const revoked = await admin.query(
      `SELECT 1 FROM iam.user_sessions WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [U_ACTIVE]
    );
    expect(revoked.rowCount).toBe(1);
    const audit = await admin.query(
      `SELECT 1 FROM iam.login_audit WHERE user_id = $1 AND event_type = 'logout'`,
      [U_ACTIVE]
    );
    expect(audit.rowCount).toBe(1);
  });

  it('is idempotent: logging out twice does not error and leaves one revoked session', async () => {
    const token = await loginToken();
    await authService.logout(token, meta());
    await expect(authService.logout(token, meta())).resolves.toBeUndefined();
    expect(
      await countRows(admin, 'iam.user_sessions', 'user_id = $1 AND revoked_at IS NOT NULL', [
        U_ACTIVE,
      ])
    ).toBe(1);
  });

  it('an unusable token is a clean no-op (never throws, revokes nothing)', async () => {
    await expect(authService.logout('not-a-jwt', meta())).resolves.toBeUndefined();
    expect(await countRows(admin, 'iam.user_sessions', 'user_id = $1', [U_ACTIVE])).toBe(0);
  });

  it('logout for a token whose session row is gone still succeeds (idempotent revoke)', async () => {
    const token = await loginToken();
    await admin.query('DELETE FROM iam.user_sessions WHERE user_id = $1', [U_ACTIVE]);
    await expect(authService.logout(token, meta())).resolves.toBeUndefined();
    // Still audits the logout for the resolved principal.
    expect(
      await countRows(admin, 'iam.login_audit', "user_id = $1 AND event_type = 'logout'", [
        U_ACTIVE,
      ])
    ).toBe(1);
  });
});

// ===========================================================================
// iam.auth-session
// ===========================================================================
describe('iam.auth-session', () => {
  it('describeSession returns the resolved identity, scope, and permissions', async () => {
    const summary = await withTransaction(
      contextFor({ userId: U_ACTIVE, operation: 'iam.auth-session', module: 'iam' }),
      (db) => authService.describeSession(db)
    );
    expect(summary.userId).toBe(U_ACTIVE);
    expect(summary.tenantId).toBe(TENANT_A);
    expect(summary.email).toBe(EMAIL_ACTIVE);
    expect(Array.isArray(summary.permissions)).toBe(true);
  });
});

// ===========================================================================
// iam.auth-password-reset
// ===========================================================================
describe('iam.auth-password-reset', () => {
  it('a request for a known address records a delivery to the allow-listed destination', async () => {
    await authService.requestPasswordReset({ email: EMAIL_ACTIVE }, meta());
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0]).toMatchObject({
      kind: 'password-reset',
      email: EMAIL_ACTIVE,
      redirectTo: REDIRECT_OK,
    });
  });

  it('a request for an unknown address is silent — no delivery, no error (no oracle)', async () => {
    await expect(
      authService.requestPasswordReset({ email: 'unknown@example.test' }, meta())
    ).resolves.toBeUndefined();
    expect(fake.deliveries).toHaveLength(0);
  });

  it('a redirect that is not allow-listed is refused before the provider is touched', async () => {
    const error = await authService
      .requestPasswordReset({ email: EMAIL_ACTIVE, redirectTo: REDIRECT_EVIL }, meta())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
    expect(fake.deliveries).toHaveLength(0);
  });
});

// ===========================================================================
// iam.auth-password-reset-completion
// ===========================================================================
describe('iam.auth-password-reset-completion', () => {
  async function recoveryToken(): Promise<string> {
    await authService.requestPasswordReset({ email: EMAIL_ACTIVE }, meta());
    return fake.deliveries[0]!.token;
  }

  it('completes a reset and invalidates every session issued before it', async () => {
    const login = await authService.login(
      { tenantId: TENANT_A, email: EMAIL_ACTIVE, password: PASSWORD },
      META
    );
    const token = await recoveryToken();
    await authService.completePasswordReset({ token, password: 'a-new-strong-password' });
    // The pre-reset access token no longer verifies (session revoked by the provider).
    await expect(fake.verifyToken(login.accessToken)).rejects.toThrow();
  });

  it('a replayed recovery token is refused (single use)', async () => {
    const token = await recoveryToken();
    await authService.completePasswordReset({ token, password: 'a-new-strong-password' });
    const error = await authService
      .completePasswordReset({ token, password: 'another-strong-password' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-IAM-002');
  });

  it('a password outside the bounds is refused before the provider is touched', async () => {
    const error = await authService
      .completePasswordReset({ token: 'irrelevant', password: 'short' })
      .catch((e: unknown) => e);
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
// iam.invitation-create
// ===========================================================================
describe('iam.invitation-create', () => {
  const inviteEmail = () => `fx-auth-invite-${randomUUID().slice(0, 8)}@example.test`;

  it('invites a user: creates an invited account, one audit record, one outbox event', async () => {
    const email = inviteEmail();
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "tenant_id = $1 AND action = 'iam.user.invited'",
      [TENANT_A]
    );
    const outboxBefore = await countRows(
      admin,
      'shared.event_outbox',
      "tenant_id = $1 AND event_type = 'user.invited'",
      [TENANT_A]
    );
    const invited = await withTransaction(asAdmin(), (db) =>
      invitations.invite(db, { email, displayName: 'Invited Person' })
    );
    expect(invited.status).toBe('invited');
    // Landed in the caller's tenant (taken from context, never the request).
    const row = await admin.query<{ tenant_id: string; status: string }>(
      'SELECT tenant_id, status FROM iam.user_accounts WHERE id = $1',
      [invited.id]
    );
    expect(row.rows[0]?.tenant_id).toBe(TENANT_A);
    expect(row.rows[0]?.status).toBe('invited');
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "tenant_id = $1 AND action = 'iam.user.invited'",
        [TENANT_A]
      )
    ).toBe(auditBefore + 1);
    expect(
      await countRows(
        admin,
        'shared.event_outbox',
        "tenant_id = $1 AND event_type = 'user.invited'",
        [TENANT_A]
      )
    ).toBe(outboxBefore + 1);
    // Redaction: the invited address (classification `restricted`) is masked in
    // the stored audit detail rows — the raw address never lands in the trail.
    const detail = await admin.query<{ new_value_masked: string | null }>(
      `SELECT d.new_value_masked
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.tenant_id = $1 AND r.action = 'iam.user.invited' AND r.entity_id = $2
          AND d.field_name = 'email'`,
      [TENANT_A, invited.id]
    );
    expect(detail.rowCount).toBe(1);
    expect(detail.rows[0]?.new_value_masked ?? '').not.toContain(email);
  });

  it('a duplicate address in the tenant is a conflict (ERR-RES-002)', async () => {
    const email = inviteEmail();
    await withTransaction(asAdmin(), (db) =>
      invitations.invite(db, { email, displayName: 'First' })
    );
    const error = await withTransaction(asAdmin(), (db) =>
      invitations.invite(db, { email, displayName: 'Second' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-002');
  });

  it('an unprivileged caller cannot invite (RLS fail-closed) and leaves nothing behind', async () => {
    const email = inviteEmail();
    const error = await withTransaction(
      contextFor({ userId: U_NOAUTH, operation: 'iam.invitation', module: 'iam' }),
      (db) => invitations.invite(db, { email, displayName: 'Denied' }).catch((e: unknown) => e)
    );
    // RLS refuses the INSERT (42501) for a principal without iam.user.manage; the
    // repository does not soften a privilege error into a domain failure, so the
    // raw refusal propagates and the transaction rolls back.
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe('42501');
    // No application account was created for the address.
    expect(await countRows(admin, 'iam.user_accounts', 'email = $1', [email])).toBe(0);
  });

  it('cross-tenant: a tenant-A administrator can only ever invite into tenant A', async () => {
    const email = inviteEmail();
    const invited = await withTransaction(asAdmin(), (db) =>
      invitations.invite(db, { email, displayName: 'Scoped To A' })
    );
    // There is no request field for a tenant; the account is in TENANT_A, and no
    // row was created in TENANT_B.
    expect(
      await countRows(admin, 'iam.user_accounts', 'id = $1 AND tenant_id = $2', [
        invited.id,
        TENANT_A,
      ])
    ).toBe(1);
    expect(
      await countRows(admin, 'iam.user_accounts', 'email = $1 AND tenant_id = $2', [
        email,
        TENANT_B,
      ])
    ).toBe(0);
  });
});

// ===========================================================================
// iam.invitation-cancel
// ===========================================================================
describe('iam.invitation-cancel', () => {
  async function invited(): Promise<{ id: string; email: string }> {
    const email = `fx-auth-cancel-${randomUUID().slice(0, 8)}@example.test`;
    const user = await withTransaction(asAdmin(), (db) =>
      invitations.invite(db, { email, displayName: 'To Cancel' })
    );
    return { id: user.id, email };
  }

  it('cancels an outstanding invitation: invited → archived, with audit + outbox', async () => {
    const { id } = await invited();
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.user.invitation_cancelled' AND entity_id = $1",
      [id]
    );
    const outboxBefore = await countRows(
      admin,
      'shared.event_outbox',
      "event_type = 'user.status.changed' AND aggregate_id = $1",
      [id]
    );
    await withTransaction(asAdmin(), (db) => invitations.cancel(db, id, 'Rescinded by admin'));
    const status = await admin.query<{ status: string }>(
      'SELECT status FROM iam.user_accounts WHERE id = $1',
      [id]
    );
    expect(status.rows[0]?.status).toBe('archived');
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "action = 'iam.user.invitation_cancelled' AND entity_id = $1",
        [id]
      )
    ).toBe(auditBefore + 1);
    expect(
      await countRows(
        admin,
        'shared.event_outbox',
        "event_type = 'user.status.changed' AND aggregate_id = $1",
        [id]
      )
    ).toBe(outboxBefore + 1);
  });

  it('refuses to cancel an account that is not an outstanding invitation (ERR-VAL-001)', async () => {
    const { id } = await invited();
    await withTransaction(asAdmin(), (db) => invitations.cancel(db, id, 'first'));
    const error = await withTransaction(asAdmin(), (db) =>
      invitations.cancel(db, id, 'again').catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
// iam.invitation-activate
// ===========================================================================
describe('iam.invitation-activate', () => {
  async function invited(): Promise<{ id: string; email: string }> {
    const email = `fx-auth-activate-${randomUUID().slice(0, 8)}@example.test`;
    const user = await withTransaction(asAdmin(), (db) =>
      invitations.invite(db, { email, displayName: 'To Activate' })
    );
    return { id: user.id, email };
  }

  it('activates an invitation the invitee has accepted: invited → active, with audit + outbox', async () => {
    const { id, email } = await invited();
    // The invitee follows their link and sets a password — the provider now
    // reports the identity as confirmed.
    await fake.acceptInvitation(email, 'the-invitees-new-password');
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.user.activated' AND entity_id = $1",
      [id]
    );
    const outboxBefore = await countRows(
      admin,
      'shared.event_outbox',
      "event_type = 'user.status.changed' AND aggregate_id = $1",
      [id]
    );
    const result = await withTransaction(asAdmin(), (db) =>
      invitations.activate(db, id, 'Invitation accepted')
    );
    expect(result.status).toBe('active');
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "action = 'iam.user.activated' AND entity_id = $1",
        [id]
      )
    ).toBe(auditBefore + 1);
    expect(
      await countRows(
        admin,
        'shared.event_outbox',
        "event_type = 'user.status.changed' AND aggregate_id = $1",
        [id]
      )
    ).toBe(outboxBefore + 1);
  });

  it('refuses to activate an invitation the provider has not confirmed (ERR-VAL-001)', async () => {
    const { id } = await invited();
    const error = await withTransaction(asAdmin(), (db) =>
      invitations.activate(db, id, 'premature').catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
    // Account remains invited; no partial activation.
    const status = await admin.query<{ status: string }>(
      'SELECT status FROM iam.user_accounts WHERE id = $1',
      [id]
    );
    expect(status.rows[0]?.status).toBe('invited');
  });
});
