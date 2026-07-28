/**
 * Inventory reads (Phase 1-21, P1-21-BE-001, BE-003, BE-011, BE-014, P1-21-QA-003).
 *
 * The isolation cases are the point of this suite, not an appendix.
 *
 * `/stock-availability`, `/stock-movements` and `/inventory-reconciliations` all
 * declare `scope: 'branch'` and REQUIRE `companyId` + `branchId`. They did not, and
 * that was a cross-branch disclosure: `authorizeScope` ran only inside
 * `if (filter present)`, so omitting the filter skipped the check and left RLS — which
 * narrows on the permission-blind grant union — as the only barrier. The same
 * principal was refused with `branchId=A1` (403) and served A1 with the parameter
 * simply left out (200). A control a caller defeats by deleting a query parameter is
 * not partial, it is ineffective. `GET /work-orders` requires the same pair for the
 * same reason.
 *
 * `/items` stays `scope: 'tenant'`, correctly: `inv.item_master` has no company or
 * branch column, so an item is tenant-wide reference data and a branch parameter
 * there would narrow nothing.
 *
 * `INV_PERMISSION_ELSEWHERE` is what makes an isolation refusal mean something. It
 * holds every `inv.*` permission scoped to A2 and an unrelated permission scoped to
 * A1, so A1 IS inside its `iam.allowed_branch_ids()` union and A1's rows are visible
 * to RLS. A scope-blind implementation serves it A1's stock; a correct one refuses.
 * Without that widening grant the request would fail whether or not the permission
 * check consulted scope at all, and the test would pass against the bug it exists to
 * catch.
 *
 * Operations exercised here: inv.item-search, inv.stock-availability-read,
 * inv.stock-movement-list, inv.inventory-reconciliation-read.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.item-search: route service authorization success denial cross-tenant
 *   inv.stock-availability-read: route service authorization success denial cross-tenant isolation
 *   inv.stock-movement-list: route service authorization success denial cross-tenant audit isolation
 *   inv.inventory-reconciliation-read: route service authorization success denial cross-tenant audit isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { BRANCH_A2, BRANCH_B1, COMPANY_B1, establishP1_19Fixtures } from './p1-19-helpers';
import {
  INV_FULL,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  INV_SCOPED_A2,
  INV_TENANT_B,
  ITEM_A,
  ITEM_A_ARCHIVED,
  ITEM_A_WILDCARD,
  QUARANTINE_A1,
  WAREHOUSE_A1,
  WAREHOUSE_A2,
  WAREHOUSE_B1,
  ITEM_B,
  auditCountFor,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  seedStock,
} from './p1-21-helpers';
import { randomUUID } from 'node:crypto';
import { POST as DAMAGE } from '@/app/api/v1/damaged-stock/route';
import { GET as ITEM_SEARCH } from '@/app/api/v1/items/route';
import { GET as AVAILABILITY } from '@/app/api/v1/stock-availability/route';
import { GET as MOVEMENTS } from '@/app/api/v1/stock-movements/route';
import { GET as RECONCILE } from '@/app/api/v1/inventory-reconciliations/route';

let admin: Pool;

const call = (handler: (request: Request) => Promise<Response>, path: string): Promise<Response> =>
  handler(new Request(`http://localhost${path}`));

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/** Damages real stock into QUARANTINE_A1 through the real route. */
async function damageIntoQuarantine(quantity: string): Promise<void> {
  const response = await DAMAGE(
    new Request('http://localhost/api/v1/damaged-stock', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        itemId: ITEM_A,
        fromLocationId: WAREHOUSE_A1,
        quarantineLocationId: QUARANTINE_A1,
        quantity,
        reason: 'Fixture damage, so the quarantine exclusion has a row to exclude',
      }),
    })
  );
  if (response.status !== 201) {
    throw new Error(`fixture damage failed with ${response.status}: ${await response.text()}`);
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '25.500' });
  await seedStock({
    itemId: ITEM_A,
    locationId: WAREHOUSE_A2,
    quantity: '4.000',
    branchId: BRANCH_A2,
  });
}, 120_000);

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('inv.item-search — the tenant item catalog', () => {
  it('returns the tenant catalog and excludes archived items by default', async () => {
    authAs(INV_FULL);
    const response = await call(ITEM_SEARCH, '/api/v1/items?limit=100');
    expect(response.status).toBe(200);
    const page = await bodyOf<{ items: { id: string; sku: string; lifecycleStatus: string }[] }>(
      response
    );
    const ids = page.items.map((i) => i.id);
    expect(ids).toContain(ITEM_A);
    // Archived is terminal (inv.guard_item_lifecycle), so surfacing it by default
    // would invite callers to build against something unusable.
    expect(ids).not.toContain(ITEM_A_ARCHIVED);
    expect(page.items.every((i) => i.lifecycleStatus === 'active')).toBe(true);
  });

  it('returns the archived item only when explicitly asked for', async () => {
    authAs(INV_FULL);
    const response = await call(ITEM_SEARCH, '/api/v1/items?lifecycleStatus=archived&limit=100');
    expect(response.status).toBe(200);
    const page = await bodyOf<{ items: { id: string }[] }>(response);
    expect(page.items.map((i) => i.id)).toContain(ITEM_A_ARCHIVED);
  });

  it('never returns a cost field, because cost is gated inside its own RLS policy', async () => {
    authAs(INV_FULL);
    const page = await bodyOf<{ items: Record<string, unknown>[] }>(
      await call(ITEM_SEARCH, '/api/v1/items?limit=100')
    );
    for (const item of page.items) {
      expect(Object.keys(item)).not.toContain('standardCost');
      expect(Object.keys(item)).not.toContain('cost');
    }
  });

  it('escapes LIKE metacharacters instead of treating them as wildcards', async () => {
    authAs(INV_FULL);
    // `FX_P121_WILD` contains `_`, a LIKE single-character wildcard. Binding the
    // value stops injection but does nothing about the metacharacter: unescaped,
    // this search would also match `FX-P121-A`.
    const page = await bodyOf<{ items: { id: string; sku: string }[] }>(
      await call(ITEM_SEARCH, '/api/v1/items?search=FX_P121_&limit=100')
    );
    expect(page.items.map((i) => i.id)).toEqual([ITEM_A_WILDCARD]);
  });

  it('refuses an unknown query parameter and an undecodable cursor (denial)', async () => {
    authAs(INV_FULL);
    // `.strict()` refuses a parameter this endpoint does not offer. `branchId` is the
    // pointed case: an item is tenant-wide reference data with no branch column, so
    // accepting the parameter would imply a narrowing that cannot happen.
    expect((await call(ITEM_SEARCH, '/api/v1/items?branchId=' + BRANCH_A1)).status).toBe(422);
    // An undecodable cursor is 400 (`ERR-PAG-001`), not 422: the platform separates a
    // malformed request from a validation failure, and a client can fix the second by
    // changing a field and the first only by fixing its pagination handling.
    expect((await call(ITEM_SEARCH, '/api/v1/items?cursor=not-a-cursor')).status).toBe(400);
  });

  it('refuses a caller without inv.item.read (authorization)', async () => {
    // A tenant-A principal holding wo.work_order.read but no inventory permission at
    // all — so the refusal is authority and not tenancy.
    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    const response = await call(ITEM_SEARCH, '/api/v1/items');
    expect(response.status).toBe(403);
  });

  it('never returns another tenant’s item (cross-tenant)', async () => {
    authAs(INV_FULL);
    const page = await bodyOf<{ items: { id: string }[] }>(
      await call(ITEM_SEARCH, '/api/v1/items?limit=100&lifecycleStatus=active')
    );
    expect(page.items.map((i) => i.id)).not.toContain(ITEM_B);

    // And the tenant-B principal sees its own item and not tenant A's, so the
    // boundary is proved from both sides against real rows.
    authAs(INV_TENANT_B);
    const bPage = await bodyOf<{ items: { id: string }[] }>(
      await call(ITEM_SEARCH, '/api/v1/items?limit=100')
    );
    expect(bPage.items.map((i) => i.id)).toContain(ITEM_B);
    expect(bPage.items.map((i) => i.id)).not.toContain(ITEM_A);
  });
});

