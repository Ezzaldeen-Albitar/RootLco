/**
 * Reception check-in in both origin modes, end to end (Phase 1-18,
 * P1-18-BE-005, P1-18-BE-006, P1-18-BE-007, P1-18-BE-008).
 *
 * Drives the real `POST /api/v1/receptions` handler through the fixed pipeline on
 * the least-privilege `app_runtime` role. Taking a vehicle into custody is one
 * controlled transaction: the origin is consumed (a walk-in reference is written,
 * or a confirmed appointment is locked and moved to `checked_in`), the frozen
 * `rec.accept_check_in()` primitive writes the visit, the mandatory
 * `service_requester` party role, the `accepted` custody event and the initial
 * status-history row, and the audit record and the `vehicle.checked-in` envelope
 * commit with them or not at all.
 *
 * The four frozen invariants this suite puts on trial are the ones a caller could
 * otherwise break: exactly one origin, an origin consumed at most once, one open
 * visit per vehicle, and a check-in only from a CONFIRMED appointment.
 *
 * Operations exercised here: rec.reception-create.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rec.reception-create: route service authorization success denial cross-tenant isolation audit outbox rollback idempotency concurrency
 *   rec.receiving-employee-list: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  SUBJECT_UNPERMITTED,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_TENANT_B,
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
import { GET as LIST_RECEIVING_EMPLOYEES } from '@/app/api/v1/reception-catalogue/receiving-employees/route';

const ROLE_CLERK = 'c1180000-0000-4000-8000-0000000000a1';
const USER_CLERK = 'c1180000-0000-4000-8000-0000000000a2';
const SUBJ_CLERK = 'fx_p1_18_rec_clerk';
/** Tenant-A account whose only grant is narrowed to BRANCH_A2. */
const ROLE_BRANCH2 = 'c1180000-0000-4000-8000-0000000000a3';
const USER_BRANCH2 = 'c1180000-0000-4000-8000-0000000000a4';
const SUBJ_BRANCH2 = 'fx_p1_18_rec_branch2';
const GRANT_BRANCH2 = 'c1180000-0000-4000-8000-0000000000a5';

/**
 * The cross-grant union principal: `rec.reception.manage` scoped to BRANCH_A2 by
 * one grant, and a second grant carrying NO reception permission scoped to
 * BRANCH_A1. `iam.has_permission` is scope-blind, and `app.branch_ids` is the
 * union of every grant, so before the route named its authorization target this
 * caller could open a visit and take custody in BRANCH_A1 — a branch where it
 * holds no reception capability at all.
 */
const ROLE_UNION_READ = 'c1180000-0000-4000-8000-0000000000a6';
const USER_UNION = 'c1180000-0000-4000-8000-0000000000a7';
const SUBJ_UNION = 'fx_p1_18_rec_union';
const GRANT_UNION_WRITE_A2 = 'c1180000-0000-4000-8000-0000000000a8';
const GRANT_UNION_READ_A1 = 'c1180000-0000-4000-8000-0000000000a9';

/**
 * A genuinely COMPANY-WIDE principal: one `company` scope row for COMPANY_A1 and
 * no branch row. `iam.has_permission_in_scope` treats that as covering every
 * branch in the company, so this principal must succeed in BOTH branches. It
 * exists because the first remediation added an application-layer check that
 * accepted only `unrestricted` or an explicit branch row, which silently refused
 * exactly this legitimate operator on the two creation routes.
 */
/**
 * A SECOND company inside tenant A, with its own branch.
 *
 * It exists to make the company half of the appointment-scope guard provable. A
 * company-wide grant in COMPANY_A1 satisfies `iam.has_permission_in_scope` on the
 * strength of its `company` scope row alone, so without the company comparison a
 * caller could authorize against COMPANY_A1 while the appointment — and therefore
 * the visit, custody and party role — lands in COMPANY_A2.
 */
const COMPANY_A2 = 'c1180000-0000-4000-8000-0000000000ad';
const BRANCH_A2_OTHER_COMPANY = 'c1180000-0000-4000-8000-0000000000ae';

const ROLE_COMPANY_WIDE = 'c1180000-0000-4000-8000-0000000000aa';
const USER_COMPANY_WIDE = 'c1180000-0000-4000-8000-0000000000ab';
const SUBJ_COMPANY_WIDE = 'fx_p1_18_rec_company_wide';
const GRANT_COMPANY_WIDE = 'c1180000-0000-4000-8000-0000000000ac';

/**
 * FE-007. The one principal in this suite holding the cross-branch authority
 * `rec.reception.receiving_employee.assign_any` on top of `rec.reception.manage`.
 *
 * It is a SEPARATE principal on purpose. Adding the permission to ROLE_CLERK
 * would have made the refusal case below pass for the wrong reason — a denial
 * test whose subject secretly holds the thing being denied proves nothing — so
 * the two cases differ in exactly one variable: who is asking.
 */
const ROLE_CROSS_BRANCH = 'c1180000-0000-4000-8000-0000000000af';
const USER_CROSS_BRANCH = 'c1180000-0000-4000-8000-0000000000b0';
const SUBJ_CROSS_BRANCH = 'fx_p1_18_rec_cross_branch';
const CROSS_BRANCH_PERMISSION = 'rec.reception.receiving_employee.assign_any';

const BRANCH_A2 = 'c1180000-0000-4000-8000-0000000000b2';
const COMPANY_B1 = 'c1180000-0000-4000-8000-0000000000c1';
const BRANCH_B1 = 'c1180000-0000-4000-8000-0000000000c2';

const REQUESTER_A = 'c1180000-0000-4000-8000-0000000000d1';
const REQUESTER_B = 'c1180000-0000-4000-8000-0000000000d2';
const APPOINTMENT_TYPE = 'c1180000-0000-4000-8000-0000000000e1';
/** Active IAM identity with an unrestricted live role grant. */
const RECEIVING_EMPLOYEE = USER_CLERK;
/** An id that belongs to no row anywhere — used for the injected-failure case. */
const ABSENT_ID = 'c1180000-0000-4000-8000-0000000000fe';

const RECEPTIONS = 'http://localhost/api/v1/receptions';

interface Body {
  readonly receptionVisitId?: string;
  readonly origin?: string;
  readonly receptionStatus?: string;
  readonly recordVersion?: number;
  readonly code?: string;
  readonly violations?: readonly { path: string; rule: string }[];
}

