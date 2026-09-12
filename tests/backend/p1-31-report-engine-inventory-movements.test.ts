/**
 * The report engine, slice 3 of 4 — `inventory_movements` (P1-31, P-11).
 *
 * COVERAGE-EVIDENCE: rpt.report-run
 *
 * ## What the Owner approved, and what follows from it
 *
 * D-4: "movement date, reference and type, the item, the warehouse or location,
 * and the quantity with its unit. Totals are separated by item and by compatible
 * unit, and the distinct meanings of a return and a transfer are preserved rather
 * than netted away."
 *
 * D-5: "No single inventory quantity is presented across unlike items; a quantity
 * is meaningful only within an item and a compatible unit."
 *
 * D-17: every report period is half-open, `[from, to)`, in the selected branch's
 * timezone, converted consistently server-side, with the timezone and the filter
 * context displayed and preserved.
 *
 * ## The vocabulary is FIVE terms, and `transfer` is not one of them
 *
 * `ck_stock_movements_type` constrains `movement_type` to `opening`, `issue`,
 * `return`, `damage` and `adjustment`
 * (`supabase/migrations/20260723094000_inv_ledger.sql`). The inventory module
 * disclaims transfers by design — the `transfer` movement kind and the `transit`
 * location type were dropped in Phase 1-10 — so there is no primitive a transfer
 * could be built on. A case below proves the absence against the live CHECK
 * rather than against this comment, and the report shows no transfer bucket: an
 * empty one would read as a real zero for a concept the ledger cannot express.
 *
 * What D-4's sentence still binds, and what this suite proves on rows, is that a
 * RETURN is never netted against an ISSUE.
 *
 * ## Why the fixtures INSERT movements against REAL source rows
 *
 * `inv.stock_movements.occurred_at` is written by the protected `inv` functions
 * from the transaction clock, and no route accepts an instant from a caller —
 * deliberately, because a client-supplied movement date would let the ledger be
 * backdated. The half-open boundary is a claim about CHOSEN instants one second
 * apart in a named zone, so the movements are inserted with explicit instants
 * through `tg_stock_movements_provenance`, the same trigger every posted movement
 * passes: each one cites a real approved opening line, part issue, part return,
 * damage record or approved adjustment, with the matching type, direction and
 * quantity, or the insert is refused exactly as it would be for a request.
 *
 * Nothing here writes a balance. This report reads the LEDGER, which is
 * append-only and immutable, and the balances are a different table it never
 * touches.
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
let runtime: Pool | undefined;

// ---- Scope ------------------------------------------------------------------

/** This suite's own company inside tenant A. Nothing else writes to it. */
const COMPANY_I = 'f1330000-0000-4000-8000-0000000000c1';
/** The REPORTED branch. */
const BRANCH_I1 = 'f1330000-0000-4000-8000-0000000000b1';
/** A sibling branch, same company, same zone — the containment case. */
const BRANCH_I2 = 'f1330000-0000-4000-8000-0000000000b2';

/**
 * `Asia/Amman` — the only non-UTC zone `supabase/seeds/01_reference_data.sql`
 * seeds, and `fk_branches_timezone` refuses anything else. A non-UTC branch is the
 * whole point: with a UTC branch this suite could not tell a BRANCH reading of a
 * calendar day from a server reading of one.
 */
const BRANCH_TIMEZONE = 'Asia/Amman';

const REPORT_CODE = 'inventory_movements';

const REPORT_READ = 'rpt.report.read';
/** The code `inv.stock-movement-list` declares for the same rows. */
const STOCK_READ = 'inv.stock.read';
/** Widens RLS reach without widening authority. Deliberately not an inventory code. */
const REACH_ONLY = 'org.tenant.read';

// ---- The period, and the instants that decide it ----------------------------

/** First day INCLUDED, in `BRANCH_TIMEZONE`. */
const FROM = '2027-05-10';
/** First day EXCLUDED — the day after the last one reported. */
const TO = '2027-05-12';

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

/** Both codes. The dataset declares one; the operation declares the other. */
const INV_RPT_FULL: Principal = {
  roleId: 'f1330000-0000-4000-8000-000000000101',
  userId: 'f1330000-0000-4000-8000-000000000102',
  subject: 'fx_p1_31_inv_full',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, STOCK_READ],
};

/** May run reports; may not read stock. Refused by the SERVICE. */
const RPT_ONLY: Principal = {
  roleId: 'f1330000-0000-4000-8000-000000000111',
  userId: 'f1330000-0000-4000-8000-000000000112',
  subject: 'fx_p1_31_inv_rpt_only',
  tenantId: TENANT_A,
  permissions: [REPORT_READ],
};

/** May read stock; may not run reports. Refused by the ROUTE. */
const STOCK_ONLY: Principal = {
  roleId: 'f1330000-0000-4000-8000-000000000121',
  userId: 'f1330000-0000-4000-8000-000000000122',
  subject: 'fx_p1_31_inv_stock_only',
  tenantId: TENANT_A,
  permissions: [STOCK_READ],
};

/**
 * Both codes, granted ONLY in `BRANCH_I2`, with `BRANCH_I1` inside its
 * permission-blind branch union through the reach role below.
 *
 * The decisive isolation principal: `BRANCH_I1`'s movements ARE visible to RLS for
 * this caller, so the only thing that can refuse a `BRANCH_I1` report is the
 * scoped permission evaluation (P1-18-A-01).
 */
const INV_SCOPED_I2: Principal = {
  roleId: 'f1330000-0000-4000-8000-000000000131',
  userId: 'f1330000-0000-4000-8000-000000000132',
  subject: 'fx_p1_31_inv_scoped_i2',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, STOCK_READ],
  scope: { companyId: COMPANY_I, branchId: BRANCH_I2 },
  grantId: 'f1330000-0000-4000-8000-0000000001f1',
};