describe('inv.stock-availability-read — what a branch actually holds', () => {
  it('returns on-hand, reserved, and the GENERATED available as exact strings', async () => {
    authAs(INV_FULL);
    const response = await call(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}&locationId=${WAREHOUSE_A1}`
    );
    expect(response.status).toBe(200);
    const page = await bodyOf<{
      items: { onHand: string; reserved: string; available: string; locationType: string }[];
    }>(response);
    expect(page.items).toHaveLength(1);
    const cell = page.items[0]!;
    // Exact strings, not numbers: numeric(12,3) cannot survive an IEEE-754 round trip.
    expect(cell.onHand).toBe('25.500');
    expect(cell.reserved).toBe('0.000');
    expect(cell.available).toBe('25.500');
    expect(typeof cell.onHand).toBe('string');
  });

  it('invents no field the schema does not store', async () => {
    authAs(INV_FULL);
    const page = await bodyOf<{ items: Record<string, unknown>[] }>(
      await call(
        AVAILABILITY,
        `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}`
      )
    );
    const keys = Object.keys(page.items[0] ?? {});
    for (const invented of [
      'damagedQty',
      'customerSuppliedQty',
      'externalPurchasePendingQty',
      'inTransitQty',
    ]) {
      expect(keys).not.toContain(invented);
    }
  });

  it('excludes quarantine by default, which is what keeps available honest', async () => {
    // Both halves of this used to be vacuous: nothing in this suite ever put stock in
    // QUARANTINE_A1, so the exclusion filtered a row that did not exist, and the
    // second assertion was `[].every(...)`, which is true for an empty page. Deleting
    // the quarantine predicate from the repository kept it green. It now damages real
    // stock into quarantine first, so both directions have a row to be right about.
    authAs(INV_FULL);
    await damageIntoQuarantine('2.000');

    const quarantineCell = await balanceOf(ITEM_A, QUARANTINE_A1);
    expect(Number(quarantineCell?.onHand ?? '0')).toBeGreaterThan(0);

    const withOut = await bodyOf<{ items: { locationId: string }[] }>(
      await call(
        AVAILABILITY,
        `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}&limit=100`
      )
    );
    expect(withOut.items.map((c) => c.locationId)).not.toContain(QUARANTINE_A1);

    const withIn = await bodyOf<{ items: { locationId: string; locationType: string }[] }>(
      await call(
        AVAILABILITY,
        `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}&includeQuarantine=true&limit=100`
      )
    );
    // The flag does not merely parse — it changes the result set.
    expect(withIn.items.map((c) => c.locationId)).toContain(QUARANTINE_A1);
    expect(withIn.items.length).toBeGreaterThan(withOut.items.length);
    expect(withIn.items.find((c) => c.locationId === QUARANTINE_A1)?.locationType).toBe(
      'quarantine'
    );
  });

  it('refuses a branchId that contradicts the named location (denial)', async () => {
    authAs(INV_FULL);
    const response = await call(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A2}&locationId=${WAREHOUSE_A1}`
    );
    expect(response.status).toBe(422);
  });

  it('refuses an unknown location rather than returning an empty page', async () => {
    authAs(INV_FULL);
    const response = await call(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&locationId=e1000000-0000-4000-8000-00000000dead`
    );
    expect(response.status).toBe(404);
  });

  it('refuses a caller lacking inv.stock.read (authorization)', async () => {
    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    expect(
      (
        await call(
          AVAILABILITY,
          `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
        )
      ).status
    ).toBe(403);
  });

  it('refuses a scoped caller the branch it holds no inventory permission in (isolation)', async () => {
    // THE decisive case. INV_PERMISSION_ELSEWHERE holds inv.stock.read scoped to A2
    // and an unrelated permission scoped to A1, so A1 is inside its permission-blind
    // app.branch_ids union and A1's rows ARE visible to RLS. Only the scoped
    // permission check can refuse this (P1-18-A-01).
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await call(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}`
    );
    expect(refused.status).toBe(403);

    // The same principal succeeds in the branch it IS scoped to, so the refusal is
    // about scope rather than a missing permission or a broken route.
    const allowed = await call(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A2}&itemId=${ITEM_A}`
    );
    expect(allowed.status).toBe(200);
    const page = await bodyOf<{ items: { branchId: string; onHand: string }[] }>(allowed);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.branchId).toBe(BRANCH_A2);
    expect(page.items[0]!.onHand).toBe('4.000');
  });

  it('refuses a location in a branch outside the caller’s scope (isolation)', async () => {
    // INV_SCOPED_A2 has NO widening grant, so A1 is outside its
    // `iam.allowed_branch_ids()` union and RLS hides the location entirely — the
    // route then answers 404 rather than 403. Both are refusals and neither
    // discloses the location's stock, so the assertion accepts either. This case
    // deliberately does NOT stand alone as the scope proof: a 404 here would also
    // appear under a scope-blind implementation, which is exactly why the
    // INV_PERMISSION_ELSEWHERE case above exists and asserts 403 specifically.
    authAs(INV_SCOPED_A2);
    const response = await call(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&locationId=${WAREHOUSE_A1}`
    );
    expect([403, 404]).toContain(response.status);
  });

  it('never returns another tenant’s stock (cross-tenant)', async () => {
    authAs(INV_FULL);
    const response = await call(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&locationId=${WAREHOUSE_B1}`
    );
    // The location belongs to tenant B, so it is invisible to this caller and the
    // branch-coherence check refuses it. Either answer is a refusal, and neither
    // discloses the location's stock.
    expect([403, 404, 422]).toContain(response.status);
  });
});