interface EmployeePage {
  readonly items: readonly { id: string; displayName: string }[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface VisitRow {
  readonly id: string;
  readonly appointment_id: string | null;
  readonly walk_in_id: string | null;
  readonly reception_status: string;
  readonly custody_accepted_at: string | null;
  readonly company_id: string;
  readonly branch_id: string;
}

let admin: Pool;
let runtime: Pool;
let vehicleCounter = 0;
let appointmentCounter = 0;

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

function createReception(body: unknown, key = crypto.randomUUID()): Promise<Response> {
  return CREATE_RECEPTION(
    new Request(RECEPTIONS, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );
}

function listReceivingEmployees(companyId = COMPANY_A1, branchId = BRANCH_A1): Promise<Response> {
  const query = new URLSearchParams({ companyId, branchId, limit: '100' });
  return LIST_RECEIVING_EMPLOYEES(
    new Request(`http://localhost/api/v1/reception-catalogue/receiving-employees?${query}`)
  );
}

/** A walk-in check-in body, scoped to COMPANY_A1 / BRANCH_A1 unless overridden. */
function walkInBody(
  vehicleId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    vehicleId,
    receivingEmployeeId: RECEIVING_EMPLOYEE,
    serviceRequesterPartnerId: REQUESTER_A,
    origin: { kind: 'walk_in', note: 'Arrived without an appointment.' },
    ...overrides,
  };
}

/** An appointment-origin check-in body. */
function appointmentBody(
  vehicleId: string,
  appointmentId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    vehicleId,
    receivingEmployeeId: RECEIVING_EMPLOYEE,
    serviceRequesterPartnerId: REQUESTER_A,
    origin: { kind: 'appointment', appointmentId },
    ...overrides,
  };
}

async function countOf(sql: string, values: readonly unknown[] = []): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

async function visitFor(vehicleId: string): Promise<VisitRow | undefined> {
  const result = await admin.query<VisitRow>(
    `SELECT id, appointment_id, walk_in_id, reception_status, custody_accepted_at,
            company_id, branch_id
       FROM rec.reception_visits WHERE vehicle_id = $1`,
    [vehicleId]
  );
  return result.rows[0];
}

async function appointmentStatus(appointmentId: string): Promise<string | undefined> {
  const result = await admin.query<{ lifecycle_status: string }>(
    `SELECT lifecycle_status FROM apt.appointments WHERE id = $1`,
    [appointmentId]
  );
  return result.rows[0]?.lifecycle_status;
}

const auditCount = (visitId: string): Promise<number> =>
  countOf(
    `SELECT count(*)::text AS n FROM iam.audit_records
      WHERE action = 'rec.reception.created' AND entity_id = $1`,
    [visitId]
  );

const outboxCount = (visitId: string): Promise<number> =>
  countOf(
    `SELECT count(*)::text AS n FROM shared.event_outbox
      WHERE event_type = 'vehicle.checked-in' AND aggregate_id = $1`,
    [visitId]
  );

/**
 * Every place a successful check-in writes, counted tenant-wide.
 *
 * The rollback case compares this before and against after: a per-vehicle count
 * would be vacuously zero for the four ledgers whose rows hang off a visit that
 * was never created, and would prove nothing. A tenant-wide delta of zero on all
 * eight is a statement about what the failed transaction left behind.
 */
async function ledgerCounts(): Promise<Record<string, number>> {
  return {
    walkIns: await countOf(
      `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE tenant_id = $1`,
      [TENANT_A]
    ),
    visits: await countOf(
      `SELECT count(*)::text AS n FROM rec.reception_visits WHERE tenant_id = $1`,
      [TENANT_A]
    ),
    partyRoles: await countOf(
      `SELECT count(*)::text AS n FROM rec.reception_party_roles WHERE tenant_id = $1`,
      [TENANT_A]
    ),
    custody: await countOf(
      `SELECT count(*)::text AS n FROM rec.custody_history WHERE tenant_id = $1`,
      [TENANT_A]
    ),
    statusHistory: await countOf(
      `SELECT count(*)::text AS n FROM rec.reception_status_history WHERE tenant_id = $1`,
      [TENANT_A]
    ),
    audits: await countOf(
      `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = 'rec.reception.created'`
    ),
    outbox: await countOf(
      `SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_type = 'vehicle.checked-in'`
    ),
    idempotencyKeys: await countOf(
      `SELECT count(*)::text AS n FROM shared.idempotency_keys
        WHERE operation = 'rec_reception_create'`
    ),
  };
}

/**
 * Blocks until `expected` backends are waiting on a lock in this database.
 *
 * Copied from `p1-16-customer-governance.test.ts`, for the same reason: a race
 * between two in-flight requests cannot be asserted until both have actually
 * reached the contended row. Waiting for that is what makes the assertion
 * deterministic instead of a coin toss decided by the event loop.
 */
async function waitForBlockedBackends(expected: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  while (Date.now() < deadline) {
    const result = await admin.query<{ n: string }>(
      `SELECT count(DISTINCT a.pid)::text AS n
         FROM pg_stat_activity a
         JOIN pg_locks l ON l.pid = a.pid
        WHERE NOT l.granted
          AND a.datname = current_database()
          AND a.pid <> pg_backend_pid()`
    );
    seen = Number(result.rows[0]?.n ?? '0');
    if (seen >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `expected ${expected} backends blocked on a lock within ${timeoutMs}ms, saw ${seen}; ` +
      'the race was not forced, so the outcome below would prove nothing'
  );
}

/**
 * Runs admin fixture writes inside one transaction with the actor GUCs set.
 *
 * The `crm`, `veh` and `apt` triggers stamp their actor from `app.user_id` and
 * the status-history stamp refuses a NULL actor, so a fixture that changes an
 * appointment's lifecycle cannot be written without a context.
 */
async function asActor(
  tenantId: string,
  run: (client: PoolClient) => Promise<void>
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, tenantId]
    );
    await run(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function newVehicle(tenantId = TENANT_A): Promise<string> {
  vehicleCounter += 1;
  const vin = `P118RC${String(vehicleCounter).padStart(11, '0')}`;
  let id = '';
  await asActor(tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1, $2, 'ice', 'active', $3) RETURNING id`,
      [tenantId, vin, USER_A]
    );
    id = result.rows[0]?.id ?? '';
  });
  return id;
}

/**
 * Books an appointment and, when asked, confirms it.
 *
 * Confirmation is written here rather than driven through a route to keep this
 * suite's fixtures independent of another operation's behaviour.
 * `apt.appointment-reschedule` does reach `confirmed` — it sets the window and
 * the status in one statement, proven by `p1-18-appointment-lifecycle.test.ts`
 * — so this is a fixture convenience, not a gap in the API.
 */
async function newAppointment(input: {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly requesterPartnerId: string;
  readonly confirm: boolean;
}): Promise<string> {
  appointmentCounter += 1;
  const offsetHours = appointmentCounter * 2;
  let id = '';
  await asActor(input.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO apt.appointments
         (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id,
          appointment_type_id, requested_from, requested_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               now() + make_interval(hours => $7::int),
               now() + make_interval(hours => $7::int + 1), $8)
       RETURNING id`,
      [
        input.tenantId,
        input.companyId,
        input.branchId,
        input.vehicleId,
        input.requesterPartnerId,
        APPOINTMENT_TYPE,
        offsetHours,
        USER_A,
      ]
    );
    id = result.rows[0]?.id ?? '';
    if (input.confirm) {
      // One statement: `ck_appointments_confirmed_required` makes the status and
      // the window a single fact.
      await client.query(
        `UPDATE apt.appointments
            SET lifecycle_status = 'confirmed',
                confirmed_from = requested_from,
                confirmed_to = requested_to
          WHERE id = $1`,
        [id]
      );
    }
  });
  return id;
}

