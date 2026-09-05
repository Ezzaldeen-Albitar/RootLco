/**
 * P1-30 W5 — the parts and ledger contract the frontend consumes (FE-011 issues,
 * FE-012 returns, FE-013 stock movements).
 *
 * The parts screen renders a work order's required parts and part issues and
 * sends issues and returns; the movements screen renders the ledger of a
 * branch. This suite proves, on the SHIPPED routes, the exact properties those
 * screens rely on and state — the routes' full behaviour belongs to
 * `p1-21-inventory-stock`, `p1-21-inventory-reads` and `p1-30-a2-inventory-reads`.
 *
 * ## What the screens say, and where each statement is proved here
 *
 * - "Each issue shows what was issued and what has come back, as two figures
 *   the server holds." `quantity` and `returnedQty` on the per-work-order list
 *   are asserted as literal strings before and after a return; no expectation
 *   is computed in this file. Found here: before any return `returnedQty` is
 *   the unscaled `"0"`, after one it is `"1.000"` — the screen shows each as
 *   published.
 * - "The server refuses a return larger than what remains issued." Asserted.
 * - "Choosing a reservation consumes it." The reservation's status is read back
 *   as `consumed`, and an issue larger than its reservation is 409 ERR-TRN-001.
 * - "Idempotent commands carry keys." Both writes are marked idempotent; a
 *   second send under the SAME header key adds no movement (the count is a
 *   delta, not a vacuous absolute) and answers the same issue.
 * - "The ledger renders in `seq` order, newest first." Consecutive rows are
 *   asserted to carry strictly decreasing `sequence` strings compared as
 *   integers, and the issue and return rows appear with their signed figures.
 * - The reads that address a branch require the target (422) and refuse a
 *   caller scoped elsewhere (403); a reader may not issue or return.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.stock-issue-create: route service authorization success denial idempotency
 *   inv.stock-return-create: route service authorization success denial idempotency
 *   inv.work-order-part-issue-list: route service authorization success denial
 *   inv.stock-movement-list: route service authorization success denial isolation
 *   wo.required-part-list: route service success
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
import { FULL, createOpenWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import type { Principal } from './p1-19-helpers';
import {
  INV_FULL,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  ITEM_A,
  ITEM_A_ALT,
  STORAGE_A1,
  WAREHOUSE_A1,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
  movementCountFor,
  reservationStatusOf,
  seedStock,
} from './p1-21-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as RESERVE } from '@/app/api/v1/stock-reservations/route';
import { POST as ISSUE } from '@/app/api/v1/stock-issues/route';
import { POST as RETURN } from '@/app/api/v1/stock-returns/route';
import { GET as MOVEMENTS } from '@/app/api/v1/stock-movements/route';
import { GET as PART_ISSUES } from '@/app/api/v1/work-orders/[workOrderId]/part-issues/route';
import {
  GET as REQUIRED_PARTS,
  POST as RECORD_REQUIRED_PART,
} from '@/app/api/v1/work-orders/[workOrderId]/required-parts/route';

let admin: Pool;
let runtime: Pool;
let workOrderId: string;

interface PageBody<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface PartIssueRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly reservationId: string | null;
  readonly quantity: string;
  readonly returnedQty: string;
  readonly issuedAt: string;
}

interface IssueEcho {
  readonly id: string;
  readonly movementId: string;
  readonly workOrderId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  readonly reservationId: string | null;
}

interface ReturnEcho {
  readonly id: string;
  readonly partIssueId: string;
  readonly quantity: string;
  readonly totalReturned: string;
  readonly issuedQuantity: string;
}

interface MovementRow {
  readonly id: string;
  readonly sequence: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly movementType: string;
  readonly direction: string;
  readonly quantity: string;
  readonly signedQuantity: string;
  readonly reference: { readonly kind: string; readonly id: string };
}

interface RequiredPartRow {
  readonly id: string;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly reference: string | null;
}

/** A tenant-A principal holding work-order permissions and NO inventory permission. */
const NO_INVENTORY: Principal = { ...INV_READER, subject: 'fx_p1_19_full' };

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

const jsonPost = (url: string, payload: unknown, key: string): Request =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(payload),
  });