/** Tenant B, unrestricted in its OWN tenant. A refusal is tenancy, not authority. */
const INV_TENANT_B: Principal = {
  roleId: 'f1330000-0000-4000-8000-000000000141',
  userId: 'f1330000-0000-4000-8000-000000000142',
  subject: 'fx_p1_31_inv_tenant_b',
  tenantId: TENANT_B,
  permissions: [REPORT_READ, STOCK_READ],
};

const PRINCIPALS: readonly Principal[] = [
  INV_RPT_FULL,
  RPT_ONLY,
  STOCK_ONLY,
  INV_SCOPED_I2,
  INV_TENANT_B,
];

const REACH_ROLE = 'f1330000-0000-4000-8000-000000000151';
const REACH_GRANT = 'f1330000-0000-4000-8000-000000000152';

// ---- Catalogue --------------------------------------------------------------

const CATEGORY_I = 'f1330000-0000-4000-8000-0000000002c1';

/**
 * Two items on two INCOMPATIBLE units, and the incompatibility is the point.
 *
 * `each` has dimension `count` and `litre` has dimension `volume`
 * (`inv.units_of_measure`, platform scope). D-5 forbids a single quantity across
 * unlike items, and a suite whose items shared a unit could not tell a report
 * that separates its totals from one that happens to add compatible numbers.
 */
const ITEM_BOLT = 'f1330000-0000-4000-8000-0000000002a1';
const ITEM_OIL = 'f1330000-0000-4000-8000-0000000002a2';
const SKU_BOLT = 'FX-P131-INV-BOLT';
const SKU_OIL = 'FX-P131-INV-OIL';
/** The platform unit ids, read back in `beforeAll` rather than written down. */
let uomEach = '';
let uomLitre = '';

const WAREHOUSE_I1 = 'f1330000-0000-4000-8000-0000000003a1';
const QUARANTINE_I1 = 'f1330000-0000-4000-8000-0000000003a2';
const WAREHOUSE_I2 = 'f1330000-0000-4000-8000-0000000003b1';
const WAREHOUSE_CODE = 'fx_p131_inv_wh1';
const WAREHOUSE_NAME = 'P1-31 Inventory Reported Warehouse';
const QUARANTINE_CODE = 'fx_p131_inv_q1';

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
  return run({ companyId: COMPANY_I, branchId: BRANCH_I1, from: FROM, to: TO, ...extra });
}

const body = async (response: Response): Promise<RunBody> => (await response.json()) as RunBody;

type Row = { readonly cells: readonly Cell[] };

