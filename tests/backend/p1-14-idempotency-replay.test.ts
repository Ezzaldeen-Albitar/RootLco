/**
 * P1-14 idempotency replay evidence (CSA-22 remediation).
 *
 * Ten P1-14 operations declare `idempotent: true` on their route registration
 * and, until this suite existed, nothing ever exercised the promise. A retry
 * promise nobody exercised is a comment: `scripts/ci/check-idempotency-evidence.mjs`
 * exists precisely to stop that state persisting, and these ten were carried as
 * named, expiring exceptions rather than quietly accepted.
 *
 * ## What a replay must prove, and why each assertion is here
 *
 * `idempotent: true` tells the caller that re-sending a request that may or may
 * not have arrived is safe. "Safe" is not "returns 200 twice" — it is that the
 * SECOND request changes nothing. So every operation below is driven through its
 * REAL exported route handler with a real `Request`, on the deployed
 * `app_runtime` identity, and each of the four durable consequences is counted
 * either side of the replay:
 *
 *  - **state** — the rows the command exists to write;
 *  - **audit** — `iam.audit_records`, which is how a privileged action is
 *    accountable; a doubled audit row is a false accusation that someone acted
 *    twice;
 *  - **outbox** — `shared.event_outbox`, because a duplicated event is delivered
 *    to every downstream consumer and no amount of consumer-side care undoes a
 *    grant that was announced twice;
 *  - **the reservation itself** — exactly one `shared.idempotency_keys` row, so
 *    the replay was arbitrated by the key rather than by luck.
 *
 * Counting is done as DELTAS around each phase rather than as absolute totals.
 * An absolute count would pass just as happily if the command had written
 * nothing at all, which is the failure mode these tests are supposed to catch.
 *
 * The third case is the one that makes the first two trustworthy: the SAME key
 * with a DIFFERENT payload must be refused (`ERR-INT-001`, 409) and must execute
 * neither version. Without it "idempotent" could be implemented as "ignore the
 * body and replay whatever is stored", which would let a key issued for one
 * command be grafted onto another. The alternative payloads below are all
 * independently valid — each would succeed under a fresh key — so the refusal
 * can only come from the key comparison and never from ordinary validation.
 *
 * ## STATUS ON REPLAY — an observation, not an assertion
 *
 * Only the response BODY is stored (`withIdempotency` is handed
 * `(value) => value.body`), so a replay rebuilds the status line from nothing and
 * `result.status ?? 200` answers 200. Measured here: eight of the ten answer 201
 * on first use and 200 on replay, and `iam.user-status-change` also loses the
 * `recordVersion` its first response carried in an ETag.
 *
 * That is a response-shape inconsistency, not a double-write — no state, audit or
 * event is duplicated, which is what `idempotent: true` promises and what this
 * suite proves. It is left as an observation rather than pinned with an
 * assertion: pinning 200 would bless it, and asserting 201 would fail against
 * behaviour that no requirement currently forbids. Every existing replay test in
 * the repository asserts `.ok` for the same reason, so this file follows suit
 * rather than inventing a stricter rule for ten operations alone.
 *
 * ## Why the route and not the service
 *
 * The idempotency wrapper lives in `route-handler.ts`: it is the route that reads
 * `Idempotency-Key`, builds the principal-bound fingerprint from the resolved
 * context, and decides whether to execute. A service-level test cannot reach any
 * of that. Driving the exported `POST` is therefore the only depth at which the
 * declaration under test is the thing being exercised.
 *
 * Operations exercised here: iam.approval-limit-create, iam.grant-issue,
 * iam.grant-scope-add, iam.invitation-create, iam.invitation-activate,
 * iam.role-create, iam.role-permission-add, iam.user-status-change,
 * iam.branch-settings-write, iam.company-settings-write.
 *
 * Each line below claims only what this file actually asserts: the exported
 * handler is invoked (`route`), the first call succeeds with its declared status
 * (`success`), exactly one audit record appears (`audit`), and the replay
 * contract holds (`idempotency`). `outbox` is claimed for the five operations
 * whose services publish an event and withheld from the five that publish none —
 * claiming it for those would be a flag with no assertion behind it, which is the
 * exact failure this gate exists to catch.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   iam.approval-limit-create: route success audit idempotency
 *   iam.grant-issue: route success audit outbox idempotency
 *   iam.grant-scope-add: route success audit outbox idempotency
 *   iam.invitation-create: route success audit outbox idempotency
 *   iam.invitation-activate: route success audit outbox idempotency
 *   iam.role-create: route success audit idempotency
 *   iam.role-permission-add: route success audit idempotency
 *   iam.user-status-change: route success audit outbox idempotency
 *   iam.branch-settings-write: route success audit idempotency
 *   iam.company-settings-write: route success audit idempotency
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { toOperationCode } from '@/server/http/idempotency';
import { FakeIdentityProvider, setIdentityProvider } from '@/modules/iam';
import { POST as APPROVAL_LIMIT_CREATE } from '@/app/api/v1/iam/approval-limits/route';
import { POST as GRANT_ISSUE } from '@/app/api/v1/iam/grants/route';
import { POST as GRANT_SCOPE_ADD } from '@/app/api/v1/iam/grants/[grantId]/scopes/route';
import { POST as INVITATION_CREATE } from '@/app/api/v1/iam/invitations/route';
import { POST as INVITATION_ACTIVATE } from '@/app/api/v1/iam/invitations/[userId]/activation/route';
import { POST as ROLE_CREATE } from '@/app/api/v1/iam/roles/route';
import { POST as ROLE_PERMISSION_ADD } from '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import { POST as USER_STATUS_CHANGE } from '@/app/api/v1/iam/users/[userId]/status/route';
import { POST as BRANCH_SETTINGS_WRITE } from '@/app/api/v1/org/branches/[branchId]/settings/route';
import { POST as COMPANY_SETTINGS_WRITE } from '@/app/api/v1/org/companies/[companyId]/settings/route';

// Distinct id space from every other backend suite, so fixtures never collide.
const U_ADMIN = 'a4000000-0000-4000-8000-000000000001';
const U_TARGET = 'a4000000-0000-4000-8000-000000000002';
const U_INVITED = 'a4000000-0000-4000-8000-000000000003';
const ROLE_ADMIN = 'a4100000-0000-4000-8000-000000000001';
/** Granted to U_TARGET by the grant-issue case; confers only what the admin holds. */
const ROLE_GRANTABLE = 'a4100000-0000-4000-8000-000000000002';
/** Target of the role-permission-add case; starts with no mappings. */
const ROLE_PERMS = 'a4100000-0000-4000-8000-000000000003';
/** Pre-existing grant on U_TARGET, so the scope-add case has something to widen. */
const GRANT_EXISTING = 'a4200000-0000-4000-8000-000000000001';

