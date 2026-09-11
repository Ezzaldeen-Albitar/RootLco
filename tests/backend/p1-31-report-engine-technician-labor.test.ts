/**
 * The report engine, slice 2 of 4 — `technician_labor_time` (P1-31, P-11).
 *
 * Slice 1 built the engine around one dataset and recorded two limitations in the
 * open: the grouping lived on the shared envelope under a work-order name, and a
 * dataset could declare exactly one required permission. This slice adds the
 * second registered dataset, which is what makes both of those real rather than
 * theoretical, and proves the generalisation on rows.
 *
 * ## What the Owner approved, and what follows from it
 *
 * D-4: "technician, branch, work-order reference, work-log date and the recorded
 * duration … cancelled and deleted logs are excluded. Recorded duration is
 * duration … not productivity … not a payroll figure."
 *
 * D-17: every report period is half-open, `[from, to)`, in the selected branch's
 * timezone, converted consistently server-side, with the timezone and the filter
 * context displayed and preserved.
 *
 * `tech.labor_sessions` has NO status column and no cancelled state, so "cancelled
 * logs are excluded" is satisfied by there being nothing to exclude; what the
 * table does have is a soft delete and `source = 'correction'`, and those are the
 * two lifecycle facts this suite exercises.
 *
 * ## Why the fixtures INSERT sessions instead of driving the labour routes
 *
 * `tech.labor_sessions.started_at` defaults to `now()` and `tech.labor-session-start`
 * never accepts a clock from the caller — deliberately, because a client-supplied
 * start would let recorded hours be written after the fact. The half-open boundary
 * is a claim about CHOSEN instants one second apart in a named zone, so the
 * sessions are inserted with explicit windows against real jobs on real work
 * orders, through the same `tech.guard_labor_session` trigger every write passes:
 * a terminal work order, a job state that does not allow labour, or a backdated
 * start is refused for a fixture exactly as it is for a request. The ONE amendment
 * path, `tech.correct_labor_session`, is called rather than imitated, so the
 * correction case is the real soft-delete-and-replace and not a hand-built pair.
 *
 * ## Why the period is in the future
 *
 * The same reason slice 1 dates its period forward: nothing here may depend on
 * what day the suite is run, and `tech.guard_labor_session` refuses a start more
 * than a day before the job existed. A future period satisfies both without a
 * clock stub.
 *
 * ## Operations exercised
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rpt.report-run: route service authorization success denial cross-tenant isolation pagination
 *
 * No `audit` flag: `rpt.report-run` registers `auditClass: 'none'`, so claiming one
 * would claim a record it does not write. No `idempotency` and no `stale-version`:
 * it is a GET.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  IDENTITY_PROVIDER,
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
import { REPORT_DATASETS, REPORT_DATASET_CODES } from '@/modules/reporting';
import { GET as RUN } from '@/app/api/v1/reports/[reportCode]/rows/route';

let admin: Pool;
let runtime: Pool;

// ---- Fixture organisation ---------------------------------------------------

/** A company of this suite's own, so the reported branch holds nobody else's rows. */
const COMPANY_L = 'f1320000-0000-4000-8000-0000000000c1';
/** The reported branch. */
const BRANCH_L1 = 'f1320000-0000-4000-8000-0000000000b1';
/** A sibling branch, same company, same zone — the containment case. */
const BRANCH_L2 = 'f1320000-0000-4000-8000-0000000000b2';
/**
 * `Asia/Amman` — the only non-UTC zone `supabase/seeds/01_reference_data.sql`
 * seeds, and `fk_branches_timezone` refuses anything else. A non-UTC branch is the
 * whole point: with a UTC branch this suite could not tell a BRANCH reading of a
 * calendar day from a server reading of one.
 */
const BRANCH_TIMEZONE = 'Asia/Amman';

const REPORT_CODE = 'technician_labor_time';

const REPORT_READ = 'rpt.report.read';
const TECHNICIAN_READ = 'tech.technician.read';
/**
 * The SECOND declared code of this dataset.
 *
 * The report publishes a work-order reference per row, so it declares the
 * work-order module's own read code beside the technician one and the check is
 * conjunctive. The suite exercises both directions of that below.
 */
const WORK_ORDER_READ = 'wo.work_order.read';
const USER_READ = 'iam.user.read';
/** Widens RLS reach without widening authority. Deliberately not a technician code. */
const REACH_ONLY = 'org.tenant.read';

// ---- The period, and the instants that decide it ----------------------------

/** First day INCLUDED, in `BRANCH_TIMEZONE`. */
const FROM = '2027-04-05';
/** First day EXCLUDED — the day after the last one reported. */
const TO = '2027-04-07';

/*
 * The bounds are READ BACK from the database rather than written down here.
 *
 * The zone offset is a property of the deployed tzdata, not of this file. Hard
 * coding the UTC instants would make the suite assert the tzdata instead of the
 * query, and would fail it on a database that is correct.
 */
let periodOpens = '';
let periodCloses = '';
/** Local 12:00 on the first included day. */
let middle = '';

const shift = (iso: string, milliseconds: number): string =>
  new Date(new Date(iso).getTime() + milliseconds).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// ---- Principals -------------------------------------------------------------

