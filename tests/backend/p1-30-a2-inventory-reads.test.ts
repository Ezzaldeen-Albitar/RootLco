/**
 * P1-30 A2 — the inventory read seams (S-14, S-15, S-16).
 *
 * The commercial half of A2 lives in `p1-30-a2-published-reads.test.ts`. The split
 * is not eight fixture worlds; it is the one the helper families already impose.
 * `establishP1_21Fixtures` seeds the whole `inv` schema plus its own second company
 * and widening grants, `establishP1_22Fixtures` seeds the whole `sal` half plus a
 * different second company, and no shipped suite loads both. Putting all ten seams
 * in one file would make a single `beforeAll` heavier than anything in the
 * repository and would prove nothing this split does not.
 *
 * ## What these three reads make possible
 *
 * The location is the SCOPE ANCHOR of every stock operation —
 * `inv.post_stock_movement` derives company and branch from it rather than from
 * anything the caller sends. Reserving, issuing, returning and adjusting all take a
 * `locationId`, and before S-16 no route returned one, so every one of those
 * commands required an id the product could not produce. S-14 makes the open
 * commitments readable, so a reservation can be released deliberately instead of
 * being left to expire. S-15 answers what a work order has consumed.
 *
 * ## The scope rule this suite enforces
 *
 * P1-18-A-01: `requiresScopedEvaluation` returns FALSE on an empty scope target
 * whatever an operation declares. S-14 and S-16 therefore REQUIRE `companyId` and
 * `branchId` and authorize them before reading; S-15 names the work order in the
 * path and derives company and branch from that row. A top-level
 * `GET /stock-issues?workOrderId=…` would have named no parent and left the
 * declared branch scope inert, which is why S-15 is the per-parent shape.
 *
 * ## Quantities
 *
 * `numeric(12,3)` crosses the wire as a decimal STRING. `quantity` and
 * `returnedQty` are published as two exact operands and are never netted: the
 * difference is a subtraction of exact decimals that IEEE-754 cannot be trusted
 * with, and `inv.guard_part_return_ceiling` is the authority on the bound anyway.
 *
 * ## Falsifiability — measured, including one mutation that was NOT caught at first
 *
 * Each mutation was applied to the shipped source, the suite was run, and the
 * mutation was reverted.
 *
 * **A — `authorizeScope` removed from `listPartIssuesForWorkOrder` (S-15).**
 * RED: the isolation case answered 200 instead of 403. The path names no branch, so
 * there is no pre-handler target and this is the ONLY guard;
 * `INV_PERMISSION_ELSEWHERE` carries the widening grant, so RLS serves the work
 * order and cannot be what refuses. The per-parent shape is proved load-bearing.
 *
 * **B — the `company_id`/`branch_id` predicate neutralised in `listReservations`
 * (S-14).** GREEN at first, and that was a hole in THIS FILE, not defence in depth:
 * every reservation the fixtures created lived in branch A1, so a read that had
 * stopped narrowing returned the same rows. Closed by seeding stock and a
 * reservation in BRANCH_A2 and adding "never returns another branch reservation".
 * Re-run under the same mutation: RED, exactly that one case. The predicate is now
 * falsifiable.
 *
 * **C — the same predicate neutralised in `listLocations` (S-16).** RED on three
 * cases without any change to the file, because the location fixtures already span
 * both branches.
 *
 * Note what B means for INV_FULL: it is unrestricted, so `iam.allowed_branch_ids()`
 * is NULL and RLS admits every tenant-A row. For an unrestricted caller the SQL
 * predicate is the ONLY narrowing on these two reads — RLS is not a second layer
 * there, and the suite must carry the proof itself.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.stock-reservation-list: route service authorization success denial cross-tenant isolation pagination
 *   inv.work-order-part-issue-list: route service authorization success denial cross-tenant isolation pagination
 *   inv.stock-location-list: route service authorization success denial cross-tenant isolation pagination
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_A2, createOpenWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import {
  INV_FULL,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  INV_SCOPED_A2,
  INV_TENANT_B,
  ITEM_A,
  ITEM_A_ALT,
  QUARANTINE_A1,
  WAREHOUSE_A1,
  WAREHOUSE_A2,
  authAs,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
  seedStock,
} from './p1-21-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as RESERVATION_LIST, POST as RESERVE } from '@/app/api/v1/stock-reservations/route';
import { GET as LOCATION_LIST } from '@/app/api/v1/stock-locations/route';
import { GET as PART_ISSUE_LIST } from '@/app/api/v1/work-orders/[workOrderId]/part-issues/route';
import { POST as ISSUE_PART } from '@/app/api/v1/stock-issues/route';

let admin: Pool;
let runtime: Pool;

const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

const jsonPost = (url: string, payload: unknown): Request =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify(payload),
  });

interface PageBody<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const reservationList = (query: string): Promise<Response> =>
  RESERVATION_LIST(new Request(`http://localhost/api/v1/stock-reservations${query}`));

const locationList = (query: string): Promise<Response> =>
  LOCATION_LIST(new Request(`http://localhost/api/v1/stock-locations${query}`));

const partIssueList = (workOrderId: string, query = ''): Promise<Response> =>
  PART_ISSUE_LIST(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/part-issues${query}`),
    { params: Promise.resolve({ workOrderId }) }
  );

/**
 * Reserves stock through the SHIPPED route, never by inserting a row.
 *
 * The work order must be OPEN, not draft: `assertWorkOrderAcceptsParts` refuses a
 * state whose `allows_jobs` is false, and `createWorkOrder` leaves the order in
 * `draft`. Reserving AGAINST a work order and issuing to one are both governed by
 * that rule, so `createOpenWorkOrder` is the only correct fixture here.
 */