function cellValue(row: Row, key: string): string | null {
  return row.cells.find((entry) => entry.key === key)?.value ?? null;
}
function cellLabel(row: Row, key: string): string | null {
  return row.cells.find((entry) => entry.key === key)?.label ?? null;
}
/** The group for one (item, unit, movement type), or undefined when absent. */
function groupFor(view: RunBody, itemId: string, unit: string, type: string): Group | undefined {
  return view.groups.find(
    (entry) =>
      entry.key.item === itemId && entry.key.unit === unit && entry.key.movementType === type
  );
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
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    if (principal.scope === undefined) {
      await client.query(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
        [principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
    } else {
      await client.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes
           (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [
          principal.tenantId,
          principal.grantId,
          principal.scope.companyId,
          principal.scope.branchId,
          USER_A,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * One movement with a CHOSEN instant, cited to a real source row.
 *
 * ## The insert is real, and the trigger is what makes it real
 *
 * `tg_stock_movements_provenance` re-reads the source and refuses the insert
 * unless the movement type, the direction and the quantity all match it, so every
 * fixture movement below is a movement the platform itself would have accepted.
 *
 * ## Why the instant is RESTATED after the insert, and what that admits
 *
 * A measured fact, recorded rather than worked around quietly:
 * `tg_stock_movements_stamp` runs `shared.stamp_status_history`, which assigns
 * `NEW.occurred_at := now()` unconditionally. **The ledger cannot record a
 * backdated movement.** No route, no protected function and no INSERT of any kind
 * can choose a movement's instant — a case below proves that against the live
 * function rather than against this comment.
 *
 * The half-open boundary, however, is a claim about CHOSEN instants one second
 * apart in a named zone, and every movement a suite inserts otherwise lands
 * inside the same microsecond-wide cluster of `now()`. So the fixture inserts
 * through the full guard — which is what validates the row — and then restates
 * `occurred_at` with an admin UPDATE in the same transaction.
 *
 * That UPDATE is visibly a fixture-only act and not a path the application has:
 * `inv.stock_movements` grants `app_runtime` SELECT and INSERT and nothing else,
 * so no application code could perform it. Nothing else about the row is touched,
 * `signed_qty` is GENERATED from `direction` and re-derives itself, and the
 * provenance the trigger checked is unchanged.
 */
async function seedMovement(input: {
  readonly branchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly movementType: string;
  readonly direction: string;
  readonly quantity: string;
  readonly referenceKind: string;
  readonly referenceId: string;
  readonly occurredAt: string;
}): Promise<string> {
  // `tg_stock_movements_stamp` runs `shared.stamp_status_history`, which refuses
  // an insert with no actor in the session context — so the fixture supplies one
  // the way the application does, rather than bypassing the trigger.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO inv.stock_movements
         (tenant_id, company_id, branch_id, item_id, location_id, movement_type, direction,
          quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11::timestamptz,$12,$12) RETURNING id`,
      [
        TENANT_A,
        COMPANY_I,
        input.branchId,
        input.itemId,
        input.locationId,
        input.movementType,
        input.direction,
        input.quantity,
        input.referenceKind,
        input.referenceId,
        input.occurredAt,
        USER_A,
      ]
    );
    const id = inserted.rows[0]?.id ?? '';
    // See the docblock: the ledger stamps `now()` and has no other way to carry a
    // business instant, so the fixture restates the one the period is about.
    await client.query(
      `UPDATE inv.stock_movements SET occurred_at = $2::timestamptz WHERE id = $1`,
      [id, input.occurredAt]
    );
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** An APPROVED opening batch with one line. The only source an `opening` may cite. */
async function seedOpeningLine(input: {
  readonly branchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  readonly batchCode: string;
}): Promise<string> {
  const batch = await admin.query<{ id: string }>(
    `INSERT INTO inv.opening_inventory_batches
       (tenant_id, company_id, branch_id, batch_code, as_of_date, counted_by, approved_by,
        approved_at, status, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,now(),'approved',$6) RETURNING id`,
    // `ck_opening_inventory_batches_maker`: the approver must differ from the
    // counter, so the two fixture identities are genuinely two.
    [TENANT_A, COMPANY_I, input.branchId, input.batchCode, FROM, USER_A, INV_RPT_FULL.userId]
  );
  const line = await admin.query<{ id: string }>(
    `INSERT INTO inv.opening_inventory_lines
       (tenant_id, company_id, branch_id, batch_id, item_id, location_id, quantity, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8) RETURNING id`,
    [
      TENANT_A,
      COMPANY_I,
      input.branchId,
      batch.rows[0]?.id ?? '',
      input.itemId,
      input.locationId,
      input.quantity,
      USER_A,
    ]
  );
  return line.rows[0]?.id ?? '';
}

/** An APPROVED adjustment. The only source an `adjustment` movement may cite. */
async function seedAdjustment(input: {
  readonly branchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly direction: string;
  readonly quantity: string;
}): Promise<string> {
  const row = await admin.query<{ id: string }>(
    `INSERT INTO inv.stock_adjustments
       (tenant_id, company_id, branch_id, item_id, location_id, direction, quantity, reason,
        status, requested_by, approved_by, approved_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,'P1-31 report fixture','approved',$8,$9,now(),$8)
     RETURNING id`,
    // `ck_stock_adjustments_maker`: approver <> requester.
    [
      TENANT_A,
      COMPANY_I,
      input.branchId,
      input.itemId,
      input.locationId,
      input.direction,
      input.quantity,
      USER_A,
      INV_RPT_FULL.userId,
    ]
  );
  return row.rows[0]?.id ?? '';
}

// The rows every case reads.
let openingId = '';
let issueId = '';
let returnId = '';
let damageOutId = '';
let damageInId = '';
let adjustmentInId = '';
let adjustmentOutId = '';
let partIssueRef = '';
let partReturnRef = '';
let damageRef = '';
let openingLineRef = '';

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);

  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_p1_31_inv','P1-31 Inventory Reporting Company','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_I, TENANT_A, USER_A]
  );
  for (const [id, code, name] of [
    [BRANCH_I1, 'fx_p1_31_inv_b1', 'P1-31 Inventory Reported Branch'],
    [BRANCH_I2, 'fx_p1_31_inv_b2', 'P1-31 Inventory Sibling Branch'],
  ]) {
    await admin.query(
      `INSERT INTO org.branches
         (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, COMPANY_I, code, name, BRANCH_TIMEZONE, USER_A]
    );
  }

  for (const principal of PRINCIPALS) await seedPrincipal(principal);

  // The reach role: an unrelated permission scoped to BRANCH_I1, so I1 is inside
  // INV_SCOPED_I2's permission-blind branch union with no report or stock
  // authority there. Without it the isolation case would pass because RLS returned
  // nothing, which proves the wrong control.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_31_inv_reach','P1-31 inventory reach only',$3)
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
      [REACH_GRANT, TENANT_A, INV_SCOPED_I2.userId, REACH_ROLE, USER_A]
    );
    await reach.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [TENANT_A, REACH_GRANT, COMPANY_I, BRANCH_I1, USER_A]
    );
    await reach.query('COMMIT');
  } catch (error) {
    await reach.query('ROLLBACK');
    throw error;
  } finally {
    reach.release();
  }

  // The platform units, by CODE. Their ids are seed data and are not written down
  // in this file: a hard-coded id would make the suite assert the seed rather than
  // the report.
  const units = await admin.query<{ id: string; code: string }>(
    `SELECT id, code FROM inv.units_of_measure WHERE scope = 'platform' AND code IN ('each','litre')`
  );
  uomEach = units.rows.find((row) => row.code === 'each')?.id ?? '';
  uomLitre = units.rows.find((row) => row.code === 'litre')?.id ?? '';

  await admin.query(
    `INSERT INTO inv.item_categories (id, tenant_id, code, name, created_by)
     VALUES ($1,$2,'fx_p1_31_report','P1-31 report fixture parts',$3)
     ON CONFLICT (id) DO NOTHING`,
    [CATEGORY_I, TENANT_A, USER_A]
  );
  for (const [id, sku, name, uom] of [
    [ITEM_BOLT, SKU_BOLT, 'P1-31 fixture bolt', uomEach],
    [ITEM_OIL, SKU_OIL, 'P1-31 fixture oil', uomLitre],
  ]) {
    await admin.query(
      `INSERT INTO inv.item_master
         (id, tenant_id, item_category_id, sku, name, uom_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, CATEGORY_I, sku, name, uom, USER_A]
    );
  }
  // `inv.guard_stock_location_hierarchy` refuses a quarantine location with no
  // parent warehouse, so the quarantine below hangs off the warehouse it takes
  // damaged stock from — the shape the schema requires, not a convenience.
  for (const [id, branchId, code, name, type, parent] of [
    [WAREHOUSE_I1, BRANCH_I1, WAREHOUSE_CODE, WAREHOUSE_NAME, 'warehouse', null],
    [
      QUARANTINE_I1,
      BRANCH_I1,
      QUARANTINE_CODE,
      'P1-31 Inventory Quarantine',
      'quarantine',
      WAREHOUSE_I1,
    ],
    [
      WAREHOUSE_I2,
      BRANCH_I2,
      'fx_p131_inv_wh2',
      'P1-31 Inventory Sibling Warehouse',
      'warehouse',
      null,
    ],
  ]) {
    await admin.query(
      `INSERT INTO inv.stock_locations
         (id, tenant_id, company_id, branch_id, location_code, name, location_type,
          parent_location_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, COMPANY_I, branchId, code, name, type, parent, USER_A]
    );
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

  // ---- The selection --------------------------------------------------------
  //
  // OPENING, in, 10.000 bolts, at the FIRST INCLUDED INSTANT — local midnight on
  // the first reported day. In.
  openingLineRef = await seedOpeningLine({
    branchId: BRANCH_I1,
    itemId: ITEM_BOLT,
    locationId: WAREHOUSE_I1,
    quantity: '10.000',
    batchCode: 'fx_p131_open_1',
  });
  openingId = await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_BOLT,
    locationId: WAREHOUSE_I1,
    movementType: 'opening',
    direction: 'in',
    quantity: '10.000',
    referenceKind: 'opening_line',
    referenceId: openingLineRef,
    occurredAt: periodOpens,
  });

  // ISSUE, out, 4.000 bolts. `inv.part_issues` names a real work order, so the
  // fixture builds one through the same route the board does.
  const visit = await seedAuthorizedVisit({ companyId: COMPANY_I, branchId: BRANCH_I1 });
  const order = await admin.query<{ id: string }>(
    `INSERT INTO wo.work_orders
       (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [TENANT_A, COMPANY_I, BRANCH_I1, visit.visitId, visit.vehicleId, USER_A]
  );
  const workOrderId = order.rows[0]?.id ?? '';
  await advance(workOrderId, [{ toState: 'open' }], FULL);
  __resetAuthenticatorForTests();

  const issue = await admin.query<{ id: string }>(
    `INSERT INTO inv.part_issues
       (tenant_id, company_id, branch_id, work_order_id, item_id, location_id, quantity, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8) RETURNING id`,
    [TENANT_A, COMPANY_I, BRANCH_I1, workOrderId, ITEM_BOLT, WAREHOUSE_I1, '4.000', USER_A]
  );
  partIssueRef = issue.rows[0]?.id ?? '';
  issueId = await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_BOLT,
    locationId: WAREHOUSE_I1,
    movementType: 'issue',
    direction: 'out',
    quantity: '4.000',
    referenceKind: 'part_issue',
    referenceId: partIssueRef,
    occurredAt: middle,
  });

  // RETURN, in, 1.500 bolts, against that issue. `tg_part_returns_ceiling`
  // refuses a return larger than what was issued, so this is a real return.
  const returned = await admin.query<{ id: string }>(
    `INSERT INTO inv.part_returns
       (tenant_id, company_id, branch_id, part_issue_id, quantity, created_by)
     VALUES ($1,$2,$3,$4,$5::numeric,$6) RETURNING id`,
    [TENANT_A, COMPANY_I, BRANCH_I1, partIssueRef, '1.500', USER_A]
  );
  partReturnRef = returned.rows[0]?.id ?? '';
  returnId = await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_BOLT,
    locationId: WAREHOUSE_I1,
    movementType: 'return',
    direction: 'in',
    quantity: '1.500',
    referenceKind: 'part_return',
    referenceId: partReturnRef,
    occurredAt: shift(middle, HOUR),
  });

  // DAMAGE — the ONE kind that posts a PAIR from a single source: out of the
  // sellable location and in to quarantine. `uq_stock_movements_source` is unique
  // on (kind, id, direction), which is what permits exactly two and no more.
  // Both carry the SAME instant, because one statement posts both; the keyset's
  // row-id tie-break is what keeps them stably ordered.
  const damaged = await admin.query<{ id: string }>(
    `INSERT INTO inv.damaged_stock
       (tenant_id, company_id, branch_id, item_id, from_location_id, quarantine_location_id,
        quantity, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,'P1-31 report fixture',$8) RETURNING id`,
    [TENANT_A, COMPANY_I, BRANCH_I1, ITEM_BOLT, WAREHOUSE_I1, QUARANTINE_I1, '2.000', USER_A]
  );
  damageRef = damaged.rows[0]?.id ?? '';
  damageOutId = await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_BOLT,
    locationId: WAREHOUSE_I1,
    movementType: 'damage',
    direction: 'out',
    quantity: '2.000',
    referenceKind: 'damage',
    referenceId: damageRef,
    occurredAt: shift(middle, 2 * HOUR),
  });
  damageInId = await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_BOLT,
    locationId: QUARANTINE_I1,
    movementType: 'damage',
    direction: 'in',
    quantity: '2.000',
    referenceKind: 'damage',
    referenceId: damageRef,
    occurredAt: shift(middle, 2 * HOUR),
  });

  // ADJUSTMENT, in, 3.250 LITRES of oil. A second item on an incompatible unit.
  adjustmentInId = await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_OIL,
    locationId: WAREHOUSE_I1,
    movementType: 'adjustment',
    direction: 'in',
    quantity: '3.250',
    referenceKind: 'adjustment',
    referenceId: await seedAdjustment({
      branchId: BRANCH_I1,
      itemId: ITEM_OIL,
      locationId: WAREHOUSE_I1,
      direction: 'in',
      quantity: '3.250',
    }),
    occurredAt: shift(middle, 3 * HOUR),
  });
  // ADJUSTMENT, out, 0.750 litres, ONE SECOND before the period closes. In.
  adjustmentOutId = await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_OIL,
    locationId: WAREHOUSE_I1,
    movementType: 'adjustment',
    direction: 'out',
    quantity: '0.750',
    referenceKind: 'adjustment',
    referenceId: await seedAdjustment({
      branchId: BRANCH_I1,
      itemId: ITEM_OIL,
      locationId: WAREHOUSE_I1,
      direction: 'out',
      quantity: '0.750',
    }),
    occurredAt: shift(periodCloses, -SECOND),
  });

  // EXACTLY at the first excluded instant. Out.
  await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_BOLT,
    locationId: WAREHOUSE_I1,
    movementType: 'adjustment',
    direction: 'in',
    quantity: '9.999',
    referenceKind: 'adjustment',
    referenceId: await seedAdjustment({
      branchId: BRANCH_I1,
      itemId: ITEM_BOLT,
      locationId: WAREHOUSE_I1,
      direction: 'in',
      quantity: '9.999',
    }),
    occurredAt: periodCloses,
  });
  // ONE SECOND before the period opens. Out.
  await seedMovement({
    branchId: BRANCH_I1,
    itemId: ITEM_BOLT,
    locationId: WAREHOUSE_I1,
    movementType: 'adjustment',
    direction: 'in',
    quantity: '8.888',
    referenceKind: 'adjustment',
    referenceId: await seedAdjustment({
      branchId: BRANCH_I1,
      itemId: ITEM_BOLT,
      locationId: WAREHOUSE_I1,
      direction: 'in',
      quantity: '8.888',
    }),
    occurredAt: shift(periodOpens, -SECOND),
  });

  // The SIBLING branch's own movement, inside the same period.
  await seedMovement({
    branchId: BRANCH_I2,
    itemId: ITEM_BOLT,
    locationId: WAREHOUSE_I2,
    movementType: 'adjustment',
    direction: 'in',
    quantity: '7.000',
    referenceKind: 'adjustment',
    referenceId: await seedAdjustment({
      branchId: BRANCH_I2,
      itemId: ITEM_BOLT,
      locationId: WAREHOUSE_I2,
      direction: 'in',
      quantity: '7.000',
    }),
    occurredAt: middle,
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

describe('inventory_movements — the rows the Owner asked for', () => {
  it('publishes the D-4 columns in the D-4 order, with the kinds a client renders from', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report());
    expect(view.columns.map((column) => column.key)).toEqual([
      'occurredAt',
      'reference',
      'movementType',
      'direction',
      'item',
      'location',
      'quantity',
      'unit',
    ]);
    expect(view.columns.map((column) => column.kind)).toEqual([
      'date',
      'text',
      'text',
      'text',
      'reference',
      'text',
      // The `quantity` kind is how a client knows this string is neither a count
      // nor an amount, and must not be re-formatted as either.
      'quantity',
      'text',
    ]);
    // No drill-through on `item`: there is no per-item read operation to name.
    // A case below proves that against the register rather than against a comment.
    expect(view.columns.map((column) => column.drillThrough)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(view.reportCode).toBe(REPORT_CODE);
    expect(view.titleKey).toBe('reports.inventory_movements.title');
    expect(view.scope).toBe('branch');
    expect(view.freshness).toBe('live');
  });

  it('returns every movement of the period, newest first, and nothing else', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    // Seven: opening, issue, return, the damage PAIR, and two adjustments.
    expect(view.rows.items).toHaveLength(7);
    const instants = view.rows.items.map((row) => cellValue(row, 'occurredAt'));
    // Descending, and the assertion is on the whole sequence rather than on the
    // ends: a report ordered by anything but its own period column reads as
    // shuffled even when the set is right.
    expect([...instants].sort().reverse()).toEqual(instants);
    expect(instants[0]).toBe(shift(periodCloses, -SECOND));
    expect(instants[6]).toBe(periodOpens);
  });

  it('carries each of the five movement types with the direction the ledger constrains', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    const pairs = view.rows.items.map((row) => [
      cellValue(row, 'movementType'),
      cellValue(row, 'direction'),
    ]);
    // `ck_stock_movements_type_direction` pins opening and return to `in` and
    // issue to `out`; damage and adjustment may go either way, and damage posts
    // BOTH from one source row.
    expect(pairs).toContainEqual(['opening', 'in']);
    expect(pairs).toContainEqual(['issue', 'out']);
    expect(pairs).toContainEqual(['return', 'in']);
    expect(pairs).toContainEqual(['damage', 'out']);
    expect(pairs).toContainEqual(['damage', 'in']);
    expect(pairs).toContainEqual(['adjustment', 'in']);
    expect(pairs).toContainEqual(['adjustment', 'out']);
    // Five distinct terms, and no sixth.
    expect(new Set(pairs.map(([type]) => type))).toEqual(
      new Set(['opening', 'issue', 'return', 'damage', 'adjustment'])
    );
  });

  it('names each movement by its business reference, item, location and unit', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    const opening = view.rows.items.find((row) => cellValue(row, 'movementType') === 'opening');
    expect(opening).toBeDefined();
    if (opening === undefined) return;
    // The reference is the ledger's own (kind, id) pair: the kind labels it and
    // the id identifies it. Nothing is concatenated.
    expect(cellLabel(opening, 'reference')).toBe('opening_line');
    expect(cellValue(opening, 'reference')).toBe(openingLineRef);
    // The item carries its SKU as the label and its id as the value.
    expect(cellLabel(opening, 'item')).toBe(SKU_BOLT);
    expect(cellValue(opening, 'item')).toBe(ITEM_BOLT);
    // The location carries its name and its branch-unique code.
    expect(cellLabel(opening, 'location')).toBe(WAREHOUSE_NAME);
    expect(cellValue(opening, 'location')).toBe(WAREHOUSE_CODE);
    // The quantity is a DECIMAL STRING at the column's own scale, and the unit is
    // its own column: a quantity without a unit is not a quantity (D-5).
    expect(cellValue(opening, 'quantity')).toBe('10.000');
    expect(cellValue(opening, 'unit')).toBe('each');
    expect(cellLabel(opening, 'unit')).toBe('Each');
  });

  it('sends the damage PAIR as two rows, out of stock and in to quarantine', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    const damage = view.rows.items.filter((row) => cellValue(row, 'movementType') === 'damage');
    expect(damage).toHaveLength(2);
    // One source row, two movements, two locations. Netting them to zero would
    // lose the fact that stock left the shelf, which is the whole record.
    expect(new Set(damage.map((row) => cellValue(row, 'reference')))).toEqual(new Set([damageRef]));
    const byDirection = new Map(damage.map((row) => [cellValue(row, 'direction'), row]));
    expect(cellValue(byDirection.get('out') as Row, 'location')).toBe(WAREHOUSE_CODE);
    expect(cellValue(byDirection.get('in') as Row, 'location')).toBe(QUARANTINE_CODE);
    expect(cellValue(byDirection.get('out') as Row, 'quantity')).toBe('2.000');
    expect(cellValue(byDirection.get('in') as Row, 'quantity')).toBe('2.000');
  });
});

describe('inventory_movements — the vocabulary the ledger actually has', () => {
  it('constrains movement_type to five terms, and TRANSFER is not one of them', async () => {
    // Measured against the live CHECK, not against a comment. D-4 asks that the
    // distinct meanings of a return and a transfer be preserved; there is no
    // transfer to preserve, so the report shows no transfer bucket rather than an
    // empty one that would read as a real zero.
    const check = await admin.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'inv.stock_movements'::regclass
          AND conname = 'ck_stock_movements_type'`
    );
    const definition = check.rows[0]?.definition ?? '';
    for (const term of ['opening', 'issue', 'return', 'damage', 'adjustment']) {
      expect(definition).toContain(term);
    }
    expect(definition).not.toContain('transfer');
    // And the ledger has no transfer row in the reported branch either, so the
    // absence is a property of the schema and not of this suite's fixtures.
    const posted = await admin.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM inv.stock_movements WHERE movement_type = 'transfer'`
    );
    expect(posted.rows[0]?.total).toBe('0');
  });

  it('stamps occurred_at from the transaction clock, so no movement can be backdated', async () => {
    // The measured fact this suite's fixtures are shaped around, proved against
    // the deployed function. `shared.stamp_status_history` assigns
    // `NEW.occurred_at := now()` on every insert into `inv.stock_movements`, and
    // `app_runtime` holds SELECT and INSERT on the table and no UPDATE — so a
    // movement's instant is the instant it was written and the platform offers no
    // way to record one that happened earlier. It is a named prerequisite in the
    // seam record, not a defect this slice invented.
    const source = await admin.query<{ prosrc: string }>(
      `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'shared' AND p.proname = 'stamp_status_history'`
    );
    expect(source.rows[0]?.prosrc ?? '').toContain('NEW.occurred_at := now()');
    const trigger = await admin.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM pg_trigger
        WHERE tgrelid = 'inv.stock_movements'::regclass AND tgname = 'tg_stock_movements_stamp'`
    );
    expect(trigger.rows[0]?.total).toBe('1');
    const grants = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'inv' AND table_name = 'stock_movements' AND grantee = 'app_runtime'`
    );
    const privileges = grants.rows.map((row) => row.privilege_type);
    expect(new Set(privileges)).toEqual(new Set(['SELECT', 'INSERT']));
  });

  it('records no unit on the movement itself, so the unit is the item’s current one', async () => {
    // A measured limitation, recorded rather than hidden. `inv.stock_movements`
    // carries no unit column: the report joins `inv.item_master.uom_id`, so the
    // unit on a row is the item's unit AS IT IS NOW. Re-pointing an item's unit
    // would therefore restate its history. It is a named prerequisite in the seam
    // record, and this case is what makes it a fact rather than a claim.
    const columns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'inv' AND table_name = 'stock_movements'`
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain('uom_id');
    expect(names).not.toContain('unit_id');
    expect(names).toContain('quantity');
  });
});

