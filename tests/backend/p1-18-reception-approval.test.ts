/**
 * Reception approval, end to end (Phase 1-18, P1-18-BE-018, P1-18-BE-008).
 *
 * Drives the real `POST /receptions/{receptionId}/approve` handler through the fixed
 * pipeline on the least-privilege `app_runtime` role. Approval is the decision that
 * releases a customer's vehicle for work, so the prerequisites are exactly the frozen
 * activation contract of `rec.guard_reception_transition` and nothing invented: an
 * ACTIVE `service_requester` party role AND an `approved` row in `rec.authorizations`.
 * Both refusals are proved by reading the reception back and finding it in its prior
 * status with no audit record and no event — `opened -> inspecting -> authorized` is
 * two legal edges, so a refusal on the second edge must roll the first one back too.
 *
 * Operations exercised here: rec.reception-approve. (The reception is opened through
 * rec.reception-create and its decision recorded through rec.reception-authorization,
 * which are evidenced by their own suites; here they are only fixture machinery.)
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rec.reception-approve: route service authorization success denial cross-tenant isolation audit outbox idempotency stale-version concurrency
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  SUBJECT_UNPERMITTED,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { POST as CREATE_RECEPTION } from '@/app/api/v1/receptions/route';
import { POST as RECORD_AUTHORIZATION } from '@/app/api/v1/receptions/[receptionId]/authorizations/route';
import { POST as APPROVE } from '@/app/api/v1/receptions/[receptionId]/approve/route';

/** A second branch of the same company: the narrowing an isolation grant uses. */
const BRANCH_A2 = 'c1780000-0000-4000-8000-0000000000a2';
/** Tenant B's own company and branch — a real scope, not a fabricated id. */
const COMPANY_B1 = 'c1780000-0000-4000-8000-0000000000b1';
const BRANCH_B1 = 'c1780000-0000-4000-8000-0000000000b2';

const ROLE_APPROVER = 'c1780000-0000-4000-8000-000000000101';
const USER_APPROVER = 'c1780000-0000-4000-8000-000000000102';
const SUBJ_APPROVER = 'fx_p1_18_rec_approver';

/** Holds every other reception permission — but NOT `rec.reception.approve`. */
const ROLE_NO_APPROVE = 'c1780000-0000-4000-8000-000000000201';
const USER_NO_APPROVE = 'c1780000-0000-4000-8000-000000000202';
const SUBJ_NO_APPROVE = 'fx_p1_18_rec_no_approve';

/** Same permissions as the approver, but the grant is narrowed to BRANCH_A2. */
const ROLE_SCOPED = 'c1780000-0000-4000-8000-000000000301';
const USER_SCOPED = 'c1780000-0000-4000-8000-000000000302';
const SUBJ_SCOPED = 'fx_p1_18_rec_scoped';
const GRANT_SCOPED = 'c1780000-0000-4000-8000-000000000303';

const ROLE_TENANT_B = 'c1780000-0000-4000-8000-000000000401';
const USER_TENANT_B = 'c1780000-0000-4000-8000-000000000402';
const SUBJ_TENANT_B = 'fx_p1_18_rec_tenant_b';

const PARTNER_A = 'c1780000-0000-4000-8000-0000000000c1';
const PARTNER_B = 'c1780000-0000-4000-8000-0000000000c2';

const R = 'http://localhost/api/v1/receptions';

const RECEPTION_PERMISSIONS = [
  'rec.reception.manage',
  'rec.reception.party.manage',
  'rec.reception.authorization.verify',
  'rec.reception.approve',
];

interface Body {
  readonly receptionVisitId?: string;
  readonly receptionStatus?: string;
  readonly appliedTransitions?: readonly string[];
  readonly recordVersion?: number;
  readonly authorizationId?: string;
  readonly origin?: string;
  readonly code?: string;
}

let admin: Pool;
let runtime: Pool;
let vehicleCounter = 0;

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

// ---------------------------------------------------------------------------
// Route drivers. Every request goes through the exported handler, so the whole
// pipeline — authentication, scope resolution, authorization, If-Match,
// idempotency, transaction — is on trial, not just the service.
// ---------------------------------------------------------------------------

