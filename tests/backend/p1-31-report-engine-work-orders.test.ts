/**
 * The report engine, slice 1 of 4 (Phase 1-31, prerequisite P-11).
 *
 * P1-23 shipped a report catalogue that could not run anything and said so:
 * `executable` was the literal `false`, because the frozen `rpt` schema binds no
 * data source to a report code. The binding this slice adds does not come from a
 * column — it comes from the Owner requirement that a report code binds to a
 * **code-registered dataset** (OWR-2026-09-06-A-12). `REPORT_DATASETS` is that
 * registry, `rpt.report-run` is the operation, and `work_orders_by_status` is the
 * first and only dataset in it.
 *
 * ## The two permissions are proved BEHAVIOURALLY, in both directions
 *
 * The route declares `rpt.report.read`; the service then checks the dataset's own
 * `wo.work_order.read` against the same company and branch. Asserting that a
 * declaration names two strings proves only that somebody typed them, so two
 * principals decide it and each is the counterfactual of the other:
 *
 *   * `RPT_ONLY` holds `rpt.report.read` and nothing else — refused with
 *     `ERR-IAM-001` naming `wo.work_order.read`, by the SERVICE.
 *   * `WO_ONLY` holds `wo.work_order.read` and nothing else — refused with
 *     `ERR-IAM-001` naming `rpt.report.read`, by the ROUTE.
 *
 * Collapse the two codes into one and both cases go red, in opposite directions.
 *
 * ## Why the fixtures INSERT work orders instead of converting receptions
 *
 * `opened_at` defaults to `now()` and `tg_work_orders_immutable` freezes it, so a
 * work order created through the authoritative conversion route cannot be given a
 * chosen instant afterwards — and the half-open period boundary is a claim about
 * chosen instants, one second apart, in a named zone. Each fixture order is
 * therefore INSERTed against a real `rec.accept_check_in` visit — the same
 * preconditions `wo.guard_work_order_refs` demands on insert — with an explicit
 * `opened_at`, and every STATE it then takes is taken through the real transition
 * route, because `state` is not immutable and the graph is what decides it.
 *
 * ## Why the period is in the future
 *
 * `WorkOrderSummary.customer` is a DATED projection resolved at the order's
 * `opened_at` (PRE-P1-29 BR-05). A back-dated fixture order therefore reports
 * `customer: null` — correctly, because the party role did not yet exist at that
 * instant — and the customer column could not be exercised at all. Dating the
 * period forward is the only arrangement that makes the projection answer, and it
 * keeps the suite deterministic: nothing here depends on what day it is run.
 *
 * ## Operations exercised
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rpt.report-run: route service authorization success denial cross-tenant isolation pagination
 *   rpt.report-catalogue: route service success cross-tenant
 *   rpt.report-read: route service success denial cross-tenant
 *
 * No `audit` flag is declared: all three register `auditClass: 'none'`, so
 * claiming one would claim a record they do not write. No `idempotency` and no
 * `stale-version`: they are GETs.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_TENANT_B,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  FULL,
  advance,
  authAs,
  establishP1_19Fixtures,
  seedAuthorizedVisit,
  type Principal,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermission } from '@/server/auth/authorization';
import { reportingModule, REPORT_DATASET_CODES } from '@/modules/reporting';
import { GET as RUN } from '@/app/api/v1/reports/[reportCode]/rows/route';
import { GET as READ_DEFINITION } from '@/app/api/v1/reports/[reportCode]/route';

let admin: Pool;
let runtime: Pool;

// ---- Fixture organisation ---------------------------------------------------

/** A second company in tenant A, so the report's branch is this suite's alone. */
const COMPANY_R = 'f1310000-0000-4000-8000-0000000000c1';
/** The reported branch. Its zone is the only non-UTC row `shared.timezones` seeds. */
const BRANCH_R1 = 'f1310000-0000-4000-8000-0000000000b1';
/** A sibling branch, for the containment case. Same company, same timezone. */
const BRANCH_R2 = 'f1310000-0000-4000-8000-0000000000b2';
/**
 * `Asia/Amman` — chosen because `supabase/seeds/01_reference_data.sql` seeds exactly
 * two zones, `UTC` and this one, and `fk_branches_timezone` refuses anything else.
 * A non-UTC branch is the whole point: with a UTC branch this suite could not tell a
 * BRANCH reading of a calendar day from a server reading of one, and a case that
 * cannot fail for the reason it names is not a case.
 */
const BRANCH_TIMEZONE = 'Asia/Amman';

const REPORT_CODE = 'work_orders_by_status';
/** A code the tenant has published a configuration for and the engine does not implement. */
const UNREGISTERED_CODE = 'p1_31_unimplemented';

const REPORT_READ = 'rpt.report.read';
const WORK_ORDER_READ = 'wo.work_order.read';
/** Widens RLS reach without widening authority. Deliberately not a work-order code. */
const REACH_ONLY = 'org.tenant.read';

// ---- The period, and the five instants that decide it -----------------------