describe('inventory_movements — the totals the Owner asked for', () => {
  it('separates every total by item, by unit and by movement type', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    // Five groups: four for the bolt (opening, issue, return, damage) and one for
    // the oil (adjustment). Never fewer — a merge would be the defect D-5 forbids.
    expect(view.groups).toHaveLength(5);
    expect(groupFor(view, ITEM_BOLT, 'each', 'opening')?.measures).toEqual({
      quantityIn: '10.000',
      quantityOut: '0.000',
    });
    expect(groupFor(view, ITEM_BOLT, 'each', 'issue')?.measures).toEqual({
      quantityIn: '0.000',
      quantityOut: '4.000',
    });
    expect(groupFor(view, ITEM_BOLT, 'each', 'return')?.measures).toEqual({
      quantityIn: '1.500',
      quantityOut: '0.000',
    });
    // The damage PAIR: both halves inside one group, kept apart as two measures.
    expect(groupFor(view, ITEM_BOLT, 'each', 'damage')?.measures).toEqual({
      quantityIn: '2.000',
      quantityOut: '2.000',
    });
    expect(groupFor(view, ITEM_OIL, 'litre', 'adjustment')?.measures).toEqual({
      quantityIn: '3.250',
      quantityOut: '0.750',
    });
    // The label is the SKU — what a human reads. The unit and the type are legible
    // in the key, so nothing is stringified into the label.
    expect(groupFor(view, ITEM_OIL, 'litre', 'adjustment')?.label).toBe(SKU_OIL);
  });

  it('never nets a return against an issue', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    // 4.000 issued and 1.500 returned. A netted report would carry 2.500
    // somewhere; nothing on this envelope does, in either measure.
    const measures = view.groups.flatMap((group) => Object.values(group.measures));
    expect(measures).not.toContain('2.500');
    expect(measures).not.toContain('-2.500');
    // And the two remain two groups, each with the direction its type constrains.
    expect(groupFor(view, ITEM_BOLT, 'each', 'issue')?.measures.quantityOut).toBe('4.000');
    expect(groupFor(view, ITEM_BOLT, 'each', 'return')?.measures.quantityIn).toBe('1.500');
  });

  it('publishes no measure that spans two items or two units', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    // Every group key names exactly one item and exactly one unit, and the two
    // units present really are incompatible — `each` is a count and `litre` a
    // volume — so a sum across them could not even be given a name.
    for (const group of view.groups) {
      expect(typeof group.key.item).toBe('string');
      expect(typeof group.key.unit).toBe('string');
      expect(typeof group.key.movementType).toBe('string');
    }
    expect(new Set(view.groups.map((group) => group.key.unit))).toEqual(new Set(['each', 'litre']));
    // The bolt's 10.000 opening and the oil's 3.250 adjustment are never added:
    // 13.250 appears nowhere, and no group carries both items.
    const measures = view.groups.flatMap((group) => Object.values(group.measures));
    expect(measures).not.toContain('13.250');
    expect(view.groups.some((group) => group.key.item === null)).toBe(false);
  });

  it('compares every quantity as a STRING, at the column’s own scale', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    const quantities = view.rows.items.map((row) => cellValue(row, 'quantity'));
    // `numeric(12,3)` arrives from `pg` as text and stays text. Every value keeps
    // its third decimal place, which a JSON number would have been free to drop.
    for (const quantity of quantities) {
      expect(typeof quantity).toBe('string');
      expect(quantity).toMatch(/^\d+\.\d{3}$/);
    }
    expect(quantities).toContain('1.500');
    expect(quantities).toContain('3.250');
    expect(quantities).toContain('0.750');
    // The measures are strings too, never JSON numbers.
    for (const group of view.groups) {
      for (const value of Object.values(group.measures)) expect(typeof value).toBe('string');
    }
  });

  it('leaves the deprecated work-order field empty for a dataset that has no states', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report());
    // `countsByState` is slice 1's grouping on a shared envelope. Filling it here
    // would mean inventing a work-order state for a stock movement.
    expect(view.countsByState).toEqual([]);
  });
});

