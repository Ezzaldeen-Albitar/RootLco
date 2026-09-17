/**
 * Recovering an invitation that the seat ceiling refused — the Owner directive.
 *
 * `iam.invitation-create` writes to two systems that cannot share a transaction:
 * it creates an identity at the provider and then inserts the account that gives
 * that identity meaning. `tg_user_accounts_capacity` refuses the second one when
 * the subscription's seats are spent, and a rollback cannot reach the first — so
 * the question this suite exists to answer is what the organisation is left
 * holding after a refusal, and whether the invitation can simply be made again
 * once a seat exists.
 *
 * Everything is measured as a DELTA around the call, because a refusal that
 * leaves the totals where they were is the only form of the claim worth making:
 * an absolute count agrees with a leak the moment a sibling case creates a row.
 *
 * Every tenant here carries the `odinv_` prefix and is removed by that prefix
 * only. No other suite in the tier deletes by it, and the shared fixture tenants
 * are never given a subscription — a ceiling on those would change what every
 * other suite runs under.
 *
 * COVERAGE-EVIDENCE (Owner directive invitation capacity recovery):
 *   iam.invitation-create: route service success audit
 *   iam.auth-login: denial
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { adminPool, deleteTenantCascade, ensureTestLogins, runtimeAppPool } from './helpers';
import { ensureOrgFixtures } from '../db/helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { FakeIdentityProvider, iamModule, setIdentityProvider } from '@/modules/iam';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';

import {
  INVITE_OPERATION,
  POST as invitationCreateRoute,
} from '@/app/api/v1/iam/invitations/route';
import { LOGIN_OPERATION, POST as loginRoute } from '@/app/api/v1/auth/login/route';

const IDENTITY_PROVIDER = 'test_harness';
const SYS = '00000000-0000-4000-8000-000000000001';
const RUN = randomUUID().slice(0, 8);
const REDIRECT_ALLOWED = 'https://app.test.local/invitation';

const code = (label: string): string => `odinv_be_${label}_${RUN}`;
const address = (label: string): string => `${code(label)}@example.test`;

const ALPHA = { tenantId: randomUUID(), companyId: randomUUID() };
const BRAVO = { tenantId: randomUUID(), companyId: randomUUID() };

const SUBJECT_ADMIN = code('admin');
const SUBJECT_BRAVO = code('bravo');

// `iam.grant.manage` is what `ins_role_grants_delegable` asks for, and
// `org.tenant.read` is the code the delegated role below carries — a role can
// only be granted by somebody who holds every permission in it.
const ADMIN_CODES = ['iam.user.manage', 'iam.grant.manage', 'org.tenant.read'];

let admin: Pool;
let runtime: Pool;
let fake: FakeIdentityProvider;
/**
 * A role the administrator may delegate, attached to every invitation below.
 *
 * Without one the "no grant was written" assertion would be trivially true — the
 * refused invitation never asked for a role, so of course none appeared. With
 * one, the admitted invitation really does write a grant, so the refused one's
 * zero is a measurement rather than a tautology.
 */
let inviteeRoleId = '';

type CallResult<T> = { readonly status: number; readonly body: T };
type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>;

let currentClaims: { providerSubject: string; tenantId: string } | null = null;

/**
 * Re-installed before EVERY request: composing `iamModule()` replaces the
 * session authenticator, so one installed at setup silently stops applying
 * after the first route call in the process.
 */
function reinstallAuthenticator(): void {
  if (currentClaims === null) {
    __resetAuthenticatorForTests();
    return;
  }
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({ identityProvider: IDENTITY_PROVIDER, ...currentClaims })
  );
}

const asAdmin = (): void => {
  currentClaims = { providerSubject: SUBJECT_ADMIN, tenantId: ALPHA.tenantId };
};
const asAnonymous = (): void => {
  currentClaims = null;
};

