/**
 * Appointment reads — the branch calendar and the detail, end to end (P1-27
 * remediation executed by P1-18, `P1-27-INT-019`).
 *
 * All four `apt.` operations were writes. The three guarded lifecycle commands
 * demand `If-Match` and the only source of `recordVersion` was a prior write's
 * response in the same session; there was no calendar of any kind. The decisive
 * test here is the ROUND TRIP: the detail's published ETag drives a real
 * `apt.appointment-reschedule` without any prior write in the session — which
 * is the whole point of the read surface.
 *
 * The list's date filter and ordering run over the CONFIRMED window falling
 * back to the requested one, proven with a rescheduled appointment whose
 * confirmed day differs from its requested day: the calendar must show it on
 * the day the workshop promised, not the day the customer first asked for.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   apt.appointment-list: route service authorization success denial isolation
 *   apt.appointment-detail: route service authorization success denial cross-tenant isolation
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
import {
  GET as LIST_APPOINTMENTS,
  POST as CREATE_APPOINTMENT,
  APPOINTMENT_LIST_OPERATION,
} from '@/app/api/v1/appointments/route';
import {
  GET as READ_APPOINTMENT,
  APPOINTMENT_DETAIL_OPERATION,
} from '@/app/api/v1/appointments/[appointmentId]/route';
import { POST as RESCHEDULE } from '@/app/api/v1/appointments/[appointmentId]/reschedule/route';

/** Tenant B's own company and branch — a real scope, not a fabricated id. */
const COMPANY_B1 = 'c1190000-0000-4000-8000-0000000000b1';
const BRANCH_B1 = 'c1190000-0000-4000-8000-0000000000b2';
/** A second branch of the same company, for the isolation split. */
const BRANCH_A2 = 'c1190000-0000-4000-8000-0000000000a2';

const ROLE_FULL = 'c1190000-0000-4000-8000-000000000101';
const USER_FULL = 'c1190000-0000-4000-8000-000000000102';
const SUBJ_FULL = 'fx_p1_18_apt_reader';

/** Holds the two WRITE codes but NOT apt.appointment.read. */
const ROLE_NO_READ = 'c1190000-0000-4000-8000-000000000201';
const USER_NO_READ = 'c1190000-0000-4000-8000-000000000202';
const SUBJ_NO_READ = 'fx_p1_18_apt_no_read';

/**
 * Read granted in BRANCH_A2 only, PLUS an unrelated permission in BRANCH_A1 —
 * so RLS shows the BRANCH_A1 row (`app.branch_ids` is the permission-blind
 * union) while `iam.has_permission_in_scope` must still refuse it.
 */
const ROLE_ELSEWHERE = 'c1190000-0000-4000-8000-000000000301';
const ROLE_DECOY = 'c1190000-0000-4000-8000-000000000304';
const USER_ELSEWHERE = 'c1190000-0000-4000-8000-000000000302';
const SUBJ_ELSEWHERE = 'fx_p1_18_apt_elsewhere';
const GRANT_ELSEWHERE = 'c1190000-0000-4000-8000-000000000303';
const GRANT_DECOY = 'c1190000-0000-4000-8000-000000000305';

const ROLE_TENANT_B = 'c1190000-0000-4000-8000-000000000401';
const USER_TENANT_B = 'c1190000-0000-4000-8000-000000000402';
const SUBJ_TENANT_B = 'fx_p1_18_apt_tenant_b';

const PARTNER_A = 'c1190000-0000-4000-8000-0000000000c1';
const TYPE_A = 'c1190000-0000-4000-8000-0000000000c2';

const A = 'http://localhost/api/v1/appointments';

const FULL_PERMISSIONS = [
  'apt.appointment.manage',
  'apt.appointment.lifecycle.manage',
  'apt.appointment.read',
];

interface Detail {
  readonly id?: string;
  readonly appointmentId?: string;
  readonly lifecycleStatus?: string;
  readonly recordVersion?: number;
  readonly requestedFrom?: string;
  readonly confirmedFrom?: string | null;
  readonly appointmentTypeName?: string | null;
  readonly requesterDisplayName?: string | null;
  readonly code?: string;
}

