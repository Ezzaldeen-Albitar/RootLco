/**
 * Reception-to-work-order conversion, end to end (Phase 1-18, P1-18-BE-019).
 *
 * Drives the real route through the fixed pipeline on the least-privilege
 * `app_runtime` role. Conversion is the one command in this module whose whole
 * point is being exactly-once: it locks the visit, creates ONE minimal work
 * order, and moves the visit to the terminal `converted` state in a single
 * transaction.
 *
 * Everything asserted here is asserted against rows read back as admin, never
 * against the response alone — a command that reports success without performing
 * it is the failure mode this suite exists to detect.
 *
 * The reception fixtures are built with admin SQL rather than through the sibling
 * check-in/approve routes on purpose: this file must fail when *conversion*
 * regresses, not when something upstream of it does, and an admin-built visit
 * leaves the tenant's outbox provably empty so "this operation publishes no
 * event" can be asserted as a tenant-wide delta rather than as a guess.
 *
 * Operation exercised here: rec.reception-convert-to-work-order.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rec.reception-convert-to-work-order: route service authorization success denial cross-tenant isolation audit rollback stale-version idempotency concurrency
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
import { POST as CONVERT } from '@/app/api/v1/receptions/[receptionId]/convert-to-work-order/route';

/** Platform actor used by the seeded permission catalog. */
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
const CONVERT_PERMISSION = 'rec.reception.convert';

/** Tenant A, unrestricted: the principal every positive case runs as. */
const ROLE_A = 'c1800000-0000-4000-8000-0000000000a1';
const USER_RA = 'c1800000-0000-4000-8000-0000000000a2';
const SUBJ_A = 'fx_p1_18_convert_a';
/** Tenant B, unrestricted in ITS OWN tenant — the cross-tenant probe. */
const ROLE_B = 'c1800000-0000-4000-8000-0000000000b1';
const USER_RB = 'c1800000-0000-4000-8000-0000000000b2';
const SUBJ_B = 'fx_p1_18_convert_b';
/** Tenant A, holding the same permission but narrowed to BRANCH_A2. */
const ROLE_SCOPED = 'c1800000-0000-4000-8000-0000000000c1';
const USER_SCOPED = 'c1800000-0000-4000-8000-0000000000c2';
const SUBJ_SCOPED = 'fx_p1_18_convert_scoped';
const GRANT_SCOPED = 'c1800000-0000-4000-8000-0000000000c3';

/** A second tenant-A branch, so "narrowed elsewhere" is a real branch. */
const BRANCH_A2 = 'a1100000-0000-4000-8000-0000000000a2';
/** Tenant B org scaffolding: the shared org fixtures only build tenant A's. */
const COMPANY_B1 = 'b1000000-0000-4000-8000-000000000001';
const BRANCH_B1 = 'b1100000-0000-4000-8000-000000000001';

const PARTNER_A = 'c1800000-0000-4000-8000-0000000000d1';
const PARTNER_B = 'c1800000-0000-4000-8000-0000000000d2';

const BASE = 'http://localhost/api/v1/receptions';

interface ConvertBody {
  readonly receptionVisitId?: string;
  readonly workOrderId?: string;
  readonly displayNumber?: string | null;
  readonly state?: string;
  readonly alreadyConverted?: boolean;
  readonly code?: string;
}

interface SeededReception {
  readonly visitId: string;
  readonly vehicleId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly recordVersion: number;
}

let admin: Pool;
let runtime: Pool;
/** Monotonic counter so every fixture vehicle carries a distinct 17-char VIN. */
let vinSeq = 0;

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

