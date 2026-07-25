/**
 * Appointment lifecycle, end to end (Phase 1-18, P1-18-BE-001…P1-18-BE-004).
 *
 * Four commands over one master row, driven through the real routes on the
 * least-privilege `app_runtime` identity. What each command is allowed to touch
 * is decided by the frozen Phase 1-8 schema, so the assertions here are aimed at
 * the properties that schema makes non-negotiable:
 *
 *  - `requested_from` / `requested_to` are listed in `tg_appointments_immutable`,
 *    so a reschedule moves the CONFIRMED window and the customer's original
 *    request survives. That is the headline test, and it reads the row back
 *    rather than trusting the response.
 *  - `cancelled` and `no_show` are distinct terminal states with their own
 *    set-once evidence columns and their own coherence CHECKs, so each is proved
 *    by reading every column of the pair back — including the ones that must
 *    still be NULL.
 *  - `ex_appointments_vehicle_confirmed` is the only authority on same-vehicle
 *    overlap, and it is PARTIAL on `lifecycle_status IN ('confirmed','checked_in')`.
 *  - `record_version` is a WHERE predicate, so a stale caller writes zero rows.
 *
 * Operations exercised here: apt.appointment-create, apt.appointment-reschedule,
 * apt.appointment-cancel, apt.appointment-no-show.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   apt.appointment-create: route service authorization success denial cross-tenant isolation audit outbox rollback idempotency
 *   apt.appointment-reschedule: route service authorization success denial cross-tenant isolation audit outbox stale-version concurrency idempotency
 *   apt.appointment-cancel: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency
 *   apt.appointment-no-show: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency
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
import { POST as CREATE } from '@/app/api/v1/appointments/route';
import { POST as RESCHEDULE } from '@/app/api/v1/appointments/[appointmentId]/reschedule/route';
import { POST as CANCEL } from '@/app/api/v1/appointments/[appointmentId]/cancel/route';
import { POST as NO_SHOW } from '@/app/api/v1/appointments/[appointmentId]/no-show/route';

// --- Fixture identities. -----------------------------------------------------
/** Tenant A scheduler: holds BOTH appointment permissions, unrestricted. */
const ROLE_FULL_A = 'c1180000-0000-4000-8000-0000000000a1';
const USER_FULL_A = 'c1180000-0000-4000-8000-0000000000a2';
const SUBJ_FULL_A = 'fx_p1_18_apt_full_a';
/** Tenant B counterpart, so tenant-B rows are created by a REAL tenant-B principal. */
const ROLE_FULL_B = 'c1180000-0000-4000-8000-0000000000b1';
const USER_FULL_B = 'c1180000-0000-4000-8000-0000000000b2';
const SUBJ_FULL_B = 'fx_p1_18_apt_full_b';
/** Tenant A caller holding `apt.appointment.manage` ONLY (no lifecycle authority). */
const ROLE_SCHED_ONLY = 'c1180000-0000-4000-8000-0000000000c1';
const USER_SCHED_ONLY = 'c1180000-0000-4000-8000-0000000000c2';
const SUBJ_SCHED_ONLY = 'fx_p1_18_apt_sched_only';
/** Tenant A caller with both permissions but a grant narrowed to BRANCH_A2. */
const ROLE_BRANCH2 = 'c1180000-0000-4000-8000-0000000000d1';
const USER_BRANCH2 = 'c1180000-0000-4000-8000-0000000000d2';
const SUBJ_BRANCH2 = 'fx_p1_18_apt_branch2';
const GRANT_BRANCH2 = 'c1180000-0000-4000-8000-0000000000d3';

// --- Organisational fixtures. ------------------------------------------------
/** A second branch in tenant A / company A1: the branch the narrowed grant holds. */
const BRANCH_A2 = 'c1180000-0000-4000-8000-0000000000e1';
const COMPANY_B1 = 'c1180000-0000-4000-8000-0000000000e2';
const BRANCH_B1 = 'c1180000-0000-4000-8000-0000000000e3';

// --- Domain fixtures. --------------------------------------------------------
const PARTNER_A = 'c1180000-0000-4000-8000-0000000000f1';
const PARTNER_B = 'c1180000-0000-4000-8000-0000000000f2';
const TYPE_A = 'c1180000-0000-4000-8000-000000000101';
const TYPE_B = 'c1180000-0000-4000-8000-000000000102';
const REASON_A = 'c1180000-0000-4000-8000-000000000103';
const REASON_B = 'c1180000-0000-4000-8000-000000000104';

const BASE = 'http://localhost/api/v1/appointments';

interface Body {
  readonly appointmentId?: string;
  readonly displayNumber?: string | null;
  readonly lifecycleStatus?: string;
  readonly changeKind?: string;
  readonly recordVersion?: number;
  readonly code?: string;
}

interface AppointmentRow {
  readonly lifecycle_status: string;
  readonly record_version: number;
  readonly requested_from: Date;
  readonly requested_to: Date;
  readonly confirmed_from: Date | null;
  readonly confirmed_to: Date | null;
  readonly cancellation_reason_id: string | null;
  readonly cancelled_at: Date | null;
  readonly cancelled_by: string | null;
  readonly no_show_recorded_at: Date | null;
  readonly no_show_recorded_by: string | null;
  readonly display_number: string | null;
  readonly branch_id: string;
}

let admin: Pool;
let runtime: Pool;
/** Appointment used by the authentication/authorization probes. */
let PROBE: string;

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
// Route drivers. Every call goes through the exported handler with a real
// Request, so the whole pipeline — authenticate, resolve scope, authorize,
// If-Match, idempotency, transaction — runs exactly as it does in production.
// ---------------------------------------------------------------------------

function headers(key: string | null, ifMatch?: number | string | null): HeadersInit {
  return {
    'content-type': 'application/json',
    ...(key === null ? {} : { 'idempotency-key': key }),
    ...(ifMatch === undefined || ifMatch === null ? {} : { 'if-match': String(ifMatch) }),
  };
}

function create(body: unknown, key: string | null = crypto.randomUUID()): Promise<Response> {
  return CREATE(
    new Request(BASE, { method: 'POST', headers: headers(key), body: JSON.stringify(body) })
  );
}