describe('inventory_movements — the half-open period in the branch zone', () => {
  it('includes the first instant of the period and excludes the one a second before it', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    const instants = view.rows.items.map((row) => cellValue(row, 'occurredAt'));
    // Local midnight on the first reported day is IN — it is `from` itself.
    expect(instants).toContain(periodOpens);
    // One second earlier is OUT, and its quantity appears in no total.
    expect(instants).not.toContain(shift(periodOpens, -SECOND));
    const measures = view.groups.flatMap((group) => Object.values(group.measures));
    expect(measures).not.toContain('8.888');
  });

  it('includes the last second of the period and excludes local midnight on the excluded day', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    const instants = view.rows.items.map((row) => cellValue(row, 'occurredAt'));
    // One second before `to` is IN; `to` itself is the first EXCLUDED instant.
    expect(instants).toContain(shift(periodCloses, -SECOND));
    expect(instants).not.toContain(periodCloses);
    const measures = view.groups.flatMap((group) => Object.values(group.measures));
    expect(measures).not.toContain('9.999');
  });

  it('states the zone the period was resolved in, and echoes the filter context', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report());
    // D-17: the timezone and the filter context travel with the numbers, so a
    // printed result can never be read without the selection that produced it.
    expect(view.period).toEqual({ from: FROM, to: TO, timezone: BRANCH_TIMEZONE });
    expect(view.filters).toEqual({ companyId: COMPANY_I, branchId: BRANCH_I1 });
    expect(view.branch).toEqual({ id: BRANCH_I1, name: 'P1-31 Inventory Reported Branch' });
  });

  it('refuses a period whose end is not after its start', async () => {
    authAs(INV_RPT_FULL);
    // `from === to` is an EMPTY period rather than a single day, because `to` is
    // exclusive. Answering it with no rows would read as "nothing moved".
    const response = await report({ to: FROM });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Problem).code).toBe('ERR-VAL-001');
  });
});

