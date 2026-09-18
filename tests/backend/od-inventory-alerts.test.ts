/**
 * Owner directive — operational stock alerts, end to end through their route
 * handlers.
 *
 * The five reads exist to be ACTED ON, so what this suite proves is not that they
 * answer 200 but that what they answer is checkable and that the thresholds are
 * where they claim to be:
 *
 *  - an item with NO configured reorder level never appears in low stock, however
 *    empty its shelf is. "Low" is a fact only once somebody has said what low means;
 *  - the low-stock boundary is `at or below`, tested at the level, one step below
 *    it and one step above it;
 *  - a count discrepancy carries the variance the adjustment was raised from and
 *    that adjustment's approval state;
 *  - the unusual-consumption rule fires at its own stated multiple and not below
 *    it, and the response carries every window it compared;
 *  - an aged transfer appears at one age threshold and not at a longer one.
 *
 * ## Two fixture techniques, named rather than hidden
 *
 * `backdate` moves `occurred_at` on movements the product has already posted. The
 * ledger is append-only to the APPLICATION — there is no UPDATE grant and no UPDATE
 * policy for `app_runtime` — and this runs on the admin pool, which is how a suite
 * can ask "what would this read say next week" without waiting a week. The rows
 * themselves are real issues, posted through `POST /stock-issues` against an
 * approved material requirement, with real provenance.
 *
 * The count and the transfer are inserted directly, because both alerts read a
 * finished record: a count that was reconciled a fortnight ago and a transfer
 * dispatched ten days ago. Their own operations are covered by
 * `p1-32-inventory-operations.test.ts`; what is under test here is the reading.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.reorder-level-set: route service authorization success denial audit idempotency isolation
 *   inv.reorder-level-list: route service authorization success denial isolation
 *   inv.reorder-level-retire: route service authorization success denial cross-tenant stale-version audit idempotency isolation
 *   inv.low-stock-alert-read: route service authorization success denial isolation
 *   inv.count-discrepancy-alert-read: route service authorization success denial isolation
 *   inv.unusual-consumption-alert-read: route service authorization success denial isolation
 *   inv.aged-in-transit-alert-read: route service authorization success denial isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  USER_A,
} from './helpers';
import { BRANCH_A2, establishP1_19Fixtures, createOpenWorkOrder } from './p1-19-helpers';
import {
  CATEGORY_A,
  INV_APPROVER,
  INV_CATALOG,
  INV_CATALOG_SCOPED_A1,
  INV_MATERIAL,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  INV_TENANT_B_CATALOG,
  QUARANTINE_A1,
  UOM_EACH,
  WAREHOUSE_A2,
  authAs,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
  seedApprovedMaterialRequirement,
  seedStock,
} from './p1-21-helpers';
import { GET as REORDER_LIST, POST as REORDER_SET } from '@/app/api/v1/reorder-levels/route';
import { POST as REORDER_RETIRE } from '@/app/api/v1/reorder-levels/[reorderLevelId]/retirement/route';
import { GET as LOW_STOCK } from '@/app/api/v1/inventory-alerts/low-stock/route';
import { GET as DISCREPANCIES } from '@/app/api/v1/inventory-alerts/count-discrepancies/route';
import { GET as CONSUMPTION } from '@/app/api/v1/inventory-alerts/unusual-consumption/route';
import { GET as AGED } from '@/app/api/v1/inventory-alerts/aged-in-transit/route';
import { POST as ISSUE } from '@/app/api/v1/stock-issues/route';

let admin: Pool;
let sequence = 0;

type Handler = (request: Request) => Promise<Response>;
type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const get = (handler: Handler, path: string): Promise<Response> =>
  handler(new Request(`http://localhost${path}`, { method: 'GET' }));

const post = (
  handler: Handler,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...headers },
      body: JSON.stringify(body),
    })
  );

const postAt = <P>(
  handler: ParamHandler<P>,
  path: string,
  params: P,
  headers: Record<string, string> = {}
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...headers },
    }),
    { params: Promise.resolve(params) }
  );

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

interface Problem {
  readonly code: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface ReorderLevelBody {
  readonly id: string;
  readonly itemId: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly locationId: string | null;
  readonly reorderLevelQty: string;
  readonly preferredOrderQty: string | null;
  readonly status: string;
  readonly replayed: boolean;
  readonly recordVersion: number;
}

interface LowStockBody {
  readonly asOf: string;
  readonly rule: { readonly statement: string; readonly excludedLocationTypes: string[] };
  readonly findings: {
    readonly items: readonly {
      readonly itemId: string;
      readonly scope: string;
      readonly availableQty: string;
      readonly reorderLevelQty: string;
      readonly shortfallQty: string;
      readonly preferredOrderQty: string | null;
    }[];
  };
}

interface DiscrepancyBody {
  readonly asOf: string;
  readonly findings: {
    readonly items: readonly {
      readonly countId: string;
      readonly itemId: string;
      readonly varianceQty: string;
      readonly countedOn: string;
      readonly adjustmentId: string | null;
      readonly adjustmentStatus: string | null;
    }[];
  };
}

interface ConsumptionBody {
  readonly asOf: string;
  readonly rule: {
    readonly statement: string;
    readonly periodDays: number;
    readonly baselinePeriods: number;
    readonly multiple: string;
    readonly minimumQty: string;
    readonly baselineStatistic: string;
  };
  readonly findings: {
    readonly items: readonly {
      readonly itemId: string;
      readonly observedQty: string;
      readonly baselineMedianQty: string;
      readonly observedPeriod: { from: string; to: string; issuedQty: string };
      readonly baselinePeriods: readonly { from: string; to: string; issuedQty: string }[];
    }[];
  };
}

interface AgedBody {
  readonly asOf: string;
  readonly rule: { readonly statement: string; readonly minimumAgeDays: number };
  readonly findings: {
    readonly items: readonly {
      readonly transferId: string;
      readonly ageDays: number;
      readonly outstandingQuantity: string;
      readonly fromBranchId: string;
      readonly toBranchId: string;
    }[];
  };
}

/** An item nobody else's fixtures touch, so a branch-wide aggregate is readable. */
async function freshItem(): Promise<string> {
  sequence += 1;
  const row = await admin.query<{ id: string }>(
    `INSERT INTO inv.item_master
       (tenant_id, item_category_id, sku, name, uom_id, created_by)
     VALUES ($1,$2,$3,$3,$4,$5) RETURNING id`,
    [TENANT_A, CATEGORY_A, `FX-ALERT-${sequence}`, UOM_EACH, USER_A]
  );
  return row.rows[0]?.id ?? '';
}