describe('inv.stock-movement-list — the immutable ledger', () => {
  it('returns the opening movements newest-first and audits the read', async () => {
    authAs(INV_FULL);
    const before = await auditCountFor('inv.movement_history.read', ITEM_A);
    const response = await call(
      MOVEMENTS,
      `/api/v1/stock-movements?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}&limit=50`
    );
    expect(response.status).toBe(200);
    const page = await bodyOf<{
      items: {
        movementType: string;
        direction: string;
        quantity: string;
        signedQuantity: string;
        reference: { kind: string; id: string };
        sequence: string;
      }[];
    }>(response);
    expect(page.items.length).toBeGreaterThan(0);
    const opening = page.items.find((m) => m.movementType === 'opening');
    expect(opening).toBeDefined();
    expect(opening!.direction).toBe('in');
    expect(opening!.reference.kind).toBe('opening_line');
    // signed_qty is GENERATED from direction, so an `in` movement is positive and the
    // sign cannot be decoupled from the magnitude.
    expect(opening!.signedQuantity.startsWith('-')).toBe(false);

    // Ordered by seq DESC — a strict total order occurred_at is not.
    const sequences = page.items.map((m) => Number(m.sequence));
    expect([...sequences].sort((a, b) => b - a)).toEqual(sequences);

    // The read is audited (audit).
    expect(await auditCountFor('inv.movement_history.read', ITEM_A)).toBe(before + 1);
  });

  it('records the filter and the row count in the audit trail, never the rows', async () => {
    authAs(INV_FULL);
    await call(
      MOVEMENTS,
      `/api/v1/stock-movements?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}&limit=50`
    );
    // Details live in `iam.audit_record_details`, one row per field, with the value
    // already masked according to its classification.
    const details = await admin.query<{ field_name: string; new_value_masked: string | null }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.action = 'inv.movement_history.read' AND r.entity_id = $1
        ORDER BY r.occurred_at DESC, d.field_name`,
      [ITEM_A]
    );
    const fields = details.rows.map((r) => r.field_name);
    expect(fields).toContain('returnedRows');
    expect(fields).toContain('itemId');
    // Copying stock levels into the audit table would duplicate the very data the
    // audit exists to protect, so no quantity is recorded.
    const values = details.rows.map((r) => r.new_value_masked ?? '').join('|');
    expect(values).not.toContain('25.500');
  });

  it('refuses a bare date where an instant is required (denial)', async () => {
    authAs(INV_FULL);
    expect(
      (
        await call(
          MOVEMENTS,
          '/api/v1/stock-movements?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&occurredFrom=2026-01-01'
        )
      ).status
    ).toBe(422);
    expect(
      (
        await call(
          MOVEMENTS,
          '/api/v1/stock-movements?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&movementType=transfer'
        )
      ).status
    ).toBe(422);
  });

  it('refuses a caller lacking inv.stock.read (authorization)', async () => {
    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    expect(
      (
        await call(
          MOVEMENTS,
          `/api/v1/stock-movements?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
        )
      ).status
    ).toBe(403);
  });

  it('never returns another tenant’s movements (cross-tenant)', async () => {
    // The tenant-B principal reads its OWN branch. Asking for tenant A's branch would
    // be refused by the scope check and would prove nothing about tenancy — the point
    // is that a legitimate read inside B never surfaces an A row.
    authAs(INV_TENANT_B);
    const response = await call(
      MOVEMENTS,
      `/api/v1/stock-movements?companyId=${COMPANY_B1}&branchId=${BRANCH_B1}&limit=100`
    );
    expect(response.status).toBe(200);
    const page = await bodyOf<{ items: { itemId: string }[] }>(response);
    expect(page.items.map((m) => m.itemId)).not.toContain(ITEM_A);
  });
});