describe('inventory_movements — authorization', () => {
  it('refuses a caller who may run reports but may not read stock', async () => {
    authAs(RPT_ONLY);
    const response = await report();
    // Refused by the SERVICE, on the dataset's own declared code, with the uniform
    // failure the route's own check produces — so a caller cannot tell the two
    // apart and cannot use the difference to discover which datasets exist.
    expect(response.status).toBe(403);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toEqual([STOCK_READ]);
  });

  it('refuses a caller who may read stock but may not run reports', async () => {
    authAs(STOCK_ONLY);
    const response = await report();
    // Refused by the ROUTE. The counterfactual of the case above: collapse the two
    // codes into one and both go red, in opposite directions.
    expect(response.status).toBe(403);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toEqual([REPORT_READ]);
  });

  it('refuses a branch the caller holds no authority in, even when RLS can see it', async () => {
    authAs(INV_SCOPED_I2);
    // The decisive isolation case. This caller's permission-blind branch union
    // COVERS BRANCH_I1 through the reach role, so RLS would return its rows; the
    // only control that can refuse is the scoped permission evaluation.
    expect((await report()).status).toBe(403);
    // And the branch it IS granted in answers, which is what makes the refusal
    // above about scope rather than about the principal.
    const own = await run({ companyId: COMPANY_I, branchId: BRANCH_I2, from: FROM, to: TO });
    expect(own.status).toBe(200);
    const view = await body(own);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]?.measures.quantityIn).toBe('7.000');
  });

  it('does not show one branch the movements of another', async () => {
    authAs(INV_RPT_FULL);
    const view = await body(await report({ limit: '50' }));
    // The sibling branch's 7.000 is inside the same period and the same tenant.
    const measures = view.groups.flatMap((group) => Object.values(group.measures));
    expect(measures).not.toContain('7.000');
    expect(view.rows.items.map((row) => cellValue(row, 'quantity'))).not.toContain('7.000');
  });

  it('does not answer for another tenant', async () => {
    authAs(INV_TENANT_B);
    // Unrestricted in its OWN tenant, so a refusal here is tenancy and not
    // authority: `requireScopeTargetInTenant` resolves the pair under the caller's
    // own RLS and finds nothing.
    expect((await report()).status).toBe(403);
  });
});