/** Every declared code plus the directory capability, so technician NAMES resolve. */
const LABOR_FULL: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000101',
  userId: 'f1320000-0000-4000-8000-000000000102',
  subject: 'fx_p1_31_labor_full',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, TECHNICIAN_READ, WORK_ORDER_READ, USER_READ],
};

/**
 * Every declared code and NOT `iam.user.read`.
 *
 * The label counterfactual. `resolveDisplayIdentities` narrows to an empty map for
 * a caller who may not read the directory, so this principal sees every row and
 * every group with a null label beside a real id — which is the behaviour, not a
 * gap. `iam.user.read` is a directory CAPABILITY and not one of the dataset's
 * declared codes, which is why its absence narrows a label instead of refusing
 * the report.
 */
const LABOR_NO_NAMES: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000111',
  userId: 'f1320000-0000-4000-8000-000000000112',
  subject: 'fx_p1_31_labor_no_names',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, TECHNICIAN_READ, WORK_ORDER_READ],
};

/**
 * May run reports and read technician records; may NOT read work orders.
 *
 * The conjunctive counterfactual. This principal can see every labour row the
 * report is built from — `tech.labor-session-list` would answer for it — and the
 * only thing it cannot read is the work order each session was logged against.
 * The report publishes that reference in a column, so the WHOLE report is refused
 * rather than the column being blanked: a blanked reference inside a report is a
 * report that reads as "no work order", which is a wrong answer and not an
 * absent one.
 */
const LABOR_NO_WORK_ORDER: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000171',
  userId: 'f1320000-0000-4000-8000-000000000172',
  subject: 'fx_p1_31_labor_no_wo',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, TECHNICIAN_READ, USER_READ],
};

/** May run reports; may not read technician records. Refused by the SERVICE. */
const RPT_ONLY: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000121',
  userId: 'f1320000-0000-4000-8000-000000000122',
  subject: 'fx_p1_31_labor_rpt_only',
  tenantId: TENANT_A,
  permissions: [REPORT_READ],
};

/** May read technician records; may not run reports. Refused by the ROUTE. */
const TECH_ONLY: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000131',
  userId: 'f1320000-0000-4000-8000-000000000132',
  subject: 'fx_p1_31_labor_tech_only',
  tenantId: TENANT_A,
  permissions: [TECHNICIAN_READ],
};

/**
 * Both codes, granted ONLY in `BRANCH_L2`, with `BRANCH_L1` inside its
 * permission-blind branch union through the reach role below.
 *
 * The decisive isolation principal: `BRANCH_L1`'s sessions ARE visible to RLS for
 * this caller, so the only thing that can refuse a `BRANCH_L1` report is the
 * scoped permission evaluation (P1-18-A-01).
 */
const LABOR_SCOPED_L2: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000141',
  userId: 'f1320000-0000-4000-8000-000000000142',
  subject: 'fx_p1_31_labor_scoped_l2',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, TECHNICIAN_READ, WORK_ORDER_READ, USER_READ],
  scope: { companyId: COMPANY_L, branchId: BRANCH_L2 },
  grantId: 'f1320000-0000-4000-8000-0000000001f1',
};

/** Tenant B, unrestricted in its OWN tenant. A refusal is tenancy, not authority. */
const LABOR_TENANT_B: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000151',
  userId: 'f1320000-0000-4000-8000-000000000152',
  subject: 'fx_p1_31_labor_tenant_b',
  tenantId: TENANT_B,
  permissions: [REPORT_READ, TECHNICIAN_READ, WORK_ORDER_READ, USER_READ],
};

const PRINCIPALS: readonly Principal[] = [
  LABOR_FULL,
  LABOR_NO_NAMES,
  LABOR_NO_WORK_ORDER,
  RPT_ONLY,
  TECH_ONLY,
  LABOR_SCOPED_L2,
  LABOR_TENANT_B,
];

const REACH_ROLE = 'f1320000-0000-4000-8000-000000000161';
const REACH_GRANT = 'f1320000-0000-4000-8000-000000000162';

// ---- Technician profiles ----------------------------------------------------
//
// One profile per behaviour, because `ex_labor_sessions_overlap` is a partial GiST
// EXCLUDE over `tstzrange(started_at, COALESCE(ended_at,'infinity'))` per
// technician: an OPEN session overlaps everything that starts after it, and two
// edge windows a second apart overlap each other. Giving each case its own
// technician is what lets all of them exist at once.
//
// The ids are ordered, because the groups come back ordered by profile id.

