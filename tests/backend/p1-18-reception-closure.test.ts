/**
 * Reception closure — close-without-work and refuse, end to end (P1-27
 * remediation executed by P1-18, `P1-27-INT-014`).
 *
 * Drives the real `POST /receptions/{receptionId}/close-without-work` and
 * `POST /receptions/{receptionId}/refuse` handlers through the fixed pipeline
 * on the least-privilege `app_runtime` role. Before these commands existed the
 * two terminal states were unreachable — only approve and convert called
 * `setStatus` — so an abandoned visit occupied its vehicle FOREVER through
 * `uq_reception_visits_open_vehicle`: the INT-013 sibling. The decisive test
 * here is therefore not the status change but the RELEASE — after closing, a
 * second check-in of the SAME vehicle succeeds, because the partial index
 * predicate names only `opened/inspecting/authorized/converted`.
 *
 * The mandatory reason is proven to land in the append-only status ledger: the
 * emit trigger reads the `app.status_reason` GUC, so a reason validated in
 * TypeScript but never published to the transaction would leave the ledger row
 * with `reason = NULL` and every assertion on it red.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rec.reception-close-without-work: route service authorization success denial cross-tenant isolation audit stale-version idempotency
 *   rec.reception-refuse: route service authorization success denial cross-tenant isolation audit stale-version idempotency
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
import {
  POST as CLOSE_WITHOUT_WORK,
  RECEPTION_CLOSE_WITHOUT_WORK_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/close-without-work/route';
import {
  POST as REFUSE,
  RECEPTION_REFUSE_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/refuse/route';

/** Tenant B's own company and branch — a real scope, not a fabricated id. */
const COMPANY_B1 = 'c1140000-0000-4000-8000-0000000000b1';
const BRANCH_B1 = 'c1140000-0000-4000-8000-0000000000b2';
/** A second branch of the same company, for the scoped-grant isolation case. */
const BRANCH_A2 = 'c1140000-0000-4000-8000-0000000000a2';

const ROLE_CLOSER = 'c1140000-0000-4000-8000-000000000101';
const USER_CLOSER = 'c1140000-0000-4000-8000-000000000102';
const SUBJ_CLOSER = 'fx_p1_18_rec_closer';

/** Holds every other reception permission — but NOT `rec.reception.close`. */
const ROLE_NO_CLOSE = 'c1140000-0000-4000-8000-000000000201';
const USER_NO_CLOSE = 'c1140000-0000-4000-8000-000000000202';
const SUBJ_NO_CLOSE = 'fx_p1_18_rec_no_close';

/** Same permissions as the closer, but the grant is narrowed to BRANCH_A2. */
const ROLE_SCOPED = 'c1140000-0000-4000-8000-000000000301';
const USER_SCOPED = 'c1140000-0000-4000-8000-000000000302';
const SUBJ_SCOPED = 'fx_p1_18_rec_close_scoped';
const GRANT_SCOPED = 'c1140000-0000-4000-8000-000000000303';

const ROLE_TENANT_B = 'c1140000-0000-4000-8000-000000000401';
const USER_TENANT_B = 'c1140000-0000-4000-8000-000000000402';
const SUBJ_TENANT_B = 'fx_p1_18_rec_close_tenant_b';

const PARTNER_A = 'c1140000-0000-4000-8000-0000000000c1';

const R = 'http://localhost/api/v1/receptions';

const CLOSER_PERMISSIONS = ['rec.reception.manage', 'rec.reception.close'];

interface Body {
  readonly receptionVisitId?: string;
  readonly receptionStatus?: string;
  readonly recordVersion?: number;
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

function createReception(body: unknown, key = crypto.randomUUID()): Promise<Response> {
  return CREATE_RECEPTION(
    new Request(R, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );
}

type Command = (
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
) => Promise<Response>;

function drive(
  handler: Command,
  receptionId: string,
  segment: string,
  payload: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': options.key ?? crypto.randomUUID(),
  };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return handler(
    new Request(`${R}/${receptionId}/${segment}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

const close = (
  id: string,
  reason: string,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> => drive(CLOSE_WITHOUT_WORK, id, 'close-without-work', { reason }, options);

const refuse = (
  id: string,
  reason: string,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> => drive(REFUSE, id, 'refuse', { reason }, options);

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
  const vin = `P118RECCLOSE${String(vehicleCounter).padStart(5, '0')}`;
  return asAdminTx(tenantId, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,'ice','active',$3) RETURNING id`,
      [tenantId, vin, USER_A]
    );
    return inserted.rows[0]?.id ?? '';
  });
}