async function reserve(input: {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  readonly workOrderId?: string;
}): Promise<string> {
  authAs(INV_FULL);
  const response = await RESERVE(
    jsonPost('http://localhost/api/v1/stock-reservations', {
      itemId: input.itemId,
      locationId: input.locationId,
      quantity: input.quantity,
      ...(input.workOrderId === undefined ? {} : { workOrderId: input.workOrderId }),
    })
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Issues a part to a work order through the shipped route. */
async function issuePart(input: {
  readonly workOrderId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
}): Promise<string> {
  authAs(INV_FULL);
  const response = await ISSUE_PART(jsonPost('http://localhost/api/v1/stock-issues', input));
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

const scopedQuery = `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '500.000' });
  await seedStock({ itemId: ITEM_A_ALT, locationId: WAREHOUSE_A1, quantity: '500.000' });
  // Stock in the OTHER branch, so a scoped list has something it must NOT return.
  // Without this the company/branch predicate is unfalsifiable: every fixture row
  // lives in A1, so removing the predicate changes no answer and the suite would
  // stay green over a read that had stopped narrowing at all.
  await seedStock({
    itemId: ITEM_A,
    locationId: WAREHOUSE_A2,
    quantity: '50.000',
    branchId: BRANCH_A2,
  });
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanP1_21Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------
// S-16 — inv.stock-location-list (class B)
//
// First, because it is the read every other stock operation depends on: without
// it the product cannot produce the `locationId` that reserving, issuing and
// adjusting all require.
// ---------------------------------------------------------------------------

describe('S-16 inv.stock-location-list', () => {
  it('401 unauthenticated, and 403 without inv.stock.read', async () => {
    __resetAuthenticatorForTests();
    expect((await locationList(scopedQuery)).status).toBe(401);

    // A tenant-A principal holding wo.work_order.read and no inventory permission,
    // so the refusal is authority and not tenancy.
    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    const refused = await locationList(scopedQuery);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('requires companyId and branchId — the authorization target is not optional', async () => {
    authAs(INV_FULL);
    // An optional pair means `authorizeScope` is skipped whenever it is omitted,
    // leaving `app.branch_ids` — the permission-blind union of every active grant —
    // as the only narrowing on a directory of a branch's layout (P1-18-A-01).
    const unscoped = await locationList('');
    expect(unscoped.status).toBe(422);
    expect(await codeOf(unscoped)).toBe('ERR-VAL-001');
  });

  it('lists the branch locations by code, with the label an operator reads', async () => {
    authAs(INV_FULL);
    const response = await locationList(scopedQuery);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<{
      id: string;
      locationCode: string;
      name: string;
      locationType: string;
      branchId: string;
      status: string;
    }>;
    const ids = body.items.map((row) => row.id);
    expect(ids).toContain(WAREHOUSE_A1);
    expect(ids).toContain(QUARANTINE_A1);
    // Every row is in the authorized branch, and no other branch's location leaks in.
    expect(body.items.every((row) => row.branchId === BRANCH_A1)).toBe(true);
    expect(ids).not.toContain(WAREHOUSE_A2);

    // Ascending by code, which is what makes it usable as a picker.
    const codes = body.items.map((row) => row.locationCode);
    expect([...codes].sort()).toEqual(codes);

    // An id is never the visible label: the name comes from the row itself.
    const warehouse = body.items.find((row) => row.id === WAREHOUSE_A1);
    expect(typeof warehouse?.name).toBe('string');
    expect(warehouse?.name.length).toBeGreaterThan(0);
    expect(warehouse?.locationType).toBe('warehouse');
    expect(warehouse?.status).toBe('active');
  });

  it('filters by type, pages by keyset, and tells a bad cursor from a bad param', async () => {
    authAs(INV_FULL);
    const quarantine = (await (
      await locationList(`${scopedQuery}&locationType=quarantine`)
    ).json()) as PageBody<{ id: string; locationType: string }>;
    expect(quarantine.items.length).toBeGreaterThan(0);
    expect(quarantine.items.every((row) => row.locationType === 'quarantine')).toBe(true);

    const pageOne = (await (await locationList(`${scopedQuery}&limit=1`)).json()) as PageBody<{
      id: string;
    }>;
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.hasMore).toBe(true);
    const pageTwo = (await (
      await locationList(
        `${scopedQuery}&limit=1&cursor=${encodeURIComponent(pageOne.nextCursor ?? '')}`
      )
    ).json()) as PageBody<{ id: string }>;
    // No overlap across the page boundary.
    expect(pageTwo.items[0]?.id).not.toBe(pageOne.items[0]?.id);

    const badCursor = await locationList(`${scopedQuery}&cursor=not-a-cursor`);
    expect(badCursor.status).toBe(400);
    expect(await codeOf(badCursor)).toBe('ERR-PAG-001');

    // An unknown parameter is 422, never a filter the caller believes was applied.
    const unknownParam = await locationList(`${scopedQuery}&locationCode=WH-1`);
    expect(unknownParam.status).toBe(422);
    expect(await codeOf(unknownParam)).toBe('ERR-VAL-001');
  });

  it('refuses a branch the caller holds no stock permission in — application check, not RLS', async () => {
    // THE decisive case. INV_PERMISSION_ELSEWHERE holds inv.stock.read scoped to A2
    // AND an unrelated permission scoped to A1, so A1 is inside its permission-blind
    // allowed-branch union and A1's locations ARE visible to RLS. The only thing that
    // can refuse is the scoped permission check (P1-18-A-01).
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await locationList(scopedQuery);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    // The same principal succeeds in the branch it IS scoped to, so the refusal is
    // about scope and not a missing permission or a broken route.
    const allowed = await locationList(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A2}`);
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as PageBody<{ id: string; branchId: string }>;
    expect(body.items.every((row) => row.branchId === BRANCH_A2)).toBe(true);
    expect(body.items.map((row) => row.id)).toContain(WAREHOUSE_A2);
  });

  it('is refused when RLS hides the branch entirely, and is cross-tenant isolated', async () => {
    // INV_SCOPED_A2 has NO widening grant, so A1 is outside its allowed-branch union.
    // Stated honestly: this proves isolation and proves RLS is doing it. It is NOT
    // the application-check proof — that is the case above, which is why both exist.
    authAs(INV_SCOPED_A2);
    const hidden = await locationList(scopedQuery);
    expect([403, 404]).toContain(hidden.status);

    // Tenant B holds inv.stock.read unrestricted, so this refusal is the tenant
    // boundary. It must not be a 200 listing tenant A's locations.
    authAs(INV_TENANT_B);
    const foreign = await locationList(scopedQuery);
    if (foreign.status === 200) {
      const body = (await foreign.json()) as PageBody<{ id: string }>;
      expect(body.items).toHaveLength(0);
    } else {
      expect([403, 404]).toContain(foreign.status);
    }
  });
});