async function seedPrincipal(input: {
  readonly tenantId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly subject: string;
}): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $4 || '@example.test', 'Reception Clerk', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [input.userId, input.tenantId, IDENTITY_PROVIDER, input.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-18 reception clerk', $4) ON CONFLICT (id) DO NOTHING`,
    [input.roleId, input.tenantId, input.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid FROM iam.permissions p
      WHERE p.permission_code = 'rec.reception.manage'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [input.tenantId, input.roleId, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('rec.reception.manage', 'rec', 'Open a reception visit and accept vehicle custody', 'medium', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  // A second branch in tenant A (the narrowed principal's only scope), and a
  // company + branch in tenant B so the cross-tenant probes address REAL rows.
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, $3, 'branch_a2', 'Fixture Branch A2', 'UTC', $4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, 'company_b1', 'Fixture Company B1', 'USD', $3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, $3, 'branch_b1', 'Fixture Branch B1', 'UTC', $4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A]
  );

  // A platform-scope appointment type: visible to both tenants, removed by the
  // `fx_` sweep in cleanFixtures.
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, status, created_by)
     VALUES ($1, 'platform', NULL, 'fx_p1_18_rc', 'P1-18 reception fixture type', 'active', $2)
     ON CONFLICT (id) DO NOTHING`,
    [APPOINTMENT_TYPE, USER_A]
  );

  await seedPrincipal({
    tenantId: TENANT_A,
    roleId: ROLE_CLERK,
    userId: USER_CLERK,
    subject: SUBJ_CLERK,
  });
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, USER_CLERK, ROLE_CLERK, USER_A]
  );

  await seedPrincipal({
    tenantId: TENANT_A,
    roleId: ROLE_BRANCH2,
    userId: USER_BRANCH2,
    subject: SUBJ_BRANCH2,
  });
  // The scoped grant and its scopes must land together: the "a scoped grant needs
  // a scope" trigger is DEFERRABLE INITIALLY DEFERRED.
  const scoped = await admin.connect();
  try {
    await scoped.query('BEGIN');
    await scoped.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1, $2, $3, $4, 'scoped', $5, $5)`,
      [GRANT_BRANCH2, TENANT_A, USER_BRANCH2, ROLE_BRANCH2, USER_A]
    );
    // Branch-only, so "granted only another branch" is literally what this grant
    // is. It previously also carried a `company` row, which under
    // `iam.has_permission_in_scope` makes a grant company-WIDE — so the principal
    // was authorized across COMPANY_A1 and only RLS was refusing it, which is not
    // what the test claimed to prove.
    await scoped.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1, $2, 'branch', $3, $4, $5)`,
      [TENANT_A, GRANT_BRANCH2, COMPANY_A1, BRANCH_A2, USER_A]
    );
    await scoped.query('COMMIT');
  } catch (error) {
    await scoped.query('ROLLBACK');
    throw error;
  } finally {
    scoped.release();
  }

  // The cross-grant union principal. `seedPrincipal` gives ROLE_BRANCH2 the
  // reception permission; ROLE_UNION_READ deliberately gets none. USER_UNION
  // holds BOTH: the capable role scoped to BRANCH_A2 and the empty role scoped
  // to BRANCH_A1.
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $4 || '@example.test', 'Union Principal', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [USER_UNION, TENANT_A, IDENTITY_PROVIDER, SUBJ_UNION, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-18 union read-only', $4) ON CONFLICT (id) DO NOTHING`,
    [ROLE_UNION_READ, TENANT_A, SUBJ_UNION, USER_A]
  );
  const union = await admin.connect();
  try {
    await union.query('BEGIN');
    for (const [grantId, roleId, branchId] of [
      [GRANT_UNION_WRITE_A2, ROLE_BRANCH2, BRANCH_A2],
      [GRANT_UNION_READ_A1, ROLE_UNION_READ, BRANCH_A1],
    ] as const) {
      await union.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1, $2, $3, $4, 'scoped', $5, $5)`,
        [grantId, TENANT_A, USER_UNION, roleId, USER_A]
      );
      // A BRANCH scope row only — deliberately no `company` row.
      //
      // `ck_grant_scopes_shape` lets a branch row carry its own `company_id`, and
      // `iam.has_permission_in_scope` matches a company only when the row's
      // `scope_type` IS `'company'`. So this grant is genuinely branch-scoped and
      // does not reach a sibling branch. An earlier version of this fixture also
      // inserted a `company` row, which by the platform's contract makes the
      // grant company-WIDE — so the "escalation" it appeared to demonstrate was
      // correct behaviour, and the application-layer check added to stop it was
      // closing nothing while refusing legitimate company-scoped operators.
      await union.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1, $2, 'branch', $3, $4, $5)`,
        [TENANT_A, grantId, COMPANY_A1, branchId, USER_A]
      );
    }
    await union.query('COMMIT');
  } catch (error) {
    await union.query('ROLLBACK');
    throw error;
  } finally {
    union.release();
  }

  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, 'company_a2', 'Fixture Company A2', 'USD', $3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_A2, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, $3, 'branch_a2b', 'Fixture Branch A2B', 'UTC', $4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2_OTHER_COMPANY, TENANT_A, COMPANY_A2, USER_A]
  );

  // The company-wide principal: `rec.reception.manage` through a single `company`
  // scope row, no branch row.
  await seedPrincipal({
    tenantId: TENANT_A,
    roleId: ROLE_COMPANY_WIDE,
    userId: USER_COMPANY_WIDE,
    subject: SUBJ_COMPANY_WIDE,
  });
  const companyWide = await admin.connect();
  try {
    await companyWide.query('BEGIN');
    await companyWide.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1, $2, $3, $4, 'scoped', $5, $5)`,
      [GRANT_COMPANY_WIDE, TENANT_A, USER_COMPANY_WIDE, ROLE_COMPANY_WIDE, USER_A]
    );
    await companyWide.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
       VALUES ($1, $2, 'company', $3, $4)`,
      [TENANT_A, GRANT_COMPANY_WIDE, COMPANY_A1, USER_A]
    );
    await companyWide.query('COMMIT');
  } catch (error) {
    await companyWide.query('ROLLBACK');
    throw error;
  } finally {
    companyWide.release();
  }

  // FE-007. The catalogue row the database gate resolves, inserted idempotently
  // exactly as `rec.reception.manage` is above: the seed owns it, and a suite
  // that depended on the seed having been re-run would be measuring the
  // developer's stack rather than the guard.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ($1, 'rec', 'Name a receiving employee who is not eligible for the visit branch', 'high', $2)
     ON CONFLICT (permission_code) DO NOTHING`,
    [CROSS_BRANCH_PERMISSION, USER_A]
  );
  await seedPrincipal({
    tenantId: TENANT_A,
    roleId: ROLE_CROSS_BRANCH,
    userId: USER_CROSS_BRANCH,
    subject: SUBJ_CROSS_BRANCH,
  });
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_CROSS_BRANCH, USER_A, CROSS_BRANCH_PERMISSION]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, USER_CROSS_BRANCH, ROLE_CROSS_BRANCH, USER_A]
  );

  await asActor(TENANT_A, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1, $2, 'individual', 'Reception Requester A', 'active', $3)
       ON CONFLICT (id) DO NOTHING`,
      [REQUESTER_A, TENANT_A, USER_A]
    );
  });
  await asActor(TENANT_B, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1, $2, 'individual', 'Reception Requester B', 'active', $3)
       ON CONFLICT (id) DO NOTHING`,
      [REQUESTER_B, TENANT_B, USER_A]
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

describe('authentication and authorization', () => {
  it('answers 401 with no session and 403 without rec.reception.manage, writing nothing', async () => {
    const vehicle = await newVehicle();

    __resetAuthenticatorForTests();
    const anonymous = await createReception(walkInBody(vehicle));
    expect(anonymous.status).toBe(401);

    // SUBJECT_UNPERMITTED is a real, active tenant-A account whose role carries no
    // permission mapping at all, so the only thing that can refuse it is the
    // operation's declared permission.
    authAs(SUBJECT_UNPERMITTED);
    const denied = await createReception(walkInBody(vehicle));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as Body).code).toBe('ERR-IAM-001');

    // A denial performs no work: no origin record and no visit exist.
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE vehicle_id = $1`,
        [vehicle]
      )
    ).toBe(0);
    expect(await visitFor(vehicle)).toBeUndefined();
  });
});