/** First day INCLUDED, in `BRANCH_TIMEZONE`. */
const FROM = '2027-03-02';
/** First day EXCLUDED — the day after the last one reported. */
const TO = '2027-03-04';

/*
 * The five instants are RESOLVED FROM THE DATABASE rather than written down here.
 *
 * The zone offset is a property of the deployed tzdata, not of this file: Jordan
 * abolished its summer clock in 2022, and a Postgres carrying older tzdata would
 * place these March days an hour away. Hard-coding the UTC instants would make the
 * suite assert the tzdata rather than the query, and would fail it on a database
 * that is correct. So the bounds are read back with the same expression the
 * repository uses, and the fixtures are placed relative to them.
 *
 * `periodOpens` is local midnight on FROM; `periodCloses` is local midnight on TO,
 * which is the first EXCLUDED instant.
 */
let periodOpens = '';
let periodCloses = '';
/** One second before the period opens. */
let beforePeriod = '';
/** Local 12:00 on the first included day. */
let middleInstant = '';
/** Local 23:30 on the last included day — the late case. */
let lateInstant = '';

const shift = (iso: string, milliseconds: number): string =>
  new Date(new Date(iso).getTime() + milliseconds).toISOString();

// ---- Principals -------------------------------------------------------------

/** Tenant A, unrestricted, holding BOTH codes. */
const RPT_FULL: Principal = {
  roleId: 'f1310000-0000-4000-8000-000000000101',
  userId: 'f1310000-0000-4000-8000-000000000102',
  subject: 'fx_p1_31_rpt_full',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, WORK_ORDER_READ],
};

/** May run reports; may not read work orders. Refused by the SERVICE. */
const RPT_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-000000000111',
  userId: 'f1310000-0000-4000-8000-000000000112',
  subject: 'fx_p1_31_rpt_only',
  tenantId: TENANT_A,
  permissions: [REPORT_READ],
};

/** May read work orders; may not run reports. Refused by the ROUTE. */
const WO_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-000000000121',
  userId: 'f1310000-0000-4000-8000-000000000122',
  subject: 'fx_p1_31_wo_only',
  tenantId: TENANT_A,
  permissions: [WORK_ORDER_READ],
};

/**
 * Both codes, granted ONLY in `BRANCH_R2`, with `BRANCH_R1` inside its
 * permission-blind `iam.allowed_branch_ids()` union through the reach role below.
 *
 * The decisive isolation principal: `BRANCH_R1`'s rows ARE visible to RLS for this
 * caller, so the only thing that can refuse a `BRANCH_R1` report is the scoped
 * permission evaluation (P1-18-A-01).
 */
const RPT_SCOPED_R2: Principal = {
  roleId: 'f1310000-0000-4000-8000-000000000131',
  userId: 'f1310000-0000-4000-8000-000000000132',
  subject: 'fx_p1_31_rpt_scoped_r2',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, WORK_ORDER_READ],
  scope: { companyId: COMPANY_R, branchId: BRANCH_R2 },
  grantId: 'f1310000-0000-4000-8000-0000000001f1',
};

/** Tenant B, unrestricted in its OWN tenant. A refusal is tenancy, not authority. */
const RPT_TENANT_B: Principal = {
  roleId: 'f1310000-0000-4000-8000-000000000141',
  userId: 'f1310000-0000-4000-8000-000000000142',
  subject: 'fx_p1_31_rpt_tenant_b',
  tenantId: TENANT_B,
  permissions: [REPORT_READ, WORK_ORDER_READ],
};

const PRINCIPALS: readonly Principal[] = [RPT_FULL, RPT_ONLY, WO_ONLY, RPT_SCOPED_R2, RPT_TENANT_B];

const REACH_ROLE = 'f1310000-0000-4000-8000-000000000151';
const REACH_GRANT = 'f1310000-0000-4000-8000-000000000152';

// ---- Response shapes --------------------------------------------------------