/** Two contributing sessions. The sum case. */
const TECH_ALPHA = 'f1320000-0000-4000-8000-0000000002a1';
/** One contributing session, starting one second before the period closes. */
const TECH_BETA = 'f1320000-0000-4000-8000-0000000002b1';
/** One session starting exactly at the excluded instant. Contributes nothing. */
const TECH_GAMMA = 'f1320000-0000-4000-8000-0000000002c1';
/** One session starting one second before the period opens. Contributes nothing. */
const TECH_DELTA = 'f1320000-0000-4000-8000-0000000002d1';
/** One session still running. Contributes nothing. */
const TECH_OPEN = 'f1320000-0000-4000-8000-0000000002e1';
/** One soft-deleted session. Contributes nothing. */
const TECH_DELETED = 'f1320000-0000-4000-8000-0000000002f1';
/** One corrected session: original retired, replacement counted once. */
const TECH_CORRECTED = 'f1320000-0000-4000-8000-000000000301';
/** In the SIBLING branch. Invisible to the reported branch. */
const TECH_OTHER_BRANCH = 'f1320000-0000-4000-8000-000000000311';

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
interface Group {
  readonly key: Record<string, string | null>;
  readonly label: string | null;
  readonly measures: Record<string, string>;
}
interface RunBody {
  readonly reportCode: string;
  readonly titleKey: string;
  readonly scope: string;
  readonly period: { readonly from: string; readonly to: string; readonly timezone: string };
  readonly filters: { readonly companyId: string; readonly branchId: string };
  readonly branch: { readonly id: string; readonly name: string };
  readonly generatedAt: string;
  readonly freshness: string;
  readonly columns: readonly Column[];
  readonly groups: readonly Group[];
  readonly countsByState: readonly unknown[];
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
  return run({ companyId: COMPANY_L, branchId: BRANCH_L1, from: FROM, to: TO, ...extra });
}

const body = async (response: Response): Promise<RunBody> => (await response.json()) as RunBody;

function cellValue(row: { readonly cells: readonly Cell[] }, key: string): string | null {
  return row.cells.find((entry) => entry.key === key)?.value ?? null;
}
function cellLabel(row: { readonly cells: readonly Cell[] }, key: string): string | null {
  return row.cells.find((entry) => entry.key === key)?.label ?? null;
}
/** The recorded seconds of one technician's group, or null when absent. */
function groupSeconds(view: RunBody, technicianProfileId: string): string | null {
  const group = view.groups.find((entry) => entry.key.technician === technicianProfileId);
  return group === undefined ? null : (group.measures.durationSeconds ?? null);
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
 * A technician profile, with the account its display name comes from.
 *
 * `fk_technician_profiles_user` anchors the profile to an identity in the SAME
 * tenant and `uq_technician_profiles_active_user` allows one live profile per
 * user, so each fixture technician needs its own account. The display name is a
 * neutral fixture label: the platform ships no staff records and this suite does
 * not invent one.
 */
async function seedTechnician(input: {
  readonly id: string;
  readonly branchId: string;
  readonly label: string;
}): Promise<string> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const account = await client.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,$3,$3||'@example.test',$4,'active',$5)
       RETURNING id`,
      [TENANT_A, IDENTITY_PROVIDER, `fx_p1_31_lab_${input.id.slice(-4)}`, input.label, USER_A]
    );
    const userId = account.rows[0]?.id ?? '';
    await client.query(
      `INSERT INTO tech.technician_profiles
         (id, tenant_id, company_id, branch_id, user_id, trade, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,'mechanic',true,$6)`,
      [input.id, TENANT_A, COMPANY_L, input.branchId, userId, USER_A]
    );
    await client.query('COMMIT');
    return userId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A work order in the named branch with ONE job on it, ready to carry labour.
 *
 * The visit is real — `rec.accept_check_in` writes the party role, the custody
 * event and the first status-history row — because `wo.guard_work_order_refs`
 * checks all three on insert. The order is then advanced to `open` through the
 * REAL transition route, because `wo.guard_job_refs` refuses a job on a state that
 * does not allow one and `draft` does not; and the job is created directly in
 * `in_progress`, which is the state `wo.job_states.labor_allowed` is true for.
 */
async function seedJob(input: {
  readonly branchId: string;
  readonly displayNumber?: string;
}): Promise<{ workOrderId: string; jobId: string }> {
  const visit = await seedAuthorizedVisit({ companyId: COMPANY_L, branchId: input.branchId });
  const order = await admin.query<{ id: string }>(
    `INSERT INTO wo.work_orders
       (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, display_number, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      TENANT_A,
      COMPANY_L,
      input.branchId,
      visit.visitId,
      visit.vehicleId,
      input.displayNumber ?? null,
      USER_A,
    ]
  );
  const workOrderId = order.rows[0]?.id ?? '';
  await advance(workOrderId, [{ toState: 'open' }], FULL);
  __resetAuthenticatorForTests();

  const job = await admin.query<{ id: string }>(
    `INSERT INTO wo.jobs
       (tenant_id, company_id, branch_id, work_order_id, title, state, created_by)
     VALUES ($1,$2,$3,$4,'P1-31 labour fixture job','in_progress',$5) RETURNING id`,
    [TENANT_A, COMPANY_L, input.branchId, workOrderId, USER_A]
  );
  return { workOrderId, jobId: job.rows[0]?.id ?? '' };
}