const setLevel = (body: Record<string, unknown>): Promise<Response> =>
  post(REORDER_SET, '/api/v1/reorder-levels', body);

const readLowStock = (query = ''): Promise<Response> =>
  get(
    LOW_STOCK,
    `/api/v1/inventory-alerts/low-stock?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}${query}`
  );

/**
 * Moves `occurred_at` on the movements one issue posted into the past.
 *
 * The application cannot do this — `inv.stock_movements` grants `app_runtime`
 * SELECT and INSERT only — and that is the point: the rows are real issues with
 * real provenance, and only their instant is a fixture.
 */
async function backdate(issueId: string, days: number): Promise<void> {
  await admin.query(
    `UPDATE inv.stock_movements
        SET occurred_at = now() - make_interval(days => $2::int)
      WHERE reference_kind = 'part_issue' AND reference_id = $1`,
    [issueId, days]
  );
}

/** Issues `quantity` of `itemId` from `cell` against an approved requirement. */
async function issueParts(
  itemId: string,
  cell: string,
  quantity: string
): Promise<{ readonly issueId: string }> {
  const workOrder = await createOpenWorkOrder();
  const requirementId = await seedApprovedMaterialRequirement({
    workOrderId: workOrder.workOrderId,
    itemId,
    allowance: '100000',
  });
  authAs(INV_MATERIAL);
  const response = await post(ISSUE, '/api/v1/stock-issues', {
    workOrderId: workOrder.workOrderId,
    itemId,
    locationId: cell,
    quantity,
    materialRequirementId: requirementId,
  });
  expect(response.status).toBe(201);
  const issued = await bodyOf<{ id: string }>(response);
  return { issueId: issued.id };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
}, 180_000);

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

// ---------------------------------------------------------------------------
// Reorder levels — the configuration every low-stock finding rests on.
// ---------------------------------------------------------------------------