describe('rec.receiving-employee-list and authoritative selection', () => {
  it('lists active branch-eligible IAM users and refuses an out-of-branch selection', async () => {
    authAs(SUBJ_CLERK);
    const listed = await listReceivingEmployees();
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as EmployeePage;
    expect(page.items).toContainEqual({ id: USER_CLERK, displayName: 'Reception Clerk' });
    expect(page.items.some((entry) => entry.id === USER_BRANCH2)).toBe(false);

    const vehicle = await newVehicle();
    const denied = await createReception(
      walkInBody(vehicle, { receivingEmployeeId: USER_BRANCH2 })
    );
    expect(denied.status).toBe(422);
    const problem = (await denied.json()) as Body;
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations).toEqual([
      { path: 'body.receivingEmployeeId', rule: 'ineligible_reference' },
    ]);
    expect(await visitFor(vehicle)).toBeUndefined();
  });

  it('keeps a disabled employee historical but neither selectable nor listable', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const created = await createReception(
      walkInBody(vehicle, { receivingEmployeeId: USER_COMPANY_WIDE })
    );
    expect(created.status).toBe(201);
    const visitId = ((await created.json()) as Body).receptionVisitId ?? '';

    const before = await admin.query<{ receiving_employee_display_name: string }>(
      `SELECT receiving_employee_display_name FROM rec.reception_visits WHERE id = $1`,
      [visitId]
    );
    expect(before.rows[0]?.receiving_employee_display_name).toBe('Reception Clerk');

    await admin.query(
      `UPDATE iam.user_accounts
          SET display_name = 'Renamed Historical Employee', status = 'locked'
        WHERE id = $1`,
      [USER_COMPANY_WIDE]
    );
    try {
      const listed = (await (await listReceivingEmployees()).json()) as EmployeePage;
      expect(listed.items.some((entry) => entry.id === USER_COMPANY_WIDE)).toBe(false);

      const deniedVehicle = await newVehicle();
      const denied = await createReception(
        walkInBody(deniedVehicle, { receivingEmployeeId: USER_COMPANY_WIDE })
      );
      expect(denied.status).toBe(422);

      const historical = await admin.query<{ receiving_employee_display_name: string }>(
        `SELECT receiving_employee_display_name FROM rec.reception_visits WHERE id = $1`,
        [visitId]
      );
      expect(historical.rows[0]?.receiving_employee_display_name).toBe('Reception Clerk');
    } finally {
      await admin.query(
        `UPDATE iam.user_accounts SET display_name = 'Reception Clerk', status = 'active' WHERE id = $1`,
        [USER_COMPANY_WIDE]
      );
    }
  });

  it('preserves unrelated check-in validation instead of mislabelling it as employee eligibility', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const response = await createReception(walkInBody(vehicle, { evSocPercent: 101 }));
    expect(response.status).toBe(422);
    const problem = (await response.json()) as Body;
    expect(problem.violations?.[0]?.path).toBe('body.evSocPercent');
    expect(problem.violations?.[0]?.rule).not.toBe('ineligible_reference');
  });

  it('refuses a forged identifier that names no account anywhere', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    // ABSENT_ID is a well-formed uuid belonging to no row. Before FE-007 this
    // was the ORDINARY case — the column had no foreign key — and a visit
    // recording it opened successfully.
    const denied = await createReception(walkInBody(vehicle, { receivingEmployeeId: ABSENT_ID }));
    expect(denied.status).toBe(422);
    expect(((await denied.json()) as Body).code).toBe('ERR-VAL-001');
    expect(await visitFor(vehicle)).toBeUndefined();
  });

  it('refuses an account from another tenant and never offers one', async () => {
    authAs(SUBJ_CLERK);
    // USER_TENANT_B is a real, active account — in tenant B. The picker must not
    // name it and the create must not accept it; both halves matter, because a
    // list that leaks a foreign identity is a disclosure even when the write
    // that follows is refused.
    const page = (await (await listReceivingEmployees()).json()) as EmployeePage;
    expect(page.items.some((entry) => entry.id === USER_TENANT_B)).toBe(false);

    const vehicle = await newVehicle();
    const denied = await createReception(
      walkInBody(vehicle, { receivingEmployeeId: USER_TENANT_B })
    );
    expect(denied.status).toBe(422);
    expect(((await denied.json()) as Body).code).toBe('ERR-VAL-001');
    expect(await visitFor(vehicle)).toBeUndefined();
  });

  it('accepts an out-of-branch employee ONLY for an actor holding the cross-branch authority', async () => {
    // The refusal half is asserted above for SUBJ_CLERK against the same
    // employee, the same branch and the same body. Here exactly one thing
    // differs — the actor — so the permission is provably what moved.
    authAs(SUBJ_CROSS_BRANCH);
    const vehicle = await newVehicle();
    const created = await createReception(
      walkInBody(vehicle, { receivingEmployeeId: USER_BRANCH2 })
    );
    expect(created.status).toBe(201);

    const visitId = ((await created.json()) as Body).receptionVisitId ?? '';
    const row = await admin.query<{ id: string; name: string }>(
      `SELECT receiving_employee_id AS id, receiving_employee_display_name AS name
         FROM rec.reception_visits WHERE id = $1`,
      [visitId]
    );
    expect(row.rows[0]?.id).toBe(USER_BRANCH2);
    expect(row.rows[0]?.name).toBe('Reception Clerk');

    // The authority does NOT widen the picker: it stays the branch's own
    // eligible set, so an administrator who reaches across branches does so
    // deliberately with an id from the user directory, not by the list quietly
    // growing under a permission the operator cannot see.
    const page = (await (await listReceivingEmployees()).json()) as EmployeePage;
    expect(page.items.some((entry) => entry.id === USER_BRANCH2)).toBe(false);
  });

  it('defaults the custodian to the authenticated user when the body names none', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const body = walkInBody(vehicle);
    delete body.receivingEmployeeId;

    const created = await createReception(body);
    expect(created.status).toBe(201);
    const visitId = ((await created.json()) as Body).receptionVisitId ?? '';
    const row = await admin.query<{ id: string; name: string }>(
      `SELECT receiving_employee_id AS id, receiving_employee_display_name AS name
         FROM rec.reception_visits WHERE id = $1`,
      [visitId]
    );
    expect(row.rows[0]?.id).toBe(USER_CLERK);
    expect(row.rows[0]?.name).toBe('Reception Clerk');
  });

  it('stamps the snapshot server-side and ignores one supplied by the caller', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    // `.strict()` refuses the unknown field outright, which is the strongest
    // possible answer: the snapshot is not merely overwritten, it has no way in.
    const rejected = await createReception(
      walkInBody(vehicle, { receivingEmployeeDisplayName: 'Someone Else' })
    );
    expect(rejected.status).toBe(422);
    expect(await visitFor(vehicle)).toBeUndefined();
  });
});