function convert(
  receptionId: string,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': options.key ?? crypto.randomUUID(),
  };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return CONVERT(
    new Request(`${BASE}/${receptionId}/convert-to-work-order`, {
      method: 'POST',
      headers,
      body: '{}',
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

async function count(sql: string, values: readonly unknown[] = []): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

/** Work orders that currently exist for a reception visit. Admin read, never RLS evidence. */
function workOrderCount(visitId: string): Promise<number> {
  return count(`SELECT count(*)::text AS n FROM wo.work_orders WHERE reception_visit_id = $1`, [
    visitId,
  ]);
}

/** Audit records the conversion action has written, tenant-wide. */
function conversionAuditCount(tenantId = TENANT_A): Promise<number> {
  return count(
    `SELECT count(*)::text AS n FROM iam.audit_records
      WHERE tenant_id = $1 AND action = 'rec.reception.converted_to_work_order'`,
    [tenantId]
  );
}

/** Every outbox row a tenant holds. The fixtures publish none, so this starts at 0. */
function outboxCount(tenantId = TENANT_A): Promise<number> {
  return count(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE tenant_id = $1`, [
    tenantId,
  ]);
}

async function receptionStatus(visitId: string): Promise<{ status: string; version: number }> {
  const result = await admin.query<{ reception_status: string; record_version: number }>(
    `SELECT reception_status, record_version FROM rec.reception_visits WHERE id = $1`,
    [visitId]
  );
  const row = result.rows[0];
  return { status: row?.reception_status ?? '', version: row?.record_version ?? 0 };
}

/** The tenant-wide work-order counter, read directly. */
function workOrderSequenceNextValue(): Promise<number> {
  return count(
    `SELECT next_value::text AS n FROM shared.number_sequences
      WHERE tenant_id = $1 AND sequence_code = 'work_order'
        AND company_id IS NULL AND branch_id IS NULL`,
    [TENANT_A]
  );
}

/**
 * Renders the number the NEXT work-order allocation will produce, then rolls the
 * allocation back so it is still the next one.
 *
 * Nothing about the rendering format is assumed: the platform allocator itself
 * produces the string. The rollback is what keeps the peek non-destructive, and
 * it is the same property the conversion relies on.
 */
async function peekNextWorkOrderNumber(): Promise<string> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`,
      [TENANT_A, USER_A]
    );
    const result = await client.query<{ display_number: string }>(
      `SELECT display_number FROM shared.next_display_number(
                p_sequence_code => 'work_order',
                p_company_id    => NULL::uuid,
                p_branch_id     => NULL::uuid)`
    );
    return result.rows[0]?.display_number ?? '';
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/**
 * Blocks until `expected` backends are waiting on a lock in this database.
 *
 * A race between two in-flight requests cannot be asserted until both have
 * actually reached the contended row. Waiting for that is what makes the
 * assertion deterministic instead of a coin toss decided by the event loop.
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
 * Builds a reception visit in the requested state, as admin, in ONE transaction.
 *
 * The frozen `rec.accept_check_in()` primitive does the check-in — visit, the
 * mandatory service-requester role, the accepted custody event and the first
 * status-history row — because hand-rolling those four would create a fixture
 * that satisfies the work-order guard without satisfying the reception contract,
 * and the guard is precisely what this suite must not fake its way past.
 */
async function seedReception(input: {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly partnerId: string;
  /** Final reception state. Defaults to `authorized` — the convertible one. */
  readonly status?: 'opened' | 'inspecting' | 'authorized' | 'converted';
}): Promise<SeededReception> {
  const status = input.status ?? 'authorized';
  const vin = `1P18${String(++vinSeq).padStart(13, '0')}`;
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, input.tenantId]
    );
    const vehicle = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,'ice','active',$3) RETURNING id`,
      [input.tenantId, vin, USER_A]
    );
    const vehicleId = vehicle.rows[0]?.id ?? '';

    const walkIn = await client.query<{ id: string }>(
      `INSERT INTO rec.walk_in_references
         (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.tenantId, input.companyId, input.branchId, vehicleId, input.partnerId, USER_A]
    );

    const visit = await client.query<{ id: string }>(
      `SELECT rec.accept_check_in($1::uuid,$2::uuid,$3::uuid,NULL::uuid,$4::uuid,$5::uuid,$6::uuid) AS id`,
      [
        input.companyId,
        input.branchId,
        vehicleId,
        walkIn.rows[0]?.id ?? '',
        USER_A,
        input.partnerId,
      ]
    );
    const visitId = visit.rows[0]?.id ?? '';

    if (status !== 'opened') {
      // The frozen activation contract: `authorized` needs an approved
      // authorization from a party already holding an authorizing role. The
      // check-in primitive created exactly one — `service_requester`.
      await client.query(
        `INSERT INTO rec.authorizations
           (tenant_id, company_id, branch_id, reception_visit_id, authorizing_role,
            partner_id, decision, channel, created_by)
         VALUES ($1,$2,$3,$4,'service_requester',$5,'approved','in_person',$6)`,
        [input.tenantId, input.companyId, input.branchId, visitId, input.partnerId, USER_A]
      );
      await client.query(
        `UPDATE rec.reception_visits SET reception_status = 'inspecting' WHERE id = $1`,
        [visitId]
      );
    }
    if (status === 'authorized' || status === 'converted') {
      await client.query(
        `UPDATE rec.reception_visits SET reception_status = 'authorized' WHERE id = $1`,
        [visitId]
      );
    }
    if (status === 'converted') {
      await client.query(
        `UPDATE rec.reception_visits SET reception_status = 'converted' WHERE id = $1`,
        [visitId]
      );
    }

    const current = await client.query<{ record_version: number }>(
      `SELECT record_version FROM rec.reception_visits WHERE id = $1`,
      [visitId]
    );
    await client.query('COMMIT');
    return {
      visitId,
      vehicleId,
      companyId: input.companyId,
      branchId: input.branchId,
      recordVersion: current.rows[0]?.record_version ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Convenience: an authorized tenant-A reception in the default branch. */
function seedAuthorized(): Promise<SeededReception> {
  return seedReception({
    tenantId: TENANT_A,
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    partnerId: PARTNER_A,
  });
}

/**
 * Appends a LATER declining decision from the same party — a withdrawal.
 *
 * Written admin-side because the conversion suite imports no authorization
 * route; what is under test is what conversion does about a standing
 * withdrawal, not how the row came to exist. The row is a genuine append to an
 * append-only table, exactly as the route would write it.
 */
async function withdrawAuthorization(seeded: SeededReception, tenantId = TENANT_A): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, tenantId]
    );
    await client.query(
      `INSERT INTO rec.authorizations
         (tenant_id, company_id, branch_id, reception_visit_id, authorizing_role,
          partner_id, decision, channel, created_by)
       VALUES ($1,$2,$3,$4,'service_requester',$5,'declined','in_person',$6)`,
      [tenantId, seeded.companyId, seeded.branchId, seeded.visitId, PARTNER_A, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** The sibling withdrawal channel: an `authorization`-type refusal for the party. */
async function refuseAuthorization(seeded: SeededReception, tenantId = TENANT_A): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, tenantId]
    );
    await client.query(
      `INSERT INTO rec.refusals
         (tenant_id, company_id, branch_id, reception_visit_id, refusal_type,
          refusing_partner_id, created_by)
       VALUES ($1,$2,$3,$4,'authorization',$5,$6)`,
      [tenantId, seeded.companyId, seeded.branchId, seeded.visitId, PARTNER_A, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedPrincipal(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Conversion Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 conversion',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A, CONVERT_PERMISSION]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  // The permission code, description and risk level are the seeded catalog's own
  // values, so a database that already carries the seed sees no drift and one
  // that does not still resolves the permission the route declares.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ($1,'rec','Convert an approved reception into a work order','high',$2)
     ON CONFLICT (permission_code) DO NOTHING`,
    [CONVERT_PERMISSION, SYSTEM_ACTOR]
  );

  // Tenant B org scaffolding + a second tenant-A branch. Both are removed by the
  // tenant cascade in cleanBackendFixtures.
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_b1','Fixture Company B1','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b1','Fixture Branch B1','UTC',$4),
            ($5,$6,$7,'branch_a2','Fixture Branch A2','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A, BRANCH_A2, TENANT_A, COMPANY_A1]
  );

  await seedPrincipal(TENANT_A, ROLE_A, USER_RA, SUBJ_A);
  await seedPrincipal(TENANT_B, ROLE_B, USER_RB, SUBJ_B);
  await seedPrincipal(TENANT_A, ROLE_SCOPED, USER_SCOPED, SUBJ_SCOPED);

  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_A, USER_RA, ROLE_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_B, USER_RB, ROLE_B, USER_A]
  );
  // The scoped grant and its scope must land together: "a scoped active grant
  // carries at least one scope" is a DEFERRABLE constraint trigger.
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

  // Business partners the receptions name as service requester. All the rec/crm
  // triggers stamp their actor from `app.user_id`, so each runs in a
  // context-set transaction.
  for (const [tenantId, partnerId] of [
    [TENANT_A, PARTNER_A],
    [TENANT_B, PARTNER_B],
  ] as const) {
    const fixture = await admin.connect();
    try {
      await fixture.query('BEGIN');
      await fixture.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, tenantId]
      );
      await fixture.query(
        `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
         VALUES ($1,$2,'organization','Reception Requester','active',$3) ON CONFLICT (id) DO NOTHING`,
        [partnerId, tenantId, USER_A]
      );
      await fixture.query('COMMIT');
    } catch (error) {
      await fixture.query('ROLLBACK');
      throw error;
    } finally {
      fixture.release();
    }
  }

  // Provision the work-order sequence. Provisioning is an operator action —
  // `app_runtime` holds no INSERT here — and it is what makes the rollback case
  // able to observe that the operation's FIRST write was undone.
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, sequence_code, prefix_template, next_value, pad_width, period_reset_rule, created_by)
     VALUES ($1,'work_order','WO-',1,6,'never',$2)`,
    [TENANT_A, USER_A]
  );

  runtime = runtimeAppPool(6);
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
  it('401 without an authenticator and 403 without rec.reception.convert, writing nothing', async () => {
    const reception = await seedAuthorized();

    __resetAuthenticatorForTests();
    const anonymous = await convert(reception.visitId, { version: reception.recordVersion });
    expect(anonymous.status).toBe(401);

    // Authenticated, in-tenant, and holding a role with no permission mappings at
    // all. The only thing that can refuse this request is the declared permission.
    authAs(SUBJECT_UNPERMITTED);
    const denied = await convert(reception.visitId, { version: reception.recordVersion });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as ConvertBody).code).toBe('ERR-IAM-001');

    // A denied request performs no work: no work order, and the visit is still
    // convertible rather than half-transitioned.
    expect(await workOrderCount(reception.visitId)).toBe(0);
    expect((await receptionStatus(reception.visitId)).status).toBe('authorized');
  });
});