function createReception(body: unknown, key = crypto.randomUUID()): Promise<Response> {
  return CREATE_RECEPTION(
    new Request(R, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );
}

function recordAuthorization(
  receptionId: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return RECORD_AUTHORIZATION(
    new Request(`${R}/${receptionId}/authorizations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

/**
 * `expectedVersion` of `null` omits `If-Match` entirely, which the operation
 * declares as version-guarded and must therefore refuse with 428.
 */
function approve(
  receptionId: string,
  expectedVersion: number | null,
  key = crypto.randomUUID()
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': key,
  };
  if (expectedVersion !== null) headers['if-match'] = String(expectedVersion);
  return APPROVE(
    new Request(`${R}/${receptionId}/approve`, { method: 'POST', headers, body: '{}' }),
    {
      params: Promise.resolve({ receptionId }),
    }
  );
}

// ---------------------------------------------------------------------------
// Admin-side fixtures and read-backs. Nothing here is ever evidence about
// runtime behaviour: this connection bypasses RLS. It exists to provision
// vehicles, to force a state the API deliberately offers no route to, and to
// count what actually landed.
// ---------------------------------------------------------------------------

async function asAdminTx<T>(tenantId: string, run: (client: Pool) => Promise<T>): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    const result = await run(client as unknown as Pool);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A fresh vehicle per reception: only one non-terminal visit may exist per vehicle. */
async function newVehicle(tenantId: string): Promise<string> {
  vehicleCounter += 1;
  const vin = `P118RECAPRV${String(vehicleCounter).padStart(6, '0')}`;
  return asAdminTx(tenantId, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,'ice','active',$3) RETURNING id`,
      [tenantId, vin, USER_A]
    );
    return inserted.rows[0]?.id ?? '';
  });
}