describe('inventory_movements — paging', () => {
  it('pages the movements while the groups keep answering for the whole selection', async () => {
    authAs(INV_RPT_FULL);
    const first = await body(await report({ limit: '3' }));
    expect(first.rows.items).toHaveLength(3);
    expect(first.rows.hasMore).toBe(true);
    expect(first.rows.nextCursor).not.toBeNull();
    // The totals are the SELECTION's, never the page's — the P1-28 round-two rule.
    // The opening is on the LAST page and its 10.000 is already in the group.
    expect(groupFor(first, ITEM_BOLT, 'each', 'opening')?.measures.quantityIn).toBe('10.000');

    const second = await body(
      await report({ limit: '3', cursor: first.rows.nextCursor as string })
    );
    expect(second.rows.items).toHaveLength(3);
    // Identical groups on both pages. A group that moved with the page would be
    // answering for the page.
    expect(second.groups).toEqual(first.groups);

    const third = await body(
      await report({ limit: '3', cursor: second.rows.nextCursor as string })
    );
    expect(third.rows.items).toHaveLength(1);
    expect(third.rows.hasMore).toBe(false);
    // Seven distinct movements across three pages, with no row seen twice — the
    // property a keyset over a non-unique sort column only has because the row id
    // is the tie-break. The damage pair SHARES an instant and is split across the
    // first boundary, which is exactly where a sort-only cursor loses a row.
    const paged = [...first.rows.items, ...second.rows.items, ...third.rows.items].map((row) =>
      cellValue(row, 'reference')
    );
    const whole = (await body(await report({ limit: '50' }))).rows.items.map((row) =>
      cellValue(row, 'reference')
    );
    expect(paged).toEqual(whole);
    expect(paged.filter((reference) => reference === damageRef)).toHaveLength(2);
  });

  it('refuses a malformed cursor and one minted for a different ordering contract', async () => {
    authAs(INV_RPT_FULL);
    const malformed = await report({ cursor: 'not-a-cursor' });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Problem).code).toBe('ERR-PAG-001');

    // Well formed base64url, issued for the LEDGER SCREEN's ordering over the SAME
    // table. A cursor is refused rather than reinterpreted: the ledger sorts on
    // `seq` and this report on `occurred_at`, and re-using one across the two
    // would silently produce a wrong page.
    authAs(INV_RPT_FULL);
    const foreign = Buffer.from(JSON.stringify({ k: 'seq', v: '1', i: openingId })).toString(
      'base64url'
    );
    const response = await report({ cursor: foreign });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Problem).code).toBe('ERR-PAG-001');
  });
});