/** One labour session with a CHOSEN window. `endedAt` null leaves it running. */
async function seedSession(input: {
  readonly technicianProfileId: string;
  readonly jobId: string;
  readonly branchId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}): Promise<string> {
  const inserted = await admin.query<{ id: string }>(
    `INSERT INTO tech.labor_sessions
       (tenant_id, company_id, branch_id, technician_profile_id, job_id,
        started_at, ended_at, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,'manual',$8) RETURNING id`,
    [
      TENANT_A,
      COMPANY_L,
      input.branchId,
      input.technicianProfileId,
      input.jobId,
      input.startedAt,
      input.endedAt,
      USER_A,
    ]
  );
  return inserted.rows[0]?.id ?? '';
}

/** Retires a session the way the platform does: a soft delete, not a row removal. */
async function softDeleteSession(sessionId: string): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `UPDATE tech.labor_sessions SET deleted_at = now(), deleted_by = $2
        WHERE id = $1`,
      [sessionId, USER_A]
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
 * Corrects a session through `tech.correct_labor_session`, never by hand.
 *
 * The function soft-deletes the original and inserts a linked replacement carrying
 * `correction_of_id` in ONE statement. Imitating it here would give this suite a
 * second correction path that could disagree with the audited one — which is the
 * exact reason the repository calls it too.
 */
async function correctSession(input: {
  readonly originalId: string;
  readonly startedAt: string;
  readonly endedAt: string;
}): Promise<string> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const corrected = await client.query<{ id: string }>(
      `SELECT tech.correct_labor_session($1::uuid,$2::timestamptz,$3::timestamptz,$4::text) AS id`,
      [input.originalId, input.startedAt, input.endedAt, 'P1-31 fixture correction']
    );
    await client.query('COMMIT');
    return corrected.rows[0]?.id ?? '';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// The rows every case reads.
let jobOne = '';
let jobTwo = '';
let workOrderOne = '';
let workOrderTwo = '';
let alphaAtOpen = '';
let alphaMidday = '';
let betaLateIn = '';
let correctionId = '';
let alphaLabel = '';