interface PageBody {
  readonly items?: readonly Detail[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
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

function list(query: string): Promise<Response> {
  return LIST_APPOINTMENTS(new Request(`${A}${query}`));
}

function detail(appointmentId: string): Promise<Response> {
  return READ_APPOINTMENT(new Request(`${A}/${appointmentId}`), {
    params: Promise.resolve({ appointmentId }),
  });
}

function reschedule(
  appointmentId: string,
  version: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return RESCHEDULE(
    new Request(`${A}/${appointmentId}/reschedule`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        'if-match': version,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ appointmentId }) }
  );
}

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

async function newVehicle(tenantId = TENANT_A): Promise<string> {
  vehicleCounter += 1;
  const vin = `P118APTREAD${String(vehicleCounter).padStart(6, '0')}`;
  return asAdminTx(tenantId, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,'ice','active',$3) RETURNING id`,
      [tenantId, vin, USER_A]
    );
    return inserted.rows[0]?.id ?? '';
  });
}

/** Books an appointment through the real route. Leaves it `requested`, RV 1. */
async function book(window: { from: string; to: string }): Promise<string> {
  const response = await CREATE_APPOINTMENT(
    new Request(A, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        vehicleId: await newVehicle(),
        requesterPartnerId: PARTNER_A,
        appointmentTypeId: TYPE_A,
        requestedFrom: window.from,
        requestedTo: window.to,
      }),
    })
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as Detail).appointmentId ?? '';
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
     VALUES ($1,$2,$3,$4,$4||'@example.test','Appointment Principal','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 appointment principal',$4) ON CONFLICT (id) DO NOTHING`,
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
     VALUES ('apt.appointment.manage','apt','Create and reschedule appointments in the caller scope','medium',$1),
            ('apt.appointment.lifecycle.manage','apt','Cancel an appointment or record a no-show','medium',$1),
            ('apt.appointment.read','apt','Read appointments, the branch calendar and the appointment catalogues','low',$1),
            ('veh.vehicle.read','veh','Search and read vehicles in the caller tenant','low',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_a2_apt','Fixture Branch A2 Apt','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_b1_apt','Fixture Company B1 Apt','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b1_apt','Fixture Branch B1 Apt','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A]
  );

  await seedPrincipal(TENANT_A, ROLE_FULL, USER_FULL, SUBJ_FULL, FULL_PERMISSIONS);
  await seedPrincipal(TENANT_A, ROLE_NO_READ, USER_NO_READ, SUBJ_NO_READ, [
    'apt.appointment.manage',
    'apt.appointment.lifecycle.manage',
  ]);
  await seedPrincipal(TENANT_A, ROLE_ELSEWHERE, USER_ELSEWHERE, SUBJ_ELSEWHERE, [
    'apt.appointment.read',
  ]);
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_18_apt_decoy','P1-18 decoy role',$3) ON CONFLICT (id) DO NOTHING`,
    [ROLE_DECOY, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = 'veh.vehicle.read'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_DECOY, USER_A]
  );
  await seedPrincipal(TENANT_B, ROLE_TENANT_B, USER_TENANT_B, SUBJ_TENANT_B, FULL_PERMISSIONS);

  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4), ($1,$5,$6,'unrestricted',$4,$4)`,
    [TENANT_A, USER_FULL, ROLE_FULL, USER_A, USER_NO_READ, ROLE_NO_READ]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_B, USER_TENANT_B, ROLE_TENANT_B, USER_A]
  );
  // The permission-elsewhere principal: read scoped to BRANCH_A2, plus a decoy
  // grant in BRANCH_A1 that carries no appointment permission at all.
  const scoped = await admin.connect();
  try {
    await scoped.query('BEGIN');
    await scoped.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5), ($6,$2,$3,$7,'scoped',$5,$5)`,
      [GRANT_ELSEWHERE, TENANT_A, USER_ELSEWHERE, ROLE_ELSEWHERE, USER_A, GRANT_DECOY, ROLE_DECOY]
    );
    await scoped.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5), ($1,$6,'branch',$3,$7,$5)`,
      [TENANT_A, GRANT_ELSEWHERE, COMPANY_A1, BRANCH_A2, USER_A, GRANT_DECOY, BRANCH_A1]
    );
    await scoped.query('COMMIT');
  } catch (error) {
    await scoped.query('ROLLBACK');
    throw error;
  } finally {
    scoped.release();
  }

  await asAdminTx(TENANT_A, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','Calendar Requester A','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A, TENANT_A, USER_A]
    );
  });
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, created_by)
     VALUES ($1,'tenant',$2,'zz_apt_read_type','General Service',$3) ON CONFLICT (id) DO NOTHING`,
    [TYPE_A, TENANT_A, USER_A]
  );

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.query(`DELETE FROM apt.appointment_types WHERE id = $1`, [TYPE_A]);
    await admin.end();
  }
});