describe('rec.reception-convert-to-work-order', () => {
  it('converts an approved reception into exactly one work order and closes the visit', async () => {
    authAs(SUBJ_A);
    const reception = await seedAuthorized();

    const response = await convert(reception.visitId, { version: reception.recordVersion });
    const body = (await response.json()) as ConvertBody;
    expect({ status: response.status, code: body.code }).toEqual({ status: 200, code: undefined });
    expect(body.receptionVisitId).toBe(reception.visitId);
    expect(body.workOrderId).toBeTruthy();
    expect(body.alreadyConverted).toBe(false);

    // Exactly one work order for this visit, carrying the visit's own vehicle and
    // the configured initial state — not a state this module invented.
    const orders = await admin.query<{
      id: string;
      vehicle_id: string;
      state: string;
      kind: string;
      parts_forward_state: string;
      display_number: string | null;
      company_id: string;
      branch_id: string;
    }>(
      `SELECT id, vehicle_id, state, kind, parts_forward_state, display_number, company_id, branch_id
         FROM wo.work_orders WHERE reception_visit_id = $1`,
      [reception.visitId]
    );
    expect(orders.rowCount).toBe(1);
    const order = orders.rows[0];
    expect(order?.id).toBe(body.workOrderId);
    expect(order?.vehicle_id).toBe(reception.vehicleId);
    expect(order?.kind).toBe('ordinary');
    expect(order?.parts_forward_state).toBe('none');
    expect(order?.company_id).toBe(reception.companyId);
    expect(order?.branch_id).toBe(reception.branchId);
    // `draft` is the state the platform state graph defines as the entry point,
    // and the work-order guard refuses any initial state that is not defined,
    // active and non-terminal. Asserting the row against the catalog rather than
    // against a literal keeps this honest if the graph is ever reconfigured.
    expect(order?.state).toBe(body.state);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.work_order_states
          WHERE code = $1 AND scope = 'platform' AND status = 'active' AND is_terminal = false`,
        [order?.state]
      )
    ).toBe(1);
    expect(order?.display_number).toBe(body.displayNumber);
    expect(order?.display_number).toBeTruthy();

    // The visit is terminal now, and its ledger recorded the move once.
    expect((await receptionStatus(reception.visitId)).status).toBe('converted');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM rec.reception_status_history
          WHERE reception_visit_id = $1 AND to_state = 'converted'`,
        [reception.visitId]
      )
    ).toBe(1);
  });

  it('creates a MINIMAL work order — no job, service line or required part', async () => {
    authAs(SUBJ_A);
    const reception = await seedAuthorized();
    const body = (await (
      await convert(reception.visitId, { version: reception.recordVersion })
    ).json()) as ConvertBody;
    const workOrderId = body.workOrderId ?? '';
    expect(workOrderId).toBeTruthy();

    // How work is organised is Phase 1-19's contract. Deciding it here would be
    // this module answering a question nobody asked it, so each of the three
    // tables P1-19 owns must be empty for the work order just created.
    for (const table of ['wo.jobs', 'wo.work_order_service_lines', 'wo.required_parts']) {
      expect(
        await count(`SELECT count(*)::text AS n FROM ${table} WHERE work_order_id = $1`, [
          workOrderId,
        ])
      ).toBe(0);
    }
  });

  it('writes exactly one audit record and publishes NO event', async () => {
    authAs(SUBJ_A);
    const reception = await seedAuthorized();
    const auditBefore = await conversionAuditCount();
    const outboxBefore = await outboxCount();

    const body = (await (
      await convert(reception.visitId, { version: reception.recordVersion })
    ).json()) as ConvertBody;
    const workOrderId = body.workOrderId ?? '';

    expect(
      await count(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'rec.reception.converted_to_work_order' AND entity_id = $1`,
        [workOrderId]
      )
    ).toBe(1);
    expect(await conversionAuditCount()).toBe(auditBefore + 1);

    // The approved event catalog defines NO event for this fact. A future
    // accidental publication would be a contract change no consumer agreed to,
    // so the assertion is the tenant's whole outbox, not just this aggregate.
    expect(await outboxCount()).toBe(outboxBefore);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM shared.event_outbox WHERE aggregate_id = ANY($1::uuid[])`,
        [[reception.visitId, workOrderId]]
      )
    ).toBe(0);
  });

  it('replays the same Idempotency-Key to the same work order, creating no second one', async () => {
    authAs(SUBJ_A);
    const reception = await seedAuthorized();
    const key = crypto.randomUUID();

    const first = (await (
      await convert(reception.visitId, { version: reception.recordVersion, key })
    ).json()) as ConvertBody;
    expect(first.workOrderId).toBeTruthy();

    const replay = await convert(reception.visitId, { version: reception.recordVersion, key });
    expect(replay.status).toBe(200);
    const replayed = (await replay.json()) as ConvertBody;
    expect(replayed.workOrderId).toBe(first.workOrderId);
    expect(replayed.displayNumber).toBe(first.displayNumber);

    expect(await workOrderCount(reception.visitId)).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'rec.reception.converted_to_work_order' AND entity_id = $1`,
        [first.workOrderId]
      )
    ).toBe(1);
  });

  it('answers a second conversion under a FRESH key with the work order already created', async () => {
    authAs(SUBJ_A);
    const reception = await seedAuthorized();
    const first = (await (
      await convert(reception.visitId, { version: reception.recordVersion })
    ).json()) as ConvertBody;

    // A different key is a genuinely new request, so the idempotency layer does
    // not answer it — the exactly-once guarantee has to come from the command
    // itself. It reports the conversion already done rather than making a second
    // work order or refusing work that succeeded.
    const second = await convert(reception.visitId, { version: reception.recordVersion + 1 });
    const body = (await second.json()) as ConvertBody;
    expect({ status: second.status, code: body.code }).toEqual({ status: 200, code: undefined });
    expect(body.workOrderId).toBe(first.workOrderId);
    expect(body.alreadyConverted).toBe(true);

    expect(await workOrderCount(reception.visitId)).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'rec.reception.converted_to_work_order' AND entity_id = $1`,
        [first.workOrderId]
      )
    ).toBe(1);
  });
});