describe('the registry', () => {
  it('registers the dataset the Owner approved, with the permission it declares', async () => {
    expect([...REPORT_DATASET_CODES]).toContain(REPORT_CODE);
    // One code: every column this report publishes is `inv` master data or the
    // ledger itself, so unlike the labour report there is no second module's
    // record in the row and no second code to name.
    expect([...REPORT_DATASETS.inventory_movements.requiredPermissions]).toEqual([STOCK_READ]);
    expect(REPORT_DATASETS.inventory_movements.scope).toBe('branch');
    // The parameter schema is the shared period: two required calendar dates, and
    // no default period, because "the last thirty days" is a business rule nobody
    // has decided.
    expect(REPORT_DATASETS.inventory_movements.parameterSchema.map((p) => p.name)).toEqual([
      'from',
      'to',
    ]);
    // Non-vacuity for the ids the rows above are keyed on.
    expect(uomEach).not.toBe('');
    expect(uomLitre).not.toBe(uomEach);
    expect(openingId).not.toBe('');
    expect(issueId).not.toBe('');
    expect(returnId).not.toBe('');
    expect(damageOutId).not.toBe(damageInId);
    expect(adjustmentInId).not.toBe(adjustmentOutId);
    expect(partIssueRef).not.toBe(partReturnRef);
  });
});