function reschedule(
  appointmentId: string,
  body: unknown,
  ifMatch: number | string | null,
  key: string = crypto.randomUUID()
): Promise<Response> {
  return RESCHEDULE(
    new Request(`${BASE}/${appointmentId}/reschedule`, {
      method: 'POST',
      headers: headers(key, ifMatch),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ appointmentId }) }
  );
}

function cancel(
  appointmentId: string,
  body: unknown,
  ifMatch: number | string | null,
  key: string = crypto.randomUUID()
): Promise<Response> {
  return CANCEL(
    new Request(`${BASE}/${appointmentId}/cancel`, {
      method: 'POST',
      headers: headers(key, ifMatch),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ appointmentId }) }
  );
}

function noShow(
  appointmentId: string,
  ifMatch: number | string | null,
  key: string = crypto.randomUUID(),
  body: unknown = {}
): Promise<Response> {
  return NO_SHOW(
    new Request(`${BASE}/${appointmentId}/no-show`, {
      method: 'POST',
      headers: headers(key, ifMatch),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ appointmentId }) }
  );
}

// ---------------------------------------------------------------------------
// Fixture and read-back helpers. Everything here runs on the ADMIN connection,
// which bypasses RLS — so nothing here is ever evidence about runtime
// behaviour. It provisions state and reads back what actually landed.
// ---------------------------------------------------------------------------

let vehicleCounter = 0;

