/**
 * Account and security for a PLATFORM-ONLY identity, proven on the response.
 *
 * `POST /platform/account/password` exists because the tenant profile surface
 * cannot serve the principal the Platform Owner Console is built for: a holder
 * of `iam.platform_grants` with no tenant role at all. Every tenant operation
 * resolves through `iam.has_permission`, which returns false without an active
 * role in the current tenant.
 *
 * Four subjects, each one a different KIND of caller:
 *
 *   PLATFORM_ONLY  a platform grant and NO tenant role — the console operator;
 *   TENANT_ONLY    a generous tenant role and no platform grant — refused,
 *                  because tenant authority is the wrong kind of authority;
 *   OTHER          a second platform operator, used to prove that the identity
 *                  acted on comes from the caller's own token;
 *   (none)         no session at all.
 *
 * The identity provider is the deterministic double, driven through the real
 * port: the suite mints a real token with it, re-authenticates through it, and
 * asserts the credential it holds afterwards. Nothing about a password is
 * asserted by reading a database column, because RootLco stores none.
 *
 * COVERAGE-EVIDENCE (Owner directive — console account and security):
 *   iam.account-password-change: route service authorization unauthenticated success denial audit provider
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  platformAppPool,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __resetRateLimitForTests } from '@/server/http/rate-limit';
import { __setPlatformPoolForTests, __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { FakeIdentityProvider, setIdentityProvider } from '@/modules/iam';
import { __resetIdentityProviderForTests } from '@/modules/iam/provider/identity-provider';
import {
  ACCOUNT_PASSWORD_CHANGE_OPERATION,
  POST as changePasswordRoute,
} from '@/app/api/v1/platform/account/password/route';

const IDENTITY_PROVIDER = 'test_harness';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';

const SUBJECT_PLATFORM = 'fx_odas_platform';
const USER_PLATFORM = 'd3210000-0000-4000-8000-00000000000a';
const EMAIL_PLATFORM = 'fx_odas_platform@fixture.test';

const SUBJECT_OTHER = 'fx_odas_other';
const USER_OTHER = 'd3210000-0000-4000-8000-00000000000b';
const EMAIL_OTHER = 'fx_odas_other@fixture.test';

const SUBJECT_TENANT = 'fx_odas_tenant';
const USER_TENANT = 'd3210000-0000-4000-8000-00000000000c';
const EMAIL_TENANT = 'fx_odas_tenant@fixture.test';
const ROLE_TENANT = 'd3210000-0000-4000-8000-00000000000d';

const FIRST_PASSWORD = 'first-password-that-is-long';
const NEXT_PASSWORD = 'second-password-that-is-long';
const TOO_WEAK = 'short';

const PATH = '/platform/account/password';

let admin: Pool;
let runtime: Pool;
let platform: Pool;
let provider: FakeIdentityProvider;

interface Violation {
  readonly path: string;
  readonly rule: string;
}
interface Problem {
  readonly code?: string;
  readonly title?: string;
  readonly violations?: readonly Violation[];
}
interface CallResult<T> {
  readonly status: number;
  readonly body: T;
  readonly raw: string;
}

async function call<T>(input: {
  readonly body?: unknown;
  readonly bearer?: string | null;
}): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.bearer) headers.authorization = `Bearer ${input.bearer}`;
  const request = new Request(`http://localhost/api/v1${PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input.body ?? {}),
  });
  const response = await changePasswordRoute(request);
  const raw = await response.text();
  return { status: response.status, body: (raw === '' ? null : JSON.parse(raw)) as T, raw };
}

function authenticateAs(providerSubject: string): void {
  // `auth-adjacent` allows ten a minute and this suite makes more than that per
  // subject. The throttle is proven by the Wave B suite, not here.
  __resetRateLimitForTests();
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId: TENANT_A,
    })
  );
}

/** A real token for `email`, minted by the double through the real port. */
async function tokenFor(email: string, password: string): Promise<string> {
  const session = await provider.authenticate(email, password);
  return session.accessToken;
}