interface Cell {
  readonly key: string;
  readonly label: string | null;
  readonly value: string | null;
}
interface Column {
  readonly key: string;
  readonly kind: string;
  readonly drillThrough: string | null;
}
interface StateCount {
  readonly stateCode: string;
  readonly stateName: string;
  readonly count: number;
}
interface RunBody {
  readonly reportCode: string;
  readonly titleKey: string;
  readonly scope: string;
  readonly period: { readonly from: string; readonly to: string; readonly timezone: string };
  readonly generatedAt: string;
  readonly freshness: string;
  readonly columns: readonly Column[];
  readonly countsByState: readonly StateCount[];
  readonly rows: {
    readonly items: readonly { readonly cells: readonly Cell[] }[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}
interface Problem {
  readonly code: string;
  readonly requiredPermissions?: readonly string[];
}

function run(query: Record<string, string>, reportCode = REPORT_CODE): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/reports/${reportCode}/rows`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return RUN(new Request(url), { params: Promise.resolve({ reportCode }) });
}

/** The default report: this suite's branch, over the whole period. */
function report(extra: Record<string, string> = {}): Promise<Response> {
  return run({ companyId: COMPANY_R, branchId: BRANCH_R1, from: FROM, to: TO, ...extra });
}

const body = async (response: Response): Promise<RunBody> => (await response.json()) as RunBody;

/** The `value` of one named cell of one row. */
function cellValue(row: { readonly cells: readonly Cell[] }, key: string): string | null {
  return row.cells.find((entry) => entry.key === key)?.value ?? null;
}
function cellLabel(row: { readonly cells: readonly Cell[] }, key: string): string | null {
  return row.cells.find((entry) => entry.key === key)?.label ?? null;
}
function countOf(view: RunBody, stateCode: string): number {
  return view.countsByState.find((entry) => entry.stateCode === stateCode)?.count ?? -1;
}

// ---- Fixture construction ---------------------------------------------------

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [
      principal.userId,
      principal.tenantId,
      IDENTITY_PROVIDER,
      principal.subject,
      principal.tenantId === TENANT_B ? USER_TENANT_B : USER_A,
    ]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }
  if (principal.scope === undefined) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    return;
  }
  // A scoped grant must carry at least one scope, enforced by a DEFERRABLE
  // constraint trigger, so the grant and the scope land in ONE transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [
        principal.tenantId,
        principal.grantId,
        principal.scope.companyId,
        principal.scope.branchId,
        USER_A,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A work order in `BRANCH_R1` (unless told otherwise) opened at a CHOSEN instant.
 *
 * The visit is real — `rec.accept_check_in` writes the service-requester role,
 * the accepted custody event and the first status-history row — because
 * `wo.guard_work_order_refs` checks all three on insert and a fixture that
 * satisfied the foreign keys without satisfying the reception contract would be
 * faking past the guard this platform relies on.
 */
async function seedWorkOrder(input: {
  readonly openedAt: string;
  readonly branchId?: string;
}): Promise<{ workOrderId: string; vehicleId: string; partnerId: string }> {
  const branchId = input.branchId ?? BRANCH_R1;
  const visit = await seedAuthorizedVisit({ companyId: COMPANY_R, branchId });
  const inserted = await admin.query<{ id: string }>(
    `INSERT INTO wo.work_orders
       (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, opened_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7) RETURNING id`,
    [TENANT_A, COMPANY_R, branchId, visit.visitId, visit.vehicleId, input.openedAt, USER_A]
  );
  const partner = await admin.query<{ partner_id: string }>(
    `SELECT partner_id FROM rec.reception_party_roles
      WHERE reception_visit_id = $1 AND relationship_role = 'service_requester'
      ORDER BY valid_from LIMIT 1`,
    [visit.visitId]
  );
  return {
    workOrderId: inserted.rows[0]?.id ?? '',
    vehicleId: visit.vehicleId,
    partnerId: partner.rows[0]?.partner_id ?? '',
  };
}

async function seedReportConfiguration(input: {
  readonly code: string;
  readonly scopeLevel: string;
  readonly id?: string;
  readonly status?: 'draft' | 'published' | 'archived';
  readonly parameterSchema?: unknown;
}): Promise<void> {
  const id = input.id ?? randomUUID();
  await admin.query(
    `INSERT INTO rpt.report_configurations
       (id, tenant_id, report_code, name, scope_level, export_permission_code,
        owner_user_id, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'rpt.export',$6,$7,$6)`,
    [
      id,
      TENANT_A,
      input.code,
      `Configured ${input.code}`,
      input.scopeLevel,
      USER_A,
      input.status ?? 'published',
    ]
  );
  await admin.query(
    `INSERT INTO rpt.report_configuration_versions
       (tenant_id, report_configuration_id, version_number, parameter_schema,
        status, published_at, created_by)
     VALUES ($1,$2,1,$3::jsonb,'published',now(),$4)`,
    [
      TENANT_A,
      id,
      JSON.stringify(input.parameterSchema ?? { filters: { branchId: { type: 'uuid' } } }),
      USER_A,
    ]
  );
}

/** Each case owns a newly generated configuration, never an existing fixture. */
async function withExplicitReportConfiguration(
  input: {
    readonly status?: 'draft' | 'published' | 'archived';
    readonly parameterSchema: unknown;
  },
  verify: (configurationId: string) => Promise<void>
): Promise<void> {
  const id = randomUUID();
  try {
    await seedReportConfiguration({ id, code: REPORT_CODE, scopeLevel: 'branch', ...input });
    await verify(id);
  } finally {
    // Retire only the header this invocation created. The ordinary suite-owned
    // teardown handles its rows later; no pre-existing fixture is deleted here.
    await admin.query(
      `UPDATE rpt.report_configurations SET deleted_at = now(), deleted_by = $3
        WHERE tenant_id = $1 AND id = $2 AND created_by = $3`,
      [TENANT_A, id, USER_A]
    );
  }
}

function readReportDefinition(): Promise<Response> {
  return READ_DEFINITION(new Request(`http://localhost/api/v1/reports/${REPORT_CODE}`), {
    params: Promise.resolve({ reportCode: REPORT_CODE }),
  });
}