describe('rec.reception-create: walk-in origin', () => {
  it('writes the walk-in, the visit, the requester role, the custody acceptance and the ledger atomically', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();

    const response = await createReception(walkInBody(vehicle));
    expect(response.status).toBe(201);
    const body = (await response.json()) as Body;
    expect(body.receptionVisitId).toBeTruthy();
    expect(body.origin).toBe('walk_in');
    expect(body.receptionStatus).toBe('opened');
    expect(body.recordVersion).toBe(1);

    const visitId = body.receptionVisitId ?? '';

    // A walk-in is a first-class origin record — exactly one, not a fabricated
    // appointment.
    const walkIns = await admin.query<{ id: string; company_id: string; branch_id: string }>(
      `SELECT id, company_id, branch_id FROM rec.walk_in_references WHERE vehicle_id = $1`,
      [vehicle]
    );
    expect(walkIns.rowCount).toBe(1);

    const visit = await visitFor(vehicle);
    expect(visit?.id).toBe(visitId);
    expect(visit?.walk_in_id).toBe(walkIns.rows[0]?.id);
    expect(visit?.appointment_id).toBeNull();
    expect(visit?.reception_status).toBe('opened');
    expect(visit?.custody_accepted_at).not.toBeNull();
    expect(visit?.company_id).toBe(COMPANY_A1);
    expect(visit?.branch_id).toBe(BRANCH_A1);

    // The four rows `rec.accept_check_in()` promises in one statement. Counting
    // each one is the point: a visit held with no custody record, or with no
    // service requester, is the state the primitive exists to make unreachable.
    const roles = await admin.query<{ relationship_role: string; partner_id: string }>(
      `SELECT relationship_role, partner_id FROM rec.reception_party_roles
        WHERE reception_visit_id = $1 AND valid_to IS NULL`,
      [visitId]
    );
    expect(roles.rowCount).toBe(1);
    expect(roles.rows[0]?.relationship_role).toBe('service_requester');
    expect(roles.rows[0]?.partner_id).toBe(REQUESTER_A);

    const custody = await admin.query<{ from_state: string | null; to_state: string }>(
      `SELECT from_state, to_state FROM rec.custody_history WHERE reception_visit_id = $1`,
      [visitId]
    );
    expect(custody.rowCount).toBe(1);
    expect(custody.rows[0]?.from_state).toBeNull();
    expect(custody.rows[0]?.to_state).toBe('accepted');

    const ledger = await admin.query<{ from_state: string | null; to_state: string }>(
      `SELECT from_state, to_state FROM rec.reception_status_history WHERE reception_visit_id = $1`,
      [visitId]
    );
    expect(ledger.rowCount).toBe(1);
    expect(ledger.rows[0]?.from_state).toBeNull();
    expect(ledger.rows[0]?.to_state).toBe('opened');

    // Audit and outbox are read back and counted, not assumed.
    expect(await auditCount(visitId)).toBe(1);
    expect(await outboxCount(visitId)).toBe(1);
    const event = await admin.query<{ event_key: string; payload: Record<string, unknown> }>(
      `SELECT event_key, payload FROM shared.event_outbox
        WHERE event_type = 'vehicle.checked-in' AND aggregate_id = $1`,
      [visitId]
    );
    expect(event.rows[0]?.event_key).toBe(`vehicle.checked-in:${visitId}`);
    expect(event.rows[0]?.payload?.['originKind']).toBe('walk_in');
    expect(event.rows[0]?.payload?.['vehicleId']).toBe(vehicle);
  });

  it('refuses a second reception while the vehicle still has an open visit, leaving one origin record', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    expect((await createReception(walkInBody(vehicle))).status).toBe(201);

    // `uq_reception_visits_open_vehicle`: custody cannot be in two places. The
    // second attempt writes its own walk-in reference BEFORE the visit insert
    // fails, so this also proves that second origin record was rolled back.
    const second = await createReception(walkInBody(vehicle));
    expect(second.status).toBe(409);
    expect(((await second.json()) as Body).code).toBe('ERR-RES-002');

    expect(
      await countOf(`SELECT count(*)::text AS n FROM rec.reception_visits WHERE vehicle_id = $1`, [
        vehicle,
      ])
    ).toBe(1);
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE vehicle_id = $1`,
        [vehicle]
      )
    ).toBe(1);
  });
});

describe('rec.reception-create: appointment origin', () => {
  it('consumes a confirmed appointment and moves it to checked_in without fabricating a walk-in', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: vehicle,
      requesterPartnerId: REQUESTER_A,
      confirm: true,
    });

    const response = await createReception(appointmentBody(vehicle, appointment));
    expect(response.status).toBe(201);
    const body = (await response.json()) as Body;
    expect(body.origin).toBe('appointment');
    const visitId = body.receptionVisitId ?? '';

    const visit = await visitFor(vehicle);
    expect(visit?.appointment_id).toBe(appointment);
    expect(visit?.walk_in_id).toBeNull();
    expect(visit?.reception_status).toBe('opened');
    expect(visit?.custody_accepted_at).not.toBeNull();

    // The XOR origin is honoured in the other direction too: no walk-in reference
    // was invented to stand in for the appointment.
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE vehicle_id = $1`,
        [vehicle]
      )
    ).toBe(0);

    // The origin is consumed in the same transaction as the visit.
    expect(await appointmentStatus(appointment)).toBe('checked_in');
    const history = await admin.query<{ from_state: string; to_state: string }>(
      `SELECT from_state, to_state FROM apt.appointment_status_history
        WHERE appointment_id = $1 ORDER BY seq DESC LIMIT 1`,
      [appointment]
    );
    expect(history.rows[0]?.from_state).toBe('confirmed');
    expect(history.rows[0]?.to_state).toBe('checked_in');

    expect(await auditCount(visitId)).toBe(1);
    expect(await outboxCount(visitId)).toBe(1);
  });

  /**
   * The body's scope must EQUAL the appointment's, and this test used to assert
   * the opposite.
   *
   * It expected 201 with the visit landing in the appointment's branch while the
   * body named another — which is exactly the escalation `resolveOrigin` now
   * refuses. `authorizationTarget` is derived from the body before the
   * transaction opens, so a divergent body meant authorizing one branch and
   * writing in a different one, and the appointment lock resolves by tenant and
   * id alone. Blessing the mismatch here is what let the appointment origin walk
   * past branch containment entirely.
   */
  it('refuses a body whose company or branch differs from the appointment', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: vehicle,
      requesterPartnerId: REQUESTER_A,
      confirm: true,
    });

    const response = await createReception(
      appointmentBody(vehicle, appointment, { branchId: BRANCH_A2 })
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');

    // The refusal performs no work: no visit, and the appointment is untouched.
    expect(await visitFor(vehicle)).toBeUndefined();
    expect(await appointmentStatus(appointment)).toBe('confirmed');

    // The control: the same request naming the appointment's own branch is
    // accepted, so the refusal is about the mismatch and nothing else.
    const ok = await createReception(appointmentBody(vehicle, appointment));
    expect(ok.status).toBe(201);
    expect((await visitFor(vehicle))?.branch_id).toBe(BRANCH_A1);
  });

  /**
   * The COMPANY half of the same guard, isolated.
   *
   * The branch-mismatch case above leaves the company half unproven, and a
   * mutation that disabled only the company comparison passed the whole suite —
   * which is how this gap was found. It is not redundant: a company-WIDE grant
   * satisfies `iam.has_permission_in_scope` on its `company` scope row alone, so a
   * caller holding COMPANY_A1 can name `companyId: COMPANY_A1` with a branch in
   * COMPANY_A2 and pass authorization on that company row alone.
   *
   * What this test establishes, stated exactly: for a company-scoped principal
   * the attempt is refused **by RLS first**, with 404 and no writes.
   * `resolve-context.ts` publishes `company_ids = [COMPANY_A1]` and no branch for a
   * `company`-only scope row, so the COMPANY_A2 appointment is never visible and
   * never locked — `lockForUpdate` returns null before the comparison runs.
   *
   * So the company half of the guard is genuine defence-in-depth rather than the
   * only thing standing between this caller and the write, and it is NOT
   * independently observable here: reaching it needs a caller that ALSO holds some
   * grant in COMPANY_A2, so the appointment is visible while the authorization
   * target still resolves through COMPANY_A1. That fixture is recorded as
   * P1-18-QA-COMPANYHALF rather than claimed as proven.
   */
  it('refuses an appointment in another company, and RLS refuses it first', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A2,
      branchId: BRANCH_A2_OTHER_COMPANY,
      vehicleId: vehicle,
      requesterPartnerId: REQUESTER_A,
      confirm: true,
    });

    authAs(SUBJ_COMPANY_WIDE);
    const response = await createReception(
      appointmentBody(vehicle, appointment, {
        companyId: COMPANY_A1,
        branchId: BRANCH_A2_OTHER_COMPANY,
      })
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as Body).code).toBe('ERR-RES-001');

    expect(await visitFor(vehicle)).toBeUndefined();
    expect(await appointmentStatus(appointment)).toBe('confirmed');
  });

  it('refuses a check-in from an appointment that is not confirmed', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: vehicle,
      requesterPartnerId: REQUESTER_A,
      confirm: false,
    });

    const response = await createReception(appointmentBody(vehicle, appointment));
    expect(response.status).toBe(409);
    expect(((await response.json()) as Body).code).toBe('ERR-TRN-001');

    // The appointment is untouched and no custody was taken.
    expect(await appointmentStatus(appointment)).toBe('requested');
    expect(await visitFor(vehicle)).toBeUndefined();
  });

  it('consumes an origin exactly once', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: vehicle,
      requesterPartnerId: REQUESTER_A,
      confirm: true,
    });
    expect((await createReception(appointmentBody(vehicle, appointment))).status).toBe(201);

    // The appointment is now `checked_in`, a terminal state with no edge back, so
    // a second check-in against the same origin is refused before it can reach
    // `uq_reception_visits_appointment`.
    const second = await createReception(appointmentBody(vehicle, appointment));
    expect(second.status).toBe(409);
    expect(((await second.json()) as Body).code).toBe('ERR-TRN-001');

    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.reception_visits WHERE appointment_id = $1`,
        [appointment]
      )
    ).toBe(1);
  });

  it('refuses a vehicle that is not the vehicle the appointment was booked for', async () => {
    authAs(SUBJ_CLERK);
    const booked = await newVehicle();
    const other = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: booked,
      requesterPartnerId: REQUESTER_A,
      confirm: true,
    });

    const response = await createReception(appointmentBody(other, appointment));
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
    expect(await appointmentStatus(appointment)).toBe('confirmed');
    expect(await visitFor(other)).toBeUndefined();
  });
});

describe('cross-tenant and branch isolation', () => {
  it('refuses a tenant-B appointment addressed by its real id, leaving it confirmed', async () => {
    const vehicleB = await newVehicle(TENANT_B);
    const appointmentB = await newAppointment({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      vehicleId: vehicleB,
      requesterPartnerId: REQUESTER_B,
      confirm: true,
    });

    authAs(SUBJ_CLERK);
    const response = await createReception({
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      vehicleId: vehicleB,
      receivingEmployeeId: RECEIVING_EMPLOYEE,
      serviceRequesterPartnerId: REQUESTER_A,
      origin: { kind: 'appointment', appointmentId: appointmentB },
    });
    // Another tenant's appointment answers exactly as an unknown one does, so the
    // refusal is not an existence oracle.
    expect(response.status).toBe(404);
    expect(((await response.json()) as Body).code).toBe('ERR-RES-001');

    // Nothing landed in tenant B, and its appointment is still awaiting arrival.
    expect(await appointmentStatus(appointmentB)).toBe('confirmed');
    expect(
      await countOf(`SELECT count(*)::text AS n FROM rec.reception_visits WHERE tenant_id = $1`, [
        TENANT_B,
      ])
    ).toBe(0);
    expect(
      await countOf(`SELECT count(*)::text AS n FROM rec.walk_in_references WHERE tenant_id = $1`, [
        TENANT_B,
      ])
    ).toBe(0);
  });

  it('refuses a tenant-B vehicle in walk-in mode exactly as it refuses an unknown one', async () => {
    const vehicleB = await newVehicle(TENANT_B);

    authAs(SUBJ_CLERK);
    const crossTenant = await createReception(walkInBody(vehicleB));
    const unknown = await createReception(walkInBody(ABSENT_ID));

    // The tenant predicate on the origin insert is what refuses this: without it a
    // tenant-A clerk could open a custody record against another tenant's vehicle.
    // Both answers are byte-identical, so possession of a real id proves nothing.
    expect(crossTenant.status).toBe(422);
    expect(unknown.status).toBe(crossTenant.status);
    const crossBody = (await crossTenant.json()) as Body;
    expect(crossBody.code).toBe('ERR-VAL-001');
    expect(((await unknown.json()) as Body).code).toBe(crossBody.code);

    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE vehicle_id = $1`,
        [vehicleB]
      )
    ).toBe(0);
    expect(await visitFor(vehicleB)).toBeUndefined();
    expect(
      await countOf(`SELECT count(*)::text AS n FROM rec.reception_visits WHERE tenant_id = $1`, [
        TENANT_B,
      ])
    ).toBe(0);
  });

  /**
   * The cross-grant union, closed at the authorization step.
   *
   * `USER_UNION` holds `rec.reception.manage` from a grant scoped to BRANCH_A2,
   * and a second grant carrying no reception permission scoped to BRANCH_A1.
   * `iam.has_permission` is scope-blind, so the code evaluates true; and
   * `resolve-context.ts` publishes `app.branch_ids` as the UNION across all
   * grants, so RLS sees BRANCH_A1 as in scope. Both of the defences that refuse
   * the previous test's principal are therefore satisfied here, and before the
   * route named its authorization target this caller could open a visit and take
   * custody of a customer's vehicle in a branch where it holds nothing.
   *
   * Naming the target makes the pipeline use `iam.has_permission_in_scope`, which
   * counts an allow only from a grant that actually covers the named branch — and
   * because the capable grant here carries a BRANCH scope row and no `company`
   * row, it does not reach BRANCH_A1. That target is the whole fix; removing
   * `scopeTargetOption(body)` from the route makes this test fail with 201, a
   * created visit and accepted custody.
   */
  it('refuses a caller whose capable grant covers a different branch than the request', async () => {
    authAs(SUBJ_UNION);
    const vehicle = await newVehicle();

    const response = await createReception(walkInBody(vehicle));
    expect(response.status).toBe(403);
    expect(((await response.json()) as Body).code).toBe('ERR-IAM-001');
    expect(await visitFor(vehicle)).toBeUndefined();

    // The control: the same principal CAN open a visit in BRANCH_A2, the branch
    // its capable grant actually covers. So the refusal is about scope, not about
    // the principal being unable to do anything at all.
    const allowed = await createReception({
      ...(walkInBody(vehicle) as Record<string, unknown>),
      branchId: BRANCH_A2,
    });
    expect(allowed.status).toBe(201);
  });

  /**
   * A company-scoped grant must keep working across every branch in its company.
   *
   * `iam.has_permission_in_scope` matches a `company` scope row against the
   * requested company regardless of branch, and its own COMMENT says so. The
   * first remediation added an application check that accepted only
   * `unrestricted` or an explicit branch row, which refused this legitimate
   * operator on the two creation routes — a false denial with no test to catch
   * it. Restoring that check makes both halves of this test fail with 403.
   */
  it('allows a company-scoped caller in every branch of its company', async () => {
    authAs(SUBJ_COMPANY_WIDE);

    const inA1 = await newVehicle();
    expect((await createReception(walkInBody(inA1))).status).toBe(201);
    expect((await visitFor(inA1))?.branch_id).toBe(BRANCH_A1);

    const inA2 = await newVehicle();
    const a2 = await createReception({
      ...(walkInBody(inA2) as Record<string, unknown>),
      branchId: BRANCH_A2,
    });
    expect(a2.status).toBe(201);
    expect((await visitFor(inA2))?.branch_id).toBe(BRANCH_A2);
  });

  /**
   * The appointment origin, closed from both directions.
   *
   * This is the escalation the first remediation missed. `resolveOrigin` writes
   * the visit in the APPOINTMENT's scope while `authorizationTarget` comes from
   * the BODY, and `lockForUpdate` resolves by tenant and id alone, so a caller
   * whose capable grant covers BRANCH_A2 could name BRANCH_A2 in the body, point
   * at an appointment in BRANCH_A1, and have the visit, its mandatory party role,
   * the accepted custody event and the appointment's `checked_in` move all land in
   * BRANCH_A1 — where it holds nothing.
   *
   * Both routes out are now shut, which is why this test drives both:
   *  - naming its own branch with a foreign appointment is refused as incoherent;
   *  - naming the appointment's branch is refused by authorization.
   *
   * Removing the equality check in `resolveOrigin` makes the first half return
   * 201 with a visit in BRANCH_A1.
   */
  it('refuses an appointment in a branch the caller is not authorized for', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: vehicle,
      requesterPartnerId: REQUESTER_A,
      confirm: true,
    });

    // USER_UNION is capable in BRANCH_A2 only, and its second permission-less
    // grant makes the BRANCH_A1 appointment visible to RLS.
    authAs(SUBJ_UNION);

    const authorizedBranchForeignAppointment = await createReception(
      appointmentBody(vehicle, appointment, { branchId: BRANCH_A2 })
    );
    expect(authorizedBranchForeignAppointment.status).toBe(422);
    expect(((await authorizedBranchForeignAppointment.json()) as Body).code).toBe('ERR-VAL-001');

    const appointmentBranchUnauthorized = await createReception(
      appointmentBody(vehicle, appointment)
    );
    expect(appointmentBranchUnauthorized.status).toBe(403);
    expect(((await appointmentBranchUnauthorized.json()) as Body).code).toBe('ERR-IAM-001');

    // Neither attempt took custody of THIS vehicle, and the appointment is
    // untouched. The custody count is scoped through the visit rather than taken
    // tenant-wide, because earlier cases in this suite legitimately hold custody.
    expect(await visitFor(vehicle)).toBeUndefined();
    expect(await appointmentStatus(appointment)).toBe('confirmed');
    expect(
      await countOf(
        `SELECT count(*)::text AS n
           FROM rec.custody_history c
           JOIN rec.reception_visits v
             ON v.tenant_id = c.tenant_id AND v.id = c.reception_visit_id
          WHERE c.tenant_id = $1 AND v.vehicle_id = $2`,
        [TENANT_A, vehicle]
      )
    ).toBe(0);
  });

  it('refuses a caller granted only another branch, on both origin modes', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: vehicle,
      requesterPartnerId: REQUESTER_A,
      confirm: true,
    });

    // USER_BRANCH2 holds the very same `rec.reception.manage` mapping through a
    // grant whose single scope row is BRANCH_A2. The operation names its
    // company/branch target, so `iam.has_permission_in_scope` looks for a scope
    // row matching BRANCH_A1 on the grant that carries the permission, finds a
    // branch row for BRANCH_A2 and no `company` row, and refuses. Both origin
    // modes are therefore denied at the authorization step, before any row is
    // read.
    //
    // This used to answer 404 on the appointment path (the row was invisible to
    // RLS) and 403 on the walk-in path (the origin INSERT hit SQLSTATE 42501 and
    // `mapCheckInFailure` classified it). Both were correct refusals and both are
    // still proven below by the absence of any custody; the denial now arrives
    // earlier and no longer depends on which layer happened to notice. Answering
    // identically on both paths also stops the status code revealing whether the
    // appointment exists.
    authAs(SUBJ_BRANCH2);
    const viaAppointment = await createReception(appointmentBody(vehicle, appointment));
    expect(viaAppointment.status).toBe(403);
    expect(((await viaAppointment.json()) as Body).code).toBe('ERR-IAM-001');

    const viaWalkIn = await createReception(walkInBody(vehicle));
    expect(viaWalkIn.status).toBe(403);
    expect(((await viaWalkIn.json()) as Body).code).toBe('ERR-IAM-001');

    // Whichever way it was refused, no custody was taken in BRANCH_A1.
    expect(await appointmentStatus(appointment)).toBe('confirmed');
    expect(await visitFor(vehicle)).toBeUndefined();
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE vehicle_id = $1`,
        [vehicle]
      )
    ).toBe(0);
  });
});

describe('rollback', () => {
  it('leaves no visit, walk-in, party role, custody event, ledger row, audit or outbox row', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const before = await ledgerCounts();

    // The injected failure is chosen so it CANNOT fire before a row has been
    // written. `rec.walk_in_references` has no fuel column at all: the only
    // statement that can raise on an invisible fuel level is the visit INSERT
    // inside `rec.accept_check_in()`, and the service records the walk-in origin
    // before it calls that. So reaching this refusal proves the transaction had
    // already inserted the origin row — this is a genuine partial write that must
    // not survive, not a request refused before it touched anything.
    const response = await createReception(walkInBody(vehicle, { fuelLevelId: ABSENT_ID }));
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');

    expect(await ledgerCounts()).toEqual(before);
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE vehicle_id = $1`,
        [vehicle]
      )
    ).toBe(0);
    expect(await visitFor(vehicle)).toBeUndefined();
  });
});