async function seedSubjects(): Promise<void> {
  for (const [id, subject, email] of [
    [USER_PLATFORM, SUBJECT_PLATFORM, EMAIL_PLATFORM],
    [USER_OTHER, SUBJECT_OTHER, EMAIL_OTHER],
    [USER_TENANT, SUBJECT_TENANT, EMAIL_TENANT],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Account security fixture', 'active', $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, IDENTITY_PROVIDER, subject, email, SYSTEM_ACTOR]
    );
  }

  // The console BASE entitlement, and deliberately nothing else: the operation
  // must be reachable by the least authority any console operator can hold.
  for (const account of [USER_PLATFORM, USER_OTHER]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, 'platform.organization.read', $2, $2) ON CONFLICT DO NOTHING`,
      [account, SYSTEM_ACTOR]
    );
  }

  // A generous TENANT role and no platform grant.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, description, is_system, created_by)
     VALUES ($1, $2, 'odas_tenant_admin', 'Account security tenant admin', 'fixture', false, $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_TENANT, TENANT_A, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $2, $1, p.id, 'allow', $3
       FROM iam.permissions p
      WHERE p.permission_code IN ('org.tenant.read','iam.user.manage','iam.role.manage','iam.audit.view')
     ON CONFLICT DO NOTHING`,
    [ROLE_TENANT, TENANT_A, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, USER_TENANT, ROLE_TENANT, SYSTEM_ACTOR]
  );
}

async function auditRowsFor(entityId: string) {
  const { rows } = await admin.query<{
    id: string;
    actor_id: string | null;
    action: string;
    entity_type: string;
    occurred_at: Date;
  }>(
    `SELECT id, actor_id, action, entity_type, occurred_at
       FROM iam.audit_records
      WHERE action = 'iam.password.changed' AND entity_id = $1
      ORDER BY occurred_at`,
    [entityId]
  );
  return rows;
}

async function auditDetailsFor(recordId: string) {
  const { rows } = await admin.query<{
    field_name: string;
    old_value_masked: string | null;
    new_value_masked: string | null;
  }>(
    `SELECT field_name, old_value_masked, new_value_masked
       FROM iam.audit_record_details WHERE audit_record_id = $1`,
    [recordId]
  );
  return rows;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = 'https://app.test/welcome';
  __resetBackendConfigForTests();

  provider = new FakeIdentityProvider({
    secret: 'account-security-secret-not-real',
    issuer: 'https://auth.test.local/auth/v1',
    audience: 'authenticated',
  });
  setIdentityProvider(provider);

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSubjects();

  runtime = runtimeAppPool(6);
  platform = platformAppPool(6);
  __setPrimaryPoolForTests(runtime);
  __setPlatformPoolForTests(platform);
}, 180_000);

beforeEach(() => {
  // The double is re-seeded before every test, so one test's credential change
  // cannot decide the next test's outcome.
  provider.reset();
  for (const [subject, email] of [
    [SUBJECT_PLATFORM, EMAIL_PLATFORM],
    [SUBJECT_OTHER, EMAIL_OTHER],
    [SUBJECT_TENANT, EMAIL_TENANT],
  ] as const) {
    provider.seed({
      subject,
      email,
      password: FIRST_PASSWORD,
      confirmed: true,
      tenantId: TENANT_A,
    });
  }
  authenticateAs(SUBJECT_PLATFORM);
});

afterAll(async () => {
  __resetAuthenticatorForTests();
  __resetIdentityProviderForTests();
  await admin.query(`DELETE FROM iam.platform_grants WHERE account_id = ANY($1::uuid[])`, [
    [USER_PLATFORM, USER_OTHER],
  ]);
  await runtime.end();
  await platform.end();
  await admin.end();
}, 60_000);