let firstOrder = '';
let middleOrder = '';
let lateOrder = '';
let excludedBefore = '';
let excludedAfter = '';
let otherBranchOrder = '';
let middleVehicleId = '';
let middlePartnerId = '';

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);

  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_p1_31_reports','P1-31 Reporting Company','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_R, TENANT_A, USER_A]
  );
  for (const [id, code, name] of [
    [BRANCH_R1, 'fx_p1_31_branch_r1', 'P1-31 Reported Branch'],
    [BRANCH_R2, 'fx_p1_31_branch_r2', 'P1-31 Sibling Branch'],
  ]) {
    await admin.query(
      `INSERT INTO org.branches
         (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, COMPANY_R, code, name, BRANCH_TIMEZONE, USER_A]
    );
  }

  for (const principal of PRINCIPALS) await seedPrincipal(principal);

  // The reach role: an unrelated permission scoped to BRANCH_R1, so R1 is inside
  // RPT_SCOPED_R2's permission-blind branch union without any report or
  // work-order authority there. Without it the isolation case would pass because
  // RLS returned nothing, which proves the wrong control.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_31_reach','P1-31 reach only',$3) ON CONFLICT (id) DO NOTHING`,
    [REACH_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, REACH_ROLE, USER_A, REACH_ONLY]
  );
  const reach = await admin.connect();
  try {
    await reach.query('BEGIN');
    await reach.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [REACH_GRANT, TENANT_A, RPT_SCOPED_R2.userId, REACH_ROLE, USER_A]
    );
    await reach.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [TENANT_A, REACH_GRANT, COMPANY_R, BRANCH_R1, USER_A]
    );
    await reach.query('COMMIT');
  } catch (error) {
    await reach.query('ROLLBACK');
    throw error;
  } finally {
    reach.release();
  }

  await seedReportConfiguration({ code: UNREGISTERED_CODE, scopeLevel: 'branch' });

  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);

  const bounds = await admin.query<{ opens: Date; closes: Date }>(
    `SELECT (($1::date)::timestamp AT TIME ZONE $3) AS opens,
            (($2::date)::timestamp AT TIME ZONE $3) AS closes`,
    [FROM, TO, BRANCH_TIMEZONE]
  );
  periodOpens = (bounds.rows[0]?.opens ?? new Date(0)).toISOString();
  periodCloses = (bounds.rows[0]?.closes ?? new Date(0)).toISOString();
  beforePeriod = shift(periodOpens, -1000);
  middleInstant = shift(periodOpens, 12 * 60 * 60 * 1000);
  lateInstant = shift(periodCloses, -30 * 60 * 1000);

  const before = await seedWorkOrder({ openedAt: beforePeriod });
  excludedBefore = before.workOrderId;
  const first = await seedWorkOrder({ openedAt: periodOpens });
  firstOrder = first.workOrderId;
  const middle = await seedWorkOrder({ openedAt: middleInstant });
  middleOrder = middle.workOrderId;
  middleVehicleId = middle.vehicleId;
  middlePartnerId = middle.partnerId;
  const late = await seedWorkOrder({ openedAt: lateInstant });
  lateOrder = late.workOrderId;
  const after = await seedWorkOrder({ openedAt: periodCloses });
  excludedAfter = after.workOrderId;
  const sibling = await seedWorkOrder({ openedAt: middleInstant, branchId: BRANCH_R2 });
  otherBranchOrder = sibling.workOrderId;

  // States taken through the REAL graph, because `state` is not immutable and the
  // transition guard is what decides which edges exist. `firstOrder` stays in
  // `draft`, the frozen column default reception leaves behind.
  await advance(middleOrder, [{ toState: 'open' }], FULL);
  await advance(lateOrder, [{ toState: 'open' }, { toState: 'in_progress' }], FULL);
  await advance(otherBranchOrder, [{ toState: 'open' }], FULL);
  __resetAuthenticatorForTests();
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await admin.query(
      `DELETE FROM rpt.report_configuration_versions WHERE tenant_id = ANY($1::uuid[])`,
      [[TENANT_A, TENANT_B]]
    );
    await admin.query(`DELETE FROM rpt.report_configurations WHERE tenant_id = ANY($1::uuid[])`, [
      [TENANT_A, TENANT_B],
    ]);
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('rpt.report-run — the rows and the counts', () => {
  it('returns the branch page and every column the dataset declares', async () => {
    authAs(RPT_FULL);
    const response = await report();
    expect(response.status).toBe(200);
    const view = await body(response);

    expect(view.reportCode).toBe(REPORT_CODE);
    expect(view.titleKey).toBe('reports.work_orders_by_status.title');
    expect(view.scope).toBe('branch');
    // `live` is a claim about where the rows came from: the operational tables,
    // inside this request's own transaction. There is no snapshot behind it.
    expect(view.freshness).toBe('live');
    expect(view.columns.map((column) => column.key)).toEqual([
      'workOrder',
      'branch',
      'customer',
      'vehicle',
      'openedAt',
      'state',
    ]);
    // Newest opened first — the work-order list's own ordering contract, reused
    // rather than reinvented, so a cursor means the same thing in both.
    expect(view.rows.items.map((row) => cellValue(row, 'workOrder'))).toEqual([
      lateOrder,
      middleOrder,
      firstOrder,
    ]);
  });

  it('counts every state over the whole selection, including the states with none', async () => {
    authAs(RPT_FULL);
    const view = await body(await report());

    // Three orders, three different states, one each.
    expect(countOf(view, 'draft')).toBe(1);
    expect(countOf(view, 'open')).toBe(1);
    expect(countOf(view, 'in_progress')).toBe(1);
    // Present at zero rather than absent. "No order is awaiting parts" is an
    // answer a manager needs to be able to read, and a `GROUP BY` alone cannot
    // give it — the state catalogue is what fills the gap.
    expect(countOf(view, 'awaiting_parts')).toBe(0);
    expect(countOf(view, 'closed')).toBe(0);
    expect(countOf(view, 'cancelled')).toBe(0);
    // The labels come from `wo.work_order_states.name` through the tenant/platform
    // override, never from a constant in the API.
    expect(view.countsByState.find((entry) => entry.stateCode === 'draft')?.stateName).toBe(
      'Draft'
    );
  });

  it('counts the SELECTION and not the page', async () => {
    authAs(RPT_FULL);
    // One row per page. A report that counted what it returned would answer 1, 0,
    // 0 here — the P1-28 round-two defect, a paged read answering for a set.
    const view = await body(await report({ limit: '1' }));
    expect(view.rows.items).toHaveLength(1);
    expect(view.rows.hasMore).toBe(true);
    expect(countOf(view, 'draft') + countOf(view, 'open') + countOf(view, 'in_progress')).toBe(3);
  });
});