/** Creates a vehicle for `tenantId` and returns its id. */
async function newVehicle(tenantId: string = TENANT_A): Promise<string> {
  vehicleCounter += 1;
  const id = crypto.randomUUID();
  const vin = `P18APT${String(vehicleCounter).padStart(11, '0')}`;
  await inTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,$3,'ice','active',$4)`,
      [id, tenantId, vin, USER_A]
    );
  });
  return id;
}

/**
 * Runs admin statements with the actor GUCs set.
 *
 * The veh/crm/apt triggers stamp their actor from `app.user_id` and the
 * appointment status ledger refuses an insert without one, so a fixture that
 * moves a lifecycle state has to supply a context just as the application does.
 */
async function inTenantContext(
  tenantId: string,
  run: (client: { query: Pool['query'] }) => Promise<void>
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    await run(client as unknown as { query: Pool['query'] });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readAppointment(appointmentId: string): Promise<AppointmentRow> {
  const result = await admin.query<AppointmentRow>(
    `SELECT lifecycle_status, record_version, requested_from, requested_to,
            confirmed_from, confirmed_to, cancellation_reason_id, cancelled_at,
            cancelled_by, no_show_recorded_at, no_show_recorded_by, display_number, branch_id
       FROM apt.appointments WHERE id = $1`,
    [appointmentId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`appointment ${appointmentId} was not found`);
  return row;
}

async function countWhere(sql: string, values: readonly unknown[] = []): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

const auditCount = (action: string, entityId: string): Promise<number> =>
  countWhere(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );

const outboxCount = (appointmentId: string): Promise<number> =>
  countWhere(
    `SELECT count(*)::text AS n FROM shared.event_outbox
      WHERE event_type = 'appointment.changed' AND aggregate_id = $1`,
    [appointmentId]
  );

const historyCount = (appointmentId: string, toState: string): Promise<number> =>
  countWhere(
    `SELECT count(*)::text AS n FROM apt.appointment_status_history
      WHERE appointment_id = $1 AND to_state = $2`,
    [appointmentId, toState]
  );

/** Raw counter of the tenant-wide appointment sequence, or null when unprovisioned. */
async function sequenceNextValue(): Promise<string | null> {
  const result = await admin.query<{ next_value: string }>(
    `SELECT next_value::text AS next_value FROM shared.number_sequences
      WHERE tenant_id = $1 AND sequence_code = 'appointment'
        AND company_id IS NULL AND branch_id IS NULL`,
    [TENANT_A]
  );
  return result.rows[0]?.next_value ?? null;
}

/**
 * Moves an appointment to `confirmed`, as admin, and returns its new version.
 *
 * This is FIXTURE state, not evidence: P1-18 exposes no operation that confirms
 * an appointment (nothing in `src/` ever writes `lifecycle_status = 'confirmed'`),
 * yet `confirmed` is the only state a no-show is reachable from and the only one
 * the same-vehicle overlap EXCLUDE covers. Reaching it here is what lets those
 * two frozen rules be tested at all; the gap itself is reported separately.
 */
async function forceConfirm(
  appointmentId: string,
  confirmedFrom: string,
  confirmedTo: string
): Promise<number> {
  await inTenantContext(TENANT_A, async (client) => {
    await client.query(
      `UPDATE apt.appointments
          SET lifecycle_status = 'confirmed', confirmed_from = $2, confirmed_to = $3
        WHERE id = $1`,
      [appointmentId, confirmedFrom, confirmedTo]
    );
  });
  return (await readAppointment(appointmentId)).record_version;
}

/**
 * Blocks until `expected` backends are waiting on a lock in this database.
 *
 * A race between two in-flight requests cannot be asserted until both have
 * actually reached the contended row. Waiting for that is what makes the
 * assertion deterministic instead of a coin toss decided by the event loop.
 */
async function waitForBlockedBackends(expected: number, timeoutMs = 5_000): Promise<void> {
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

/** Standard tenant-A booking body. */
function bookingFor(vehicleId: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    vehicleId,
    requesterPartnerId: PARTNER_A,
    appointmentTypeId: TYPE_A,
    requestedFrom: '2026-09-01T09:00:00Z',
    requestedTo: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

/** Books an appointment as the currently authenticated caller and returns its id. */
async function book(body: unknown): Promise<string> {
  const response = await create(body);
  const parsed = (await response.json()) as Body;
  if (response.status !== 201 || !parsed.appointmentId) {
    throw new Error(`booking failed: ${response.status} ${JSON.stringify(parsed)}`);
  }
  return parsed.appointmentId;
}

async function seedPrincipal(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string,
  permissions: readonly string[]
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Appointment Fixture','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 appointment fixture',$4) ON CONFLICT (id) DO NOTHING`,
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

  // Seeded platform codes (seed 04). Inserting them is a no-op wherever the seed
  // has run; it keeps this suite runnable on a database predating them.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('apt.appointment.manage','apt','Create and reschedule appointments in the caller scope','medium',$1),
            ('apt.appointment.lifecycle.manage','apt','Cancel an appointment or record a no-show','medium',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  const BOTH = ['apt.appointment.manage', 'apt.appointment.lifecycle.manage'];
  await seedPrincipal(TENANT_A, ROLE_FULL_A, USER_FULL_A, SUBJ_FULL_A, BOTH);
  await seedPrincipal(TENANT_B, ROLE_FULL_B, USER_FULL_B, SUBJ_FULL_B, BOTH);
  await seedPrincipal(TENANT_A, ROLE_SCHED_ONLY, USER_SCHED_ONLY, SUBJ_SCHED_ONLY, [
    'apt.appointment.manage',
  ]);
  await seedPrincipal(TENANT_A, ROLE_BRANCH2, USER_BRANCH2, SUBJ_BRANCH2, BOTH);

  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$8,$8),
            ($4,$5,$6,'unrestricted',$8,$8),
            ($1,$7,$9,'unrestricted',$8,$8)`,
    [
      TENANT_A,
      USER_FULL_A,
      ROLE_FULL_A,
      TENANT_B,
      USER_FULL_B,
      ROLE_FULL_B,
      USER_SCHED_ONLY,
      USER_A,
      ROLE_SCHED_ONLY,
    ]
  );

  // Organisational scaffolding: a second tenant-A branch for the narrowed grant,
  // and a tenant-B company/branch so the cross-tenant appointment is a real row
  // created by a real tenant-B principal rather than a fabricated id.
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_a2_p118','P1-18 Branch A2','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_b1_p118','P1-18 Company B1','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b1_p118','P1-18 Branch B1','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A]
  );

  // The scoped grant and its scopes must land in ONE transaction: the "a scoped
  // grant needs a scope" trigger is DEFERRABLE INITIALLY DEFERRED.
  const scoped = await admin.connect();
  try {
    await scoped.query('BEGIN');
    await scoped.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [GRANT_BRANCH2, TENANT_A, USER_BRANCH2, ROLE_BRANCH2, USER_A]
    );
    await scoped.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
       VALUES ($1,$2,'company',$3,$4)`,
      [TENANT_A, GRANT_BRANCH2, COMPANY_A1, USER_A]
    );
    await scoped.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [TENANT_A, GRANT_BRANCH2, COMPANY_A1, BRANCH_A2, USER_A]
    );
    await scoped.query('COMMIT');
  } catch (error) {
    await scoped.query('ROLLBACK');
    throw error;
  } finally {
    scoped.release();
  }

  // Requesters and appointment catalogs, one per tenant.
  await inTenantContext(TENANT_A, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','P1-18 Requester A','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A, TENANT_A, USER_A]
    );
  });
  await inTenantContext(TENANT_B, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','P1-18 Requester B','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_B, TENANT_B, USER_A]
    );
  });
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, status, created_by)
     VALUES ($1,'tenant',$2,'fx_p1_18_service','P1-18 Service','active',$5),
            ($3,'tenant',$4,'fx_p1_18_service','P1-18 Service B','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [TYPE_A, TENANT_A, TYPE_B, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.cancellation_reasons (id, scope, tenant_id, code, name, status, created_by)
     VALUES ($1,'tenant',$2,'fx_p1_18_customer_request','Customer request','active',$5),
            ($3,'tenant',$4,'fx_p1_18_customer_request','Customer request B','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [REASON_A, TENANT_A, REASON_B, TENANT_B, USER_A]
  );

  // Provision the appointment-number sequence for tenant A only. Provisioning is
  // an operator action (`app_runtime` holds no INSERT here), and having it in
  // exactly one tenant covers both branches of the create path: an allocated
  // number in A, and `null` in B where no sequence is configured.
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, sequence_code, prefix_template, next_value, pad_width, created_by)
     VALUES ($1,'appointment','APT-',1,6,$2)
     ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING`,
    [TENANT_A, USER_A]
  );

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  authAs(SUBJ_FULL_A);
  PROBE = await book(bookingFor(await newVehicle()));
  __resetAuthenticatorForTests();
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
  it('answers 401 on all four appointment routes with no authenticator', async () => {
    __resetAuthenticatorForTests();
    const responses = await Promise.all([
      create(bookingFor(PROBE)),
      reschedule(
        PROBE,
        { confirmedFrom: '2026-09-01T09:00:00Z', confirmedTo: '2026-09-01T10:00:00Z' },
        1
      ),
      cancel(PROBE, { cancellationReasonId: REASON_A }, 1),
      noShow(PROBE, 1),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
  });

  it('answers 403 on all four routes for a caller holding no appointment permission', async () => {
    authAs(SUBJECT_UNPERMITTED);
    const responses = await Promise.all([
      create(bookingFor(PROBE)),
      reschedule(
        PROBE,
        { confirmedFrom: '2026-09-01T09:00:00Z', confirmedTo: '2026-09-01T10:00:00Z' },
        1
      ),
      cancel(PROBE, { cancellationReasonId: REASON_A }, 1),
      noShow(PROBE, 1),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as Body).code).toBe('ERR-IAM-001');
    }
    // A denied caller performs no work: the probe is untouched.
    const row = await readAppointment(PROBE);
    expect(row.lifecycle_status).toBe('requested');
    expect(row.confirmed_from).toBeNull();
  });

  // The two lifecycle commands declare a DIFFERENT permission from the two
  // scheduling ones (`apt.appointment.lifecycle.manage` versus
  // `apt.appointment.manage`), because ending a booking is not the same authority
  // as arranging one. Every other test in this file authenticates as a caller
  // holding both, so widening either route's permission list would leave the
  // suite green. This case pins the split.
  it('refuses cancel and no-show to a caller holding only apt.appointment.manage', async () => {
    authAs(SUBJ_SCHED_ONLY);
    const vehicle = await newVehicle();
    // The scheduling permission alone is genuinely sufficient for its own two
    // operations — so the refusals below are about authority, not about a
    // broken principal.
    const appointment = await book(bookingFor(vehicle));
    expect(
      (
        await reschedule(
          appointment,
          { confirmedFrom: '2026-09-02T09:00:00Z', confirmedTo: '2026-09-02T10:00:00Z' },
          1
        )
      ).status
    ).toBe(200);

    const cancelled = await cancel(appointment, { cancellationReasonId: REASON_A }, 2);
    expect(cancelled.status).toBe(403);
    expect(((await cancelled.json()) as Body).code).toBe('ERR-IAM-001');
    const noShowed = await noShow(appointment, 2);
    expect(noShowed.status).toBe(403);

    // The reschedule above confirmed it; neither refused command moved it on.
    const row = await readAppointment(appointment);
    expect(row.lifecycle_status).toBe('confirmed');
    expect(row.cancelled_at).toBeNull();
    expect(row.no_show_recorded_at).toBeNull();
  });
});

describe('apt.appointment-create', () => {
  it('books an appointment at the head of the lifecycle with an audit record and one event', async () => {
    authAs(SUBJ_FULL_A);
    const vehicle = await newVehicle();
    const response = await create(bookingFor(vehicle));
    const body = (await response.json()) as Body;

    expect(response.status).toBe(201);
    expect(body.appointmentId).toBeTruthy();
    // Creation is never a transition: a caller cannot post an appointment that is
    // already confirmed, which would bypass the guard and the status ledger.
    expect(body.lifecycleStatus).toBe('requested');
    expect(body.recordVersion).toBe(1);
    expect(body.displayNumber).toMatch(/^APT-\d{6}$/);
    // The ETag is the version the next guarded command must present.
    expect(response.headers.get('ETag')).toBe('"1"');

    const row = await readAppointment(body.appointmentId ?? '');
    expect(row.requested_from.toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(row.requested_to.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(row.confirmed_from).toBeNull();
    expect(row.display_number).toBe(body.displayNumber);

    expect(await auditCount('apt.appointment.created', body.appointmentId ?? '')).toBe(1);
    expect(await outboxCount(body.appointmentId ?? '')).toBe(1);
  });

  it('replays a repeated booking under one key instead of booking twice', async () => {
    authAs(SUBJ_FULL_A);
    const vehicle = await newVehicle();
    const key = crypto.randomUUID();
    const payload = bookingFor(vehicle);

    const first = (await (await create(payload, key)).json()) as Body;
    const replay = await create(payload, key);
    expect(((await replay.json()) as Body).appointmentId).toBe(first.appointmentId);

    // The load-bearing proof is the count, not the echoed id.
    expect(
      await countWhere(`SELECT count(*)::text AS n FROM apt.appointments WHERE vehicle_id = $1`, [
        vehicle,
      ])
    ).toBe(1);
    expect(await auditCount('apt.appointment.created', first.appointmentId ?? '')).toBe(1);
    expect(await outboxCount(first.appointmentId ?? '')).toBe(1);
  });

  it('refuses a window with no explicit UTC offset and an inverted window', async () => {
    authAs(SUBJ_FULL_A);
    const vehicle = await newVehicle();

    // A timezone-less local timestamp would be resolved against the server zone
    // rather than the branch zone — a real booking on the wrong hour.
    const naive = await create(
      bookingFor(vehicle, {
        requestedFrom: '2026-09-01T09:00:00',
        requestedTo: '2026-09-01T10:00:00',
      })
    );
    expect(naive.status).toBe(422);
    expect(((await naive.json()) as Body).code).toBe('ERR-VAL-001');

    const inverted = await create(
      bookingFor(vehicle, {
        requestedFrom: '2026-09-01T10:00:00Z',
        requestedTo: '2026-09-01T09:00:00Z',
      })
    );
    expect(inverted.status).toBe(422);

    const equal = await create(
      bookingFor(vehicle, {
        requestedFrom: '2026-09-01T10:00:00Z',
        requestedTo: '2026-09-01T10:00:00Z',
      })
    );
    expect(equal.status).toBe(422);

    // A confirmed window supplied at booking is held to the same rule.
    const badConfirmed = await create(
      bookingFor(vehicle, {
        confirmedFrom: '2026-09-01T09:00:00',
        confirmedTo: '2026-09-01T10:00:00',
      })
    );
    expect(badConfirmed.status).toBe(422);

    expect(
      await countWhere(`SELECT count(*)::text AS n FROM apt.appointments WHERE vehicle_id = $1`, [
        vehicle,
      ])
    ).toBe(0);
  });

  it('refuses a tenant-B vehicle and a tenant-B requester, writing nothing', async () => {
    // Both referenced rows are REAL rows in tenant B, addressed by their real
    // ids. The composite `(tenant_id, vehicle_id)` and `(tenant_id, requester_partner_id)`
    // foreign keys are what make them unreachable: dropping the tenant column from
    // either would let this booking succeed against another tenant's data.
    authAs(SUBJ_FULL_B, TENANT_B);
    const tenantBVehicle = await newVehicle(TENANT_B);
    // Prove the tenant-B rows are genuinely usable *in their own tenant*, so the
    // refusals below are about tenancy and not about an unusable fixture.
    expect(
      (
        await create({
          companyId: COMPANY_B1,
          branchId: BRANCH_B1,
          vehicleId: tenantBVehicle,
          requesterPartnerId: PARTNER_B,
          appointmentTypeId: TYPE_B,
          requestedFrom: '2026-09-01T09:00:00Z',
          requestedTo: '2026-09-01T10:00:00Z',
        })
      ).status
    ).toBe(201);

    authAs(SUBJ_FULL_A);
    const ownVehicle = await newVehicle();
    const crossVehicle = await create(bookingFor(tenantBVehicle));
    expect(crossVehicle.status).toBe(422);
    expect(((await crossVehicle.json()) as Body).code).toBe('ERR-VAL-001');

    const crossRequester = await create(bookingFor(ownVehicle, { requesterPartnerId: PARTNER_B }));
    expect(crossRequester.status).toBe(422);
    expect(((await crossRequester.json()) as Body).code).toBe('ERR-VAL-001');

    // Nothing landed: no tenant-A appointment names the tenant-B vehicle, and
    // none names the tenant-B requester.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM apt.appointments
          WHERE tenant_id = $1 AND (vehicle_id = $2 OR requester_partner_id = $3)`,
        [TENANT_A, tenantBVehicle, PARTNER_B]
      )
    ).toBe(0);
    expect(
      await countWhere(`SELECT count(*)::text AS n FROM apt.appointments WHERE vehicle_id = $1`, [
        ownVehicle,
      ])
    ).toBe(0);
  });

  // P1-18-APT-001, found by this suite and since fixed. The out-of-scope branch is
  // refused by `ins_appointments_scope`, the RLS INSERT policy on
  // `apt.appointments`, which raises SQLSTATE 42501. That refusal used to fall
  // through `AppointmentService.mapWriteFailure` and be classified `ERR-SYS-001`,
  // so an authorization decision was reported as a server fault AND forwarded to
  // `captureException` (src/server/http/route-handler.ts) — meaning any
  // authenticated caller could manufacture unlimited monitoring incidents simply
  // by booking outside their own branch. The mapper now returns `ERR-IAM-001`.
  //
  // Asserting 403 rather than "not 2xx" is the point: a denial that arrives as a
  // 500 is a regression this test must catch, not tolerate.
  it('refuses a caller whose grant names another branch, as an authorization denial', async () => {
    authAs(SUBJ_BRANCH2);
    const vehicle = await newVehicle();

    // Positive control first: the narrowed caller is a working principal inside
    // the branch it actually holds, so the refusal below is about scope.
    const inScope = await create(bookingFor(vehicle, { branchId: BRANCH_A2 }));
    expect(inScope.status).toBe(201);
    expect(
      (await readAppointment(((await inScope.json()) as Body).appointmentId ?? '')).branch_id
    ).toBe(BRANCH_A2);

    const outOfScope = await create(bookingFor(vehicle, { branchId: BRANCH_A1 }));
    // Never a success — if `ins_appointments_scope` were dropped this would be 201.
    expect(outOfScope.ok).toBe(false);
    expect(outOfScope.status).toBe(403);
    expect(((await outOfScope.json()) as Body).code).toBe('ERR-IAM-001');
    // The refusal is only half of it: nothing reached BRANCH_A1.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM apt.appointments WHERE vehicle_id = $1 AND branch_id = $2`,
        [vehicle, BRANCH_A1]
      )
    ).toBe(0);
    // …and no orphan audit record or event survived the rolled-back attempt.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records a
          WHERE a.action = 'apt.appointment.created'
            AND NOT EXISTS (SELECT 1 FROM apt.appointments x WHERE x.id = a.entity_id)`
      )
    ).toBe(0);
  });

  it('rolls a failed booking back completely, burning no appointment number', async () => {
    authAs(SUBJ_FULL_A);
    const vehicle = await newVehicle();
    const before = await sequenceNextValue();
    expect(before).not.toBeNull();

    // The failure is injected AFTER the number has been allocated: the display
    // number is drawn first, then the insert trips `tg_appointments_catalog_refs`
    // on an appointment type no tenant owns. Everything the command touched —
    // the counter advance, the row, the audit record, the outbox envelope — has
    // to disappear together.
    const response = await create(
      bookingFor(vehicle, { appointmentTypeId: '00000000-0000-4000-8000-0000000000fe' })
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');

    expect(
      await countWhere(`SELECT count(*)::text AS n FROM apt.appointments WHERE vehicle_id = $1`, [
        vehicle,
      ])
    ).toBe(0);
    // No audit record and no event survive for an appointment that does not exist.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records a
          WHERE a.action = 'apt.appointment.created'
            AND NOT EXISTS (SELECT 1 FROM apt.appointments x WHERE x.id = a.entity_id)`
      )
    ).toBe(0);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM shared.event_outbox e
          WHERE e.event_type = 'appointment.changed'
            AND NOT EXISTS (SELECT 1 FROM apt.appointments x WHERE x.id = e.aggregate_id)`
      )
    ).toBe(0);
    // The allocation is made inside the caller's transaction precisely so a
    // rolled-back booking does not leave a gap in the sequence.
    expect(await sequenceNextValue()).toBe(before);
  });
});

describe('apt.appointment-reschedule', () => {
  it('moves the CONFIRMED window and leaves the requested window untouched', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    const before = await readAppointment(appointment);

    const response = await reschedule(
      appointment,
      { confirmedFrom: '2026-09-03T13:00:00Z', confirmedTo: '2026-09-03T14:30:00Z' },
      1
    );
    const body = (await response.json()) as Body;
    expect(response.status).toBe(200);
    expect(body.changeKind).toBe('rescheduled');
    expect(body.recordVersion).toBe(2);

    const after = await readAppointment(appointment);
    // THE HEADLINE. `requested_from`/`requested_to` are listed in
    // `tg_appointments_immutable`: they record what the customer asked for and no
    // lifecycle command may rewrite them. If a reschedule ever moved them, the
    // original request would be silently erased from the record.
    expect(after.requested_from.toISOString()).toBe(before.requested_from.toISOString());
    expect(after.requested_to.toISOString()).toBe(before.requested_to.toISOString());
    expect(after.confirmed_from?.toISOString()).toBe('2026-09-03T13:00:00.000Z');
    expect(after.confirmed_to?.toISOString()).toBe('2026-09-03T14:30:00.000Z');
    // Agreeing a firm window IS confirming — canonical UC-APT-001 is one use
    // case, "Confirm or reschedule appointment". The transition matters rather
    // than being cosmetic: `confirmed` is the state that reserves constrained
    // capacity, so it is what arms the same-vehicle overlap EXCLUDE and what
    // makes no-show and appointment-originated check-in reachable at all.
    expect(after.lifecycle_status).toBe('confirmed');
    // Emitted by the frozen append-only ledger, one row per real change.
    expect(await historyCount(appointment, 'confirmed')).toBe(1);

    expect(await auditCount('apt.appointment.rescheduled', appointment)).toBe(1);
    // Two envelopes for this aggregate now: the booking and this change.
    expect(await outboxCount(appointment)).toBe(2);
  });

  it('refuses a request that tries to send the immutable requested window', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));

    // The strict schema is what stops a caller believing a requested-window edit
    // was applied. Accepting and ignoring the field would be worse than refusing.
    const response = await reschedule(
      appointment,
      {
        confirmedFrom: '2026-09-03T13:00:00Z',
        confirmedTo: '2026-09-03T14:00:00Z',
        requestedFrom: '2026-12-01T08:00:00Z',
      },
      1
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');

    const row = await readAppointment(appointment);
    expect(row.requested_from.toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(row.confirmed_from).toBeNull();
    expect(row.record_version).toBe(1);
  });

  it('refuses an overlapping confirmed window on the same vehicle and changes nothing', async () => {
    authAs(SUBJ_FULL_A);
    const vehicle = await newVehicle();
    const first = await book(bookingFor(vehicle));
    const second = await book(bookingFor(vehicle));

    // `ex_appointments_vehicle_confirmed` is PARTIAL — it covers `confirmed` and
    // `checked_in` rows only — so both appointments have to be confirmed before
    // it can bite. Confirmation is a fixture step here (see forceConfirm).
    await reschedule(
      first,
      { confirmedFrom: '2026-09-04T09:00:00Z', confirmedTo: '2026-09-04T11:00:00Z' },
      1
    );
    await forceConfirm(first, '2026-09-04T09:00:00Z', '2026-09-04T11:00:00Z');
    await reschedule(
      second,
      { confirmedFrom: '2026-09-05T09:00:00Z', confirmedTo: '2026-09-05T11:00:00Z' },
      1
    );
    const secondVersion = await forceConfirm(
      second,
      '2026-09-05T09:00:00Z',
      '2026-09-05T11:00:00Z'
    );

    const clash = await reschedule(
      second,
      { confirmedFrom: '2026-09-04T10:00:00Z', confirmedTo: '2026-09-04T12:00:00Z' },
      secondVersion
    );
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as Body).code).toBe('ERR-RES-002');

    // The loser's own window is exactly where it was; the winner's is untouched.
    const secondRow = await readAppointment(second);
    expect(secondRow.confirmed_from?.toISOString()).toBe('2026-09-05T09:00:00.000Z');
    expect(secondRow.confirmed_to?.toISOString()).toBe('2026-09-05T11:00:00.000Z');
    expect(secondRow.record_version).toBe(secondVersion);
    const firstRow = await readAppointment(first);
    expect(firstRow.confirmed_from?.toISOString()).toBe('2026-09-04T09:00:00.000Z');

    // A non-overlapping move on the same pair is still accepted, so the refusal
    // above is the exclusion constraint and not a blanket block.
    const ok = await reschedule(
      second,
      { confirmedFrom: '2026-09-06T09:00:00Z', confirmedTo: '2026-09-06T11:00:00Z' },
      secondVersion
    );
    expect(ok.status).toBe(200);
  });

  it('refuses a stale If-Match and a missing one, writing nothing', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    await reschedule(
      appointment,
      { confirmedFrom: '2026-09-07T09:00:00Z', confirmedTo: '2026-09-07T10:00:00Z' },
      1
    );

    const stale = await reschedule(
      appointment,
      { confirmedFrom: '2026-09-08T09:00:00Z', confirmedTo: '2026-09-08T10:00:00Z' },
      1
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Body).code).toBe('ERR-CON-001');

    const missing = await reschedule(
      appointment,
      { confirmedFrom: '2026-09-08T09:00:00Z', confirmedTo: '2026-09-08T10:00:00Z' },
      null
    );
    expect(missing.status).toBe(428);
    expect(((await missing.json()) as Body).code).toBe('ERR-CON-002');

    const row = await readAppointment(appointment);
    expect(row.confirmed_from?.toISOString()).toBe('2026-09-07T09:00:00.000Z');
    expect(row.record_version).toBe(2);
    expect(await auditCount('apt.appointment.rescheduled', appointment)).toBe(1);
  });

  it('lets exactly one of two forced-concurrent reschedules win', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    const windows = [
      { confirmedFrom: '2026-09-09T09:00:00Z', confirmedTo: '2026-09-09T10:00:00Z' },
      { confirmedFrom: '2026-09-10T09:00:00Z', confirmedTo: '2026-09-10T10:00:00Z' },
    ];

    // `Promise.all` only STARTS both requests; nothing in the pipeline makes them
    // overlap, so on its own it proves nothing. Holding the appointment row from
    // a third connection parks both writers on the `SELECT … FOR UPDATE` the
    // service takes before it decides anything. Releasing the gate then lets
    // exactly one UPDATE still match `record_version = 1`.
    const gate = await admin.connect();
    const outcomes = await (async () => {
      try {
        await gate.query('BEGIN');
        await gate.query('SELECT id FROM apt.appointments WHERE id = $1 FOR UPDATE', [appointment]);

        const inFlight = Promise.all([
          reschedule(appointment, windows[0], 1),
          reschedule(appointment, windows[1], 1),
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
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);
    const successes = statuses.filter((status) => status === 200).length;

    const row = await readAppointment(appointment);
    // The committed window is one of the two that were attempted — never a blend,
    // and never a half-applied pair taken from both.
    const winner = windows.findIndex(
      (w) => new Date(w.confirmedFrom).toISOString() === row.confirmed_from?.toISOString()
    );
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(row.confirmed_to?.toISOString()).toBe(
      new Date(windows[winner]?.confirmedTo ?? '').toISOString()
    );
    // `shared.touch_row_metadata` advances the version by exactly one per UPDATE,
    // so the loser writing anything at all would show up here.
    expect(row.record_version).toBe(1 + successes);
    expect(await auditCount('apt.appointment.rescheduled', appointment)).toBe(successes);
  });

  it('replays a repeated reschedule under one key instead of moving twice', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    const key = crypto.randomUUID();
    const window = { confirmedFrom: '2026-09-11T09:00:00Z', confirmedTo: '2026-09-11T10:00:00Z' };

    const first = (await (await reschedule(appointment, window, 1, key)).json()) as Body;
    const replay = await reschedule(appointment, window, 1, key);
    expect(replay.ok).toBe(true);
    expect(((await replay.json()) as Body).recordVersion).toBe(first.recordVersion);

    const row = await readAppointment(appointment);
    expect(row.record_version).toBe(2);
    expect(await auditCount('apt.appointment.rescheduled', appointment)).toBe(1);
    expect(await outboxCount(appointment)).toBe(2);
  });

  it('refuses a terminal appointment', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    expect((await cancel(appointment, { cancellationReasonId: REASON_A }, 1)).status).toBe(200);

    const response = await reschedule(
      appointment,
      { confirmedFrom: '2026-09-12T09:00:00Z', confirmedTo: '2026-09-12T10:00:00Z' },
      2
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as Body).code).toBe('ERR-TRN-001');
    expect((await readAppointment(appointment)).confirmed_from).toBeNull();
  });

  it('refuses a tenant-B appointment and a branch outside the caller grant', async () => {
    authAs(SUBJ_FULL_B, TENANT_B);
    const theirs = await book({
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      vehicleId: await newVehicle(TENANT_B),
      requesterPartnerId: PARTNER_B,
      appointmentTypeId: TYPE_B,
      requestedFrom: '2026-09-01T09:00:00Z',
      requestedTo: '2026-09-01T10:00:00Z',
    });

    // A REAL tenant-B row, addressed by its REAL id by a tenant-A principal who
    // holds the very same permission in its own tenant. Only the tenant predicate
    // on the lock can refuse this.
    authAs(SUBJ_FULL_A);
    const cross = await reschedule(
      theirs,
      { confirmedFrom: '2026-09-13T09:00:00Z', confirmedTo: '2026-09-13T10:00:00Z' },
      1
    );
    expect(cross.status).toBe(404);
    expect(((await cross.json()) as Body).code).toBe('ERR-RES-001');

    const mine = await book(bookingFor(await newVehicle()));
    authAs(SUBJ_BRANCH2);
    const outOfScope = await reschedule(
      mine,
      { confirmedFrom: '2026-09-13T09:00:00Z', confirmedTo: '2026-09-13T10:00:00Z' },
      1
    );
    // Indistinguishable from an unknown id by design: possession of an id proves
    // nothing about the row behind it.
    expect(outOfScope.status).toBe(404);
    expect(((await outOfScope.json()) as Body).code).toBe('ERR-RES-001');

    for (const untouched of [theirs, mine]) {
      const row = await readAppointment(untouched);
      expect(row.confirmed_from).toBeNull();
      expect(row.record_version).toBe(1);
    }
  });
});

describe('apt.appointment-cancel', () => {
  it('cancels with reason, timestamp and actor written together', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));

    const response = await cancel(appointment, { cancellationReasonId: REASON_A }, 1);
    const body = (await response.json()) as Body;
    expect(response.status).toBe(200);
    expect(body.lifecycleStatus).toBe('cancelled');
    expect(body.changeKind).toBe('cancelled');

    const row = await readAppointment(appointment);
    // `ck_appointments_cancel_coherent` makes the three one fact: a cancelled
    // appointment missing any of them is not a row PostgreSQL will hold, so the
    // database could never have shown a half-cancelled record.
    expect(row.lifecycle_status).toBe('cancelled');
    expect(row.cancellation_reason_id).toBe(REASON_A);
    expect(row.cancelled_at).not.toBeNull();
    expect(row.cancelled_by).toBe(USER_FULL_A);
    // Cancellation is not a no-show; those columns stay empty.
    expect(row.no_show_recorded_at).toBeNull();
    expect(row.no_show_recorded_by).toBeNull();

    expect(await historyCount(appointment, 'cancelled')).toBe(1);
    expect(await auditCount('apt.appointment.cancelled', appointment)).toBe(1);
    expect(await outboxCount(appointment)).toBe(2);
  });

  it('refuses a second cancellation and leaves the first untouched', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    await cancel(appointment, { cancellationReasonId: REASON_A }, 1);
    const first = await readAppointment(appointment);

    const again = await cancel(appointment, { cancellationReasonId: REASON_A }, 2);
    expect(again.status).toBe(409);
    expect(((await again.json()) as Body).code).toBe('ERR-TRN-001');

    const row = await readAppointment(appointment);
    expect(row.cancelled_at?.toISOString()).toBe(first.cancelled_at?.toISOString());
    expect(row.record_version).toBe(first.record_version);
    expect(await historyCount(appointment, 'cancelled')).toBe(1);
    expect(await auditCount('apt.appointment.cancelled', appointment)).toBe(1);
  });

  it('refuses a stale If-Match and an unknown or cross-tenant reason', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    await reschedule(
      appointment,
      { confirmedFrom: '2026-09-14T09:00:00Z', confirmedTo: '2026-09-14T10:00:00Z' },
      1
    );

    const stale = await cancel(appointment, { cancellationReasonId: REASON_A }, 1);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Body).code).toBe('ERR-CON-001');

    // A catalogue row belonging to tenant B is invisible to the guard, exactly as
    // a nonexistent one is.
    const foreign = await cancel(appointment, { cancellationReasonId: REASON_B }, 2);
    expect(foreign.status).toBe(422);
    expect(((await foreign.json()) as Body).code).toBe('ERR-VAL-001');

    // Both refusals left the appointment exactly where the reschedule put it.
    const row = await readAppointment(appointment);
    expect(row.lifecycle_status).toBe('confirmed');
    expect(row.cancelled_at).toBeNull();
    expect(await auditCount('apt.appointment.cancelled', appointment)).toBe(0);
  });

  it('replays a repeated cancellation under one key instead of cancelling twice', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    const key = crypto.randomUUID();

    const first = (await (
      await cancel(appointment, { cancellationReasonId: REASON_A }, 1, key)
    ).json()) as Body;
    const replay = await cancel(appointment, { cancellationReasonId: REASON_A }, 1, key);
    expect(replay.ok).toBe(true);
    expect(((await replay.json()) as Body).recordVersion).toBe(first.recordVersion);

    expect((await readAppointment(appointment)).record_version).toBe(2);
    expect(await historyCount(appointment, 'cancelled')).toBe(1);
    expect(await auditCount('apt.appointment.cancelled', appointment)).toBe(1);
    expect(await outboxCount(appointment)).toBe(2);
  });

  it('refuses a tenant-B appointment and a branch outside the caller grant', async () => {
    authAs(SUBJ_FULL_B, TENANT_B);
    const theirs = await book({
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      vehicleId: await newVehicle(TENANT_B),
      requesterPartnerId: PARTNER_B,
      appointmentTypeId: TYPE_B,
      requestedFrom: '2026-09-01T09:00:00Z',
      requestedTo: '2026-09-01T10:00:00Z',
    });

    authAs(SUBJ_FULL_A);
    const cross = await cancel(theirs, { cancellationReasonId: REASON_A }, 1);
    expect(cross.status).toBe(404);
    expect(((await cross.json()) as Body).code).toBe('ERR-RES-001');

    const mine = await book(bookingFor(await newVehicle()));
    authAs(SUBJ_BRANCH2);
    const outOfScope = await cancel(mine, { cancellationReasonId: REASON_A }, 1);
    expect(outOfScope.status).toBe(404);

    for (const untouched of [theirs, mine]) {
      const row = await readAppointment(untouched);
      expect(row.lifecycle_status).toBe('requested');
      expect(row.cancellation_reason_id).toBeNull();
      expect(row.cancelled_at).toBeNull();
      expect(row.cancelled_by).toBeNull();
    }
  });
});

describe('apt.appointment-no-show', () => {
  it('records a no-show on a confirmed appointment without touching the cancellation columns', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    const version = await forceConfirm(appointment, '2026-09-15T09:00:00Z', '2026-09-15T10:00:00Z');

    const response = await noShow(appointment, version);
    const body = (await response.json()) as Body;
    expect(response.status).toBe(200);
    expect(body.lifecycleStatus).toBe('no_show');
    expect(body.changeKind).toBe('no_show_recorded');

    const row = await readAppointment(appointment);
    expect(row.lifecycle_status).toBe('no_show');
    // `ck_appointments_no_show_coherent` binds the state to its timestamp; the
    // actor is an ordinary evidence column written in the same statement.
    expect(row.no_show_recorded_at).not.toBeNull();
    expect(row.no_show_recorded_by).toBe(USER_FULL_A);
    // A no-show is NOT a cancellation, and one must never stand in for the other.
    expect(row.cancellation_reason_id).toBeNull();
    expect(row.cancelled_at).toBeNull();
    expect(row.cancelled_by).toBeNull();

    expect(await historyCount(appointment, 'no_show')).toBe(1);
    expect(await auditCount('apt.appointment.no_show_recorded', appointment)).toBe(1);
    expect(await outboxCount(appointment)).toBe(2);
  });

  it('refuses a no-show from requested and from cancelled', async () => {
    authAs(SUBJ_FULL_A);
    const requested = await book(bookingFor(await newVehicle()));
    // You cannot fail to show up for an appointment nobody confirmed.
    const fromRequested = await noShow(requested, 1);
    expect(fromRequested.status).toBe(409);
    expect(((await fromRequested.json()) as Body).code).toBe('ERR-TRN-001');
    const stillRequested = await readAppointment(requested);
    expect(stillRequested.lifecycle_status).toBe('requested');
    expect(stillRequested.no_show_recorded_at).toBeNull();
    expect(stillRequested.record_version).toBe(1);

    const cancelled = await book(bookingFor(await newVehicle()));
    await cancel(cancelled, { cancellationReasonId: REASON_A }, 1);
    const fromCancelled = await noShow(cancelled, 2);
    expect(fromCancelled.status).toBe(409);
    expect(((await fromCancelled.json()) as Body).code).toBe('ERR-TRN-001');
    const stillCancelled = await readAppointment(cancelled);
    expect(stillCancelled.lifecycle_status).toBe('cancelled');
    expect(stillCancelled.no_show_recorded_at).toBeNull();
    expect(stillCancelled.no_show_recorded_by).toBeNull();
    // The cancellation evidence is intact.
    expect(stillCancelled.cancellation_reason_id).toBe(REASON_A);
    expect(await auditCount('apt.appointment.no_show_recorded', cancelled)).toBe(0);
  });

  it('refuses a stale If-Match and a body that smuggles a field', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    const version = await forceConfirm(appointment, '2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z');

    const stale = await noShow(appointment, version - 1);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Body).code).toBe('ERR-CON-001');

    // The command carries no body: a caller who tries to smuggle a status or a
    // version alongside it gets a 422 rather than the impression it was applied.
    const smuggled = await noShow(appointment, version, crypto.randomUUID(), {
      lifecycleStatus: 'cancelled',
    });
    expect(smuggled.status).toBe(422);
    expect(((await smuggled.json()) as Body).code).toBe('ERR-VAL-001');

    const row = await readAppointment(appointment);
    expect(row.lifecycle_status).toBe('confirmed');
    expect(row.no_show_recorded_at).toBeNull();
    expect(await auditCount('apt.appointment.no_show_recorded', appointment)).toBe(0);
  });

  it('replays a repeated no-show under one key instead of recording twice', async () => {
    authAs(SUBJ_FULL_A);
    const appointment = await book(bookingFor(await newVehicle()));
    const version = await forceConfirm(appointment, '2026-09-17T09:00:00Z', '2026-09-17T10:00:00Z');
    const key = crypto.randomUUID();

    const first = (await (await noShow(appointment, version, key)).json()) as Body;
    const replay = await noShow(appointment, version, key);
    expect(replay.ok).toBe(true);
    expect(((await replay.json()) as Body).recordVersion).toBe(first.recordVersion);

    expect((await readAppointment(appointment)).record_version).toBe(version + 1);
    expect(await historyCount(appointment, 'no_show')).toBe(1);
    expect(await auditCount('apt.appointment.no_show_recorded', appointment)).toBe(1);
    expect(await outboxCount(appointment)).toBe(2);
  });

  it('refuses a tenant-B appointment and a branch outside the caller grant', async () => {
    authAs(SUBJ_FULL_B, TENANT_B);
    const theirs = await book({
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      vehicleId: await newVehicle(TENANT_B),
      requesterPartnerId: PARTNER_B,
      appointmentTypeId: TYPE_B,
      requestedFrom: '2026-09-01T09:00:00Z',
      requestedTo: '2026-09-01T10:00:00Z',
    });

    authAs(SUBJ_FULL_A);
    const cross = await noShow(theirs, 1);
    expect(cross.status).toBe(404);
    expect(((await cross.json()) as Body).code).toBe('ERR-RES-001');

    const mine = await book(bookingFor(await newVehicle()));
    const version = await forceConfirm(mine, '2026-09-18T09:00:00Z', '2026-09-18T10:00:00Z');
    authAs(SUBJ_BRANCH2);
    const outOfScope = await noShow(mine, version);
    expect(outOfScope.status).toBe(404);
    expect(((await outOfScope.json()) as Body).code).toBe('ERR-RES-001');

    for (const untouched of [theirs, mine]) {
      const row = await readAppointment(untouched);
      expect(row.no_show_recorded_at).toBeNull();
      expect(row.no_show_recorded_by).toBeNull();
    }
    expect((await readAppointment(mine)).lifecycle_status).toBe('confirmed');
  });
});