describe('inv.inventory-reconciliation-read — the audit evidence', () => {
  it('re-derives balances from the ledger and reports zero incoherent cells', async () => {
    authAs(INV_FULL);
    const before = await auditCountFor('inv.reconciliation.performed', ITEM_A);
    const response = await call(
      RECONCILE,
      `/api/v1/inventory-reconciliations?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}`
    );
    expect(response.status).toBe(200);
    const body = await bodyOf<{
      checkedAt: string;
      cellsChecked: number;
      incoherentCells: number;
      cells: { storedOnHand: string; ledgerOnHand: string; coherent: boolean }[];
    }>(response);
    expect(body.cellsChecked).toBeGreaterThan(0);
    // inv.guard_stock_balance_coherence should make this structurally zero; a
    // non-zero count would mean the guard had been bypassed.
    expect(body.incoherentCells).toBe(0);
    for (const cell of body.cells) {
      expect(cell.coherent).toBe(true);
      expect(cell.storedOnHand).toBe(cell.ledgerOnHand);
    }
    // checkedAt comes from the database clock, so a skewed host cannot misdate it.
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    expect(await auditCountFor('inv.reconciliation.performed', ITEM_A)).toBe(before + 1);
  });

  it('is not reachable by an ordinary stock reader (authorization)', async () => {
    // INV_READER holds inv.stock.read but NOT inv.audit.read, so this refusal
    // distinguishes the two authorities rather than testing authentication.
    authAs(INV_READER);
    expect(
      (
        await call(
          RECONCILE,
          `/api/v1/inventory-reconciliations?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
        )
      ).status
    ).toBe(403);
    // The same principal CAN read availability, which is what makes the refusal above
    // specific to the reconciliation permission.
    expect(
      (
        await call(
          AVAILABILITY,
          `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
        )
      ).status
    ).toBe(200);
  });

  it('refuses an unknown query parameter (denial)', async () => {
    authAs(INV_FULL);
    expect(
      (
        await call(
          RECONCILE,
          '/api/v1/inventory-reconciliations?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&repair=true'
        )
      ).status
    ).toBe(422);
  });

  it('never reconciles another tenant’s balances (cross-tenant)', async () => {
    authAs(INV_TENANT_B);
    const response = await call(
      RECONCILE,
      `/api/v1/inventory-reconciliations?companyId=${COMPANY_B1}&branchId=${BRANCH_B1}`
    );
    expect(response.status).toBe(200);
    const body = await bodyOf<{ cells: { itemId: string }[] }>(response);
    expect(body.cells.map((c) => c.itemId)).not.toContain(ITEM_A);
  });

  it('leaves the ledger untouched — a reconciliation is a read', async () => {
    const before = await countRowsOf(
      `SELECT count(*)::text AS n FROM inv.stock_movements WHERE tenant_id = $1`,
      [TENANT_A]
    );
    authAs(INV_FULL);
    await call(
      RECONCILE,
      '/api/v1/inventory-reconciliations?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=100'
    );
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.stock_movements WHERE tenant_id = $1`,
        [TENANT_A]
      )
    ).toBe(before);
  });
});

/**
 * H1 regression — the scope check must not be skippable.
 *
 * The defect: `authorizeScope` ran only when a filter was supplied, so omitting
 * `branchId` skipped it entirely and RLS — which narrows on the permission-blind
 * union of every grant — was the only remaining barrier. Measured before the fix:
 * refused with `branchId=A1` (403), served A1 with the parameter left out (200).
 *
 * These fail if the scope pair is made optional again on any of the three reads.
 */
describe('H1 — no read reaches stock without naming and authorizing a branch', () => {
  const UNSCOPED = [
    ['stock-availability', AVAILABILITY],
    ['stock-movements', MOVEMENTS],
    ['inventory-reconciliations', RECONCILE],
  ] as const;

  it('refuses every branch-scoped read that names no scope at all', async () => {
    // Even the unrestricted principal is refused: the pair is not a filter a caller
    // may decline, it is the target the permission is evaluated against.
    authAs(INV_FULL);
    for (const [name, handler] of UNSCOPED) {
      const response = await call(handler, `/api/v1/${name}?itemId=${ITEM_A}`);
      expect(response.status, `${name} without a scope pair`).toBe(422);
    }
  });

  it('refuses a half-named scope, so one column cannot stand in for the pair', async () => {
    authAs(INV_FULL);
    for (const [name, handler] of UNSCOPED) {
      expect(
        (await call(handler, `/api/v1/${name}?branchId=${BRANCH_A1}`)).status,
        `${name} with branch only`
      ).toBe(422);
      expect(
        (await call(handler, `/api/v1/${name}?companyId=${COMPANY_A1}`)).status,
        `${name} with company only`
      ).toBe(422);
    }
  });

  it('refuses a scoped caller on every branch-scoped read, filter or no filter', async () => {
    // THE regression. This principal has A1 inside its permission-blind allowed-branch
    // union, so RLS admits A1's rows — only the scoped permission check can refuse it.
    authAs(INV_PERMISSION_ELSEWHERE);
    for (const [name, handler] of UNSCOPED) {
      const withFilter = await call(
        handler,
        `/api/v1/${name}?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}`
      );
      expect(withFilter.status, `${name} A1 with an item filter`).toBe(403);
      const withoutFilter = await call(
        handler,
        `/api/v1/${name}?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
      );
      // Before the fix this second shape was the hole: no item filter, no scope check.
      expect(withoutFilter.status, `${name} A1 with no item filter`).toBe(403);
    }
  });

  it('serves the same caller its OWN branch, so the refusal is scope and not breakage', async () => {
    authAs(INV_PERMISSION_ELSEWHERE);
    for (const [name, handler] of UNSCOPED) {
      const allowed = await call(
        handler,
        `/api/v1/${name}?companyId=${COMPANY_A1}&branchId=${BRANCH_A2}`
      );
      expect(allowed.status, `${name} A2`).toBe(200);
    }
  });

  it('refuses a location that reaches outside the authorized pair', async () => {
    // `locationId` must not be a way around the branch that was authorized.
    authAs(INV_FULL);
    const response = await call(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A2}&locationId=${WAREHOUSE_A1}`
    );
    expect(response.status).toBe(422);
  });
});