/** Opens a reception through the real check-in route. Leaves it `opened`, RV 1. */
async function openReception(vehicleId?: string): Promise<{ id: string; vehicleId: string }> {
  const vehicle = vehicleId ?? (await newVehicle());
  const response = await createReception({
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    vehicleId: vehicle,
    receivingEmployeeId: USER_CLOSER,
    serviceRequesterPartnerId: PARTNER_A,
    origin: { kind: 'walk_in' },
  });
  expect(response.status).toBe(201);
  return { id: ((await response.json()) as Body).receptionVisitId ?? '', vehicleId: vehicle };
}

async function scalar(sql: string, values: readonly unknown[]): Promise<string | null> {
  const result = await admin.query<{ value: string | null }>(sql, [...values]);
  return result.rows[0]?.value ?? null;
}

const statusOf = (receptionId: string): Promise<string | null> =>
  scalar(`SELECT reception_status AS value FROM rec.reception_visits WHERE id = $1`, [receptionId]);

async function ledgerReason(receptionId: string, toState: string): Promise<string | null> {
  return scalar(
    `SELECT reason AS value FROM rec.reception_status_history
      WHERE reception_visit_id = $1 AND to_state = $2
      ORDER BY seq DESC LIMIT 1`,
    [receptionId, toState]
  );
}

async function auditCount(receptionId: string, action: string): Promise<number> {
  const raw = await scalar(
    `SELECT count(*)::text AS value FROM iam.audit_records
      WHERE action = $2 AND entity_id = $1`,
    [receptionId, action]
  );
  return Number(raw ?? '0');
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
     VALUES ($1,$2,$3,$4,$4||'@example.test','Closure Principal','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 closure principal',$4) ON CONFLICT (id) DO NOTHING`,
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
            ('rec.reception.close','rec','Close a reception visit without work or refuse it','high',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_a2_close','Fixture Branch A2 Close','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_b1_close','Fixture Company B1 Close','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b1_close','Fixture Branch B1 Close','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A]
  );

  await seedPrincipal(TENANT_A, ROLE_CLOSER, USER_CLOSER, SUBJ_CLOSER, CLOSER_PERMISSIONS);
  await seedPrincipal(TENANT_A, ROLE_NO_CLOSE, USER_NO_CLOSE, SUBJ_NO_CLOSE, [
    'rec.reception.manage',
  ]);
  await seedPrincipal(TENANT_A, ROLE_SCOPED, USER_SCOPED, SUBJ_SCOPED, CLOSER_PERMISSIONS);
  await seedPrincipal(TENANT_B, ROLE_TENANT_B, USER_TENANT_B, SUBJ_TENANT_B, CLOSER_PERMISSIONS);

  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4), ($1,$5,$6,'unrestricted',$4,$4)`,
    [TENANT_A, USER_CLOSER, ROLE_CLOSER, USER_A, USER_NO_CLOSE, ROLE_NO_CLOSE]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_B, USER_TENANT_B, ROLE_TENANT_B, USER_A]
  );
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

  await asAdminTx(TENANT_A, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','Closure Requester A','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A, TENANT_A, USER_A]
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