describe('rpt.report-run — the period is half-open in the BRANCH timezone', () => {
  it('reports the zone the period was resolved in', async () => {
    authAs(RPT_FULL);
    const view = await body(await report());
    expect(view.period).toEqual({ from: FROM, to: TO, timezone: BRANCH_TIMEZONE });
  });

  it('is anchored to the branch zone and not to the server one', () => {
    // NON-VACUITY, and it comes first. Every boundary case below would pass just as
    // happily if the bounds had been resolved in UTC — unless the zone actually
    // moves them. Local midnight in the branch zone is NOT midnight UTC, so a UTC
    // reading of this period selects a different set of instants.
    expect(periodOpens).not.toBe(`${FROM}T00:00:00.000Z`);
    expect(periodCloses).not.toBe(`${TO}T00:00:00.000Z`);
    // And the period is two whole days, however the offset falls.
    expect(new Date(periodCloses).getTime() - new Date(periodOpens).getTime()).toBe(
      2 * 24 * 60 * 60 * 1000
    );
  });

  it('includes 23:30 on the last day and excludes 00:00 on the next one', async () => {
    authAs(RPT_FULL);
    const ids = (await body(await report())).rows.items.map((row) => cellValue(row, 'workOrder'));
    // Local 23:30 on the last included day: inside, by thirty minutes.
    expect(ids).toContain(lateOrder);
    // Local 00:00 on the EXCLUDED day. `to` is exclusive, so this instant is the
    // first one outside the period — and under a UTC reading of the same two
    // calendar days it would fall inside.
    expect(ids).not.toContain(excludedAfter);
    // One second before the period opens, excluded for that reason and no other.
    expect(ids).not.toContain(excludedBefore);
    // The first included instant — the boundary is inclusive at the bottom, which
    // is the other half of half-open.
    expect(ids).toContain(firstOrder);
  });

  it('refuses a period whose end is not after its start', async () => {
    authAs(RPT_FULL);
    // `to` is EXCLUSIVE, so `from === to` is an empty period rather than one day.
    // Answering it with an empty report would read as "no work orders", which is a
    // wrong answer rather than an empty one.
    const empty = await report({ to: FROM });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as Problem).code).toBe('ERR-VAL-001');
    authAs(RPT_FULL);
    expect((await report({ from: '2027-03-04', to: '2027-03-02' })).status).toBe(422);
  });
});

describe('rpt.report-run — the cells a client renders', () => {
  it('carries the drill-through target, the branch, the customer and the vehicle', async () => {
    authAs(RPT_FULL);
    const view = await body(await report());
    const row = view.rows.items.find((entry) => cellValue(entry, 'workOrder') === middleOrder);
    expect(row).toBeDefined();
    if (row === undefined) return;

    // The reference column names the route TEMPLATE; the cell carries the id that
    // fills it. The API does not build the client's URLs.
    const reference = view.columns.find((column) => column.key === 'workOrder');
    expect(reference?.kind).toBe('reference');
    expect(reference?.drillThrough).toBe('/work-orders/{id}');

    expect(cellValue(row, 'branch')).toBe(BRANCH_R1);
    expect(cellLabel(row, 'branch')).toBe('P1-31 Reported Branch');
    // The dated party projection, resolved at this order's `opened_at`.
    expect(cellValue(row, 'customer')).toBe(middlePartnerId);
    expect(cellLabel(row, 'customer')).not.toBeNull();
    expect(cellValue(row, 'vehicle')).toBe(middleVehicleId);
    expect(cellValue(row, 'openedAt')).toBe(middleInstant);
    // The state cell carries both halves: the catalogue code a client filters on
    // and the catalogue name a human reads.
    expect(cellValue(row, 'state')).toBe('open');
    expect(cellLabel(row, 'state')).toBe('Open');
  });
});