const DISPLAY_NUMBER = 'P1-31-LABOUR-0001';

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);

  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_p1_31_labour','P1-31 Labour Reporting Company','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_L, TENANT_A, USER_A]
  );
  for (const [id, code, name] of [
    [BRANCH_L1, 'fx_p1_31_labour_b1', 'P1-31 Labour Reported Branch'],
    [BRANCH_L2, 'fx_p1_31_labour_b2', 'P1-31 Labour Sibling Branch'],
  ]) {
    await admin.query(
      `INSERT INTO org.branches
         (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, COMPANY_L, code, name, BRANCH_TIMEZONE, USER_A]
    );
  }

  for (const principal of PRINCIPALS) await seedPrincipal(principal);

  // The reach role: an unrelated permission scoped to BRANCH_L1, so L1 is inside
  // LABOR_SCOPED_L2's permission-blind branch union with no report or technician
  // authority there. Without it the isolation case would pass because RLS returned
  // nothing, which proves the wrong control.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_31_labour_reach','P1-31 labour reach only',$3)
     ON CONFLICT (id) DO NOTHING`,
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
      [REACH_GRANT, TENANT_A, LABOR_SCOPED_L2.userId, REACH_ROLE, USER_A]
    );
    await reach.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [TENANT_A, REACH_GRANT, COMPANY_L, BRANCH_L1, USER_A]
    );
    await reach.query('COMMIT');
  } catch (error) {
    await reach.query('ROLLBACK');
    throw error;
  } finally {
    reach.release();
  }

  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);

  const bounds = await admin.query<{ opens: Date; closes: Date }>(
    `SELECT (($1::date)::timestamp AT TIME ZONE $3) AS opens,
            (($2::date)::timestamp AT TIME ZONE $3) AS closes`,
    [FROM, TO, BRANCH_TIMEZONE]
  );
  periodOpens = (bounds.rows[0]?.opens ?? new Date(0)).toISOString();
  periodCloses = (bounds.rows[0]?.closes ?? new Date(0)).toISOString();
  middle = shift(periodOpens, 12 * HOUR);

  alphaLabel = 'P1-31 Labour Fixture Alpha';
  await seedTechnician({ id: TECH_ALPHA, branchId: BRANCH_L1, label: alphaLabel });
  await seedTechnician({
    id: TECH_BETA,
    branchId: BRANCH_L1,
    label: 'P1-31 Labour Fixture Beta',
  });
  await seedTechnician({
    id: TECH_GAMMA,
    branchId: BRANCH_L1,
    label: 'P1-31 Labour Fixture Gamma',
  });
  await seedTechnician({
    id: TECH_DELTA,
    branchId: BRANCH_L1,
    label: 'P1-31 Labour Fixture Delta',
  });
  await seedTechnician({
    id: TECH_OPEN,
    branchId: BRANCH_L1,
    label: 'P1-31 Labour Fixture Running',
  });
  await seedTechnician({
    id: TECH_DELETED,
    branchId: BRANCH_L1,
    label: 'P1-31 Labour Fixture Retired',
  });
  await seedTechnician({
    id: TECH_CORRECTED,
    branchId: BRANCH_L1,
    label: 'P1-31 Labour Fixture Corrected',
  });
  await seedTechnician({
    id: TECH_OTHER_BRANCH,
    branchId: BRANCH_L2,
    label: 'P1-31 Labour Fixture Sibling',
  });

  const first = await seedJob({ branchId: BRANCH_L1, displayNumber: DISPLAY_NUMBER });
  workOrderOne = first.workOrderId;
  jobOne = first.jobId;
  const second = await seedJob({ branchId: BRANCH_L1 });
  workOrderTwo = second.workOrderId;
  jobTwo = second.jobId;
  const sibling = await seedJob({ branchId: BRANCH_L2 });

  // ALPHA: one hour at the first included instant, half an hour at midday.
  alphaAtOpen = await seedSession({
    technicianProfileId: TECH_ALPHA,
    jobId: jobOne,
    branchId: BRANCH_L1,
    startedAt: periodOpens,
    endedAt: shift(periodOpens, HOUR),
  });
  alphaMidday = await seedSession({
    technicianProfileId: TECH_ALPHA,
    jobId: jobTwo,
    branchId: BRANCH_L1,
    startedAt: middle,
    endedAt: shift(middle, 30 * MINUTE),
  });
  // BETA: starts ONE SECOND before the period closes. In, and its end is outside
  // the period — the predicate is on the start, which is what "work-log date"
  // means.
  betaLateIn = await seedSession({
    technicianProfileId: TECH_BETA,
    jobId: jobOne,
    branchId: BRANCH_L1,
    startedAt: shift(periodCloses, -SECOND),
    endedAt: shift(periodCloses, 10 * MINUTE - SECOND),
  });
  // GAMMA: starts EXACTLY at the first excluded instant. Out.
  await seedSession({
    technicianProfileId: TECH_GAMMA,
    jobId: jobOne,
    branchId: BRANCH_L1,
    startedAt: periodCloses,
    endedAt: shift(periodCloses, 15 * MINUTE),
  });
  // DELTA: starts ONE SECOND before the period opens. Out.
  await seedSession({
    technicianProfileId: TECH_DELTA,
    jobId: jobOne,
    branchId: BRANCH_L1,
    startedAt: shift(periodOpens, -SECOND),
    endedAt: shift(periodOpens, 15 * MINUTE),
  });
  // Still running. Out: an open session has no duration, and running it to `now()`
  // would make the same closed period total differently on every run.
  await seedSession({
    technicianProfileId: TECH_OPEN,
    jobId: jobOne,
    branchId: BRANCH_L1,
    startedAt: middle,
    endedAt: null,
  });
  // Soft-deleted. Out.
  const retired = await seedSession({
    technicianProfileId: TECH_DELETED,
    jobId: jobOne,
    branchId: BRANCH_L1,
    startedAt: middle,
    endedAt: shift(middle, 20 * MINUTE),
  });
  await softDeleteSession(retired);
  // Corrected: one hour recorded, amended to twenty minutes. The original is
  // retired by the function and the replacement is the only row that counts.
  const original = await seedSession({
    technicianProfileId: TECH_CORRECTED,
    jobId: jobOne,
    branchId: BRANCH_L1,
    startedAt: shift(middle, HOUR),
    endedAt: shift(middle, 2 * HOUR),
  });
  correctionId = await correctSession({
    originalId: original,
    startedAt: shift(middle, HOUR),
    endedAt: shift(middle, HOUR + 20 * MINUTE),
  });
  // The sibling branch's own session, inside the same period.
  await seedSession({
    technicianProfileId: TECH_OTHER_BRANCH,
    jobId: sibling.jobId,
    branchId: BRANCH_L2,
    startedAt: middle,
    endedAt: shift(middle, 45 * MINUTE),
  });

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