describe('idempotent replay', () => {
  it('replays one visit under the same key instead of opening a second', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const key = crypto.randomUUID();
    const body = walkInBody(vehicle);

    const first = (await (await createReception(body, key)).json()) as Body;
    expect(first.receptionVisitId).toBeTruthy();
    const visitId = first.receptionVisitId ?? '';

    const replayResponse = await createReception(body, key);
    expect(replayResponse.status).toBe(200);
    expect(((await replayResponse.json()) as Body).receptionVisitId).toBe(visitId);

    // Counted, not inferred: one of everything the command writes.
    expect(
      await countOf(`SELECT count(*)::text AS n FROM rec.reception_visits WHERE vehicle_id = $1`, [
        vehicle,
      ])
    ).toBe(1);
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE vehicle_id = $1`,
        [vehicle]
      )
    ).toBe(1);
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.reception_party_roles WHERE reception_visit_id = $1`,
        [visitId]
      )
    ).toBe(1);
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.custody_history WHERE reception_visit_id = $1`,
        [visitId]
      )
    ).toBe(1);
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.reception_status_history WHERE reception_visit_id = $1`,
        [visitId]
      )
    ).toBe(1);
    expect(await auditCount(visitId)).toBe(1);
    expect(await outboxCount(visitId)).toBe(1);
  });

  it('refuses the same key carrying a different check-in', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const other = await newVehicle();
    const key = crypto.randomUUID();

    expect((await createReception(walkInBody(vehicle), key)).status).toBe(201);
    const grafted = await createReception(walkInBody(other), key);
    expect(grafted.status).toBe(409);
    expect(((await grafted.json()) as Body).code).toBe('ERR-INT-001');

    // The second command never ran: the other vehicle is still uncommitted to.
    expect(await visitFor(other)).toBeUndefined();
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.walk_in_references WHERE vehicle_id = $1`,
        [other]
      )
    ).toBe(0);
  });
});

describe('concurrency', () => {
  it('lets exactly one of two simultaneous check-ins of the same appointment win', async () => {
    authAs(SUBJ_CLERK);
    const vehicle = await newVehicle();
    const appointment = await newAppointment({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: vehicle,
      requesterPartnerId: REQUESTER_A,
      confirm: true,
    });

    // `Promise.all` only *starts* both requests. If the first one committed before
    // the second reached its `SELECT ... FOR UPDATE`, the second would read a
    // `checked_in` appointment on an unlocked row and be refused for an ordinary
    // lifecycle reason — a correct answer that proves nothing about the race.
    //
    // Holding the appointment from a third connection parks BOTH writers on the
    // origin lock before either can consume it. Releasing the gate then makes them
    // strictly serial: the winner inserts the visit and marks the appointment,
    // and the loser's re-read of the same locked row sees `checked_in`.
    const gate = await admin.connect();
    const outcomes = await (async () => {
      try {
        await gate.query('BEGIN');
        await gate.query('SELECT id FROM apt.appointments WHERE id = $1 FOR UPDATE', [appointment]);

        const inFlight = Promise.all([
          createReception(appointmentBody(vehicle, appointment)),
          createReception(appointmentBody(vehicle, appointment)),
        ]);

        try {
          await waitForBlockedBackends(2);
        } finally {
          // Released whether or not both arrived, so a failure reports its own
          // cause instead of a timeout.
          await gate.query('ROLLBACK');
        }
        return await inFlight;
      } finally {
        gate.release();
      }
    })();

    // Numeric sort: the default comparator is lexicographic.
    const statuses = outcomes.map((response) => response.status).sort((x, y) => x - y);
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(409);

    // The load-bearing assertion: one origin, one visit, one custody chain.
    const visits = await admin.query<{ id: string }>(
      `SELECT id FROM rec.reception_visits WHERE appointment_id = $1`,
      [appointment]
    );
    expect(visits.rowCount).toBe(1);
    const visitId = visits.rows[0]?.id ?? '';
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM rec.custody_history WHERE reception_visit_id = $1`,
        [visitId]
      )
    ).toBe(1);
    expect(await auditCount(visitId)).toBe(1);
    expect(await outboxCount(visitId)).toBe(1);
    expect(await appointmentStatus(appointment)).toBe('checked_in');
  });
});