describe('inv.reorder-level-set', () => {
  it('sets a branch level, revises it, and replays an unchanged call without a second audit row', async () => {
    const itemId = await freshItem();
    authAs(INV_CATALOG);

    const created = await setLevel({
      itemId,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      reorderLevelQty: '5',
      preferredOrderQty: '20',
    });
    expect(created.status).toBe(200);
    const level = await bodyOf<ReorderLevelBody>(created);
    expect(level).toMatchObject({
      itemId,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      locationId: null,
      reorderLevelQty: '5.000',
      preferredOrderQty: '20.000',
      status: 'active',
      replayed: false,
    });
    expect(await auditRows(level.id)).toBe(1);

    // The same call again: nothing changed, so nothing is written.
    const replay = await bodyOf<ReorderLevelBody>(
      await setLevel({
        itemId,
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        reorderLevelQty: '5',
        preferredOrderQty: '20',
      })
    );
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(level.id);
    expect(replay.recordVersion).toBe(level.recordVersion);
    expect(await auditRows(level.id)).toBe(1);

    // A changed threshold REVISES the one live row rather than adding a second.
    const revised = await bodyOf<ReorderLevelBody>(
      await setLevel({
        itemId,
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        reorderLevelQty: '9',
      })
    );
    expect(revised.id).toBe(level.id);
    expect(revised.reorderLevelQty).toBe('9.000');
    expect(revised.preferredOrderQty).toBe(null);
    expect(revised.replayed).toBe(false);
    expect(revised.recordVersion).toBe(level.recordVersion + 1);
    expect(await liveLevelsFor(itemId)).toBe(1);
    expect(await auditRows(level.id)).toBe(2);
  });

  it('refuses a branch without its company, and a location without its branch', async () => {
    const itemId = await freshItem();
    authAs(INV_CATALOG);

    const noCompany = await setLevel({ itemId, branchId: BRANCH_A1, reorderLevelQty: '1' });
    expect(noCompany.status).toBe(422);
    expect((await bodyOf<Problem>(noCompany)).violations?.[0]).toEqual({
      path: 'body.companyId',
      rule: 'branch_needs_company',
    });

    const noBranch = await setLevel({
      itemId,
      companyId: COMPANY_A1,
      locationId: QUARANTINE_A1,
      reorderLevelQty: '1',
    });
    expect(noBranch.status).toBe(422);
    expect((await bodyOf<Problem>(noBranch)).violations?.[0]).toEqual({
      path: 'body.branchId',
      rule: 'location_needs_branch',
    });
    expect(await liveLevelsFor(itemId)).toBe(0);
  });

  it('refuses an organisation-wide level to a branch-scoped holder of inv.item.manage', async () => {
    const itemId = await freshItem();
    authAs(INV_CATALOG_SCOPED_A1);

    const refused = await setLevel({ itemId, reorderLevelQty: '3' });
    expect(refused.status).toBe(403);
    expect((await bodyOf<Problem>(refused)).code).toBe('ERR-IAM-001');
    expect(await liveLevelsFor(itemId)).toBe(0);

    // The same principal MAY set the level for the branch it actually holds.
    const allowed = await setLevel({
      itemId,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      reorderLevelQty: '3',
    });
    expect(allowed.status).toBe(200);
    expect(await liveLevelsFor(itemId)).toBe(1);
  });

  it('refuses a branch the caller holds no inventory authority in, and writes nothing', async () => {
    const itemId = await freshItem();
    // Scoped to A2 with A1 inside the permission-blind allowed-branch union, so RLS
    // would admit the row: only the scoped permission check can refuse this.
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await setLevel({
      itemId,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      reorderLevelQty: '3',
    });
    expect(refused.status).toBe(403);
    expect(await liveLevelsFor(itemId)).toBe(0);
  });
});

describe('inv.reorder-level-list', () => {
  it('lists the configured levels and refuses a caller without inv.stock.read', async () => {
    const itemId = await freshItem();
    authAs(INV_CATALOG);
    await setLevel({ itemId, companyId: COMPANY_A1, branchId: BRANCH_A1, reorderLevelQty: '4' });

    authAs(INV_READER);
    const listed = await get(REORDER_LIST, `/api/v1/reorder-levels?itemId=${itemId}`);
    expect(listed.status).toBe(200);
    const body = await bodyOf<{
      asOf: string;
      levels: { items: readonly ReorderLevelBody[] };
    }>(listed);
    expect(Date.parse(body.asOf)).not.toBeNaN();
    expect(body.levels.items).toHaveLength(1);
    expect(body.levels.items[0]).toMatchObject({ itemId, reorderLevelQty: '4.000' });

    // Another tenant's unrestricted catalogue authority sees none of it.
    authAs(INV_TENANT_B_CATALOG);
    const other = await bodyOf<{ levels: { items: readonly ReorderLevelBody[] } }>(
      await get(REORDER_LIST, `/api/v1/reorder-levels?itemId=${itemId}`)
    );
    expect(other.levels.items).toHaveLength(0);
  });
});