describe('rec.reception-convert-to-work-order: standing authorization', () => {
  /**
   * The consequential one. `wo.guard_work_order_refs` re-tests that an approved
   * authorization EXISTS, never that it is the standing decision, so before this
   * check a customer could withdraw consent and a work order would still open on
   * their vehicle. The visit stays `authorized` throughout — nothing about its
   * status reveals the withdrawal — so conversion is the only place left to
   * catch it.
   *
   * Without the application check this test fails with 200 and one work order.
   */
  /**
   * The same withdrawal, recorded through the refusals route instead.
   *
   * `wo.guard_work_order_refs` only re-tests that an approved authorization
   * EXISTS, and it never looks at `rec.refusals` at all, so before the
   * `rec.refusals` arm of `standingAuthorizations` this opened a work order on a
   * vehicle whose owner had refused authorization. Removing that arm makes this
   * fail with 200 and one work order.
   */
  it('refuses conversion when an authorization refusal supersedes the approval', async () => {
    authAs(SUBJ_A);
    const seeded = await seedAuthorized();
    await refuseAuthorization(seeded);

    const response = await convert(seeded.visitId, { version: seeded.recordVersion });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');
    expect(await workOrderCount(seeded.visitId)).toBe(0);
    expect((await receptionStatus(seeded.visitId)).status).toBe('authorized');
  });

  it('refuses conversion when the standing decision is a later withdrawal', async () => {
    authAs(SUBJ_A);
    const seeded = await seedAuthorized();
    await withdrawAuthorization(seeded);

    const response = await convert(seeded.visitId, { version: seeded.recordVersion });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');

    // The refusal performs no work: no work order, and the visit is still
    // authorized rather than converted.
    expect(await workOrderCount(seeded.visitId)).toBe(0);
    expect((await receptionStatus(seeded.visitId)).status).toBe('authorized');
  });
});