const SUBJ_ADMIN = 'fx_p1_14_idem_admin';
const SUBJ_INVITED = 'fx_p1_14_idem_invited';
const SUBJ_TARGET = 'fx_p1_14_idem_target';

/**
 * Everything the ten operations demand between them. `iam.user.read` and
 * `iam.role.read` are here because delegation is checked by CONTENT: the caller
 * must already hold every allow-permission a role confers before granting it, and
 * before mapping it onto another role.
 */
const ADMIN_PERMISSIONS = [
  'iam.grant.manage',
  'iam.user.manage',
  'iam.role.manage',
  'iam.approval.manage',
  'iam.session.view_all',
  'org.settings.manage',
  'iam.user.read',
  'iam.role.read',
];

const API = 'http://localhost/api/v1';

let admin: Pool;
let runtime: Pool;
let provider: FakeIdentityProvider;

interface Problem {
  readonly code?: string;
  readonly status?: number;
}

/** Counts rows the operation is supposed to write exactly once. */
type Counter = () => Promise<number>;

/**
 * Re-installs the test authenticator immediately before every request.
 *
 * `iamModule()`'s composition root calls `installIamRuntime()`, which installs a
 * `BearerSessionAuthenticator` — so the FIRST route call replaces this suite's
 * authenticator as a side effect of running, and every later call would fail
 * authentication instead of exercising the replay. Re-installing per request is
 * what the other route-driven suites do, and it keeps each call a genuine
 * separate HTTP request rather than a continuation of the previous one.
 */