describe('registration', () => {
  it('registers both reads exactly as the contract says', () => {
    for (const [operation, id, path] of [
      [APPOINTMENT_LIST_OPERATION, 'apt.appointment-list', '/appointments'],
      [APPOINTMENT_DETAIL_OPERATION, 'apt.appointment-detail', '/appointments/{appointmentId}'],
    ] as const) {
      expect(operation.id, id).toBe(id);
      expect(operation.path, id).toBe(path);
      expect(operation.method, id).toBe('GET');
      expect(operation.permissions, id).toEqual(['apt.appointment.read']);
      expect(operation.scope, id).toBe('branch');
      expect(operation.auditClass, id).toBe('none');
      expect(operation.rateLimitPolicy, id).toBe('expensive-read');
      expect(operation.idempotent ?? false, id).toBe(false);
      expect(operation.versionGuarded ?? false, id).toBe(false);
    }
  });
});

describe('authorization', () => {
  it('answers 401 with no session and 403 without apt.appointment.read (denial)', async () => {
    authAs(SUBJ_FULL);
    const id = await book({ from: '2026-09-01T09:00:00Z', to: '2026-09-01T10:00:00Z' });

    __resetAuthenticatorForTests();
    expect((await detail(id)).status).toBe(401);

    authAs(SUBJECT_UNPERMITTED);
    expect((await detail(id)).status).toBe(403);

    // The sharper case: this principal holds BOTH write codes — it may book,
    // reschedule, cancel — and is refused purely because the read code is
    // missing. Reads are not implied by writes.
    authAs(SUBJ_NO_READ);
    const denied = await detail(id);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as Detail).code).toBe('ERR-IAM-001');
    const deniedList = await list(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`);
    expect(deniedList.status).toBe(403);
  });

  it('answers the uniform 404 across other-tenant and never-existent ids (cross-tenant)', async () => {
    authAs(SUBJ_FULL);
    const id = await book({ from: '2026-09-02T09:00:00Z', to: '2026-09-02T10:00:00Z' });

    authAs(SUBJ_TENANT_B, TENANT_B);
    const foreign = await detail(id);
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as Detail).code).toBe('ERR-RES-001');

    authAs(SUBJ_FULL);
    const absent = await detail(crypto.randomUUID());
    expect(absent.status).toBe(404);
    expect(((await absent.json()) as Detail).code).toBe('ERR-RES-001');
  });

  it('splits the isolation refusal: permission-elsewhere 403, and the list refuses the target (isolation)', async () => {
    authAs(SUBJ_FULL);
    const id = await book({ from: '2026-09-03T09:00:00Z', to: '2026-09-03T10:00:00Z' });

    // The elsewhere principal SEES the BRANCH_A1 row — the decoy grant puts A1
    // in `app.branch_ids` — but holds apt.appointment.read only in A2, so the
    // deferred authorizer refuses with 403 rather than RLS hiding it as 404.
    // RLS visibility is not authority (P1-18-A-01).
    authAs(SUBJ_ELSEWHERE);
    const denied = await detail(id);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as Detail).code).toBe('ERR-IAM-001');

    // The list names its branch, and the pre-handler target evaluation refuses
    // a branch the read grant does not cover.
    const deniedList = await list(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`);
    expect(deniedList.status).toBe(403);
  });

  it('requires companyId and branchId on the list, and rejects unknown parameters', async () => {
    authAs(SUBJ_FULL);
    expect((await list(`?branchId=${BRANCH_A1}`)).status).toBe(422);
    expect(
      (await list(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&tenantId=${TENANT_B}`)).status
    ).toBe(422);
    // An inverted range is a bad request, not an empty page.
    expect(
      (
        await list(
          `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}` +
            `&from=${encodeURIComponent('2026-09-09T10:00:00Z')}&to=${encodeURIComponent('2026-09-01T10:00:00Z')}`
        )
      ).status
    ).toBe(422);
  });
});

describe('the calendar (success)', () => {
  it('orders by the CONFIRMED window falling back to requested, and the range filter follows it', async () => {
    authAs(SUBJ_FULL);
    // Booked for the 10th, then confirmed for the 20th: the calendar must show
    // it on the 20th. A second appointment requested on the 15th, never
    // confirmed, stays on the 15th.
    const moved = await book({ from: '2026-10-10T09:00:00Z', to: '2026-10-10T10:00:00Z' });
    const fixed = await book({ from: '2026-10-15T09:00:00Z', to: '2026-10-15T10:00:00Z' });
    const confirm = await reschedule(moved, '1', {
      confirmedFrom: '2026-10-20T09:00:00Z',
      confirmedTo: '2026-10-20T10:00:00Z',
    });
    expect(confirm.status).toBe(200);

    const october = await list(
      `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}` +
        `&from=${encodeURIComponent('2026-10-01T00:00:00Z')}&to=${encodeURIComponent('2026-10-31T23:59:59Z')}&limit=100`
    );
    expect(october.status).toBe(200);
    const page = (await october.json()) as PageBody;
    expect(Object.keys(page).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
    const ids = (page.items ?? []).map((item) => item.id);
    // Soonest effective start first: the 15th (requested) before the 20th
    // (confirmed) — even though the moved one was requested five days earlier.
    expect(ids.indexOf(fixed)).toBeLessThan(ids.indexOf(moved));

    // A window over the ORIGINAL requested day must NOT contain the moved
    // appointment any more: its effective window is the confirmed one.
    const tenth = await list(
      `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}` +
        `&from=${encodeURIComponent('2026-10-10T00:00:00Z')}&to=${encodeURIComponent('2026-10-10T23:59:59Z')}&limit=100`
    );
    const tenthIds = (((await tenth.json()) as PageBody).items ?? []).map((item) => item.id);
    expect(tenthIds).not.toContain(moved);

    // And the confirmed day contains it, carrying the per-row recordVersion the
    // guarded commands are addressed with.
    const twentieth = await list(
      `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}` +
        `&from=${encodeURIComponent('2026-10-20T00:00:00Z')}&to=${encodeURIComponent('2026-10-20T23:59:59Z')}&limit=100`
    );
    const rows = ((await twentieth.json()) as PageBody).items ?? [];
    const found = rows.find((item) => item.id === moved);
    expect(found).toBeDefined();
    expect(typeof found?.recordVersion).toBe('number');
    expect(found?.lifecycleStatus).toBe('confirmed');
  });

  it('answers an empty page — not 404 — for tenant B own empty branch', async () => {
    authAs(SUBJ_TENANT_B, TENANT_B);
    const response = await list(`?companyId=${COMPANY_B1}&branchId=${BRANCH_B1}&limit=10`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageBody;
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});

describe('the detail and the If-Match round trip (success)', () => {
  it('publishes the ETag that drives a guarded write with NO prior write in the session', async () => {
    authAs(SUBJ_FULL);
    const id = await book({ from: '2026-11-05T09:00:00Z', to: '2026-11-05T10:00:00Z' });

    const response = await detail(id);
    expect(response.status).toBe(200);
    const etag = response.headers.get('etag');
    expect(etag).toBe('"1"');
    const body = (await response.json()) as Detail;
    expect(body.recordVersion).toBe(1);
    expect(body.lifecycleStatus).toBe('requested');
    // Ids never stand alone: the labels a screen shows are resolved here.
    expect(body.appointmentTypeName).toBe('General Service');
    expect(body.requesterDisplayName).toBe('Calendar Requester A');

    // THE POINT OF THE WHOLE TASK: the published header value, fed back
    // verbatim as If-Match, moves the appointment. No write preceded this read
    // in the session.
    const confirmed = await reschedule(id, etag ?? '', {
      confirmedFrom: '2026-11-06T09:00:00Z',
      confirmedTo: '2026-11-06T10:00:00Z',
    });
    expect(confirmed.status).toBe(200);

    // And the wrong version is refused.
    const stale = await reschedule(id, '"1"', {
      confirmedFrom: '2026-11-07T09:00:00Z',
      confirmedTo: '2026-11-07T10:00:00Z',
    });
    expect(stale.status).toBe(409);
  });

  it('answers 422 — not 500 — for a malformed path id', async () => {
    authAs(SUBJ_FULL);
    const response = await detail('not-a-uuid');
    expect(response.status).toBe(422);
  });
});