describe('technician_labor_time — the rows the Owner asked for', () => {
  it('publishes the D-4 columns in the D-4 order, with the kinds a client renders from', async () => {
    authAs(LABOR_FULL);
    const response = await report();
    expect(response.status).toBe(200);
    const view = await body(response);

    expect(view.reportCode).toBe(REPORT_CODE);
    expect(view.titleKey).toBe('reports.technician_labor_time.title');
    expect(view.scope).toBe('branch');
    // `live` is a claim about provenance: the operational tables, inside this
    // request's own transaction. There is no snapshot behind it.
    expect(view.freshness).toBe('live');
    expect(view.columns.map((column) => column.key)).toEqual([
      'technician',
      'branch',
      'workOrder',
      'workLogDate',
      'duration',
      'source',
    ]);
    // `duration` is its own KIND. Without it a client cannot tell 3600 seconds
    // from 3600 of anything else, and would have to guess at a format.
    expect(view.columns.find((column) => column.key === 'duration')?.kind).toBe('duration');
    expect(view.columns.find((column) => column.key === 'technician')?.kind).toBe('reference');
    expect(view.columns.find((column) => column.key === 'workOrder')?.drillThrough).toBe(
      '/work-orders/{id}'
    );
  });

  it('returns only the contributing sessions, newest start first', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());

    // Four rows and not eight. Everything excluded below is excluded for a
    // different reason, and each has its own case.
    expect(view.rows.items.map((row) => cellValue(row, 'duration'))).toEqual([
      // BETA, one second before the period closes: ten minutes.
      '600',
      // The CORRECTION, an hour after midday: twenty minutes.
      '1200',
      // ALPHA at midday: half an hour.
      '1800',
      // ALPHA at the first included instant: one hour.
      '3600',
    ]);
    expect(view.rows.items.map((row) => cellValue(row, 'technician'))).toEqual([
      TECH_BETA,
      TECH_CORRECTED,
      TECH_ALPHA,
      TECH_ALPHA,
    ]);
    expect(view.rows.hasMore).toBe(false);
    expect(view.rows.nextCursor).toBeNull();
  });

  it('names the work order each session was logged against, through the work-order port', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());

    const midday = view.rows.items.find((row) => cellValue(row, 'duration') === '1800');
    const atOpen = view.rows.items.find((row) => cellValue(row, 'duration') === '3600');
    // `tech.labor_sessions` carries a JOB id and no work-order column. The report
    // publishes the work order because the work-order module answered for its own
    // table, not because this module joined across a private schema.
    expect(cellValue(midday!, 'workOrder')).toBe(workOrderTwo);
    expect(cellValue(atOpen!, 'workOrder')).toBe(workOrderOne);
    // The label is the display number when the order has one. It is allocated when
    // an order is issued a document, so a nulled label is a real state.
    expect(cellLabel(atOpen!, 'workOrder')).toBe(DISPLAY_NUMBER);
    expect(cellLabel(midday!, 'workOrder')).toBeNull();
    // Non-vacuity: the two rows really are on different orders.
    expect(workOrderOne).not.toBe(workOrderTwo);
  });

  it('carries the branch, the work-log instant and the booking source on every row', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());
    const atOpen = view.rows.items.find((row) => cellValue(row, 'duration') === '3600');

    expect(cellValue(atOpen!, 'branch')).toBe(BRANCH_L1);
    expect(cellLabel(atOpen!, 'branch')).toBe('P1-31 Labour Reported Branch');
    // The session's START, serialised UTC like every other published instant.
    expect(cellValue(atOpen!, 'workLogDate')).toBe(periodOpens);
    expect(cellValue(atOpen!, 'source')).toBe('manual');
    // The correction is visible AS a correction. A reader who could not tell an
    // amended figure from an original one would be reading a different report.
    const corrected = view.rows.items.find((row) => cellValue(row, 'duration') === '1200');
    expect(cellValue(corrected!, 'source')).toBe('correction');
  });
});