function authAsAdmin(): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: SUBJ_ADMIN,
      tenantId: TENANT_A,
    })
  );
}

async function auditCount(action: string): Promise<number> {
  return countRows(admin, 'iam.audit_records', 'tenant_id = $1 AND action = $2', [
    TENANT_A,
    action,
  ]);
}

async function outboxCount(eventType: string): Promise<number> {
  return countRows(admin, 'shared.event_outbox', 'tenant_id = $1 AND event_type = $2', [
    TENANT_A,
    eventType,
  ]);
}

/** Reservation rows for one operation id and key — the arbiter of the replay. */
async function storedKeys(operationId: string, key: string): Promise<number> {
  return countRows(
    admin,
    'shared.idempotency_keys',
    'tenant_id = $1 AND operation = $2 AND idempotency_key = $3',
    [TENANT_A, toOperationCode(operationId), key]
  );
}

/**
 * The whole replay contract for one operation, asserted as deltas.
 *
 * `call` is the operation's real route handler with a body and a key; the suite
 * supplies it so this helper never needs to know the URL shape or the params.
 */
async function proveReplay(spec: {
  /** Registered operation id — also selects the reservation row. */
  readonly operationId: string;
  readonly call: (body: unknown, key: string) => Promise<Response>;
  readonly payload: unknown;
  /** Independently valid, so a refusal can only be the key comparison. */
  readonly otherPayload: unknown;
  readonly firstStatus: number;
  readonly state: Counter;
  readonly auditAction: string;
  /** Omitted for the operations whose catalog entry defines no event. */
  readonly eventType?: string;
}): Promise<void> {
  const key = `fx-p1-14-idem-${randomUUID()}`;
  const invoke = (body: unknown): Promise<Response> => {
    authAsAdmin();
    return spec.call(body, key);
  };
  const before = {
    state: await spec.state(),
    audit: await auditCount(spec.auditAction),
    outbox: spec.eventType ? await outboxCount(spec.eventType) : 0,
  };

  // ---- 1. first use: the command runs and everything is written once --------
  const first = await invoke(spec.payload);
  expect(first.status).toBe(spec.firstStatus);
  const firstBody: unknown = await first.json();

  expect(await spec.state()).toBe(before.state + 1);
  expect(await auditCount(spec.auditAction)).toBe(before.audit + 1);
  if (spec.eventType) expect(await outboxCount(spec.eventType)).toBe(before.outbox + 1);
  expect(await storedKeys(spec.operationId, key)).toBe(1);

  // ---- 2. replay: same key, same payload -----------------------------------
  // The stored response comes back, and — the load-bearing part — none of the
  // three durable side effects moves.
  // `ok` rather than an exact status, deliberately — see the STATUS ON REPLAY
  // note in the file header. The stored *body* is what the contract promises and
  // what is asserted on the next line.
  const replay = await invoke(spec.payload);
  expect(replay.ok).toBe(true);
  expect(await replay.json()).toEqual(firstBody);

  expect(await spec.state()).toBe(before.state + 1);
  expect(await auditCount(spec.auditAction)).toBe(before.audit + 1);
  if (spec.eventType) expect(await outboxCount(spec.eventType)).toBe(before.outbox + 1);
  expect(await storedKeys(spec.operationId, key)).toBe(1);

  // ---- 3. same key, DIFFERENT payload: refused, and nothing runs ------------
  const conflict = await invoke(spec.otherPayload);
  expect(conflict.status).toBe(409);
  expect(((await conflict.json()) as Problem).code).toBe('ERR-INT-001');

  // Neither the stored command nor the grafted one executed a second time.
  expect(await spec.state()).toBe(before.state + 1);
  expect(await auditCount(spec.auditAction)).toBe(before.audit + 1);
  if (spec.eventType) expect(await outboxCount(spec.eventType)).toBe(before.outbox + 1);
  expect(await storedKeys(spec.operationId, key)).toBe(1);
}