describe('refusals', () => {
  it('refuses an unapproved reception in either pre-authorized state', async () => {
    authAs(SUBJ_A);
    for (const status of ['opened', 'inspecting'] as const) {
      const reception = await seedReception({
        tenantId: TENANT_A,
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        partnerId: PARTNER_A,
        status,
      });
      const response = await convert(reception.visitId, { version: reception.recordVersion });
      expect(response.status).toBe(409);
      expect(((await response.json()) as ConvertBody).code).toBe('ERR-TRN-001');
      expect(await workOrderCount(reception.visitId)).toBe(0);
      expect((await receptionStatus(reception.visitId)).status).toBe(status);
    }
  });

  it('refuses a reception already marked converted', async () => {
    authAs(SUBJ_A);
    const reception = await seedReception({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      partnerId: PARTNER_A,
      status: 'converted',
    });
    // `converted` is terminal. With no work order behind it there is nothing to
    // report as already done, so the lifecycle rule is what answers.
    const response = await convert(reception.visitId, { version: reception.recordVersion });
    expect(response.status).toBe(409);
    expect(((await response.json()) as ConvertBody).code).toBe('ERR-TRN-001');
    expect(await workOrderCount(reception.visitId)).toBe(0);
  });

  it('requires If-Match and refuses a stale one, creating no work order', async () => {
    authAs(SUBJ_A);
    const reception = await seedAuthorized();

    const missing = await convert(reception.visitId, { version: null });
    expect(missing.status).toBe(428);
    expect(((await missing.json()) as ConvertBody).code).toBe('ERR-CON-002');

    const stale = await convert(reception.visitId, { version: reception.recordVersion + 7 });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ConvertBody).code).toBe('ERR-CON-001');

    // The refusal happens after the work order has been inserted inside the
    // transaction, so "no work order" here is the rollback holding, not the
    // command declining early.
    expect(await workOrderCount(reception.visitId)).toBe(0);
    const after = await receptionStatus(reception.visitId);
    expect(after.status).toBe('authorized');
    expect(after.version).toBe(reception.recordVersion);
  });
});