async function call<T>(
  handler: unknown,
  input: {
    readonly path: string;
    readonly method?: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
  }
): Promise<CallResult<T>> {
  reinstallAuthenticator();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await (handler as RouteHandler)(request, { params: Promise.resolve({}) });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

const invite = (body: Record<string, unknown>) =>
  call<{ id?: string; status?: string; code?: string; capacity?: unknown }>(invitationCreateRoute, {
    path: '/iam/invitations',
    body,
    idempotencyKey: randomUUID(),
  });

async function scalar<T>(sql: string, values: readonly unknown[] = []): Promise<T | null> {
  const { rows } = await admin.query(sql, values as unknown[]);
  return rows.length === 0 ? null : (Object.values(rows[0] as object)[0] as T);
}

const count = async (sql: string, values: readonly unknown[] = []): Promise<number> =>
  Number(await scalar<string>(sql, values));

/**
 * Every figure a refused invitation must leave untouched, read in one place so a
 * case cannot quietly measure fewer of them than the one before it.
 *
 * `org.capacity_usage` is the DATABASE's own seat arithmetic — the same function
 * the ceiling is enforced from and the capacity screen is answered from — rather
 * than a count of accounts written here, which would be a second copy of the rule
 * agreeing with itself.
 */
interface Footprint {
  readonly accounts: number;
  readonly grants: number;
  readonly scopes: number;
  readonly statusHistory: number;
  readonly invitedAudit: number;
  readonly invitedEvents: number;
  readonly sessions: number;
  readonly seatsUsed: number;
}

async function footprintOf(tenantId: string): Promise<Footprint> {
  const usage = await scalar<{ users: { used: number; limit: number | null } }>(
    'SELECT org.capacity_usage($1)',
    [tenantId]
  );
  return {
    accounts: await count('SELECT count(*) FROM iam.user_accounts WHERE tenant_id = $1', [
      tenantId,
    ]),
    grants: await count('SELECT count(*) FROM iam.role_grants WHERE tenant_id = $1', [tenantId]),
    scopes: await count('SELECT count(*) FROM iam.grant_scopes WHERE tenant_id = $1', [tenantId]),
    statusHistory: await count(
      'SELECT count(*) FROM iam.user_status_history WHERE tenant_id = $1',
      [tenantId]
    ),
    invitedAudit: await count(
      `SELECT count(*) FROM iam.audit_records WHERE tenant_id = $1 AND action = 'iam.user.invited'`,
      [tenantId]
    ),
    invitedEvents: await count(
      `SELECT count(*) FROM shared.event_outbox WHERE tenant_id = $1 AND event_type = 'user.invited'`,
      [tenantId]
    ),
    sessions: await count('SELECT count(*) FROM iam.user_sessions WHERE tenant_id = $1', [
      tenantId,
    ]),
    seatsUsed: usage === null ? -1 : usage.users.used,
  };
}

const seatLimitOf = async (tenantId: string): Promise<number | null> => {
  const usage = await scalar<{ users: { used: number; limit: number | null } }>(
    'SELECT org.capacity_usage($1)',
    [tenantId]
  );
  return usage === null ? null : usage.users.limit;
};

async function seedTenant(
  tenant: { tenantId: string; companyId: string },
  label: string
): Promise<void> {
  await admin.query(
    `INSERT INTO org.tenants (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
     VALUES ($1, $2, 'Invitation recovery fixture', 'active', 'en', 'UTC', $3)`,
    [tenant.tenantId, code(`t_${label}`), SYS]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, $3, 'Invitation recovery fixture company', 'USD', $4)`,
    [tenant.companyId, tenant.tenantId, code(`c_${label}`), SYS]
  );
}

async function seedActor(
  tenantId: string,
  subject: string,
  codes: readonly string[]
): Promise<void> {
  const userId = randomUUID();
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'Invitation recovery fixture', 'active', $6)`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, `${subject}@example.test`, SYS]
  );
  const roleId = randomUUID();
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by) VALUES ($1, $2, $3, 'Fixture role', $4)`,
    [roleId, tenantId, `${subject}_role`, SYS]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])`,
    [tenantId, roleId, SYS, codes]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
    [tenantId, userId, roleId, SYS]
  );
}

/**
 * Moves the organisation onto a plan with a different seat ceiling, through the
 * assignment the schema models: the running assignment is expired at this
 * instant and a new active one begins. Editing the seat number in place would
 * have proved that a number can be edited, not that raising a customer's plan
 * lets the invitation through.
 */