function request(path: string, body: unknown, key: string): Request {
  return new Request(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

/**
 * Provisions every fixture in ONE transaction, for the same reason `cleanState`
 * uses one: `tg_role_grants_require_scope` is deferred to COMMIT, so a scoped
 * grant and its first scope must be visible together or neither is.
 */
async function seedFixtures(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await seedWithin(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedWithin(admin: PoolClient): Promise<void> {
  for (const [id, subject, email, status, identityProvider] of [
    [U_ADMIN, SUBJ_ADMIN, 'fx-p1-14-idem-admin@example.test', 'active', IDENTITY_PROVIDER],
    [U_TARGET, SUBJ_TARGET, 'fx-p1-14-idem-target@example.test', 'active', IDENTITY_PROVIDER],
    // Invited, and confirmed with the provider below: the state the activation
    // operation is the only legitimate way out of.
    [U_INVITED, SUBJ_INVITED, 'fx-p1-14-idem-invited@example.test', 'invited', 'supabase'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'P1-14 idempotency fixture',$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, identityProvider, subject, email, status, USER_A]
    );
  }

  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$4,'fx_p1_14_idem_admin','P1-14 idempotency admin',$5),
            ($2,$4,'fx_p1_14_idem_grantable','P1-14 idempotency grantable',$5),
            ($3,$4,'fx_p1_14_idem_perms','P1-14 idempotency permission target',$5)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ADMIN, ROLE_GRANTABLE, ROLE_PERMS, TENANT_A, USER_A]
  );

  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = ANY($4::text[])
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_ADMIN, USER_A, ADMIN_PERMISSIONS]
  );
  // The grantable role confers strictly less than the admin holds, so the
  // delegation check passes on merit rather than because the role is empty.
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = $4
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_GRANTABLE, USER_A, 'iam.user.read']
  );

  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     SELECT $1,$2,$3,'unrestricted','active',$4,$4
      WHERE NOT EXISTS (SELECT 1 FROM iam.role_grants WHERE tenant_id=$1 AND user_id=$2 AND role_id=$3)`,
    [TENANT_A, U_ADMIN, ROLE_ADMIN, USER_A]
  );

  // A live grant on someone OTHER than the caller: `addScope` refuses to widen
  // the caller's own authority, so a self-owned grant would fail for a reason
  // that has nothing to do with idempotency.
  await admin.query(
    `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1,$2,$3,$4,'scoped','active',$5,$5)
     ON CONFLICT (id) DO NOTHING`,
    [GRANT_EXISTING, TENANT_A, U_TARGET, ROLE_GRANTABLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
     SELECT $1,$2,'company',$3,$4
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.grant_scopes
         WHERE grant_id=$2 AND scope_type='company' AND company_id=$3 AND branch_id IS NULL)`,
    [TENANT_A, GRANT_EXISTING, COMPANY_A1, USER_A]
  );
}

/**
 * Removes only what THIS suite created.
 *
 * Two constraints shape it. Everything runs in ONE transaction because
 * `tg_role_grants_require_scope` is DEFERRABLE INITIALLY DEFERRED: deleting a
 * scoped grant's scopes in a statement of their own fails at COMMIT, since at
 * that moment the grant still exists with no scope. And the predicates are all
 * fixture-prefixed rather than tenant-wide, because the shared backend fixtures
 * own a scoped grant of their own in tenant A — a blanket
 * `DELETE FROM iam.grant_scopes WHERE tenant_id = ...` strips its scope and
 * breaks every later suite that relies on it.
 *
 * Audit and outbox rows are deliberately NOT deleted: every assertion in this
 * file is a delta, so leftovers are harmless, and audit records are chained by
 * `iam.audit_integrity_links` — a test harness has no business reaching into
 * that.
 */