describe('scope', () => {
  it('refuses a tenant-B principal converting a real tenant-A reception, and the reverse', async () => {
    const mine = await seedAuthorized();
    const theirs = await seedReception({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      partnerId: PARTNER_B,
    });

    // SUBJ_B holds the very same `rec.reception.convert` permission in its own
    // tenant, so authorization passes and the only thing that can refuse this is
    // the tenancy predicate on the visit resolve.
    authAs(SUBJ_B, TENANT_B);
    const crossIn = await convert(mine.visitId, { version: mine.recordVersion });
    expect(crossIn.status).toBe(404);
    expect(((await crossIn.json()) as ConvertBody).code).toBe('ERR-RES-001');

    authAs(SUBJ_A);
    const crossOut = await convert(theirs.visitId, { version: theirs.recordVersion });
    expect(crossOut.status).toBe(404);
    expect(((await crossOut.json()) as ConvertBody).code).toBe('ERR-RES-001');

    // Neither attempt landed anything in either tenant, and neither visit moved.
    expect(await workOrderCount(mine.visitId)).toBe(0);
    expect(await workOrderCount(theirs.visitId)).toBe(0);
    expect((await receptionStatus(mine.visitId)).status).toBe('authorized');
    expect((await receptionStatus(theirs.visitId)).status).toBe('authorized');

    // And tenant A can still convert its own reception, which is what makes the
    // two refusals above about tenancy rather than about an unconvertible row.
    const ok = await convert(mine.visitId, { version: mine.recordVersion });
    expect({ status: ok.status, code: ((await ok.json()) as ConvertBody).code }).toEqual({
      status: 200,
      code: undefined,
    });
    expect(await workOrderCount(mine.visitId)).toBe(1);
  });

  it('refuses a principal whose grant is narrowed to another branch', async () => {
    const reception = await seedAuthorized();

    // Same tenant, same permission, but the grant carries a branch scope naming
    // BRANCH_A2 while the reception lives in BRANCH_A1.
    authAs(SUBJ_SCOPED);
    const refused = await convert(reception.visitId, { version: reception.recordVersion });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as ConvertBody).code).toBe('ERR-RES-001');
    expect(await workOrderCount(reception.visitId)).toBe(0);
    expect((await receptionStatus(reception.visitId)).status).toBe('authorized');

    // The unrestricted principal converts the same row, so the refusal was the
    // grant narrowing and nothing else.
    authAs(SUBJ_A);
    const allowed = await convert(reception.visitId, { version: reception.recordVersion });
    expect({ status: allowed.status, code: ((await allowed.json()) as ConvertBody).code }).toEqual({
      status: 200,
      code: undefined,
    });
    expect(await workOrderCount(reception.visitId)).toBe(1);
  });
});