async function assignSeatLimit(maxUsers: number): Promise<void> {
  await admin.query(
    `UPDATE org.tenant_subscriptions
        SET status = 'expired', effective_to = now()
      WHERE tenant_id = $1 AND status = 'active' AND effective_to IS NULL`,
    [ALPHA.tenantId]
  );
  const planId = randomUUID();
  await admin.query(
    `INSERT INTO org.subscription_plans (id, plan_code, name, capacity_limits, status, effective_from, created_by)
     VALUES ($1, $2, 'Invitation recovery fixture plan', $3::jsonb, 'active', now() - interval '1 day', $4)`,
    [planId, code(`plan_${maxUsers}`), JSON.stringify({ max_users: maxUsers }), SYS]
  );
  await admin.query(
    `INSERT INTO org.tenant_subscriptions (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
     VALUES ($1, $2, 'active', now(), $3, $3)`,
    [ALPHA.tenantId, planId, SYS]
  );
}

async function removeOwnFixtures(): Promise<void> {
  const { rows } = await admin.query<{ id: string }>(
    `SELECT id FROM org.tenants WHERE tenant_code LIKE 'odinv\\_%'`
  );
  await deleteTenantCascade(
    admin,
    rows.map((row) => row.id)
  );
  await admin.query(`DELETE FROM org.subscription_plans WHERE plan_code LIKE 'odinv\\_%'`);
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = REDIRECT_ALLOWED;
  __resetBackendConfigForTests();

  fake = new FakeIdentityProvider({
    secret: 'od-invitation-capacity-recovery-secret-not-real',
    issuer: 'https://auth.test.local/auth/v1',
    audience: 'authenticated',
  });
  setIdentityProvider(fake);

  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await removeOwnFixtures();

  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);

  await seedTenant(ALPHA, 'alpha');
  await seedTenant(BRAVO, 'bravo');
  await seedActor(ALPHA.tenantId, SUBJECT_ADMIN, ADMIN_CODES);
  await seedActor(BRAVO.tenantId, SUBJECT_BRAVO, ADMIN_CODES);

  inviteeRoleId = randomUUID();
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by) VALUES ($1, $2, $3, 'Invitee role', $4)`,
    [inviteeRoleId, ALPHA.tenantId, code('invitee_role'), SYS]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = 'org.tenant.read'`,
    [ALPHA.tenantId, inviteeRoleId, SYS]
  );

  // One seat is already held by the administrator seeded above, so a ceiling of
  // two leaves exactly one free for the first case to spend.
  await assignSeatLimit(2);

  iamModule();
}, 120_000);

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  __resetAuthenticatorForTests();
  await runtime.end();
  await removeOwnFixtures();
  await admin.end();
}, 60_000);

describe('the operations under test', () => {
  it('names the invitation and the login the recovery is measured through', () => {
    expect(INVITE_OPERATION.id).toBe('iam.invitation-create');
    expect(INVITE_OPERATION.permissions).toEqual(['iam.user.manage']);
    expect(LOGIN_OPERATION.id).toBe('iam.auth-login');
  });
});