async function cleanState(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM shared.idempotency_keys WHERE tenant_id = $1', [TENANT_A]);
    await client.query(
      `DELETE FROM iam.grant_scopes
        WHERE tenant_id = $1
          AND grant_id IN (SELECT id FROM iam.role_grants
                            WHERE tenant_id = $1 AND user_id = ANY($2::uuid[]))`,
      [TENANT_A, [U_ADMIN, U_TARGET, U_INVITED]]
    );
    await client.query(
      'DELETE FROM iam.role_grants WHERE tenant_id = $1 AND user_id = ANY($2::uuid[])',
      [TENANT_A, [U_ADMIN, U_TARGET, U_INVITED]]
    );
    await client.query(
      "DELETE FROM iam.approval_limits WHERE tenant_id = $1 AND limit_type LIKE 'fx_p1_14_idem%'",
      [TENANT_A]
    );
    await client.query('DELETE FROM iam.user_sessions WHERE user_id = ANY($1::uuid[])', [
      [U_ADMIN, U_TARGET, U_INVITED],
    ]);
    await client.query('DELETE FROM iam.user_status_history WHERE user_id = ANY($1::uuid[])', [
      [U_ADMIN, U_TARGET, U_INVITED],
    ]);
    // Fixture roles and any role the role-create case made, by prefix.
    await client.query(
      `DELETE FROM iam.role_permissions
        WHERE role_id IN (SELECT id FROM iam.roles
                           WHERE tenant_id = $1 AND role_code LIKE 'fx_p1_14_idem%')`,
      [TENANT_A]
    );
    await client.query(
      "DELETE FROM iam.roles WHERE tenant_id = $1 AND role_code LIKE 'fx_p1_14_idem%'",
      [TENANT_A]
    );
    await client.query(
      "DELETE FROM iam.user_accounts WHERE tenant_id = $1 AND email LIKE 'fx-p1-14-idem%'",
      [TENANT_A]
    );
    await client.query(
      "DELETE FROM org.company_settings WHERE company_id = $1 AND setting_key LIKE 'fx_p1_14_idem%'",
      [COMPANY_A1]
    );
    await client.query(
      "DELETE FROM org.branch_settings WHERE branch_id = $1 AND setting_key LIKE 'fx_p1_14_idem%'",
      [BRANCH_A1]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Invitation links are refused outright unless a destination is allow-listed. */
const REDIRECT_OK = 'https://app.test.local/invitation';

beforeAll(async () => {
  process.env.AUTH_REDIRECT_ALLOWLIST = REDIRECT_OK;
  __resetBackendConfigForTests();
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  provider = new FakeIdentityProvider({
    secret: 'p1-14-idempotency-secret-not-real',
    issuer: 'https://auth.test.local/auth/v1',
    audience: 'authenticated',
  });
  setIdentityProvider(provider);

  // Every case below runs as the same tenant-A administrator. The principal is
  // resolved from these claims by the real resolver, so the fingerprint's
  // identity component is server-derived exactly as it is in production.
  authAsAdmin();
});

beforeEach(async () => {
  provider.reset();
  // The invited account's provider identity: present, confirmed, not disabled —
  // the only shape `activate` accepts.
  provider.seed({
    email: 'fx-p1-14-idem-invited@example.test',
    subject: SUBJ_INVITED,
    confirmed: true,
    tenantId: TENANT_A,
  });
  await cleanState();
  await seedFixtures();
});

afterAll(async () => {
  __resetAuthenticatorForTests();
  __setPrimaryPoolForTests(undefined);
  await cleanState();
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

// ===========================================================================
// iam.approval-limit-create — a duplicate would widen someone's spending
// authority, which is the reason this one is on the list at all.
// ===========================================================================
describe('iam.approval-limit-create', () => {
  it('replays under one key: one limit, one audit record, and a payload change is refused', async () => {
    await proveReplay({
      operationId: 'iam.approval-limit-create',
      call: (body, key) => APPROVAL_LIMIT_CREATE(request('/iam/approval-limits', body, key)),
      payload: {
        companyId: COMPANY_A1,
        userId: U_TARGET,
        limitType: 'fx_p1_14_idem_limit',
        amount: '1500.0000',
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
      // A different ceiling — valid on its own, which is the point.
      otherPayload: {
        companyId: COMPANY_A1,
        userId: U_TARGET,
        limitType: 'fx_p1_14_idem_limit',
        amount: '9999.0000',
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
      firstStatus: 201,
      state: () =>
        countRows(admin, 'iam.approval_limits', 'tenant_id = $1 AND limit_type = $2', [
          TENANT_A,
          'fx_p1_14_idem_limit',
        ]),
      auditAction: 'iam.approval_limit.created',
    });
  });
});

// ===========================================================================
// iam.grant-issue — highest severity on the list: a double write issues a
// second role grant, and announces it downstream twice.
// ===========================================================================
describe('iam.grant-issue', () => {
  it('replays under one key: one grant, one audit record, one event', async () => {
    await proveReplay({
      operationId: 'iam.grant-issue',
      call: (body, key) => GRANT_ISSUE(request('/iam/grants', body, key)),
      payload: { userId: U_TARGET, roleId: ROLE_GRANTABLE, approvalRef: 'fx-p1-14-idem-a' },
      otherPayload: { userId: U_TARGET, roleId: ROLE_GRANTABLE, approvalRef: 'fx-p1-14-idem-b' },
      firstStatus: 201,
      state: () =>
        countRows(
          admin,
          'iam.role_grants',
          'tenant_id = $1 AND user_id = $2 AND role_id = $3 AND scope_mode = $4',
          [TENANT_A, U_TARGET, ROLE_GRANTABLE, 'unrestricted']
        ),
      auditAction: 'iam.grant.issued',
      eventType: 'access.grant.changed',
    });
  });
});

// ===========================================================================
// iam.grant-scope-add — a duplicate scope row widens an existing grant.
// ===========================================================================
describe('iam.grant-scope-add', () => {
  it('replays under one key: one scope row, one audit record, one event', async () => {
    await proveReplay({
      operationId: 'iam.grant-scope-add',
      call: (body, key) =>
        GRANT_SCOPE_ADD(request(`/iam/grants/${GRANT_EXISTING}/scopes`, body, key), {
          params: Promise.resolve({ grantId: GRANT_EXISTING }),
        }),
      payload: { scopeType: 'branch', companyId: COMPANY_A1, branchId: BRANCH_A1 },
      // The same grant, a company-wide scope instead of the branch one.
      otherPayload: { scopeType: 'company', companyId: COMPANY_A1 },
      firstStatus: 201,
      state: () =>
        countRows(
          admin,
          'iam.grant_scopes',
          'tenant_id = $1 AND grant_id = $2 AND scope_type = $3',
          [TENANT_A, GRANT_EXISTING, 'branch']
        ),
      auditAction: 'iam.grant.scope_added',
      eventType: 'access.grant.changed',
    });
  });
});

// ===========================================================================
// iam.invitation-create — a duplicate could produce two pending identities for
// one person, and this command also reaches an EXTERNAL provider.
// ===========================================================================
describe('iam.invitation-create', () => {
  const email = 'fx-p1-14-idem-newcomer@example.test';

  it('replays under one key: one account, one audit record, one event', async () => {
    await proveReplay({
      operationId: 'iam.invitation-create',
      call: (body, key) => INVITATION_CREATE(request('/iam/invitations', body, key)),
      payload: { email, displayName: 'P1-14 Newcomer' },
      otherPayload: { email, displayName: 'P1-14 Newcomer Renamed' },
      firstStatus: 201,
      state: () =>
        countRows(admin, 'iam.user_accounts', 'tenant_id = $1 AND email = $2', [TENANT_A, email]),
      auditAction: 'iam.user.invited',
      eventType: 'user.invited',
    });
  });

  it('does not invite the identity provider a second time on replay', async () => {
    const key = `fx-p1-14-idem-${randomUUID()}`;
    const body = { email, displayName: 'P1-14 Newcomer' };

    authAsAdmin();
    expect((await INVITATION_CREATE(request('/iam/invitations', body, key))).status).toBe(201);
    expect(provider.deliveries.filter((d) => d.kind === 'invite')).toHaveLength(1);

    // The replay must short-circuit BEFORE the provider call: a second invite
    // mail carries a second live token for the same identity, and no amount of
    // database-side care takes that back.
    authAsAdmin();
    expect((await INVITATION_CREATE(request('/iam/invitations', body, key))).ok).toBe(true);
    expect(provider.deliveries.filter((d) => d.kind === 'invite')).toHaveLength(1);
  });
});

// ===========================================================================
// iam.invitation-activate — activation is state-changing and audited; a replay
// must not audit twice.
// ===========================================================================
describe('iam.invitation-activate', () => {
  it('replays under one key: one transition, one audit record, one event', async () => {
    await proveReplay({
      operationId: 'iam.invitation-activate',
      call: (body, key) =>
        INVITATION_ACTIVATE(request(`/iam/invitations/${U_INVITED}/activation`, body, key), {
          params: Promise.resolve({ userId: U_INVITED }),
        }),
      payload: { reason: 'Invitation accepted with the provider.' },
      otherPayload: { reason: 'Accepted, recorded under a different reason.' },
      firstStatus: 200,
      // The append-only status ledger, not the account row: "the account is
      // active" would read as 1 however many times it had been set.
      state: () =>
        countRows(
          admin,
          'iam.user_status_history',
          'tenant_id = $1 AND user_id = $2 AND to_state = $3',
          [TENANT_A, U_INVITED, 'active']
        ),
      auditAction: 'iam.user.activated',
      eventType: 'user.status.changed',
    });
  });
});

// ===========================================================================
// iam.role-create — a duplicate role fragments permission administration.
// ===========================================================================
describe('iam.role-create', () => {
  it('replays under one key: one role, one audit record, and a payload change is refused', async () => {
    await proveReplay({
      operationId: 'iam.role-create',
      call: (body, key) => ROLE_CREATE(request('/iam/roles', body, key)),
      payload: { roleCode: 'fx_p1_14_idem_created', name: 'P1-14 idempotency created role' },
      // A wholly different role, which would succeed under its own key.
      otherPayload: { roleCode: 'fx_p1_14_idem_other', name: 'P1-14 idempotency other role' },
      firstStatus: 201,
      state: () =>
        countRows(admin, 'iam.roles', 'tenant_id = $1 AND role_code LIKE $2', [
          TENANT_A,
          'fx_p1_14_idem_created%',
        ]),
      auditAction: 'iam.role.created',
    });
  });
});

// ===========================================================================
// iam.role-permission-add — second highest severity: a double write attaches a
// permission twice.
// ===========================================================================
describe('iam.role-permission-add', () => {
  it('replays under one key: one mapping, one audit record, and a payload change is refused', async () => {
    await proveReplay({
      operationId: 'iam.role-permission-add',
      call: (body, key) =>
        ROLE_PERMISSION_ADD(request(`/iam/roles/${ROLE_PERMS}/permissions`, body, key), {
          params: Promise.resolve({ roleId: ROLE_PERMS }),
        }),
      payload: { permissionCode: 'iam.user.read', effect: 'allow' },
      // A different permission the caller also holds, so the refusal cannot be
      // a delegation failure wearing an idempotency error's clothes.
      otherPayload: { permissionCode: 'iam.role.read', effect: 'allow' },
      firstStatus: 201,
      state: () =>
        countRows(admin, 'iam.role_permissions', 'tenant_id = $1 AND role_id = $2', [
          TENANT_A,
          ROLE_PERMS,
        ]),
      auditAction: 'iam.role.permission_added',
    });
  });
});

// ===========================================================================
// iam.user-status-change — suspension and reinstatement are audited
// transitions, and locking also revokes every live session.
// ===========================================================================
describe('iam.user-status-change', () => {
  it('replays under one key: one transition, one audit record, one event', async () => {
    await proveReplay({
      operationId: 'iam.user-status-change',
      call: (body, key) =>
        USER_STATUS_CHANGE(request(`/iam/users/${U_TARGET}/status`, body, key), {
          params: Promise.resolve({ userId: U_TARGET }),
        }),
      payload: { status: 'locked', reason: 'Suspended pending review.' },
      // `archived` is also reachable from `active`, so this is a real
      // alternative command rather than an invalid one.
      otherPayload: { status: 'archived', reason: 'Archived instead.' },
      firstStatus: 200,
      state: () =>
        countRows(
          admin,
          'iam.user_status_history',
          'tenant_id = $1 AND user_id = $2 AND to_state = $3',
          [TENANT_A, U_TARGET, 'locked']
        ),
      auditAction: 'iam.user.locked',
      eventType: 'user.status.changed',
    });
  });
});

// ===========================================================================
// iam.branch-settings-write / iam.company-settings-write — settings writes are
// last-write-wins, so a replay is PROBABLY harmless. "Probably" is not evidence,
// and both tables are append-only version ledgers: a replayed write would leave
// a second version behind and change what the history says happened.
// ===========================================================================
describe('iam.branch-settings-write', () => {
  it('replays under one key: one version row, one audit record, and a payload change is refused', async () => {
    await proveReplay({
      operationId: 'iam.branch-settings-write',
      call: (body, key) =>
        BRANCH_SETTINGS_WRITE(request(`/org/branches/${BRANCH_A1}/settings`, body, key), {
          params: Promise.resolve({ branchId: BRANCH_A1 }),
        }),
      payload: {
        settingKey: 'fx_p1_14_idem.branch',
        settingValue: 'first',
        valueType: 'string',
      },
      otherPayload: {
        settingKey: 'fx_p1_14_idem.branch',
        settingValue: 'second',
        valueType: 'string',
      },
      firstStatus: 201,
      state: () =>
        countRows(admin, 'org.branch_settings', 'branch_id = $1 AND setting_key = $2', [
          BRANCH_A1,
          'fx_p1_14_idem.branch',
        ]),
      auditAction: 'org.branch.settings_updated',
    });
  });
});

describe('iam.company-settings-write', () => {
  it('replays under one key: one version row, one audit record, and a payload change is refused', async () => {
    await proveReplay({
      operationId: 'iam.company-settings-write',
      call: (body, key) =>
        COMPANY_SETTINGS_WRITE(request(`/org/companies/${COMPANY_A1}/settings`, body, key), {
          params: Promise.resolve({ companyId: COMPANY_A1 }),
        }),
      payload: {
        settingKey: 'fx_p1_14_idem.company',
        settingValue: 'first',
        valueType: 'string',
      },
      otherPayload: {
        settingKey: 'fx_p1_14_idem.company',
        settingValue: 'second',
        valueType: 'string',
      },
      firstStatus: 201,
      state: () =>
        countRows(admin, 'org.company_settings', 'company_id = $1 AND setting_key = $2', [
          COMPANY_A1,
          'fx_p1_14_idem.company',
        ]),
      auditAction: 'org.company.settings_updated',
    });
  });
});