describe('the operation declares what the console depends on', () => {
  it('names the base console entitlement, audits as a security act, and is not idempotent', () => {
    expect(ACCOUNT_PASSWORD_CHANGE_OPERATION.id).toBe('iam.account-password-change');
    expect(ACCOUNT_PASSWORD_CHANGE_OPERATION.path).toBe(PATH);
    expect(ACCOUNT_PASSWORD_CHANGE_OPERATION.permissions).toEqual(['platform.organization.read']);
    expect(ACCOUNT_PASSWORD_CHANGE_OPERATION.auditClass).toBe('security');
    expect(ACCOUNT_PASSWORD_CHANGE_OPERATION.auditAction).toBe('iam.password.changed');
    // An idempotency fingerprint over a body carrying two passwords is refused
    // by ERR-INT-003, so declaring it would make every request fail.
    expect(ACCOUNT_PASSWORD_CHANGE_OPERATION.idempotent).toBeUndefined();
  });
});

describe('a platform-only identity changes its own password', () => {
  it('replaces the credential at the provider and refuses the old one afterwards', async () => {
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call<{ status: string; otherSessions: string }>({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('password-changed');
    expect(result.body.otherSessions).toBe('ended-at-provider');

    // The credential itself, asked of the provider rather than read anywhere.
    await expect(provider.authenticate(EMAIL_PLATFORM, NEXT_PASSWORD)).resolves.toMatchObject({
      subject: SUBJECT_PLATFORM,
    });
    await expect(provider.authenticate(EMAIL_PLATFORM, FIRST_PASSWORD)).rejects.toMatchObject({
      reason: 'invalid-credentials',
    });
  });

  it('neither echoes a password nor returns anything but the two published fields', async () => {
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call<Record<string, unknown>>({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
    });

    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual(['otherSessions', 'status']);
    expect(result.raw).not.toContain(FIRST_PASSWORD);
    expect(result.raw).not.toContain(NEXT_PASSWORD);
  });

  it('ends every other session of the identity at the provider', async () => {
    // A session opened BEFORE the change, on another device.
    const otherDevice = await provider.authenticate(EMAIL_PLATFORM, FIRST_PASSWORD);
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);

    const result = await call<{ otherSessions: string }>({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
    });
    expect(result.status).toBe(200);
    expect(result.body.otherSessions).toBe('ended-at-provider');

    await expect(provider.verifyToken(otherDevice.accessToken)).rejects.toMatchObject({
      reason: 'invalid-token',
    });
  });

  it('acts on the caller of the token and never on another operator', async () => {
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
    });
    expect(result.status).toBe(200);

    // The second operator's credential is untouched: there is no field in the
    // request document that could have named them.
    await expect(provider.authenticate(EMAIL_OTHER, FIRST_PASSWORD)).resolves.toMatchObject({
      subject: SUBJECT_OTHER,
    });
  });
});

describe('a refusal names which field the caller must correct', () => {
  it('refuses a wrong current password with ERR-IAM-003 and changes nothing', async () => {
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call<Problem>({
      bearer,
      body: { currentPassword: 'not-the-current-password', newPassword: NEXT_PASSWORD },
    });

    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ERR-IAM-003');
    expect(result.body.violations).toEqual([
      { path: 'body.currentPassword', rule: 'did_not_verify' },
    ]);
    // Still the old credential, and the attempted new one was never written.
    await expect(provider.authenticate(EMAIL_PLATFORM, FIRST_PASSWORD)).resolves.toBeTruthy();
    await expect(provider.authenticate(EMAIL_PLATFORM, NEXT_PASSWORD)).rejects.toMatchObject({
      reason: 'invalid-credentials',
    });
  });

  it("refuses a new password the provider's own policy rejects, with ERR-IAM-004", async () => {
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call<Problem>({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: TOO_WEAK },
    });

    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ERR-IAM-004');
    expect(result.body.violations).toEqual([
      { path: 'body.newPassword', rule: 'refused_by_identity_provider' },
    ]);
    // The provider's own sentence is written to the operator log and is
    // deliberately NOT in the response: ADR-019 §3, and the interface renders
    // catalogued keys in two languages.
    expect(result.raw).not.toContain('at least');
    expect(result.raw).not.toContain(TOO_WEAK);
    await expect(provider.authenticate(EMAIL_PLATFORM, FIRST_PASSWORD)).resolves.toBeTruthy();
  });

  it('tells the two refusals apart by code, for the same account and the same session', async () => {
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const wrongCurrent = await call<Problem>({
      bearer,
      body: { currentPassword: 'wrong', newPassword: NEXT_PASSWORD },
    });
    const weakNew = await call<Problem>({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: TOO_WEAK },
    });
    expect(wrongCurrent.body.code).not.toBe(weakNew.body.code);
  });

  it('refuses a body that names a field the operation does not publish', async () => {
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call<Problem>({
      bearer,
      body: {
        currentPassword: FIRST_PASSWORD,
        newPassword: NEXT_PASSWORD,
        email: EMAIL_OTHER,
      },
    });
    // The identity is never taken from the request document, and a body trying
    // to name one is refused rather than ignored.
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ERR-VAL-001');
  });
});