describe('rpt.report-run — authorization', () => {
  it('401 without an authenticator', async () => {
    __resetAuthenticatorForTests();
    expect((await report()).status).toBe(401);
  });

  it('refuses a caller holding wo.work_order.read but not rpt.report.read', async () => {
    authAs(WO_ONLY);
    const denied = await report();
    expect(denied.status).toBe(403);
    const problem = (await denied.json()) as Problem;
    expect(problem.code).toBe('ERR-IAM-001');
    // The ROUTE refused: the operation's own declared code is what is missing.
    expect(problem.requiredPermissions).toEqual(['rpt.report.read']);
  });

  it('refuses a caller holding rpt.report.read but not the dataset read code', async () => {
    authAs(RPT_ONLY);
    const denied = await report();
    expect(denied.status).toBe(403);
    const problem = (await denied.json()) as Problem;
    // The SERVICE refused, and it answers the same uniform failure the route does
    // — so a caller cannot tell the two checks apart and cannot use the difference
    // to discover which datasets exist.
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toEqual(['wo.work_order.read']);
  });

  it('refuses a branch the caller is not granted in, while RLS can still see it', async () => {
    authAs(RPT_SCOPED_R2);
    // Granted in R2 only, with R1 inside its permission-blind branch union. RLS
    // alone would return R1's rows; only the scoped evaluation refuses.
    const denied = await report();
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as Problem).code).toBe('ERR-IAM-001');

    authAs(RPT_SCOPED_R2);
    const allowed = await run({
      companyId: COMPANY_R,
      branchId: BRANCH_R2,
      from: FROM,
      to: TO,
    });
    expect(allowed.status).toBe(200);
    // Not a vacuous pass: the branch it IS granted in answers with its own order.
    expect((await body(allowed)).rows.items.map((row) => cellValue(row, 'workOrder'))).toEqual([
      otherBranchOrder,
    ]);
  });

  it('reports one branch only — a sibling branch order never appears', async () => {
    authAs(RPT_FULL);
    const ids = (await body(await report())).rows.items.map((row) => cellValue(row, 'workOrder'));
    expect(ids).not.toContain(otherBranchOrder);
  });

  it('refuses a foreign tenant branch before the report is ever run', async () => {
    authAs(RPT_TENANT_B);
    // Unrestricted IN ITS OWN TENANT, so BOTH permission checks pass on scope
    // alone: `iam.has_permission_in_scope` short-circuits on an unrestricted
    // grant before any `org.*` row is read, and does not know whose branch this
    // is. What refuses it is `requireScopeTargetInTenant` (P1-30 CC-14), the
    // platform probe that resolves the (company, branch) pair under the caller's
    // OWN RLS — so the refusal arrives before the handler, and the run service's
    // own null-branch refusal is never reached through this route.
    //
    // ERR-IAM-001 and not ERR-RES-001, deliberately: a not-found would confirm
    // the existence boundary the uniform denial exists to hide. The refusal is
    // identical for a foreign tenant's real pair, a pair that exists nowhere and
    // an in-tenant pair belonging to another company.
    const denied = await report();
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as Problem).code).toBe('ERR-IAM-001');
  });
});

describe('rpt.report-run — the code and the query', () => {
  it('answers an unregistered report code as not found', async () => {
    authAs(RPT_FULL);
    // Including one the tenant has PUBLISHED a configuration for: a configuration
    // row is not a data source, and this is the whole reason `executable` exists.
    const unimplemented = await run(
      { companyId: COMPANY_R, branchId: BRANCH_R1, from: FROM, to: TO },
      UNREGISTERED_CODE
    );
    expect(unimplemented.status).toBe(404);
    expect(((await unimplemented.json()) as Problem).code).toBe('ERR-RES-001');

    authAs(RPT_FULL);
    const absent = await run(
      { companyId: COMPANY_R, branchId: BRANCH_R1, from: FROM, to: TO },
      'p1_31_never_existed'
    );
    expect(absent.status).toBe(404);
  });

  it('refuses a missing scope, an unknown parameter and a non-calendar day', async () => {
    authAs(RPT_FULL);
    // 422 and not 403: `scopeTargetOption` yields NO target when the pair is
    // incomplete, so the pre-handler check falls back to the scope-blind
    // evaluation an unrestricted grant satisfies, and the schema is what refuses.
    expect((await run({ companyId: COMPANY_R, from: FROM, to: TO })).status).toBe(422);
    authAs(RPT_FULL);
    expect((await report({ unexpected: 'x' })).status).toBe(422);
    authAs(RPT_FULL);
    // An instant carries an offset the caller chose, which would silently
    // override the branch timezone the period is expressed in.
    expect((await report({ from: '2027-03-02T00:00:00Z' })).status).toBe(422);
  });
});