describe('atomicity', () => {
  it('rolls a failed conversion back completely, leaving no partial state anywhere', async () => {
    authAs(SUBJ_A);
    const reception = await seedAuthorized();
    const decoy = await seedAuthorized();

    // Injected failure: the number the conversion is about to allocate is already
    // carried by a live work order, so the INSERT violates
    // `uq_work_orders_active_display_number` AFTER the counter has advanced and
    // the work-order row has been formed.
    const collidingNumber = await peekNextWorkOrderNumber();
    expect(collidingNumber).toBeTruthy();
    await admin.query(
      `INSERT INTO wo.work_orders
         (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, display_number, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        TENANT_A,
        decoy.companyId,
        decoy.branchId,
        decoy.visitId,
        decoy.vehicleId,
        collidingNumber,
        USER_A,
      ]
    );

    const sequenceBefore = await workOrderSequenceNextValue();
    const auditBefore = await conversionAuditCount();
    const key = crypto.randomUUID();

    const response = await convert(reception.visitId, {
      version: reception.recordVersion,
      key,
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as ConvertBody).code).toBe('ERR-RES-002');

    // Every table this operation writes is untouched — counted, not inferred
    // from the status code.
    expect(await workOrderCount(reception.visitId)).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM rec.reception_status_history
          WHERE reception_visit_id = $1 AND to_state = 'converted'`,
        [reception.visitId]
      )
    ).toBe(0);
    expect(await conversionAuditCount()).toBe(auditBefore);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM shared.idempotency_keys
          WHERE tenant_id = $1 AND idempotency_key = $2`,
        [TENANT_A, key]
      )
    ).toBe(0);

    // The visit never moved, and the display-number counter was not burned: the
    // allocation is the operation's FIRST write, so an unchanged counter is
    // direct evidence that the whole transaction — work-order row included —
    // was rolled back rather than partially committed.
    const after = await receptionStatus(reception.visitId);
    expect(after.status).toBe('authorized');
    expect(after.version).toBe(reception.recordVersion);
    expect(await workOrderSequenceNextValue()).toBe(sequenceBefore);

    // And the reception is still convertible once the collision is removed.
    await admin.query(`DELETE FROM wo.work_orders WHERE reception_visit_id = $1`, [decoy.visitId]);
    const retry = await convert(reception.visitId, { version: reception.recordVersion });
    expect(retry.status).toBe(200);
    expect(await workOrderCount(reception.visitId)).toBe(1);
  });

  it('two concurrent conversions of one reception produce exactly ONE work order', async () => {
    authAs(SUBJ_A);
    const reception = await seedAuthorized();
    const auditBefore = await conversionAuditCount();

    // A third connection holds the visit row so both requests are provably in
    // flight and blocked on the same tuple before either can proceed. Without
    // this barrier the two would very likely run one after the other and the
    // outcome below would prove nothing about concurrency at all.
    const gate = await admin.connect();
    const outcomes = await (async () => {
      try {
        await gate.query('BEGIN');
        await gate.query('SELECT id FROM rec.reception_visits WHERE id = $1 FOR UPDATE', [
          reception.visitId,
        ]);

        const inFlight = Promise.all([
          convert(reception.visitId, { version: reception.recordVersion }),
          convert(reception.visitId, { version: reception.recordVersion }),
        ]);

        try {
          await waitForBlockedBackends(2);
        } finally {
          // Release whether or not both arrived, so the requests finish and a
          // failure reports its own cause instead of a timeout.
          await gate.query('ROLLBACK');
        }
        return await inFlight;
      } finally {
        gate.release();
      }
    })();

    const statuses = outcomes.map((response) => response.status).sort((x, y) => x - y);
    const bodies = (await Promise.all(
      outcomes.map((response) => response.json())
    )) as ConvertBody[];

    // Neither request faulted: the loser meets a stable, mapped outcome rather
    // than a driver error surfacing as a 500.
    expect(statuses.every((status) => status < 500)).toBe(true);
    // The visit lock serialises the two, so the second reads the state the first
    // committed and answers with the work order that already exists instead of
    // creating a second one or refusing work that succeeded. If the lock were
    // dropped, both would insert and the frozen partial unique index
    // `uq_work_orders_ordinary_origin` would refuse one of them with 409 — so
    // this pair of 200s is what fails when the serialisation is removed.
    expect(statuses).toEqual([200, 200]);
    expect(bodies[0]?.workOrderId).toBeTruthy();
    expect(bodies[1]?.workOrderId).toBe(bodies[0]?.workOrderId);
    expect(bodies.filter((body) => body.alreadyConverted === false)).toHaveLength(1);

    // The invariant itself, counted: one work order, one audit record, one
    // recorded transition.
    expect(await workOrderCount(reception.visitId)).toBe(1);
    expect(await conversionAuditCount()).toBe(auditBefore + 1);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM rec.reception_status_history
          WHERE reception_visit_id = $1 AND to_state = 'converted'`,
        [reception.visitId]
      )
    ).toBe(1);
    expect((await receptionStatus(reception.visitId)).status).toBe('converted');
  });
});