// ---------------------------------------------------------------------------
// S-14 — inv.stock-reservation-list (class B)
// ---------------------------------------------------------------------------

describe('S-14 inv.stock-reservation-list', () => {
  it('401 unauthenticated, and 403 without inv.stock.read', async () => {
    __resetAuthenticatorForTests();
    expect((await reservationList(scopedQuery)).status).toBe(401);

    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    const refused = await reservationList(scopedQuery);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('requires the scope pair, and refuses an unknown query parameter', async () => {
    authAs(INV_FULL);
    const unscoped = await reservationList('');
    expect(unscoped.status).toBe(422);
    expect(await codeOf(unscoped)).toBe('ERR-VAL-001');

    const unknownParam = await reservationList(`${scopedQuery}&quantity=1`);
    expect(unknownParam.status).toBe(422);
    expect(await codeOf(unknownParam)).toBe('ERR-VAL-001');
  });

  it('lists what is reserved, newest first, with labels and decimal quantities', async () => {
    const order = await createOpenWorkOrder();
    const older = await reserve({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '2.000' });
    const newer = await reserve({
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '3.500',
      workOrderId: order.workOrderId,
    });

    authAs(INV_FULL);
    const response = await reservationList(scopedQuery);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<{
      id: string;
      sku: string;
      locationCode: string;
      quantity: string;
      status: string;
      workOrderId: string | null;
      expiresAt: string | null;
    }>;
    const ids = body.items.map((row) => row.id);
    expect(ids).toContain(newer);
    expect(ids).toContain(older);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));

    const seen = body.items.find((row) => row.id === newer);
    // numeric(12,3) crosses as an exact decimal STRING.
    expect(typeof seen?.quantity).toBe('string');
    expect(seen?.quantity).toBe('3.500');
    expect(seen?.status).toBe('active');
    // The work order the commitment is FOR — the fact that made the list worth
    // publishing, because availability alone cannot say who holds the stock.
    expect(seen?.workOrderId).toBe(order.workOrderId);
    // Ids are paired with labels drawn from real tables, never published bare.
    expect(typeof seen?.sku).toBe('string');
    expect(typeof seen?.locationCode).toBe('string');
    // A reservation with no expiry reports null rather than a fabricated far-future
    // instant, which would make an open commitment look time-bounded.
    expect(seen?.expiresAt).toBeNull();
  });

  it('filters by item and work order, and pages by keyset without overlap', async () => {
    const order = await createOpenWorkOrder();
    await reserve({
      itemId: ITEM_A_ALT,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
      workOrderId: order.workOrderId,
    });
    await reserve({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' });

    authAs(INV_FULL);
    const byItem = (await (
      await reservationList(`${scopedQuery}&itemId=${ITEM_A_ALT}`)
    ).json()) as PageBody<{ itemId: string }>;
    expect(byItem.items.length).toBeGreaterThan(0);
    expect(byItem.items.every((row) => row.itemId === ITEM_A_ALT)).toBe(true);

    const byOrder = (await (
      await reservationList(`${scopedQuery}&workOrderId=${order.workOrderId}`)
    ).json()) as PageBody<{ workOrderId: string | null }>;
    expect(byOrder.items.length).toBeGreaterThan(0);
    expect(byOrder.items.every((row) => row.workOrderId === order.workOrderId)).toBe(true);

    const pageOne = (await (await reservationList(`${scopedQuery}&limit=1`)).json()) as PageBody<{
      id: string;
    }>;
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.hasMore).toBe(true);
    const pageTwo = (await (
      await reservationList(
        `${scopedQuery}&limit=1&cursor=${encodeURIComponent(pageOne.nextCursor ?? '')}`
      )
    ).json()) as PageBody<{ id: string }>;
    // The microsecond cursor is what stops reservations sharing a millisecond from
    // being silently skipped across the page boundary (P1-27-INT-006).
    expect(pageTwo.items[0]?.id).not.toBe(pageOne.items[0]?.id);

    const badCursor = await reservationList(`${scopedQuery}&cursor=not-a-cursor`);
    expect(badCursor.status).toBe(400);
    expect(await codeOf(badCursor)).toBe('ERR-PAG-001');
  });

  it('never returns another branch reservation, even to an unrestricted caller', async () => {
    // The falsifiability case for the company/branch predicate. INV_FULL is
    // unrestricted, so `iam.allowed_branch_ids()` is NULL and RLS admits every
    // tenant-A reservation — the SQL predicate is the ONLY thing narrowing this
    // read to the authorized branch. Verified by mutation: neutralising the
    // predicate turns this case red and nothing else in the file notices.
    const inOtherBranch = await reserve({
      itemId: ITEM_A,
      locationId: WAREHOUSE_A2,
      quantity: '1.000',
    });
    const inThisBranch = await reserve({
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });

    authAs(INV_FULL);
    const body = (await (await reservationList(`${scopedQuery}&limit=100`)).json()) as PageBody<{
      id: string;
      branchId: string;
    }>;
    expect(body.items.map((row) => row.id)).toContain(inThisBranch);
    expect(body.items.map((row) => row.id)).not.toContain(inOtherBranch);
    expect(body.items.every((row) => row.branchId === BRANCH_A1)).toBe(true);
  });

  it('refuses a locationId that names a different branch from the one authorized', async () => {
    authAs(INV_FULL);
    // Without this the location filter would be a way around the branch check, which
    // is the hole `readAvailability` closes the same way.
    const crossed = await reservationList(`${scopedQuery}&locationId=${WAREHOUSE_A2}`);
    expect(crossed.status).toBe(422);
    expect(await codeOf(crossed)).toBe('ERR-VAL-001');
  });

  it('refuses a branch the caller holds no stock permission in — application check, not RLS', async () => {
    await reserve({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' });

    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await reservationList(scopedQuery);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    // Served in the branch it IS scoped to.
    expect((await reservationList(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A2}`)).status).toBe(
      200
    );
  });

  it('is cross-tenant isolated: tenant B sees no tenant-A reservation', async () => {
    const mine = await reserve({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' });

    authAs(INV_TENANT_B);
    const foreign = await reservationList(scopedQuery);
    if (foreign.status === 200) {
      const body = (await foreign.json()) as PageBody<{ id: string }>;
      expect(body.items.map((row) => row.id)).not.toContain(mine);
    } else {
      expect([403, 404]).toContain(foreign.status);
    }
  });
});

// ---------------------------------------------------------------------------
// S-15 — inv.work-order-part-issue-list (class B, PARENT-SCOPED)
// ---------------------------------------------------------------------------

describe('S-15 inv.work-order-part-issue-list', () => {
  it('401 unauthenticated, and 403 without inv.stock.read', async () => {
    const order = await createOpenWorkOrder();

    __resetAuthenticatorForTests();
    expect((await partIssueList(order.workOrderId)).status).toBe(401);

    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    const refused = await partIssueList(order.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('answers an EMPTY page for a visible work order with nothing issued', async () => {
    const order = await createOpenWorkOrder();
    authAs(INV_FULL);
    const response = await partIssueList(order.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<unknown>;
    // Empty, not 404: the order is visible and genuinely holds no parts. A 404 would
    // be indistinguishable from "you may not see that order".
    expect(body.items).toHaveLength(0);
    expect(body.hasMore).toBe(false);
  });

  it('lists the parts issued to ONE work order, with returnedQty, both as strings', async () => {
    const order = await createOpenWorkOrder();
    const other = await createOpenWorkOrder();
    const issued = await issuePart({
      workOrderId: order.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '4.000',
    });
    await issuePart({
      workOrderId: other.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });

    authAs(INV_FULL);
    const response = await partIssueList(order.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<{
      id: string;
      workOrderId: string;
      sku: string;
      locationCode: string;
      quantity: string;
      returnedQty: string;
      issuedAt: string;
    }>;
    expect(body.items.map((row) => row.id)).toEqual([issued]);
    // The OTHER work order's issue is not here — the parent id is a real filter, not
    // a label on an unfiltered list.
    expect(body.items.every((row) => row.workOrderId === order.workOrderId)).toBe(true);

    const seen = body.items[0];
    expect(typeof seen?.quantity).toBe('string');
    expect(seen?.quantity).toBe('4.000');
    // The correlated sum over inv.part_returns — the same one readPartIssue computes,
    // in SQL. Nothing has been returned, so it is an exact zero, not a null.
    expect(typeof seen?.returnedQty).toBe('string');
    expect(Number(seen?.returnedQty)).toBe(0);
    // The outstanding amount is NOT published: netting two exact decimals in
    // JavaScript is the arithmetic the server-owned-amount rule forbids. Both exact
    // operands are given instead.
    expect(JSON.stringify(body)).not.toContain('outstanding');
    expect(typeof seen?.sku).toBe('string');
    expect(typeof seen?.locationCode).toBe('string');
    expect(typeof seen?.issuedAt).toBe('string');
  });

  it('pages by keyset, and tells a bad cursor from a bad parameter', async () => {
    const order = await createOpenWorkOrder();
    await issuePart({
      workOrderId: order.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });
    await issuePart({
      workOrderId: order.workOrderId,
      itemId: ITEM_A_ALT,
      locationId: WAREHOUSE_A1,
      quantity: '2.000',
    });

    authAs(INV_FULL);
    const pageOne = (await (
      await partIssueList(order.workOrderId, '?limit=1')
    ).json()) as PageBody<{ id: string }>;
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.hasMore).toBe(true);
    const pageTwo = (await (
      await partIssueList(
        order.workOrderId,
        `?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor ?? '')}`
      )
    ).json()) as PageBody<{ id: string }>;
    expect(pageTwo.items[0]?.id).not.toBe(pageOne.items[0]?.id);
    expect(pageTwo.hasMore).toBe(false);

    const badCursor = await partIssueList(order.workOrderId, '?cursor=not-a-cursor');
    expect(badCursor.status).toBe(400);
    expect(await codeOf(badCursor)).toBe('ERR-PAG-001');

    const unknownParam = await partIssueList(order.workOrderId, '?itemId=' + ITEM_A);
    expect(unknownParam.status).toBe(422);
    expect(await codeOf(unknownParam)).toBe('ERR-VAL-001');

    const malformed = await partIssueList('not-a-uuid');
    expect(malformed.status).toBe(422);
    expect(await codeOf(malformed)).toBe('ERR-VAL-001');
  });

  it('derives scope from the WORK ORDER row — the application check refuses, not RLS', async () => {
    const order = await createOpenWorkOrder();
    await issuePart({
      workOrderId: order.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });

    // THE decisive case for the parent-scoped shape. INV_PERMISSION_ELSEWHERE holds
    // inv.stock.read scoped to A2 and carries the widening grant that puts A1 inside
    // its permission-blind allowed-branch union — so RLS serves the work order and
    // the only thing that can refuse is `authorizeScope` on the company and branch
    // read FROM THAT ROW. A top-level `/stock-issues?workOrderId=…` could not be made
    // to refuse here at all: with no parent in the path the target is empty and
    // `requiresScopedEvaluation` returns false whatever is declared (P1-18-A-01).
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await partIssueList(order.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    authAs(INV_FULL);
    expect((await partIssueList(order.workOrderId)).status).toBe(200);
  });

  it('is refused by RLS when the parent work order is not visible at all', async () => {
    const order = await createOpenWorkOrder();
    await issuePart({
      workOrderId: order.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });

    // INV_SCOPED_A2 has no widening grant, so A1 is outside its allowed-branch union
    // and the work order is invisible: the refusal happens before `authorizeScope` is
    // reached. Recorded honestly — this is the DATABASE layer, and it is why the case
    // above exists to prove the application layer separately.
    authAs(INV_SCOPED_A2);
    const hidden = await partIssueList(order.workOrderId);
    expect(hidden.status).toBe(404);
    expect(await codeOf(hidden)).toBe('ERR-RES-001');
  });

  it('is cross-tenant isolated, and an empty page is not the answer', async () => {
    const order = await createOpenWorkOrder();
    await issuePart({
      workOrderId: order.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });

    // Tenant B holds inv.stock.read unrestricted, so the refusal is the tenant
    // boundary. It must NOT be a 200 with an empty page — that would confirm the work
    // order exists in another tenant.
    authAs(INV_TENANT_B);
    const foreign = await partIssueList(order.workOrderId);
    expect(foreign.status).not.toBe(200);
    expect([403, 404]).toContain(foreign.status);
  });
});