describe('registration', () => {
  it('registers both commands exactly as the contract says', () => {
    const declared = [
      [
        RECEPTION_CLOSE_WITHOUT_WORK_OPERATION,
        'rec.reception-close-without-work',
        '/receptions/{receptionId}/close-without-work',
        'rec.reception.closed_without_work',
      ],
      [
        RECEPTION_REFUSE_OPERATION,
        'rec.reception-refuse',
        '/receptions/{receptionId}/refuse',
        'rec.reception.refused',
      ],
    ] as const;
    for (const [operation, id, path, auditAction] of declared) {
      expect(operation.id, id).toBe(id);
      expect(operation.path, id).toBe(path);
      expect(operation.method, id).toBe('POST');
      expect(operation.permissions, id).toEqual(['rec.reception.close']);
      expect(operation.scope, id).toBe('branch');
      expect(operation.auditClass, id).toBe('privileged');
      expect(operation.auditAction, id).toBe(auditAction);
      expect(operation.idempotent, id).toBe(true);
      expect(operation.versionGuarded, id).toBe(true);
      expect(operation.rateLimitPolicy, id).toBe('standard-command');
    }
  });
});

describe('authorization', () => {
  it('answers 401 with no session, 403 without rec.reception.close, moving nothing', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();

    __resetAuthenticatorForTests();
    expect((await close(id, 'nobody came back', { version: 1 })).status).toBe(401);

    authAs(SUBJECT_UNPERMITTED);
    expect((await close(id, 'nobody came back', { version: 1 })).status).toBe(403);

    // The sharper case: this principal may OPEN a visit (rec.reception.manage)
    // and is refused purely because `rec.reception.close` is missing — dropping
    // that one code from the declaration would turn this 403 into a 200.
    authAs(SUBJ_NO_CLOSE);
    const denied = await refuse(id, 'wrong workshop', { version: 1 });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as Body).code).toBe('ERR-IAM-001');

    expect(await statusOf(id)).toBe('opened');
  });

  it('answers the uniform 404 for another tenant, and for a never-existent id', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();

    // A real visit, addressed with a real id, from the wrong tenant: the same
    // ERR-RES-001 as an id that never existed, so possession of an id proves
    // nothing (cross-tenant).
    authAs(SUBJ_TENANT_B, TENANT_B);
    const foreign = await close(id, 'not ours', { version: 1 });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as Body).code).toBe('ERR-RES-001');

    authAs(SUBJ_CLOSER);
    const absent = await refuse(crypto.randomUUID(), 'ghost', { version: 1 });
    expect(absent.status).toBe(404);
    expect(((await absent.json()) as Body).code).toBe('ERR-RES-001');

    expect(await statusOf(id)).toBe('opened');
  });

  it('refuses a caller whose close grant is scoped to another branch (isolation)', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();

    // The scoped principal holds rec.reception.close — in BRANCH_A2 only. The
    // visit is in BRANCH_A1 and outside every branch the grant covers, so RLS
    // hides the row and the answer is the uniform 404: visibility and authority
    // refuse together, and neither discloses the visit's existence.
    authAs(SUBJ_SCOPED);
    const denied = await close(id, 'not my branch', { version: 1 });
    expect(denied.status).toBe(404);
    expect(await statusOf(id)).toBe('opened');
  });
});

describe('the If-Match contract', () => {
  it('refuses a missing If-Match with 428 and a stale one with 409', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();

    const missing = await close(id, 'abandoned', { version: null });
    expect(missing.status).toBe(428);
    expect(((await missing.json()) as Body).code).toBe('ERR-CON-002');

    const stale = await close(id, 'abandoned', { version: 7 });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Body).code).toBe('ERR-CON-001');

    expect(await statusOf(id)).toBe('opened');
  });
});