describe('who may reach it', () => {
  it('admits a platform-only identity that holds no tenant role whatsoever', async () => {
    const { rows } = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM iam.role_grants WHERE user_id = $1`,
      [USER_PLATFORM]
    );
    expect(rows[0]?.count).toBe('0');

    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
    });
    expect(result.status).toBe(200);
  });

  it('refuses a tenant user who holds no platform authority, with ERR-IAM-001', async () => {
    authenticateAs(SUBJECT_TENANT);
    const bearer = await tokenFor(EMAIL_TENANT, FIRST_PASSWORD);
    const result = await call<Problem>({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
    });

    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
    // Their credential is untouched: the refusal happens before the provider is
    // asked anything at all.
    await expect(provider.authenticate(EMAIL_TENANT, FIRST_PASSWORD)).resolves.toBeTruthy();
    await expect(provider.authenticate(EMAIL_TENANT, NEXT_PASSWORD)).rejects.toMatchObject({
      reason: 'invalid-credentials',
    });
  });

  it('answers 401 ERR-IAM-002 to a caller with no session', async () => {
    __resetAuthenticatorForTests();
    const result = await call<Problem>({
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
    });
    expect(result.status).toBe(401);
    expect(result.body.code).toBe('ERR-IAM-002');
  });
});

describe('the audit record says who and when, and nothing that could be a credential', () => {
  it('appends exactly one catalogued record carrying the actor and the time', async () => {
    const before = await auditRowsFor(USER_PLATFORM);
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call({
      bearer,
      body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
    });
    expect(result.status).toBe(200);

    const after = await auditRowsFor(USER_PLATFORM);
    expect(after.length).toBe(before.length + 1);
    const written = after[after.length - 1];
    expect(written?.action).toBe('iam.password.changed');
    expect(written?.entity_type).toBe('iam.user_account');
    expect(written?.actor_id).toBe(USER_PLATFORM);
    expect(written?.occurred_at).toBeInstanceOf(Date);
  });

  it('writes no password, no hash and no token into the record or its details', async () => {
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    expect(
      (
        await call({
          bearer,
          body: { currentPassword: FIRST_PASSWORD, newPassword: NEXT_PASSWORD },
        })
      ).status
    ).toBe(200);

    const rows = await auditRowsFor(USER_PLATFORM);
    const written = rows[rows.length - 1];
    expect(written).toBeDefined();
    const details = await auditDetailsFor(written?.id as string);
    const text = JSON.stringify(details);
    expect(text).not.toContain(FIRST_PASSWORD);
    expect(text).not.toContain(NEXT_PASSWORD);
    expect(text).not.toContain(bearer);
    // What it DOES carry: how the change was authorised, and only that.
    expect(details.map((row) => row.field_name)).toEqual(['verification']);
    expect(details[0]?.new_value_masked).toBe('current-password');
  });

  it('writes no record when the current password did not verify', async () => {
    const before = await auditRowsFor(USER_PLATFORM);
    const bearer = await tokenFor(EMAIL_PLATFORM, FIRST_PASSWORD);
    const result = await call({
      bearer,
      body: { currentPassword: 'wrong', newPassword: NEXT_PASSWORD },
    });
    expect(result.status).toBe(422);
    expect((await auditRowsFor(USER_PLATFORM)).length).toBe(before.length);
  });
});