const issue = (payload: unknown, key = randomUUID()): Promise<Response> =>
  ISSUE(jsonPost('http://localhost/api/v1/stock-issues', payload, key));
const partReturn = (payload: unknown, key = randomUUID()): Promise<Response> =>
  RETURN(jsonPost('http://localhost/api/v1/stock-returns', payload, key));
const partIssues = (id: string, query = ''): Promise<Response> =>
  PART_ISSUES(new Request(`http://localhost/api/v1/work-orders/${id}/part-issues${query}`), {
    params: Promise.resolve({ workOrderId: id }),
  });
const requiredParts = (id: string): Promise<Response> =>
  REQUIRED_PARTS(new Request(`http://localhost/api/v1/work-orders/${id}/required-parts`), {
    params: Promise.resolve({ workOrderId: id }),
  });
const movements = (query: string): Promise<Response> =>
  MOVEMENTS(new Request(`http://localhost/api/v1/stock-movements${query}`));

const target = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

async function reserve(quantity: string): Promise<string> {
  authAs(INV_FULL);
  const response = await RESERVE(
    jsonPost(
      'http://localhost/api/v1/stock-reservations',
      { itemId: ITEM_A_ALT, locationId: STORAGE_A1, quantity, workOrderId },
      randomUUID()
    )
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  // The cell every issue and return below moves; nothing else touches it.
  await seedStock({ itemId: ITEM_A_ALT, locationId: STORAGE_A1, quantity: '20.000' });
  await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '500.000' });
  workOrderId = (await createOpenWorkOrder()).workOrderId;
}, 180_000);

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
// The required parts of the order (wo.required-part-list)
// ---------------------------------------------------------------------------