describe('rec.reception-close-without-work', () => {
  it('closes an opened visit, carries the reason into the ledger, audits once', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();

    const response = await close(id, 'customer declined the estimate', { version: 1 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.receptionStatus).toBe('closed_without_work');
    expect(body.recordVersion).toBe(2);
    expect(response.headers.get('etag')).toBe('"2"');

    expect(await statusOf(id)).toBe('closed_without_work');
    // The reason travelled through the GUC into the append-only ledger row.
    expect(await ledgerReason(id, 'closed_without_work')).toBe('customer declined the estimate');
    expect(await auditCount(id, 'rec.reception.closed_without_work')).toBe(1);
  });

  it('releases uq_reception_visits_open_vehicle: the SAME vehicle can be received again', async () => {
    // The point of the whole command (P1-27-INT-014, the INT-013 sibling). The
    // partial unique index names only opened/inspecting/authorized/converted,
    // so a closed visit stops occupying its vehicle — asserted end to end by a
    // second real check-in rather than by reading the predicate.
    authAs(SUBJ_CLOSER);
    const first = await openReception();
    expect((await close(first.id, 'no show', { version: 1 })).status).toBe(200);

    const second = await createReception({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: first.vehicleId,
      receivingEmployeeId: USER_CLOSER,
      serviceRequesterPartnerId: PARTNER_A,
      origin: { kind: 'walk_in' },
    });
    expect(second.status).toBe(201);
    const reopened = ((await second.json()) as Body).receptionVisitId ?? '';
    expect(reopened).not.toBe(first.id);
    expect(await statusOf(reopened)).toBe('opened');
  });

  it('replays idempotently with the SAME key and refuses a NEW attempt on the closed visit', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();
    const key = crypto.randomUUID();

    const first = await close(id, 'abandoned', { version: 1, key });
    expect(first.status).toBe(200);

    // Same key, same payload: the stored response replays as 200 with no ETag,
    // and the visit is not written twice — one ledger row, one audit record.
    const replay = await close(id, 'abandoned', { version: 1, key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('etag')).toBeNull();
    expect(((await replay.json()) as Body).receptionStatus).toBe('closed_without_work');
    expect(await auditCount(id, 'rec.reception.closed_without_work')).toBe(1);

    // A NEW key against the now-terminal visit is a real conflict, not a replay.
    const again = await close(id, 'abandoned', { version: 2 });
    expect(again.status).toBe(409);
    expect(((await again.json()) as Body).code).toBe('ERR-TRN-001');
  });

  it('rejects a blank or over-long reason before anything runs', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();
    expect((await close(id, '   ', { version: 1 })).status).toBe(422);
    expect((await close(id, 'x'.repeat(501), { version: 1 })).status).toBe(422);
    expect(await statusOf(id)).toBe('opened');
  });
});

describe('rec.reception-refuse', () => {
  it('refuses an inspecting visit, carries the reason, audits its own action', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();
    // Walk the visit to `inspecting` admin-side: the graph gives inspecting an
    // edge into refused, and the command must take it, not just the opened one.
    await asAdminTx(TENANT_A, async (client) => {
      await client.query(
        `UPDATE rec.reception_visits SET reception_status='inspecting' WHERE id=$1`,
        [id]
      );
    });

    const response = await refuse(id, 'vehicle presented with undisclosed damage', {
      version: 2,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.receptionStatus).toBe('refused');
    expect(body.recordVersion).toBe(3);

    expect(await statusOf(id)).toBe('refused');
    expect(await ledgerReason(id, 'refused')).toBe('vehicle presented with undisclosed damage');
    expect(await auditCount(id, 'rec.reception.refused')).toBe(1);
    expect(await auditCount(id, 'rec.reception.closed_without_work')).toBe(0);
  });

  it('releases the vehicle exactly as close does', async () => {
    authAs(SUBJ_CLOSER);
    const first = await openReception();
    expect((await refuse(first.id, 'refused at the desk', { version: 1 })).status).toBe(200);

    const second = await createReception({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      vehicleId: first.vehicleId,
      receivingEmployeeId: USER_CLOSER,
      serviceRequesterPartnerId: PARTNER_A,
      origin: { kind: 'walk_in' },
    });
    expect(second.status).toBe(201);
  });

  it('is refused on a terminal visit with the state named (denial)', async () => {
    authAs(SUBJ_CLOSER);
    const { id } = await openReception();
    expect((await close(id, 'first closure', { version: 1 })).status).toBe(200);

    const terminal = await refuse(id, 'second thoughts', { version: 2 });
    expect(terminal.status).toBe(409);
    expect(((await terminal.json()) as Body).code).toBe('ERR-TRN-001');
    expect(await statusOf(id)).toBe('closed_without_work');
  });
});