describe('inv.reorder-level-retire', () => {
  it('needs If-Match, refuses a stale version, retires once, and replays the second call', async () => {
    const itemId = await freshItem();
    authAs(INV_CATALOG);
    const level = await bodyOf<ReorderLevelBody>(
      await setLevel({ itemId, companyId: COMPANY_A1, branchId: BRANCH_A1, reorderLevelQty: '2' })
    );

    const noHeader = await postAt(REORDER_RETIRE, `/api/v1/reorder-levels/${level.id}/retirement`, {
      reorderLevelId: level.id,
    });
    expect(noHeader.status).toBe(428);

    const stale = await postAt(
      REORDER_RETIRE,
      `/api/v1/reorder-levels/${level.id}/retirement`,
      { reorderLevelId: level.id },
      { 'if-match': String(level.recordVersion + 7) }
    );
    expect(stale.status).toBe(409);
    expect(await liveLevelsFor(itemId)).toBe(1);

    const retired = await postAt(
      REORDER_RETIRE,
      `/api/v1/reorder-levels/${level.id}/retirement`,
      { reorderLevelId: level.id },
      { 'if-match': String(level.recordVersion) }
    );
    expect(retired.status).toBe(200);
    const after = await bodyOf<ReorderLevelBody>(retired);
    expect(after.status).toBe('retired');
    expect(after.replayed).toBe(false);
    expect(await liveLevelsFor(itemId)).toBe(0);
    expect(await auditRows(level.id, 'inv.item_reorder_level.retired')).toBe(1);

    // Retiring it again changes nothing and is audited once.
    const again = await bodyOf<ReorderLevelBody>(
      await postAt(
        REORDER_RETIRE,
        `/api/v1/reorder-levels/${level.id}/retirement`,
        { reorderLevelId: level.id },
        { 'if-match': String(after.recordVersion) }
      )
    );
    expect(again.replayed).toBe(true);
    expect(await auditRows(level.id, 'inv.item_reorder_level.retired')).toBe(1);

    // The signature is free again: a replacement can be set at once.
    const replacement = await setLevel({
      itemId,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      reorderLevelQty: '6',
    });
    expect(replacement.status).toBe(200);
    expect((await bodyOf<ReorderLevelBody>(replacement)).id).not.toBe(level.id);
  });

  it('answers 404 to another tenant holding the same authority', async () => {
    const itemId = await freshItem();
    authAs(INV_CATALOG);
    const level = await bodyOf<ReorderLevelBody>(
      await setLevel({ itemId, companyId: COMPANY_A1, branchId: BRANCH_A1, reorderLevelQty: '2' })
    );

    authAs(INV_TENANT_B_CATALOG);
    const refused = await postAt(
      REORDER_RETIRE,
      `/api/v1/reorder-levels/${level.id}/retirement`,
      { reorderLevelId: level.id },
      { 'if-match': String(level.recordVersion) }
    );
    expect(refused.status).toBe(404);
    expect(await liveLevelsFor(itemId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Low stock.
// ---------------------------------------------------------------------------

describe('inv.low-stock-alert-read', () => {
  it('reports at the level and one below it, and stays silent one above it', async () => {
    const itemId = await freshItem();
    const cell = await freshLocation();
    await seedStock({ itemId, locationId: cell, quantity: '10.000' });
    authAs(INV_CATALOG);

    // Just above: 10 available against a level of 9 is not low.
    await setLevel({ itemId, companyId: COMPANY_A1, branchId: BRANCH_A1, reorderLevelQty: '9' });
    authAs(INV_READER);
    expect(await findingFor(itemId)).toBe(undefined);

    // Exactly at: 10 against 10 IS low — the rule is "at or below".
    authAs(INV_CATALOG);
    await setLevel({ itemId, companyId: COMPANY_A1, branchId: BRANCH_A1, reorderLevelQty: '10' });
    authAs(INV_READER);
    expect(await findingFor(itemId)).toMatchObject({
      scope: 'branch',
      availableQty: '10.000',
      reorderLevelQty: '10.000',
      shortfallQty: '0.000',
    });

    // Below: the shortfall is the gap, computed by the database in numeric.
    authAs(INV_CATALOG);
    await setLevel({
      itemId,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      reorderLevelQty: '12.500',
      preferredOrderQty: '40',
    });
    authAs(INV_READER);
    expect(await findingFor(itemId)).toMatchObject({
      availableQty: '10.000',
      reorderLevelQty: '12.500',
      shortfallQty: '2.500',
      preferredOrderQty: '40.000',
    });
  });

  it('never reports an item that has no reorder level, however empty its shelf', async () => {
    const itemId = await freshItem();
    const cell = await freshLocation();
    await seedStock({ itemId, locationId: cell, quantity: '1.000' });
    authAs(INV_READER);

    expect(await findingFor(itemId)).toBe(undefined);

    // And the moment a level is configured, the same shelf IS reported — so the
    // silence above is the missing level and not a missing balance.
    authAs(INV_CATALOG);
    await setLevel({ itemId, companyId: COMPANY_A1, branchId: BRANCH_A1, reorderLevelQty: '5' });
    authAs(INV_READER);
    expect(await findingFor(itemId)).toMatchObject({ availableQty: '1.000' });
  });

  it('stops reporting an item whose level was retired', async () => {
    const itemId = await freshItem();
    const cell = await freshLocation();
    await seedStock({ itemId, locationId: cell, quantity: '1.000' });
    authAs(INV_CATALOG);
    const level = await bodyOf<ReorderLevelBody>(
      await setLevel({ itemId, companyId: COMPANY_A1, branchId: BRANCH_A1, reorderLevelQty: '5' })
    );
    authAs(INV_READER);
    expect(await findingFor(itemId)).not.toBe(undefined);

    authAs(INV_CATALOG);
    await postAt(
      REORDER_RETIRE,
      `/api/v1/reorder-levels/${level.id}/retirement`,
      { reorderLevelId: level.id },
      { 'if-match': String(level.recordVersion) }
    );
    authAs(INV_READER);
    expect(await findingFor(itemId)).toBe(undefined);
  });

  it('compares a location level against that location alone, and states the rule', async () => {
    const itemId = await freshItem();
    const busy = await freshLocation();
    const quiet = await freshLocation();
    await seedStock({ itemId, locationId: busy, quantity: '30.000' });
    await seedStock({ itemId, locationId: quiet, quantity: '2.000' });

    authAs(INV_CATALOG);
    await setLevel({
      itemId,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      locationId: quiet,
      reorderLevelQty: '5',
    });
    authAs(INV_READER);
    const body = await bodyOf<LowStockBody>(await readLowStock(`&itemId=${itemId}`));
    // The branch holds 32 and would not be low; the shelf holds 2 and is.
    expect(body.findings.items).toHaveLength(1);
    expect(body.findings.items[0]).toMatchObject({
      scope: 'location',
      availableQty: '2.000',
      shortfallQty: '3.000',
    });
    expect(body.rule.excludedLocationTypes).toEqual(['quarantine', 'transit']);
    expect(body.rule.statement).toContain('at or below');
    expect(Date.parse(body.asOf)).not.toBeNaN();
  });

  it('refuses a branch the caller holds no inventory authority in', async () => {
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await readLowStock();
    expect(refused.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Count discrepancies.
// ---------------------------------------------------------------------------

describe('inv.count-discrepancy-alert-read', () => {
  it('reports a reconciled variance with its adjustment state, and ignores a zero one', async () => {
    const itemId = await freshItem();
    const zeroItem = await freshItem();
    const cell = await freshLocation();
    const { countId, adjustmentId } = await seedReconciledCount(cell, itemId, zeroItem);

    authAs(INV_READER);
    const response = await get(
      DISCREPANCIES,
      `/api/v1/inventory-alerts/count-discrepancies?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&locationId=${cell}`
    );
    expect(response.status).toBe(200);
    const body = await bodyOf<DiscrepancyBody>(response);
    expect(Date.parse(body.asOf)).not.toBeNaN();

    const rows = body.findings.items.filter((row) => row.countId === countId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemId,
      varianceQty: '-3.000',
      adjustmentId,
      adjustmentStatus: 'pending',
    });
    expect(Date.parse(rows[0]?.countedOn ?? '')).not.toBeNaN();
    // The line counted exactly right carries no variance and is not a discrepancy.
    expect(body.findings.items.some((row) => row.itemId === zeroItem)).toBe(false);
  });

  it('refuses a branch the caller holds no inventory authority in', async () => {
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await get(
      DISCREPANCIES,
      `/api/v1/inventory-alerts/count-discrepancies?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
    );
    expect(refused.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Unusual consumption.
// ---------------------------------------------------------------------------

describe('inv.unusual-consumption-alert-read', () => {
  it('fires at the stated multiple, not below it, and publishes every window it compared', async () => {
    const itemId = await freshItem();
    const cell = await freshLocation();
    await seedStock({ itemId, locationId: cell, quantity: '200.000' });

    // Three baseline weeks of 2 units each, then 12 units this week.
    for (const daysAgo of [10, 17, 24]) {
      const { issueId } = await issueParts(itemId, cell, '2');
      await backdate(issueId, daysAgo);
    }
    const recent = await issueParts(itemId, cell, '12');
    await backdate(recent.issueId, 1);

    authAs(INV_READER);
    const base = `/api/v1/inventory-alerts/unusual-consumption?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${itemId}&periodDays=7&baselinePeriods=3`;

    // 12 against a median of 2 is six times the baseline: at a multiple of 6 it fires.
    const firing = await bodyOf<ConsumptionBody>(await get(CONSUMPTION, `${base}&multiple=6`));
    expect(firing.findings.items).toHaveLength(1);
    const finding = firing.findings.items[0];
    expect(finding).toMatchObject({
      itemId,
      observedQty: '12.000',
      baselineMedianQty: '2.000',
    });
    expect(finding?.baselinePeriods).toHaveLength(3);
    expect(finding?.baselinePeriods.map((p) => p.issuedQty)).toEqual(['2.000', '2.000', '2.000']);
    expect(finding?.observedPeriod.issuedQty).toBe('12.000');
    expect(Date.parse(finding?.observedPeriod.from ?? '')).not.toBeNaN();
    expect(firing.rule).toMatchObject({
      periodDays: 7,
      baselinePeriods: 3,
      multiple: '6.000',
      baselineStatistic: 'median (lower of the two middle values on an even count)',
    });

    // Just above six times: seven times two is fourteen, and twelve is not that.
    const quiet = await bodyOf<ConsumptionBody>(await get(CONSUMPTION, `${base}&multiple=7`));
    expect(quiet.findings.items).toHaveLength(0);

    // The absolute floor decides on its own: a multiple of 2 would fire, but a
    // minimum of 13 units does not.
    const floored = await bodyOf<ConsumptionBody>(
      await get(CONSUMPTION, `${base}&multiple=2&minimumQty=13`)
    );
    expect(floored.findings.items).toHaveLength(0);
  });

  it('refuses a period outside the published bounds and names the field', async () => {
    authAs(INV_READER);
    const refused = await get(
      CONSUMPTION,
      `/api/v1/inventory-alerts/unusual-consumption?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&periodDays=400`
    );
    expect(refused.status).toBe(422);
    expect((await bodyOf<Problem>(refused)).violations?.[0]).toEqual({
      path: 'query.periodDays',
      rule: 'out_of_range',
    });
  });

  it('refuses a branch the caller holds no inventory authority in', async () => {
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await get(
      CONSUMPTION,
      `/api/v1/inventory-alerts/unusual-consumption?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
    );
    expect(refused.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Aged in transit.
// ---------------------------------------------------------------------------

describe('inv.aged-in-transit-alert-read', () => {
  it('reports a transfer past the age asked about and not one inside it', async () => {
    const itemId = await freshItem();
    const transferId = await seedAgedTransfer(itemId, 10, '7.500');

    authAs(INV_READER);
    const base = `/api/v1/inventory-alerts/aged-in-transit?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;
    const reported = await bodyOf<AgedBody>(await get(AGED, `${base}&minimumAgeDays=7`));
    const row = reported.findings.items.find((item) => item.transferId === transferId);
    expect(row).toMatchObject({
      ageDays: 10,
      outstandingQuantity: '7.500',
      fromBranchId: BRANCH_A1,
      toBranchId: BRANCH_A2,
    });
    expect(reported.rule.minimumAgeDays).toBe(7);
    expect(Date.parse(reported.asOf)).not.toBeNaN();

    const silent = await bodyOf<AgedBody>(await get(AGED, `${base}&minimumAgeDays=30`));
    expect(silent.findings.items.some((item) => item.transferId === transferId)).toBe(false);
  });

  it('refuses a branch the caller holds no inventory authority in', async () => {
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await get(
      AGED,
      `/api/v1/inventory-alerts/aged-in-transit?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
    );
    expect(refused.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Fixtures and small readers.
// ---------------------------------------------------------------------------

function auditRows(entityId: string, action = 'inv.item_reorder_level.set'): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
}

function liveLevelsFor(itemId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM inv.item_reorder_levels WHERE item_id = $1 AND status = 'active'`,
    [itemId]
  );
}

async function findingFor(
  itemId: string
): Promise<LowStockBody['findings']['items'][number] | undefined> {
  const body = await bodyOf<LowStockBody>(await readLowStock(`&itemId=${itemId}`));
  return body.findings.items.find((row) => row.itemId === itemId);
}

/**
 * A count reconciled a fortnight ago: one line short by three with a PENDING
 * adjustment, and one line that matched exactly.
 *
 * Written directly because the alert reads a FINISHED record and the count's own
 * operations are covered by `p1-32-inventory-operations.test.ts`. Nothing here
 * posts stock — which is the rule the count itself keeps.
 */
async function seedReconciledCount(
  locationId: string,
  shortItemId: string,
  exactItemId: string
): Promise<{ readonly countId: string; readonly adjustmentId: string }> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const count = await client.query<{ id: string }>(
      `INSERT INTO inv.stock_counts
         (tenant_id, company_id, branch_id, location_id, status, snapshot_at,
          counted_by, reconciled_at, reconciled_by, created_by)
       VALUES ($1,$2,$3,$4,'reconciled', now() - interval '15 days', $5,
               now() - interval '14 days', $6, $5)
       RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, locationId, USER_A, INV_APPROVER.userId]
    );
    const countId = count.rows[0]?.id ?? '';
    const adjustment = await client.query<{ id: string }>(
      `INSERT INTO inv.stock_adjustments
         (tenant_id, company_id, branch_id, item_id, location_id, direction, quantity,
          reason, status, requested_by, created_by)
       VALUES ($1,$2,$3,$4,$5,'out',3,'Count variance','pending',$6,$6)
       RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, shortItemId, locationId, USER_A]
    );
    const adjustmentId = adjustment.rows[0]?.id ?? '';
    await client.query(
      `INSERT INTO inv.stock_count_lines
         (tenant_id, company_id, branch_id, count_id, item_id, snapshot_qty, counted_qty,
          adjustment_id, created_by)
       VALUES ($1,$2,$3,$4,$5,10,7,$6,$7), ($1,$2,$3,$4,$8,4,4,NULL,$7)`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, countId, shortItemId, adjustmentId, USER_A, exactItemId]
    );
    await client.query('COMMIT');
    return { countId, adjustmentId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A transfer dispatched `days` ago from branch A1 to branch A2 and never received.
 *
 * The ledger legs are deliberately absent: `dispatched_at` is frozen by
 * `tg_stock_transfers_immutable`, so a transfer dispatched through the product
 * cannot be moved into the past, and what this alert reads is the transfer ROW —
 * its status, its dispatch instant and its generated outstanding quantity. The
 * dispatch movements are covered by `p1-32-inventory-operations.test.ts`.
 */
async function seedAgedTransfer(itemId: string, days: number, quantity: string): Promise<string> {
  const from = await freshLocation();
  const transit = await freshLocation();
  const row = await admin.query<{ id: string }>(
    `INSERT INTO inv.stock_transfers
       (tenant_id, company_id, branch_id, item_id, from_location_id, transit_location_id,
        to_branch_id, to_location_id, quantity, status, dispatched_at, dispatched_by, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,'dispatched',
             now() - make_interval(days => $10::int), $11, $11)
     RETURNING id`,
    [
      TENANT_A,
      COMPANY_A1,
      BRANCH_A1,
      itemId,
      from,
      transit,
      BRANCH_A2,
      WAREHOUSE_A2,
      quantity,
      days,
      USER_A,
    ]
  );
  return row.rows[0]?.id ?? '';
}