describe('(a) an invitation the seat ceiling refuses', () => {
  const firstEmail = address('seat_holder');
  const refusedEmail = address('refused');
  const ghostEmail = address('ghost');
  let ghostSubject = '';

  it('admits the invitation that takes the last seat, with the role it was given', async () => {
    const before = await footprintOf(ALPHA.tenantId);
    asAdmin();
    const admitted = await invite({
      email: firstEmail,
      displayName: 'Seat Holder',
      roleIds: [inviteeRoleId],
    });
    expect([200, 201]).toContain(admitted.status);
    expect(admitted.body.status).toBe('invited');

    const after = await footprintOf(ALPHA.tenantId);
    expect(after.seatsUsed).toBe(2);
    expect(after.grants - before.grants).toBe(1);
    expect(await seatLimitOf(ALPHA.tenantId)).toBe(2);
  });

  it('answers ERR-CAP-001 and moves nothing at all', async () => {
    const before = await footprintOf(ALPHA.tenantId);
    asAdmin();
    const refused = await invite({
      email: refusedEmail,
      displayName: 'Refused Invitee',
      roleIds: [inviteeRoleId],
    });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ERR-CAP-001');
    expect(refused.body.capacity).toEqual({ kind: 'users', limit: 2, used: 2 });

    // Every figure, as a delta. No account, no membership, no role grant, no
    // scope, no status row, no audit record claiming an invitation happened, no
    // published event, and the seat arithmetic exactly where it was.
    expect(await footprintOf(ALPHA.tenantId)).toEqual(before);

    // And the row really is absent rather than merely uncounted.
    expect(
      await count('SELECT count(*) FROM iam.user_accounts WHERE email = $1', [refusedEmail])
    ).toBe(0);
  });

  it('leaves no provider identity behind for the address it refused', async () => {
    expect(await fake.findByEmail(refusedEmail)).toBeNull();
  });

  it('gives the refused address no way to sign in and no session', async () => {
    const before = await footprintOf(ALPHA.tenantId);
    asAnonymous();
    const denied = await call<{ code: string; accessToken?: unknown }>(loginRoute, {
      path: '/auth/login',
      body: { email: refusedEmail, password: 'correct horse battery staple' },
    });

    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe('ERR-IAM-002');
    expect(denied.body.accessToken).toBeUndefined();
    expect(await footprintOf(ALPHA.tenantId)).toEqual(before);
    expect(await fake.findByEmail(refusedEmail)).toBeNull();
  });

  it('cannot be authenticated into the organisation while no account references it', async () => {
    // An identity in exactly the state a refusal used to leave behind — it exists
    // at the provider, it is confirmed, it has a password and it is bound to this
    // organisation — and there is no account for it. It must reach nothing.
    const ghost = fake.seed({
      email: ghostEmail,
      password: 'correct horse battery staple',
      confirmed: true,
      tenantId: ALPHA.tenantId,
    });
    ghostSubject = ghost.subject;

    const before = await footprintOf(ALPHA.tenantId);
    asAnonymous();
    const denied = await call<{ code: string }>(loginRoute, {
      path: '/auth/login',
      body: { email: ghostEmail, password: 'correct horse battery staple' },
    });

    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe('ERR-IAM-002');
    expect(await footprintOf(ALPHA.tenantId)).toEqual(before);
    expect(
      await count('SELECT count(*) FROM iam.user_accounts WHERE provider_subject = $1', [
        ghostSubject,
      ])
    ).toBe(0);
  });
});

describe('(b) the same address, once a seat exists', () => {
  const refusedEmail = address('refused');

  it('succeeds and consumes exactly one seat', async () => {
    await assignSeatLimit(3);
    expect(await seatLimitOf(ALPHA.tenantId)).toBe(3);

    const before = await footprintOf(ALPHA.tenantId);
    asAdmin();
    const admitted = await invite({ email: refusedEmail, displayName: 'Refused Invitee' });

    expect([200, 201]).toContain(admitted.status);
    expect(admitted.body.status).toBe('invited');

    const after = await footprintOf(ALPHA.tenantId);
    expect(after.seatsUsed - before.seatsUsed).toBe(1);
    expect(after.accounts - before.accounts).toBe(1);
    expect(after.invitedAudit - before.invitedAudit).toBe(1);
    expect(after.invitedEvents - before.invitedEvents).toBe(1);
    expect(
      await count('SELECT count(*) FROM iam.user_accounts WHERE email = $1', [refusedEmail])
    ).toBe(1);
  });
});

describe('(b) an orphan identity that already exists is reused, not blocked', () => {
  const orphanEmail = address('orphan');
  let orphanSubject = '';

  it('invites the same identity the provider already holds and takes one seat', async () => {
    // The state a refusal left behind before the compensation existed: an
    // unconfirmed identity, bound to this organisation, with no account anywhere.
    orphanSubject = fake.seed({
      email: orphanEmail,
      confirmed: false,
      tenantId: ALPHA.tenantId,
    }).subject;

    await assignSeatLimit(4);
    const before = await footprintOf(ALPHA.tenantId);
    asAdmin();
    const admitted = await invite({ email: orphanEmail, displayName: 'Healed Invitee' });

    expect([200, 201]).toContain(admitted.status);
    const after = await footprintOf(ALPHA.tenantId);
    expect(after.seatsUsed - before.seatsUsed).toBe(1);
    expect(after.accounts - before.accounts).toBe(1);

    // The SAME identity, not a second one: the account points at the subject the
    // provider already held, and the provider still holds exactly that subject.
    expect(
      await scalar<string>('SELECT provider_subject FROM iam.user_accounts WHERE email = $1', [
        orphanEmail,
      ])
    ).toBe(orphanSubject);
    expect((await fake.findByEmail(orphanEmail))?.subject).toBe(orphanSubject);
  });
});