describe('technician_labor_time — which logs contribute', () => {
  it('excludes a session that is still running', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());
    // An OPEN session has no duration. Treating one as running to `now()` would
    // make the same report over the same closed period total differently every
    // time it is run.
    expect(groupSeconds(view, TECH_OPEN)).toBeNull();
    expect(view.rows.items.some((row) => cellValue(row, 'technician') === TECH_OPEN)).toBe(false);
  });

  it('excludes a soft-deleted session', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());
    expect(groupSeconds(view, TECH_DELETED)).toBeNull();
    expect(view.rows.items.some((row) => cellValue(row, 'technician') === TECH_DELETED)).toBe(
      false
    );
  });

  it('counts a corrected session ONCE, on its amended window', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());

    // `tech.correct_labor_session` retired an hour and wrote twenty minutes. Both
    // rows exist; counting both would double-count every correction in the
    // platform, and counting the retired one would report hours that were withdrawn.
    const rows = view.rows.items.filter((row) => cellValue(row, 'technician') === TECH_CORRECTED);
    expect(rows).toHaveLength(1);
    expect(cellValue(rows[0]!, 'duration')).toBe('1200');
    expect(groupSeconds(view, TECH_CORRECTED)).toBe('1200');
    // Non-vacuity: the original really is still in the table, retired.
    const present = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tech.labor_sessions
        WHERE correction_of_id IS NOT NULL AND id = $1 AND deleted_at IS NULL`,
      [correctionId]
    );
    expect(present.rows[0]?.n).toBe('1');
    const retired = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tech.labor_sessions
        WHERE technician_profile_id = $1 AND deleted_at IS NOT NULL`,
      [TECH_CORRECTED]
    );
    expect(retired.rows[0]?.n).toBe('1');
  });

  it('reports no cancelled bucket, because the table has no cancelled state', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());
    // D-4 says cancelled logs are excluded. There is nothing to exclude: the
    // schema has no status column at all, so a bucket here would read as a real
    // zero for a concept that does not exist.
    const columns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tech' AND table_name = 'labor_sessions'
          AND column_name IN ('status','state','cancelled_at')`
    );
    expect(columns.rows).toHaveLength(0);
    expect(view.groups.every((group) => group.measures.cancelled === undefined)).toBe(true);
  });
});

describe('technician_labor_time — the half-open period in the branch zone', () => {
  it('includes the first instant of the period and excludes the one a second before it', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());

    // ALPHA started at local midnight on the first included day: IN.
    expect(view.rows.items.some((row) => cellValue(row, 'workLogDate') === periodOpens)).toBe(true);
    // DELTA started one second earlier: OUT, and its technician has no group.
    expect(groupSeconds(view, TECH_DELTA)).toBeNull();
  });

  it('includes the last second of the period and excludes local midnight on the excluded day', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());

    // BETA started one second before local midnight on the excluded day: IN — and
    // it ENDS after the period, which does not matter, because the work-log date
    // is the start.
    expect(groupSeconds(view, TECH_BETA)).toBe('600');
    expect(view.rows.items.some((row) => cellValue(row, 'workLogDate') === periodCloses)).toBe(
      false
    );
    // GAMMA started exactly at that midnight: OUT. A closed upper bound would have
    // swallowed it, and the two technicians are one second apart.
    expect(groupSeconds(view, TECH_GAMMA)).toBeNull();
  });

  it('states the zone the period was resolved in, and echoes the filter context', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());

    // D-17: a number must never be readable without the period and the selection
    // that produced it.
    expect(view.period).toEqual({ from: FROM, to: TO, timezone: BRANCH_TIMEZONE });
    expect(view.filters).toEqual({ companyId: COMPANY_L, branchId: BRANCH_L1 });
    expect(view.branch).toEqual({ id: BRANCH_L1, name: 'P1-31 Labour Reported Branch' });
    // The bounds really are the BRANCH's and not the server's: local midnight in
    // Amman is not midnight UTC, so a UTC reading of this period would select a
    // different set.
    expect(periodOpens.endsWith('T00:00:00.000Z')).toBe(false);
  });
});

describe('technician_labor_time — the groups', () => {
  it('sums each technician over the WHOLE selection, exactly', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());

    // ALPHA: one hour plus half an hour. The total is the sum of the very same
    // per-row expression the rows carry, so a reader who adds the page cannot find
    // a disagreement.
    expect(groupSeconds(view, TECH_ALPHA)).toBe('5400');
    expect(groupSeconds(view, TECH_BETA)).toBe('600');
    expect(groupSeconds(view, TECH_CORRECTED)).toBe('1200');
    // Only the technicians who contributed. A roster listed at zero would be an
    // attendance record, which D-4 says this is not.
    expect(view.groups.map((group) => group.key.technician)).toEqual([
      TECH_ALPHA,
      TECH_BETA,
      TECH_CORRECTED,
    ]);
  });

  it('names the technician when the caller may be told, and publishes a null label when not', async () => {
    authAs(LABOR_FULL);
    const named = await body(await report());
    expect(named.groups.find((group) => group.key.technician === TECH_ALPHA)?.label).toBe(
      alphaLabel
    );
    expect(
      named.rows.items.find((row) => cellValue(row, 'technician') === TECH_ALPHA)
    ).toBeDefined();
    expect(cellLabel(named.rows.items[2]!, 'technician')).toBe(alphaLabel);

    // The counterfactual, and it is the whole point of the null: the directory
    // narrows to an empty map for a caller without `iam.user.read`, so the same
    // rows arrive with the id and no name. Nothing is invented and nothing is
    // refused.
    authAs(LABOR_NO_NAMES);
    const anonymous = await body(await report());
    expect(anonymous.groups.find((group) => group.key.technician === TECH_ALPHA)?.label).toBeNull();
    expect(anonymous.groups.map((group) => group.key.technician)).toEqual(
      named.groups.map((group) => group.key.technician)
    );
    expect(cellLabel(anonymous.rows.items[2]!, 'technician')).toBeNull();
    expect(cellValue(anonymous.rows.items[2]!, 'technician')).toBe(TECH_ALPHA);
  });

  it('leaves the deprecated work-order field empty for a dataset that has no states', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());
    // `countsByState` is slice 1's grouping on a shared envelope. Filling it here
    // would mean inventing a work-order state for a labour session.
    expect(view.countsByState).toEqual([]);
  });
});

describe('technician_labor_time — authorization', () => {
  it('refuses a caller who may run reports but may not read technician records', async () => {
    authAs(RPT_ONLY);
    const response = await report();
    // Refused by the SERVICE, on the dataset's own declared code, with the uniform
    // failure the route's own check produces — so a caller cannot tell the two
    // apart and cannot use the difference to discover which datasets exist.
    expect(response.status).toBe(403);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toEqual([TECHNICIAN_READ]);
  });

  it('refuses a caller who may read technician records but not the work orders they name', async () => {
    authAs(LABOR_NO_WORK_ORDER);
    const response = await report();
    // The conjunctive check. Every code the dataset declares is evaluated, and the
    // WHOLE report is refused on the first one missing — this caller could read
    // every labour session through `tech.labor-session-list`, and would still be
    // told the work-order ids and display numbers that carried labour in the
    // branch if the report answered with the reference column blanked.
    expect(response.status).toBe(403);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-IAM-001');
    // The code NAMED is the missing one, not the whole declared list.
    expect(problem.requiredPermissions).toEqual([WORK_ORDER_READ]);
  });

  it('answers the same caller once the work-order code is granted', async () => {
    // The non-vacuity half of the case above: the refusal is about the ONE code
    // and not about anything else this principal lacks. Granting it turns the same
    // request into the same report the fully-granted caller sees.
    authAs(LABOR_FULL);
    const view = await body(await report());
    expect(view.rows.items.length).toBeGreaterThan(0);
    expect(view.rows.items.some((row) => cellValue(row, 'workOrder') !== null)).toBe(true);
  });

  it('refuses a caller who may read technician records but may not run reports', async () => {
    authAs(TECH_ONLY);
    const response = await report();
    // Refused by the ROUTE. The counterfactual of the case above: collapse the two
    // codes into one and both go red, in opposite directions.
    expect(response.status).toBe(403);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toEqual([REPORT_READ]);
  });

  it('refuses a branch the caller holds no authority in, even when RLS can see it', async () => {
    authAs(LABOR_SCOPED_L2);
    // The decisive isolation case. This caller's permission-blind branch union
    // COVERS BRANCH_L1 through the reach role, so RLS would return its rows; the
    // only control that can refuse is the scoped permission evaluation.
    expect((await report()).status).toBe(403);
    // And the branch it IS granted in answers, which is what makes the refusal
    // above about scope rather than about the principal.
    const own = await run({
      companyId: COMPANY_L,
      branchId: BRANCH_L2,
      from: FROM,
      to: TO,
    });
    expect(own.status).toBe(200);
    const view = await body(own);
    expect(view.groups.map((group) => group.key.technician)).toEqual([TECH_OTHER_BRANCH]);
  });

  it('does not show one branch the labour of another', async () => {
    authAs(LABOR_FULL);
    const view = await body(await report());
    expect(view.rows.items.some((row) => cellValue(row, 'technician') === TECH_OTHER_BRANCH)).toBe(
      false
    );
    expect(groupSeconds(view, TECH_OTHER_BRANCH)).toBeNull();
  });

  it('does not answer for another tenant', async () => {
    authAs(LABOR_TENANT_B);
    // Unrestricted in its OWN tenant, so a refusal here is tenancy and not
    // authority: `requireScopeTargetInTenant` resolves the pair under the caller's
    // own RLS and finds nothing.
    expect((await report()).status).toBe(403);
  });
});

describe('technician_labor_time — paging', () => {
  it('pages the sessions while the groups keep answering for the whole selection', async () => {
    authAs(LABOR_FULL);
    const first = await body(await report({ limit: '2' }));
    expect(first.rows.items).toHaveLength(2);
    expect(first.rows.hasMore).toBe(true);
    expect(first.rows.nextCursor).not.toBeNull();
    // The totals are the SELECTION's, never the page's — the P1-28 round-two rule.
    expect(groupSeconds(first, TECH_ALPHA)).toBe('5400');

    const second = await body(
      await report({ limit: '2', cursor: first.rows.nextCursor as string })
    );
    expect(second.rows.items.map((row) => cellValue(row, 'duration'))).toEqual(['1800', '3600']);
    expect(second.rows.hasMore).toBe(false);
    // Identical groups on both pages. A group that moved with the page would be
    // answering for the page.
    expect(second.groups).toEqual(first.groups);
    // Non-vacuity: the two pages really are disjoint.
    const firstIds = first.rows.items.map((row) => cellValue(row, 'workLogDate'));
    const secondIds = second.rows.items.map((row) => cellValue(row, 'workLogDate'));
    expect(firstIds.some((value) => secondIds.includes(value))).toBe(false);
  });

  it('refuses a malformed cursor and one minted for a different ordering contract', async () => {
    authAs(LABOR_FULL);
    const malformed = await report({ cursor: 'not-a-cursor' });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Problem).code).toBe('ERR-PAG-001');

    // Well formed base64url, issued for a DIFFERENT contract. A cursor is refused
    // rather than reinterpreted: re-using one across orderings silently produces a
    // wrong page.
    authAs(LABOR_FULL);
    const foreign = Buffer.from(
      JSON.stringify({ k: 'wo.work_orders:opened_at_desc', v: periodOpens, i: alphaAtOpen })
    ).toString('base64url');
    const response = await report({ cursor: foreign });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Problem).code).toBe('ERR-PAG-001');
  });
});

describe('the registry', () => {
  it('registers the dataset the Owner approved, with the permission it declares', async () => {
    expect([...REPORT_DATASET_CODES]).toContain(REPORT_CODE);
    // The permission list is a LIST from this slice onward, and it names one code
    // per RECORD the report publishes: the labour sessions themselves under the
    // code `tech.labor-session-list` already declares, and the work orders the
    // reference column resolves to under the work-order module's own read code.
    expect([...REPORT_DATASETS.technician_labor_time.requiredPermissions]).toEqual([
      TECHNICIAN_READ,
      WORK_ORDER_READ,
    ]);
    expect(REPORT_DATASETS.technician_labor_time.scope).toBe('branch');
    // The parameter schema is the shared period: two required calendar dates, and
    // no default period, because "the last thirty days" is a business rule nobody
    // has decided.
    expect(REPORT_DATASETS.technician_labor_time.parameterSchema.map((p) => p.name)).toEqual([
      'from',
      'to',
    ]);
    // Non-vacuity for the ids the rows above are keyed on.
    expect(alphaAtOpen).not.toBe('');
    expect(alphaMidday).not.toBe('');
    expect(betaLateIn).not.toBe('');
    expect(jobOne).not.toBe(jobTwo);
  });
});