describe('rpt.report-run — pagination', () => {
  it('pages the rows disjointly and refuses a malformed or foreign cursor', async () => {
    authAs(RPT_FULL);
    const first = await body(await report({ limit: '2' }));
    expect(first.rows.items).toHaveLength(2);
    expect(first.rows.hasMore).toBe(true);
    expect(first.rows.nextCursor).not.toBeNull();

    authAs(RPT_FULL);
    const second = await body(await report({ limit: '2', cursor: first.rows.nextCursor ?? '' }));
    expect(second.rows.items).toHaveLength(1);
    expect(second.rows.hasMore).toBe(false);
    const firstIds = first.rows.items.map((row) => cellValue(row, 'workOrder'));
    const secondIds = second.rows.items.map((row) => cellValue(row, 'workOrder'));
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    // The counts are the same on both pages, because they are the selection's.
    expect(second.countsByState).toEqual(first.countsByState);

    authAs(RPT_FULL);
    const malformed = await report({ cursor: 'not-a-cursor' });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Problem).code).toBe('ERR-PAG-001');
  });

  it('clamps an oversized page rather than trusting the caller', async () => {
    authAs(RPT_FULL);
    expect((await report({ limit: '100000' })).status).toBe(422);
  });
});

describe('the catalogue reports what the engine can actually run', () => {
  it('marks a registered baseline executable and an unimplemented tenant row not', async () => {
    const page = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: RPT_FULL.userId,
        operation: 'rpt.report-catalogue',
      }),
      (db) => reportingModule().catalogue.listPublished(db, {})
    );
    const baseline = page.items.find((item) => item.reportCode === REPORT_CODE);
    expect(baseline?.executable).toBe(true);
    expect(baseline?.source).toBe('platform');
    // A baseline names no export permission, because report export is P-12 and
    // `rpt.export` is deliberately excluded (change control CC-04).
    expect(baseline?.exportPermissionCode).toBeNull();
    expect(baseline?.titleKey).toBe('reports.work_orders_by_status.title');

    const configured = page.items.find((item) => item.reportCode === UNREGISTERED_CODE);
    expect(configured?.source).toBe('tenant');
    // Published, readable, and NOT runnable: the platform has no dataset for it.
    expect(configured?.executable).toBe(false);
    expect(configured?.exportPermissionCode).toBe('rpt.export');
  });

  it('reads a registered code that the tenant has not configured', async () => {
    const view = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: RPT_FULL.userId, operation: 'rpt.report-read' }),
      (db) => reportingModule().catalogue.readByCode(db, REPORT_CODE)
    );
    // The engineering decision this slice records: a configuration row is
    // CUSTOMIZATION of a report the platform implements, not a precondition for
    // it existing. `rpt.report_configurations` has no seed and no writer yet, so
    // the alternative would leave every report unreachable in every tenant.
    expect(view.source).toBe('platform');
    expect(view.executable).toBe(true);
    expect(view.recordVersion).toBe(0);
  });

  it('still refuses an unconfigured, unregistered code', async () => {
    const denied = (await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: RPT_FULL.userId, operation: 'rpt.report-read' }),
      (db) =>
        reportingModule()
          .catalogue.readByCode(db, 'p1_31_never_existed')
          .then(() => null)
          .catch((error: unknown) => error)
    )) as AppFailure;
    expect(denied).toBeInstanceOf(AppFailure);
    expect(denied.code).toBe('ERR-RES-001');
  });

  it('does not leak the baselines into another tenant as tenant rows', async () => {
    const page = await withTransaction(
      contextFor({
        tenantId: TENANT_B,
        userId: RPT_TENANT_B.userId,
        operation: 'rpt.report-catalogue',
      }),
      (db) => reportingModule().catalogue.listPublished(db, {})
    );
    // Baselines ARE visible to every tenant — they are platform code, not tenant
    // data — but tenant A's configured row is not, and the baseline arrives
    // marked `platform` rather than as something tenant B configured.
    expect(page.items.map((item) => item.reportCode)).toContain(REPORT_CODE);
    expect(page.items.map((item) => item.reportCode)).not.toContain(UNREGISTERED_CODE);
    expect(page.items.find((item) => item.reportCode === REPORT_CODE)?.source).toBe('platform');
  });

  it('registers exactly the datasets the engine implements', async () => {
    // Non-vacuity for the whole slice: a registry that had quietly emptied would
    // make every `executable` assertion above pass for the wrong reason.
    //
    // TWO codes from engine slice 2 onward, and the list is exhaustive rather
    // than a `toContain`: the four baseline reports D-4 approves land one slice
    // at a time, and an exact list is what makes the arrival of the third one a
    // deliberate edit here instead of a silent widening of the catalogue.
    expect([...REPORT_DATASET_CODES]).toEqual([REPORT_CODE, 'technician_labor_time']);
  });
});