describe('wo.required-part-list — what the parts screen offers to issue', () => {
  it('lists a recorded line with its item reference, quantity as a string and free-text unit', async () => {
    authAs(FULL);
    const recorded = await RECORD_REQUIRED_PART(
      jsonPost(
        `http://localhost/api/v1/work-orders/${workOrderId}/required-parts`,
        { description: 'Oil filter', quantity: '1.000', unit: 'each', itemRef: ITEM_A_ALT },
        randomUUID()
      ),
      { params: Promise.resolve({ workOrderId }) }
    );
    expect(recorded.status).toBe(201);

    authAs(INV_READER);
    const response = await requiredParts(workOrderId);
    expect(response.status).toBe(200);
    const body = await bodyOf<{ items: readonly RequiredPartRow[] }>(response);
    const line = body.items.find((row) => row.reference === ITEM_A_ALT);
    expect(line).toMatchObject({ description: 'Oil filter', quantity: '1.000', unit: 'each' });
    expect(typeof line?.quantity).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// FE-011 — issue, against a reservation, with a key
// ---------------------------------------------------------------------------

describe('FE-011 inv.stock-issue-create', () => {
  let reservationId: string;
  let issueId: string;
  const key = randomUUID();

  it('a reader who holds every inventory read may not issue', async () => {
    reservationId = await reserve('2.500');
    authAs(INV_READER);
    const refused = await issue({
      workOrderId,
      itemId: ITEM_A_ALT,
      locationId: STORAGE_A1,
      quantity: '2.500',
      reservationId,
    });
    expect(refused.status).toBe(403);
    expect(await balanceOf(ITEM_A_ALT, STORAGE_A1)).toEqual({
      onHand: '20.000',
      reserved: '2.500',
      available: '17.500',
    });
  });

  it('issues against the reservation: 201, the quantity as a string, the reservation consumed, the balance moved by the server', async () => {
    authAs(INV_FULL);
    const before = await movementCountFor(ITEM_A_ALT, STORAGE_A1);
    const response = await issue(
      { workOrderId, itemId: ITEM_A_ALT, locationId: STORAGE_A1, quantity: '2.500', reservationId },
      key
    );
    expect(response.status).toBe(201);
    const echo = await bodyOf<IssueEcho>(response);
    issueId = echo.id;
    expect(echo).toMatchObject({
      workOrderId,
      itemId: ITEM_A_ALT,
      locationId: STORAGE_A1,
      quantity: '2.500',
      reservationId,
    });
    expect(typeof echo.quantity).toBe('string');
    expect(await reservationStatusOf(reservationId)).toBe('consumed');
    expect(await balanceOf(ITEM_A_ALT, STORAGE_A1)).toEqual({
      onHand: '17.500',
      reserved: '0.000',
      available: '17.500',
    });
    expect(await movementCountFor(ITEM_A_ALT, STORAGE_A1)).toBe(before + 1);
  });

  it('the same header key again answers the same issue and writes no second movement', async () => {
    authAs(INV_FULL);
    const before = await movementCountFor(ITEM_A_ALT, STORAGE_A1);
    const response = await issue(
      { workOrderId, itemId: ITEM_A_ALT, locationId: STORAGE_A1, quantity: '2.500', reservationId },
      key
    );
    expect([200, 201]).toContain(response.status);
    const echo = await bodyOf<IssueEcho>(response);
    expect(echo.id).toBe(issueId);
    expect(await movementCountFor(ITEM_A_ALT, STORAGE_A1)).toBe(before);
    expect(await balanceOf(ITEM_A_ALT, STORAGE_A1)).toMatchObject({ onHand: '17.500' });
  });

  it('an issue larger than its reservation is refused as a conflict, and moves nothing', async () => {
    const small = await reserve('1.000');
    authAs(INV_FULL);
    const before = await movementCountFor(ITEM_A_ALT, STORAGE_A1);
    const refused = await issue({
      workOrderId,
      itemId: ITEM_A_ALT,
      locationId: STORAGE_A1,
      quantity: '2.000',
      reservationId: small,
    });
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe('ERR-TRN-001');
    expect(await movementCountFor(ITEM_A_ALT, STORAGE_A1)).toBe(before);
    expect(await reservationStatusOf(small)).toBe('active');
  });

  it('the per-work-order list shows the issue with two exact figures and no remaining', async () => {
    authAs(NO_INVENTORY);
    expect((await partIssues(workOrderId)).status).toBe(403);

    authAs(INV_READER);
    const response = await partIssues(workOrderId, '?limit=100');
    expect(response.status).toBe(200);
    const body = await bodyOf<PageBody<PartIssueRow>>(response);
    const row = body.items.find((item) => item.id === issueId);
    expect(row).toMatchObject({
      workOrderId,
      itemId: ITEM_A_ALT,
      sku: 'FX-P121-B',
      locationCode: 'FX-ST-A1',
      reservationId,
      quantity: '2.500',
      // FINDING (W5): before any return the server publishes the unscaled
      // "0", not "0.000" — the coalesced sum is not cast to numeric(12,3) —
      // while after a return it is scaled ("1.000", below). The screen renders
      // the string as published; this suite asserts what the server states.
      returnedQty: '0',
    });
    expect(typeof row?.returnedQty).toBe('string');
    expect(Object.keys(row ?? {}).filter((k) => /remaining|outstanding/i.test(k))).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // FE-012 — return, bounded by the issue
  // ---------------------------------------------------------------------------

  it('a reader may not return', async () => {
    authAs(INV_READER);
    expect((await partReturn({ partIssueId: issueId, quantity: '1.000' })).status).toBe(403);
  });

  it('returns 1.000 of the 2.500: the echo states the running figures, the list shows them, the balance comes back', async () => {
    authAs(INV_FULL);
    const response = await partReturn({
      partIssueId: issueId,
      quantity: '1.000',
      reason: 'unused',
    });
    expect(response.status).toBe(201);
    const echo = await bodyOf<ReturnEcho>(response);
    expect(echo).toMatchObject({
      partIssueId: issueId,
      quantity: '1.000',
      totalReturned: '1.000',
      issuedQuantity: '2.500',
    });
    expect(typeof echo.totalReturned).toBe('string');

    authAs(INV_READER);
    const list = await bodyOf<PageBody<PartIssueRow>>(await partIssues(workOrderId, '?limit=100'));
    expect(list.items.find((item) => item.id === issueId)).toMatchObject({
      quantity: '2.500',
      returnedQty: '1.000',
    });
    expect(await balanceOf(ITEM_A_ALT, STORAGE_A1)).toEqual({
      onHand: '18.500',
      reserved: '1.000',
      available: '17.500',
    });
  });

  it('the same return header key again answers the same return and writes no second movement', async () => {
    authAs(INV_FULL);
    const key = randomUUID();
    const first = await partReturn({ partIssueId: issueId, quantity: '0.500' }, key);
    expect(first.status).toBe(201);
    const echo = await bodyOf<ReturnEcho>(first);
    expect(echo).toMatchObject({
      quantity: '0.500',
      totalReturned: '1.500',
      issuedQuantity: '2.500',
    });
    const before = await movementCountFor(ITEM_A_ALT, STORAGE_A1);
    const again = await partReturn({ partIssueId: issueId, quantity: '0.500' }, key);
    expect([200, 201]).toContain(again.status);
    expect((await bodyOf<ReturnEcho>(again)).id).toBe(echo.id);
    expect(await movementCountFor(ITEM_A_ALT, STORAGE_A1)).toBe(before);
    expect(await balanceOf(ITEM_A_ALT, STORAGE_A1)).toMatchObject({ onHand: '19.000' });
    authAs(INV_READER);
    const list = await bodyOf<PageBody<PartIssueRow>>(await partIssues(workOrderId, '?limit=100'));
    expect(list.items.find((item) => item.id === issueId)).toMatchObject({ returnedQty: '1.500' });
  });

  it('a return larger than what remains issued is refused as a conflict, and moves nothing', async () => {
    authAs(INV_FULL);
    const before = await movementCountFor(ITEM_A_ALT, STORAGE_A1);
    // 1.500 of 2.500 has come back; 1.001 more would exceed the issue.
    const refused = await partReturn({ partIssueId: issueId, quantity: '1.001' });
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe('ERR-TRN-001');
    expect(await movementCountFor(ITEM_A_ALT, STORAGE_A1)).toBe(before);
    expect(await balanceOf(ITEM_A_ALT, STORAGE_A1)).toMatchObject({ onHand: '19.000' });
  });

  // ---------------------------------------------------------------------------
  // FE-013 — the ledger, in sequence order
  // ---------------------------------------------------------------------------

  it('the ledger requires the target and refuses a caller scoped elsewhere', async () => {
    authAs(INV_READER);
    expect((await movements('')).status).toBe(422);
    authAs(NO_INVENTORY);
    expect((await movements(`?${target}`)).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await movements(`?${target}`)).status).toBe(403);
  });

  it('renders the work order’s movements newest sequence first, with the issue and the return signed', async () => {
    authAs(INV_READER);
    const response = await movements(`?${target}&workOrderId=${workOrderId}&limit=100`);
    expect(response.status).toBe(200);
    const body = await bodyOf<PageBody<MovementRow>>(response);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < body.items.length; i += 1) {
      const previous = BigInt((body.items[i - 1] as MovementRow).sequence);
      const current = BigInt((body.items[i] as MovementRow).sequence);
      expect(previous > current).toBe(true);
    }
    for (const row of body.items) expect(typeof row.sequence).toBe('string');
    const issued = body.items.find(
      (row) => row.reference.kind === 'part_issue' && row.reference.id === issueId
    );
    expect(issued).toMatchObject({
      movementType: 'issue',
      direction: 'out',
      quantity: '2.500',
      signedQuantity: '-2.500',
      itemId: ITEM_A_ALT,
      locationId: STORAGE_A1,
    });
    const returns = body.items.filter((row) => row.reference.kind === 'part_return');
    expect(returns.map((row) => row.signedQuantity).sort()).toEqual(['0.500', '1.000']);
    for (const row of returns)
      expect(row).toMatchObject({ movementType: 'return', direction: 'in' });
    // The row names its location by identifier only.
    expect(Object.keys(issued ?? {})).not.toContain('locationCode');
  });

  it('filters by movement type and reference kind', async () => {
    authAs(INV_READER);
    const returns = await bodyOf<PageBody<MovementRow>>(
      await movements(`?${target}&workOrderId=${workOrderId}&movementType=return&limit=100`)
    );
    expect(returns.items.length).toBe(2);
    expect(returns.items.every((row) => row.movementType === 'return')).toBe(true);
    const issues = await bodyOf<PageBody<MovementRow>>(
      await movements(`?${target}&workOrderId=${workOrderId}&referenceKind=part_issue&limit=100`)
    );
    expect(issues.items.every((row) => row.reference.kind === 'part_issue')).toBe(true);
  });
});