describe('an identity that is not this organisation to reuse stays refused', () => {
  const foreignEmail = address('foreign');
  let foreignSubject = '';

  it('refuses an address bound to another organisation and leaves its binding alone', async () => {
    foreignSubject = fake.seed({
      email: foreignEmail,
      confirmed: false,
      tenantId: BRAVO.tenantId,
    }).subject;

    const before = await footprintOf(ALPHA.tenantId);
    asAdmin();
    const refused = await invite({ email: foreignEmail, displayName: 'Foreign Invitee' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ERR-RES-002');
    expect(await footprintOf(ALPHA.tenantId)).toEqual(before);

    // Untouched: the binding still names the organisation it belonged to, so an
    // invitation cannot be used to take another tenant's identity.
    const still = await fake.findBySubject(foreignSubject);
    expect(still?.tenantId).toBe(BRAVO.tenantId);
  });

  it('refuses an address this organisation already has an account for', async () => {
    const before = await footprintOf(ALPHA.tenantId);
    asAdmin();
    const refused = await invite({
      email: address('seat_holder'),
      displayName: 'Duplicate Invitee',
    });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ERR-RES-002');
    expect(await footprintOf(ALPHA.tenantId)).toEqual(before);
  });
});

describe('(c) two invitations racing for the last seat', () => {
  const raceOne = address('race_one');
  const raceTwo = address('race_two');

  it('admits exactly one of them and spends exactly one seat', async () => {
    // Four seats are held after the cases above; five makes exactly one free.
    await assignSeatLimit(5);
    const before = await footprintOf(ALPHA.tenantId);
    expect(before.seatsUsed).toBe(4);

    asAdmin();
    const [first, second] = await Promise.all([
      invite({ email: raceOne, displayName: 'Race One' }),
      invite({ email: raceTwo, displayName: 'Race Two' }),
    ]);

    const outcomes = [first, second];
    const admitted = outcomes.filter((result) => result.status === 200 || result.status === 201);
    const refused = outcomes.filter((result) => result.status === 409);
    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.body.code).toBe('ERR-CAP-001');
    expect(refused[0]?.body.capacity).toEqual({ kind: 'users', limit: 5, used: 5 });

    const after = await footprintOf(ALPHA.tenantId);
    expect(after.seatsUsed - before.seatsUsed).toBe(1);
    expect(after.accounts - before.accounts).toBe(1);
    expect(after.invitedAudit - before.invitedAudit).toBe(1);

    // Exactly one of the two addresses has an account, and the address that lost
    // has no identity left at the provider either.
    const winner =
      (await count('SELECT count(*) FROM iam.user_accounts WHERE email = $1', [raceOne])) === 1
        ? raceOne
        : raceTwo;
    const loser = winner === raceOne ? raceTwo : raceOne;
    expect(await count('SELECT count(*) FROM iam.user_accounts WHERE email = $1', [loser])).toBe(0);
    expect(await fake.findByEmail(loser)).toBeNull();
    expect((await fake.findByEmail(winner))?.subject).toBe(
      await scalar<string>('SELECT provider_subject FROM iam.user_accounts WHERE email = $1', [
        winner,
      ])
    );
  });
});

describe('an identity the refused invitation found, rather than made, survives the refusal', () => {
  const survivorEmail = address('survivor');

  it('answers ERR-CAP-001 and leaves the pre-existing identity exactly as it was', async () => {
    // The seats are all spent after the race above. The identity exists BEFORE
    // the invitation, bound to this organisation and reusable — so the refusal
    // arrives at the INSERT, after the reuse decision, which is the only place a
    // compensation could reach it.
    const seeded = fake.seed({
      email: survivorEmail,
      confirmed: false,
      tenantId: ALPHA.tenantId,
    });

    const before = await footprintOf(ALPHA.tenantId);
    expect(before.seatsUsed).toBe(5);
    expect(await seatLimitOf(ALPHA.tenantId)).toBe(5);

    asAdmin();
    const refused = await invite({ email: survivorEmail, displayName: 'Survivor Invitee' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ERR-CAP-001');
    expect(await footprintOf(ALPHA.tenantId)).toEqual(before);
    expect(
      await count('SELECT count(*) FROM iam.user_accounts WHERE email = $1', [survivorEmail])
    ).toBe(0);

    const after = await fake.findBySubject(seeded.subject);
    expect(after).not.toBeNull();
    expect(after?.email).toBe(survivorEmail);
    expect(after?.tenantId).toBe(ALPHA.tenantId);
    expect(after?.disabled).toBe(false);
    expect((await fake.findByEmail(survivorEmail))?.subject).toBe(seeded.subject);
  });
});

describe('a compensation the provider refuses is reported, never hidden', () => {
  const strandedEmail = address('stranded');

  it('still answers ERR-CAP-001 and still writes no account', async () => {
    const before = await footprintOf(ALPHA.tenantId);
    expect(before.seatsUsed).toBe(5);

    fake.refuseDelete = true;
    try {
      asAdmin();
      const refused = await invite({ email: strandedEmail, displayName: 'Stranded Invitee' });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('ERR-CAP-001');
    } finally {
      fake.refuseDelete = false;
    }

    // The caller is told the truth about the seat, and the database is untouched.
    expect(await footprintOf(ALPHA.tenantId)).toEqual(before);

    // The identity the provider would not remove is still there — and the next
    // invitation of that address reuses it rather than being blocked by it, which
    // is what makes the unremoved identity self-healing.
    const stranded = await fake.findByEmail(strandedEmail);
    expect(stranded).not.toBeNull();

    await assignSeatLimit(6);
    asAdmin();
    const healed = await invite({ email: strandedEmail, displayName: 'Stranded Invitee' });
    expect([200, 201]).toContain(healed.status);
    expect(
      await scalar<string>('SELECT provider_subject FROM iam.user_accounts WHERE email = $1', [
        strandedEmail,
      ])
    ).toBe(stranded?.subject);
  });
});

describe('two invitations of the SAME address racing for the last seat', () => {
  const contestedEmail = address('contested');

  it('admits one, refuses the other, and never removes the identity the winner holds', async () => {
    // Six seats are held after the healed invitation above; seven frees one.
    await assignSeatLimit(7);
    const before = await footprintOf(ALPHA.tenantId);
    expect(before.seatsUsed).toBe(6);
    expect(await fake.findByEmail(contestedEmail)).toBeNull();

    // Force the interleaving that makes the race dangerous: each directory read
    // of this address waits (boundedly) for the other one to arrive, so without
    // serialization BOTH requests read "no identity" and both believe they made
    // the subject the provider hands them. With the address lock the second read
    // cannot start until the first transaction has ended, the wait simply runs
    // out, and the second request reads the committed outcome instead.
    const original = fake.findByEmail.bind(fake);
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.findByEmail = async (email: string) => {
      if (email === contestedEmail) {
        arrived += 1;
        if (arrived >= 2) release();
        await Promise.race([bothArrived, new Promise((resolve) => setTimeout(resolve, 750))]);
      }
      return original(email);
    };

    asAdmin();
    let outcomes: Awaited<ReturnType<typeof invite>>[];
    try {
      outcomes = await Promise.all([
        invite({ email: contestedEmail, displayName: 'Contested One' }),
        invite({ email: contestedEmail, displayName: 'Contested Two' }),
      ]);
    } finally {
      fake.findByEmail = original;
    }

    const admitted = outcomes.filter((result) => result.status === 200 || result.status === 201);
    const refused = outcomes.filter((result) => result.status === 409);
    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    // Serialized on the address, the loser reads the winner's committed account
    // and is told the address is taken; a seat refusal would also leave nothing.
    expect(['ERR-RES-002', 'ERR-CAP-001']).toContain(refused[0]?.body.code);

    const after = await footprintOf(ALPHA.tenantId);
    expect(after.seatsUsed - before.seatsUsed).toBe(1);
    expect(after.accounts - before.accounts).toBe(1);
    expect(after.invitedAudit - before.invitedAudit).toBe(1);
    expect(
      await count('SELECT count(*) FROM iam.user_accounts WHERE email = $1', [contestedEmail])
    ).toBe(1);

    // The one account's identity is still at the provider: the refused request
    // did not remove the subject the winner's account references.
    const heldSubject = await scalar<string>(
      'SELECT provider_subject FROM iam.user_accounts WHERE email = $1',
      [contestedEmail]
    );
    const identity = await fake.findByEmail(contestedEmail);
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe(heldSubject);
    expect(await fake.findBySubject(heldSubject as string)).not.toBeNull();
  });
});