/** Opens a reception through the real check-in route. Leaves it `opened`. */
async function openReception(
  input: {
    readonly tenantId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly partnerId?: string;
  } = {}
): Promise<string> {
  const tenantId = input.tenantId ?? TENANT_A;
  const vehicleId = await newVehicle(tenantId);
  const response = await createReception({
    companyId: input.companyId ?? COMPANY_A1,
    branchId: input.branchId ?? BRANCH_A1,
    vehicleId,
    // The receiving employee follows the TENANT. DBCR-P1-18-002 gave the column a
    // same-tenant FK and an insert-time eligibility guard, so the tenant-A
    // USER_APPROVER this fixture passed unconditionally now draws a 422
    // `ineligible_reference` on the tenant-B visit this suite builds to prove
    // isolation — meaning the isolation was being asserted against a visit that
    // could not exist.
    receivingEmployeeId: tenantId === TENANT_B ? USER_TENANT_B : USER_APPROVER,
    serviceRequesterPartnerId: input.partnerId ?? PARTNER_A,
    origin: { kind: 'walk_in' },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as Body).receptionVisitId ?? '';
}

/**
 * Opens a reception AND records the approved authorization, so the only thing
 * standing between it and `authorized` is the request under test.
 */
async function openApprovable(
  input: {
    readonly tenantId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly partnerId?: string;
  } = {}
): Promise<string> {
  const receptionId = await openReception(input);
  const decision = await recordAuthorization(receptionId, {
    authorizingRole: 'service_requester',
    partnerId: input.partnerId ?? PARTNER_A,
    decision: 'approved',
  });
  expect(decision.status).toBe(201);
  return receptionId;
}

/**
 * Appends an `authorization`-type refusal for a party — the second, cheaper way to
 * withdraw consent.
 *
 * `POST /receptions/{id}/refusals` writes this row and needs only
 * `rec.reception.signature.manage`, where the `declined` decision that also blocks
 * needs `rec.reception.authorization.verify`. Written admin-side because this
 * suite imports no refusals route; the row is a genuine append with the column set
 * the route produces, and what is under test is what approval does about it.
 */
async function refuseAuthorization(
  receptionId: string,
  partnerId = PARTNER_A,
  tenantId = TENANT_A
): Promise<void> {
  await asAdminTx(tenantId, async (client) => {
    const scope = await client.query<{ company_id: string; branch_id: string }>(
      `SELECT company_id, branch_id FROM rec.reception_visits WHERE id = $1`,
      [receptionId]
    );
    const row = scope.rows[0];
    await client.query(
      `INSERT INTO rec.refusals
         (tenant_id, company_id, branch_id, reception_visit_id, refusal_type,
          refusing_partner_id, created_by)
       VALUES ($1,$2,$3,$4,'authorization',$5,$6)`,
      [tenantId, row?.company_id, row?.branch_id, receptionId, partnerId, USER_A]
    );
  });
}

/** Forces a status the API offers no route to, so a terminal state can be tested. */
async function forceStatus(receptionId: string, next: string, tenantId = TENANT_A): Promise<void> {
  await asAdminTx(tenantId, async (client) => {
    await client.query(`UPDATE rec.reception_visits SET reception_status=$2 WHERE id=$1`, [
      receptionId,
      next,
    ]);
  });
}

/** Dates out the mandatory service-requester role the check-in primitive created. */
async function closeServiceRequesterRole(receptionId: string): Promise<number> {
  return asAdminTx(TENANT_A, async (client) => {
    const closed = await client.query(
      `UPDATE rec.reception_party_roles SET valid_to = now()
        WHERE reception_visit_id = $1 AND relationship_role = 'service_requester'
          AND valid_to IS NULL AND deleted_at IS NULL`,
      [receptionId]
    );
    return closed.rowCount ?? 0;
  });
}

async function scalar(sql: string, values: readonly unknown[]): Promise<string | null> {
  const result = await admin.query<{ value: string | null }>(sql, [...values]);
  return result.rows[0]?.value ?? null;
}

const statusOf = (receptionId: string): Promise<string | null> =>
  scalar(`SELECT reception_status AS value FROM rec.reception_visits WHERE id = $1`, [receptionId]);

async function versionOf(receptionId: string): Promise<number> {
  const raw = await scalar(
    `SELECT record_version::text AS value FROM rec.reception_visits WHERE id = $1`,
    [receptionId]
  );
  return Number(raw ?? '-1');
}

async function auditCount(receptionId: string): Promise<number> {
  const raw = await scalar(
    `SELECT count(*)::text AS value FROM iam.audit_records
      WHERE action = 'rec.reception.approved' AND entity_id = $1`,
    [receptionId]
  );
  return Number(raw ?? '0');
}

async function outboxCount(receptionId: string): Promise<number> {
  const raw = await scalar(
    `SELECT count(*)::text AS value FROM shared.event_outbox
      WHERE event_type = 'reception.approved' AND aggregate_id = $1`,
    [receptionId]
  );
  return Number(raw ?? '0');
}

async function historyCount(receptionId: string, toState: string): Promise<number> {
  const raw = await scalar(
    `SELECT count(*)::text AS value FROM rec.reception_status_history
      WHERE reception_visit_id = $1 AND to_state = $2`,
    [receptionId, toState]
  );
  return Number(raw ?? '0');
}

/** Reception untouched: prior status, prior version, no audit, no event, no ledger row. */
async function expectUntouched(receptionId: string, status = 'opened'): Promise<void> {
  expect(await statusOf(receptionId)).toBe(status);
  expect(await versionOf(receptionId)).toBe(1);
  expect(await auditCount(receptionId)).toBe(0);
  expect(await outboxCount(receptionId)).toBe(0);
  // `opened -> authorized` is TWO edges and the service applies the first one
  // before the guard refuses the second. If the transaction did not roll back,
  // an `inspecting` ledger row would survive the refusal.
  expect(await historyCount(receptionId, 'inspecting')).toBe(0);
  expect(await historyCount(receptionId, 'authorized')).toBe(0);
}

/**
 * Blocks until `expected` backends are waiting on a lock *while holding one on
 * `rec.reception_visits`* — i.e. until both approvals have genuinely reached the
 * contended visit row.
 *
 * A race between two in-flight requests cannot be asserted until both have
 * actually arrived; waiting for that is what makes the outcome deterministic
 * instead of a coin toss decided by the event loop. The row-lock wait itself
 * appears in `pg_locks` as an ungranted `transactionid`/`tuple` entry rather
 * than as a lock on the table, so the table is matched through a second entry
 * the same backend holds. Without that correlation any unrelated blocked
 * backend anywhere in the database would satisfy the wait and the gate would be
 * released too early.
 */
async function waitForBlockedBackends(expected: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  while (Date.now() < deadline) {
    const result = await admin.query<{ n: string }>(
      `SELECT count(DISTINCT w.pid)::text AS n
         FROM pg_locks w
         JOIN pg_stat_activity a ON a.pid = w.pid
        WHERE NOT w.granted
          AND a.datname = current_database()
          AND w.pid <> pg_backend_pid()
          AND EXISTS (
            SELECT 1 FROM pg_locks held
             WHERE held.pid = w.pid
               AND held.relation = 'rec.reception_visits'::regclass
          )`
    );
    seen = Number(result.rows[0]?.n ?? '0');
    if (seen >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `expected ${expected} backends blocked on the reception row within ${timeoutMs}ms, saw ${seen}; ` +
      'the race was not forced, so the outcome below would prove nothing'
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedPrincipal(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string,
  permissions: readonly string[]
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Reception Principal','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 reception principal',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A, [...permissions]]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('rec.reception.manage','rec','Open a reception visit and accept vehicle custody','medium',$1),
            ('rec.reception.party.manage','rec','Assign and close dated party roles on a reception','medium',$1),
            ('rec.reception.authorization.verify','rec','Verify and record reception authorization decisions','high',$1),
            ('rec.reception.approve','rec','Approve a reception visit for work','high',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  // A second branch in tenant A, and tenant B's own company and branch. The
  // isolation and cross-tenant cases below address REAL rows in these scopes.
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_a2','Fixture Branch A2','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_b1','Fixture Company B1','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b1','Fixture Branch B1','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A]
  );

  await seedPrincipal(TENANT_A, ROLE_APPROVER, USER_APPROVER, SUBJ_APPROVER, RECEPTION_PERMISSIONS);
  await seedPrincipal(
    TENANT_A,
    ROLE_NO_APPROVE,
    USER_NO_APPROVE,
    SUBJ_NO_APPROVE,
    RECEPTION_PERMISSIONS.filter((code) => code !== 'rec.reception.approve')
  );
  await seedPrincipal(TENANT_A, ROLE_SCOPED, USER_SCOPED, SUBJ_SCOPED, RECEPTION_PERMISSIONS);
  await seedPrincipal(TENANT_B, ROLE_TENANT_B, USER_TENANT_B, SUBJ_TENANT_B, RECEPTION_PERMISSIONS);

  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4), ($1,$5,$6,'unrestricted',$4,$4)`,
    [TENANT_A, USER_APPROVER, ROLE_APPROVER, USER_A, USER_NO_APPROVE, ROLE_NO_APPROVE]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_B, USER_TENANT_B, ROLE_TENANT_B, USER_A]
  );
  // The scoped grant and its single branch scope must land together: the
  // "a scoped grant needs a scope" constraint trigger is INITIALLY DEFERRED.
  const scoped = await admin.connect();
  try {
    await scoped.query('BEGIN');
    await scoped.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [GRANT_SCOPED, TENANT_A, USER_SCOPED, ROLE_SCOPED, USER_A]
    );
    await scoped.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [TENANT_A, GRANT_SCOPED, COMPANY_A1, BRANCH_A2, USER_A]
    );
    await scoped.query('COMMIT');
  } catch (error) {
    await scoped.query('ROLLBACK');
    throw error;
  } finally {
    scoped.release();
  }

  // The service requester each reception is opened for, one per tenant. Every
  // crm/veh trigger stamps its actor from `app.user_id`, so both run in a
  // context-set transaction.
  await asAdminTx(TENANT_A, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','Reception Requester A','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A, TENANT_A, USER_A]
    );
  });
  await asAdminTx(TENANT_B, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','Reception Requester B','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_B, TENANT_B, USER_A]
    );
  });

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('authorization', () => {
  it('answers 401 with no session and 403 without rec.reception.approve, moving nothing', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openApprovable();

    __resetAuthenticatorForTests();
    expect((await approve(reception, 1)).status).toBe(401);

    // A tenant-A account with a role carrying no permission mappings at all.
    authAs(SUBJECT_UNPERMITTED);
    expect((await approve(reception, 1)).status).toBe(403);

    // The sharper case: this principal holds every OTHER reception permission —
    // it may open the visit and record the authorization — and is refused purely
    // because `rec.reception.approve` is missing. Dropping that one code from the
    // operation's declaration would turn this 403 into a 200.
    authAs(SUBJ_NO_APPROVE);
    const denied = await approve(reception, 1);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as Body).code).toBe('ERR-IAM-001');

    await expectUntouched(reception);
  });
});

describe('rec.reception-approve: the frozen activation contract', () => {
  it('refuses approval with no approved authorization and rolls the first edge back', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openReception();
    // Sanity: the reception really does have its mandatory service-requester
    // role, so the refusal below can only be about the missing authorization.
    expect(
      await scalar(
        `SELECT count(*)::text AS value FROM rec.reception_party_roles
          WHERE reception_visit_id = $1 AND relationship_role = 'service_requester'
            AND valid_to IS NULL AND deleted_at IS NULL`,
        [reception]
      )
    ).toBe('1');

    const refused = await approve(reception, 1);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Body).code).toBe('ERR-TRN-001');
    await expectUntouched(reception);
  });

  it('refuses approval when the only recorded decision is a decline', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openReception();
    const declined = await recordAuthorization(reception, {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_A,
      decision: 'declined',
    });
    expect(declined.status).toBe(201);

    const refused = await approve(reception, 1);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Body).code).toBe('ERR-TRN-001');
    await expectUntouched(reception);
  });

  it('refuses approval when the service-requester role has been closed', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openApprovable();
    // The approved decision was recorded while the role was still active, so it
    // survives; what is gone is the standing authority the visit needs to be
    // released for work. That is the case the activation contract exists for.
    expect(await closeServiceRequesterRole(reception)).toBe(1);
    expect(
      await scalar(
        `SELECT count(*)::text AS value FROM rec.authorizations
          WHERE reception_visit_id = $1 AND decision = 'approved'`,
        [reception]
      )
    ).toBe('1');
    expect(
      await scalar(
        `SELECT count(*)::text AS value FROM rec.reception_party_roles
          WHERE reception_visit_id = $1 AND relationship_role = 'service_requester'
            AND valid_to IS NULL AND deleted_at IS NULL`,
        [reception]
      )
    ).toBe('0');

    const refused = await approve(reception, 1);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Body).code).toBe('ERR-TRN-001');
    await expectUntouched(reception);
  });

  it('approves once both prerequisites hold, auditing it and emitting exactly one event', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openApprovable();

    const response = await approve(reception, 1);
    expect(response.status).toBe(200);
    // `opened -> authorized` is two legal edges, so the resulting version is the
    // caller's plus two — and the ETag must carry what the row really holds,
    // because the conversion that follows has to present it.
    expect(response.headers.get('etag')).toBe('"3"');
    const body = (await response.json()) as Body;
    expect(body.receptionStatus).toBe('authorized');
    expect(body.appliedTransitions).toEqual(['inspecting', 'authorized']);
    expect(body.recordVersion).toBe(3);

    expect(await statusOf(reception)).toBe('authorized');
    expect(await versionOf(reception)).toBe(3);
    expect(await historyCount(reception, 'inspecting')).toBe(1);
    expect(await historyCount(reception, 'authorized')).toBe(1);
    expect(await auditCount(reception)).toBe(1);
    expect(await outboxCount(reception)).toBe(1);

    const event = await admin.query<{
      event_key: string;
      // `aggregate_version` is bigint, which the driver returns as text rather
      // than risking a silent precision loss; it is cast in SQL so the assertion
      // compares one representation, not two.
      aggregate_version: string;
      payload: { receptionStatus?: string; receptionVisitId?: string };
    }>(
      `SELECT event_key, aggregate_version::text AS aggregate_version, payload
         FROM shared.event_outbox
        WHERE event_type = 'reception.approved' AND aggregate_id = $1`,
      [reception]
    );
    expect(event.rows[0]?.event_key).toBe(`reception.approved:${reception}`);
    expect(event.rows[0]?.aggregate_version).toBe('3');
    expect(event.rows[0]?.payload.receptionStatus).toBe('authorized');
    expect(event.rows[0]?.payload.receptionVisitId).toBe(reception);
  });
});

describe('rec.reception-approve: standing authorization', () => {
  /**
   * A withdrawal must actually withdraw.
   *
   * `rec.authorizations` is append-only and its table comment states a decision
   * is "superseded by later rows". The frozen guard does not implement that: it
   * asks only whether SOME row with `decision = 'approved'` exists, so once a
   * party has ever approved, a later `declined` is invisible to it forever. The
   * service reads the STANDING decision and refuses.
   *
   * Without the application check this test fails with 200: the visit becomes
   * `authorized` on the strength of an approval the customer has withdrawn.
   */
  it('refuses approval when the standing decision is a later withdrawal', async () => {
    authAs(SUBJ_APPROVER);
    const receptionId = await openApprovable();

    const withdrawal = await recordAuthorization(receptionId, {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_A,
      decision: 'declined',
    });
    expect(withdrawal.status).toBe(201);

    const response = await approve(receptionId, await versionOf(receptionId));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');
    await expectUntouched(receptionId);
  });

  /**
   * A refusal recorded through the refusals route must withdraw consent too.
   *
   * `rec.refusals.refusal_type` includes `'authorization'`, so this is a second
   * way for a party to say no — and a cheaper one, needing
   * `rec.reception.signature.manage` rather than
   * `rec.reception.authorization.verify`. Reading only `rec.authorizations` left
   * it inert: approve, refuse, and approval still succeeded, which is the same
   * "refusal read as consent" outcome by the sibling route. Removing the
   * `rec.refusals` arm of `standingAuthorizations` makes this fail with 200.
   */
  it('refuses approval when an authorization refusal supersedes the approval', async () => {
    authAs(SUBJ_APPROVER);
    const receptionId = await openApprovable();
    await refuseAuthorization(receptionId);

    const response = await approve(receptionId, await versionOf(receptionId));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');
    await expectUntouched(receptionId);
  });

  it('approves once a fresh approval supersedes an authorization refusal', async () => {
    authAs(SUBJ_APPROVER);
    const receptionId = await openApprovable();
    await refuseAuthorization(receptionId);

    expect(
      (
        await recordAuthorization(receptionId, {
          authorizingRole: 'service_requester',
          partnerId: PARTNER_A,
          decision: 'approved',
        })
      ).status
    ).toBe(201);

    // Latest word wins in both directions, across both tables.
    const response = await approve(receptionId, await versionOf(receptionId));
    expect(response.status).toBe(200);
    expect(await statusOf(receptionId)).toBe('authorized');
  });

  it('approves again once a fresh approval supersedes the withdrawal', async () => {
    authAs(SUBJ_APPROVER);
    const receptionId = await openApprovable();

    expect(
      (
        await recordAuthorization(receptionId, {
          authorizingRole: 'service_requester',
          partnerId: PARTNER_A,
          decision: 'declined',
        })
      ).status
    ).toBe(201);
    expect(
      (
        await recordAuthorization(receptionId, {
          authorizingRole: 'service_requester',
          partnerId: PARTNER_A,
          decision: 'approved',
        })
      ).status
    ).toBe(201);

    // The control that keeps the guard from being merely "any decline ever
    // blocks": supersession works in both directions, latest row wins.
    const response = await approve(receptionId, await versionOf(receptionId));
    expect(response.status).toBe(200);
    expect(await statusOf(receptionId)).toBe('authorized');
  });
});

describe('lifecycle refusals', () => {
  it('refuses a second approval of an already-authorized reception and writes nothing more', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openApprovable();
    expect((await approve(reception, 1)).status).toBe(200);

    const again = await approve(reception, 3);
    expect(again.status).toBe(409);
    expect(((await again.json()) as Body).code).toBe('ERR-TRN-001');

    expect(await statusOf(reception)).toBe('authorized');
    expect(await versionOf(reception)).toBe(3);
    expect(await auditCount(reception)).toBe(1);
    expect(await outboxCount(reception)).toBe(1);
    expect(await historyCount(reception, 'authorized')).toBe(1);
  });

  it('refuses approval of a terminal reception in every terminal state', async () => {
    authAs(SUBJ_APPROVER);

    for (const terminal of ['refused', 'closed_without_work']) {
      const reception = await openApprovable();
      await forceStatus(reception, terminal);
      const refused = await approve(reception, 2);
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as Body).code).toBe('ERR-TRN-001');
      expect(await statusOf(reception)).toBe(terminal);
      expect(await auditCount(reception)).toBe(0);
      expect(await outboxCount(reception)).toBe(0);
    }

    // `converted` is only reachable from `authorized`, so this one is approved
    // for real first and then moved on — which also proves a converted reception
    // cannot be re-approved into a second release for work.
    const converted = await openApprovable();
    expect((await approve(converted, 1)).status).toBe(200);
    await forceStatus(converted, 'converted');
    const refused = await approve(converted, 4);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Body).code).toBe('ERR-TRN-001');
    expect(await statusOf(converted)).toBe('converted');
    // Still exactly the one approval that really happened.
    expect(await auditCount(converted)).toBe(1);
    expect(await outboxCount(converted)).toBe(1);
  });
});

describe('optimistic concurrency', () => {
  it('refuses a stale If-Match with ERR-CON-001 and leaves the status unchanged', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openApprovable();

    const stale = await approve(reception, 99);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Body).code).toBe('ERR-CON-001');
    await expectUntouched(reception);

    // The version was the ONLY thing wrong: with the version the caller really
    // saw, the very same request succeeds.
    expect((await approve(reception, 1)).status).toBe(200);
    expect(await statusOf(reception)).toBe('authorized');
  });

  it('requires If-Match at all, answering 428 without touching the reception', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openApprovable();
    const response = await approve(reception, null);
    expect(response.status).toBe(428);
    expect(((await response.json()) as Body).code).toBe('ERR-CON-002');
    await expectUntouched(reception);
  });

  it('replays one Idempotency-Key into one status change, one audit record, one event', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openApprovable();
    const key = crypto.randomUUID();

    const first = await approve(reception, 1, key);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Body;

    const replay = await approve(reception, 1, key);
    expect(replay.status).toBe(200);
    expect((await replay.json()) as Body).toEqual(firstBody);

    expect(await statusOf(reception)).toBe('authorized');
    expect(await versionOf(reception)).toBe(3);
    expect(await historyCount(reception, 'authorized')).toBe(1);
    expect(await auditCount(reception)).toBe(1);
    expect(await outboxCount(reception)).toBe(1);
  });

  it('lets exactly one of two simultaneous approvals win, with exactly one event', async () => {
    authAs(SUBJ_APPROVER);
    const reception = await openApprovable();

    // `Promise.all` only STARTS both requests; nothing in the pipeline makes them
    // overlap, so on its own it proves nothing about concurrency. Holding the
    // visit row from a third connection parks both writers on the `FOR UPDATE`
    // the approval takes first, and releasing the gate then lets exactly one of
    // them read `opened` — which is the property under test.
    const gate = await admin.connect();
    const outcomes = await (async () => {
      try {
        await gate.query('BEGIN');
        await gate.query('SELECT id FROM rec.reception_visits WHERE id = $1 FOR UPDATE', [
          reception,
        ]);

        const inFlight = Promise.all([approve(reception, 1), approve(reception, 1)]);
        try {
          await waitForBlockedBackends(2);
        } finally {
          // Release whether or not both arrived, so a failure reports its own
          // cause instead of a timeout.
          await gate.query('ROLLBACK');
        }
        return await inFlight;
      } finally {
        gate.release();
      }
    })();

    // Numeric sort: the default comparator is lexicographic, which happens to
    // agree for these two codes but would not for a three- versus four-digit pair.
    const statuses = outcomes.map((response) => response.status).sort((x, y) => x - y);
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);
    // The loser serialised behind the winner's row lock and re-read the state the
    // winner left, so it was refused as already authorized rather than allowed to
    // release the same vehicle for work a second time.
    const loser = outcomes.find((response) => response.status === 409);
    expect(((await (loser as Response).json()) as Body).code).toBe('ERR-TRN-001');

    expect(await statusOf(reception)).toBe('authorized');
    expect(await versionOf(reception)).toBe(3);
    expect(await historyCount(reception, 'authorized')).toBe(1);
    expect(await auditCount(reception)).toBe(1);
    expect(await outboxCount(reception)).toBe(1);
    // The append-only ledger holds exactly the three transitions that really
    // happened — opened, inspecting, authorized — so the loser committed no
    // partial edge of its own before being refused.
    expect(
      await scalar(
        `SELECT count(*)::text AS value FROM rec.reception_status_history WHERE reception_visit_id = $1`,
        [reception]
      )
    ).toBe('3');
  });
});

describe('tenant and branch boundaries', () => {
  it('refuses a tenant-B principal on a tenant-A reception, and tenant A on a real tenant-B one', async () => {
    authAs(SUBJ_APPROVER);
    const inTenantA = await openApprovable();

    authAs(SUBJ_TENANT_B, TENANT_B);
    const inTenantB = await openApprovable({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      partnerId: PARTNER_B,
    });

    // Tenant B holds the very same `rec.reception.approve` permission in its own
    // tenant, so authorization passes and the only thing that can refuse this is
    // the tenant predicate on the visit resolve.
    const crossIntoA = await approve(inTenantA, 1);
    expect(crossIntoA.status).toBe(404);
    expect(((await crossIntoA.json()) as Body).code).toBe('ERR-RES-001');
    await expectUntouched(inTenantA);

    authAs(SUBJ_APPROVER);
    const crossIntoB = await approve(inTenantB, 1);
    expect(crossIntoB.status).toBe(404);
    expect(((await crossIntoB.json()) as Body).code).toBe('ERR-RES-001');
    await expectUntouched(inTenantB);

    // And the tenant-B reception really was approvable all along: its own tenant
    // completes it. Without this the two 404s above could have been caused by an
    // unapprovable fixture rather than by the boundary.
    authAs(SUBJ_TENANT_B, TENANT_B);
    expect((await approve(inTenantB, 1)).status).toBe(200);
    expect(await statusOf(inTenantB)).toBe('authorized');

    // Tenant A's reception is still untouched after all of it.
    await expectUntouched(inTenantA);
  });

  it('refuses a branch-narrowed principal out of scope and admits it inside its own branch', async () => {
    authAs(SUBJ_APPROVER);
    const inBranchA1 = await openApprovable({ branchId: BRANCH_A1 });
    const inBranchA2 = await openApprovable({ branchId: BRANCH_A2 });

    // SUBJ_SCOPED holds `rec.reception.approve` and its grant is narrowed to
    // BRANCH_A2 only. Both receptions are in its own tenant and its own company.
    authAs(SUBJ_SCOPED);
    const outOfScope = await approve(inBranchA1, 1);
    expect(outOfScope.status).toBe(404);
    expect(((await outOfScope.json()) as Body).code).toBe('ERR-RES-001');
    await expectUntouched(inBranchA1);

    // The same principal, the same permission, the same request shape — inside
    // the branch it was granted. So the refusal above was the narrowing and
    // nothing else.
    const inScope = await approve(inBranchA2, 1);
    expect(inScope.status).toBe(200);
    expect(await statusOf(inBranchA2)).toBe('authorized');
    expect(await auditCount(inBranchA2)).toBe(1);
    expect(await outboxCount(inBranchA2)).toBe(1);

    // And branch A1's reception is still exactly where it was.
    await expectUntouched(inBranchA1);
  });
});