describe('tenant report restrictions remain visible to a read-only report caller', () => {
  const allowedFilters = {
    companyId: { type: 'uuid' },
    branchId: { type: 'uuid' },
    from: { type: 'date' },
    to: { type: 'date' },
  };

  async function readerConfiguration(id: string) {
    return withTransaction(
      contextFor({ tenantId: TENANT_A, userId: RPT_FULL.userId, operation: 'rpt.report-read' }),
      async (db) => {
        const visible = await db.query<{ status: string; scope_level: string }>(
          `SELECT status, scope_level FROM rpt.report_configurations
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [TENANT_A, id]
        );
        return {
          configure: await callerHoldsPermission(db, 'rpt.report.configure', {
            companyId: COMPANY_R,
            branchId: BRANCH_R1,
          }),
          export: await callerHoldsPermission(db, 'rpt.export', {
            companyId: COMPANY_R,
            branchId: BRANCH_R1,
          }),
          visible: visible.rows,
        };
      }
    );
  }

  it('runs the absent-configuration baseline without granting export authority', async () => {
    const authority = await readerConfiguration(randomUUID());
    expect(authority).toEqual({ configure: false, export: false, visible: [] });
    authAs(RPT_FULL);
    const result = await report();
    expect(result.status).toBe(200);
    expect((await body(result)).rows.items.map((row) => cellValue(row, 'workOrder'))).toContain(
      middleOrder
    );

    authAs(RPT_FULL);
    const definition = await readReportDefinition();
    expect(definition.status).toBe(200);
    expect(await definition.json()).toMatchObject({
      source: 'platform',
      exportPermissionCode: null,
    });
  });

  it.each(['draft', 'archived'] as const)(
    'can see a same-tenant %s configuration under runtime RLS, and both routes refuse fallback',
    async (status) => {
      await withExplicitReportConfiguration({ status, parameterSchema: {} }, async (id) => {
        // If RLS hid this row from a caller without configure, the engine would
        // see null and incorrectly run the code baseline. This proves the actual
        // runtime visibility separately from the route's refusal.
        expect(await readerConfiguration(id)).toEqual({
          configure: false,
          export: false,
          visible: [{ status, scope_level: 'branch' }],
        });
        authAs(RPT_FULL);
        const denied = await report();
        expect(denied.status).toBe(404);
        expect(((await denied.json()) as Problem).code).toBe('ERR-RES-001');

        authAs(RPT_FULL);
        const definition = await readReportDefinition();
        expect(definition.status).toBe(404);
        expect(((await definition.json()) as Problem).code).toBe('ERR-RES-001');
      });
    }
  );

  it('sees a published restrictive allowlist without configure permission and refuses execution', async () => {
    await withExplicitReportConfiguration(
      { parameterSchema: { filters: { branchId: { type: 'uuid' } } } },
      async (id) => {
        expect(await readerConfiguration(id)).toEqual({
          configure: false,
          export: false,
          visible: [{ status: 'published', scope_level: 'branch' }],
        });
        authAs(RPT_FULL);
        const denied = await report();
        expect(denied.status).toBe(403);
        expect(((await denied.json()) as Problem).code).toBe('ERR-IAM-001');

        // Configuration metadata remains readable, including its separate
        // export requirement. Reading it confers neither configure nor export.
        authAs(RPT_FULL);
        const definition = await readReportDefinition();
        expect(definition.status).toBe(200);
        expect(await definition.json()).toMatchObject({
          source: 'tenant',
          scopeLevel: 'branch',
          exportPermissionCode: 'rpt.export',
          parameterSchema: { filters: { branchId: { type: 'uuid' } } },
        });
      }
    );
  });

  it('keeps the frozen published schema default {} executable for a reader without configure or export', async () => {
    await withExplicitReportConfiguration({ parameterSchema: {} }, async (id) => {
      expect(await readerConfiguration(id)).toMatchObject({ configure: false, export: false });
      authAs(RPT_FULL);
      const result = await report();
      expect(result.status).toBe(200);
      expect((await body(result)).rows.items.map((row) => cellValue(row, 'workOrder'))).toContain(
        middleOrder
      );
    });
  });

  it('does not let a published branch configuration widen the caller scoped to its sibling', async () => {
    await withExplicitReportConfiguration(
      { parameterSchema: { filters: allowedFilters } },
      async () => {
        authAs(RPT_SCOPED_R2);
        const denied = await report();
        expect(denied.status).toBe(403);
        expect(((await denied.json()) as Problem).code).toBe('ERR-IAM-001');

        authAs(RPT_SCOPED_R2);
        const permitted = await report({ branchId: BRANCH_R2 });
        expect(permitted.status).toBe(200);
        expect(
          (await body(permitted)).rows.items.map((row) => cellValue(row, 'workOrder'))
        ).toEqual([otherBranchOrder]);
      }
    );
  });
});
