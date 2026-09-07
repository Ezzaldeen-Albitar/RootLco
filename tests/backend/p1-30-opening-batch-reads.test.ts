/**
 * P1-30 seam S-17 — the opening-inventory batch reads.
 *
 * ## What these two reads make possible
 *
 * The opening batch was WRITE-ONLY on the wire: three POSTs — create, add line,
 * approve — and no GET at all. Everything a counter saw after a create existed
 * only as state in the tab that made the request. So a reload lost the batch, a
 * sign-out lost it, and the SECOND PERSON — the one
 * `ck_opening_inventory_batches_maker` requires, since the counter may not approve
 * their own count — had no way to reach a draft at all. The maker-and-checker rule
 * was satisfiable only by swapping sessions inside one un-reloaded tab, which is a
 * harness and not a product. Approval is the single operation in the platform that
 * creates stock from nothing, so approving a batch nobody can read is not a second
 * pair of eyes.
 *
 * `inv.opening-batch-list` gives an approver a way to FIND the drafts of a branch;
 * `inv.opening-batch-read` gives them the counted lines to look at before they
 * approve. Both sit on `inv.stock.read`, the permission the count screen already
 * gates on — the 118-code catalogue names no batch-specific read authority and
 * this slice mints none (RES-05).
 *
 * ## The scope rule
 *
 * P1-18-A-01: `requiresScopedEvaluation` returns FALSE on an empty scope target
 * whatever an operation declares. The LIST therefore REQUIRES `companyId` and
 * `branchId` and authorizes them before reading. The DETAIL names a batch and not
 * a branch, so its in-service `authorizeScope` on the batch's own pair is the ONLY
 * scoped guard it has.
 *
 * ## Not-found before scope, on purpose
 *
 * The detail's header lookup carries no scope predicate: an unknown id, a
 * soft-deleted batch and another tenant's batch all answer `404 ERR-RES-001`
 * before any scope decision is taken. Answering 403 for an id the caller may not
 * see would confirm that the id names a real batch somewhere, which is exactly the
 * existence signal a foreign id must not receive. A batch in another branch of the
 * caller's OWN tenant is a different case: it is read, and then refused by
 * `authorizeScope`.
 *
 * ## Exactly-once was already structural; the answer was the defect
 *
 * `uq_opening_inventory_lines_cell` allows one live line per (item, location)
 * inside a batch. That index — not an idempotency key — is what makes a counted
 * cell exactly-once, and the duplicate cases proving it live beside the write they
 * guard, in `p1-21-inventory-intake.test.ts`. What was wrong was the ANSWER: the
 * 23505 was unmapped and surfaced as `500 ERR-SYS-001` with an error-monitoring
 * capture. It is now `409 ERR-RES-002`.
 *
 * ## Falsifiability — measured, each mutation applied and reverted
 *
 * **A — `authorizeScope` deleted from `readOpeningBatch`.** RED: the detail
 * isolation case answered 200 instead of 403. The path names no branch, so there
 * is no pre-handler target and this is the only guard; `INV_PERMISSION_ELSEWHERE`
 * carries a widening grant, so RLS serves the row and cannot be what refuses.
 *
 * **B — the `company_id`/`branch_id` predicate neutralised in
 * `listOpeningBatches`.** RED on the case asserting the BRANCH_A2 batch is absent
 * for `INV_FULL`. `INV_FULL` is unrestricted, so `iam.allowed_branch_ids()` is
 * NULL and RLS admits every tenant-A row: for such a caller the SQL predicate is
 * the ONLY narrowing, and this file has to carry that proof itself.
 *
 * **C — `scopeTargetOption(raw)` removed from the list route alone.** GREEN, and
 * stated as such rather than hidden: the in-service `authorizeScope` absorbs it.
 * The route option makes the pre-handler check scope-aware; it is not the guard.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.opening-batch-list: route service authorization success denial cross-tenant isolation pagination
 *   inv.opening-batch-read: route service authorization success denial cross-tenant isolation
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
import { BRANCH_A2, establishP1_19Fixtures } from './p1-19-helpers';
import {
  INV_APPROVER,
  INV_FULL,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  INV_SCOPED_A2,
  INV_TENANT_B,
  ITEM_A,
  ITEM_A_ALT,
  STORAGE_A1,
  WAREHOUSE_A1,
  authAs,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
} from './p1-21-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  GET as BATCH_LIST,
  POST as BATCH_CREATE,
} from '@/app/api/v1/opening-inventory-batches/route';
import { GET as BATCH_READ } from '@/app/api/v1/opening-inventory-batches/[batchId]/route';
import { POST as LINE_CREATE } from '@/app/api/v1/opening-inventory-batches/[batchId]/lines/route';
import { POST as BATCH_APPROVE } from '@/app/api/v1/opening-inventory-batches/[batchId]/approval/route';

let admin: Pool;
let runtime: Pool;

interface PageBody<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface BatchRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly batchCode: string;
  readonly asOfDate: string;
  readonly status: string;
  readonly countedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly lineCount: number;
  readonly createdAt: string;
  readonly recordVersion: number;
}

interface LineRow {
  readonly id: string;
  readonly batchId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly quantity: string;
}

interface DetailBody {
  readonly batch: BatchRow;
  readonly lines: readonly LineRow[];
}

const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

const batchList = (query: string): Promise<Response> =>
  BATCH_LIST(new Request(`http://localhost/api/v1/opening-inventory-batches${query}`));

const batchRead = (batchId: string): Promise<Response> =>
  BATCH_READ(new Request(`http://localhost/api/v1/opening-inventory-batches/${batchId}`), {
    params: Promise.resolve({ batchId }),
  });

const scopedQuery = `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

/**
 * Every fixture is built through the SHIPPED routes, never by inserting rows.
 *
 * A read suite that seeded its own rows would prove the SELECT and nothing about
 * whether the write it claims to recover ever produces that shape.
 */
const createBatch = async (branchId = BRANCH_A1): Promise<string> => {
  authAs(INV_FULL);
  // A distinct code per batch: `uq_opening_inventory_batches_code` is unique per
  // branch, and the codes must also survive a repeated local run of this file.
  const response = await BATCH_CREATE(
    new Request('http://localhost/api/v1/opening-inventory-batches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId,
        batchCode: `FX-S17-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        asOfDate: '2026-07-01',
      }),
    })
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

const addLine = async (
  batchId: string,
  input: { readonly itemId: string; readonly locationId: string; readonly quantity: string }
): Promise<void> => {
  authAs(INV_FULL);
  const response = await LINE_CREATE(
    new Request(`http://localhost/api/v1/opening-inventory-batches/${batchId}/lines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
    { params: Promise.resolve({ batchId }) }
  );
  expect(response.status).toBe(201);
};

/** Approves as a DIFFERENT actor — `ck_opening_inventory_batches_maker`. */
const approve = async (batchId: string): Promise<void> => {
  authAs(INV_APPROVER);
  const response = await BATCH_APPROVE(
    new Request(`http://localhost/api/v1/opening-inventory-batches/${batchId}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    }),
    { params: Promise.resolve({ batchId }) }
  );
  expect(response.status).toBe(200);
};

/** Two drafts in A1 and one in A2, so the branch predicate is falsifiable. */
let firstA1 = '';
let secondA1 = '';
let otherBranch = '';

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);

  firstA1 = await createBatch(BRANCH_A1);
  secondA1 = await createBatch(BRANCH_A1);
  // In the OTHER branch. Without it the company/branch predicate changes no
  // answer for an unrestricted caller and the list would be unfalsifiable.
  otherBranch = await createBatch(BRANCH_A2);
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
// inv.opening-batch-list
// ---------------------------------------------------------------------------

describe('inv.opening-batch-list', () => {
  it('401 unauthenticated, and 403 without inv.stock.read', async () => {
    __resetAuthenticatorForTests();
    expect((await batchList(scopedQuery)).status).toBe(401);

    // A tenant-A principal with no inventory permission, so the refusal is
    // authority and not tenancy.
    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    const refused = await batchList(scopedQuery);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('requires companyId and branchId — the authorization target is not optional', async () => {
    authAs(INV_FULL);
    // An optional pair means `authorizeScope` is skipped whenever it is omitted,
    // leaving `app.branch_ids` — the permission-blind union of every active grant
    // — as the only narrowing on a list of what each branch is counting.
    const unscoped = await batchList('');
    expect(unscoped.status).toBe(422);
    expect(await codeOf(unscoped)).toBe('ERR-VAL-001');

    // An unknown parameter is refused rather than accepted as a filter the caller
    // believes was applied.
    const unknownParam = await batchList(`${scopedQuery}&batchCode=FX-S17`);
    expect(unknownParam.status).toBe(422);
    expect(await codeOf(unknownParam)).toBe('ERR-VAL-001');
  });

  it('lists the branch batches newest first, and no other branch leaks in', async () => {
    authAs(INV_FULL);
    const response = await batchList(scopedQuery);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<BatchRow>;
    const ids = body.items.map((row) => row.id);
    expect(ids).toContain(firstA1);
    expect(ids).toContain(secondA1);
    // Newest first: the second batch was created after the first.
    expect(ids.indexOf(secondA1)).toBeLessThan(ids.indexOf(firstA1));

    // THE falsifiable case. `INV_FULL` is unrestricted, so RLS admits every
    // tenant-A row and the SQL predicate is the only thing narrowing this list.
    expect(body.items.every((row) => row.branchId === BRANCH_A1)).toBe(true);
    expect(ids).not.toContain(otherBranch);

    const seen = body.items.find((row) => row.id === firstA1);
    expect(seen?.companyId).toBe(COMPANY_A1);
    // A `date` column publishes a plain ISO date and never acquires a time.
    expect(seen?.asOfDate).toBe('2026-07-01');
    expect(seen?.status).toBe('draft');
    // The two halves of the maker-checker rule, both readable.
    expect(seen?.countedBy).toBe(INV_FULL.userId);
    expect(seen?.approvedBy).toBeNull();
    expect(seen?.approvedAt).toBeNull();
    expect(typeof seen?.batchCode).toBe('string');
    expect(typeof seen?.recordVersion).toBe('number');
    // An empty draft attests to nothing, and the count says so without paging.
    expect(seen?.lineCount).toBe(0);
  });

  it('counts the lines of a batch in the answer, not from a page of them', async () => {
    const batchId = await createBatch(BRANCH_A1);
    await addLine(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' });
    await addLine(batchId, { itemId: ITEM_A_ALT, locationId: STORAGE_A1, quantity: '2.000' });

    authAs(INV_FULL);
    const body = (await (await batchList(scopedQuery)).json()) as PageBody<BatchRow>;
    expect(body.items.find((row) => row.id === batchId)?.lineCount).toBe(2);
  });

  it('filters by status, and an approved batch carries its approver and instant', async () => {
    const batchId = await createBatch(BRANCH_A1);
    await addLine(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '4.000' });
    await approve(batchId);

    authAs(INV_FULL);
    const approvedOnly = (await (
      await batchList(`${scopedQuery}&status=approved`)
    ).json()) as PageBody<BatchRow>;
    expect(approvedOnly.items.length).toBeGreaterThan(0);
    expect(approvedOnly.items.every((row) => row.status === 'approved')).toBe(true);
    const seen = approvedOnly.items.find((row) => row.id === batchId);
    expect(seen?.approvedBy).toBe(INV_APPROVER.userId);
    expect(seen?.approvedBy).not.toBe(seen?.countedBy);
    expect(typeof seen?.approvedAt).toBe('string');
    expect(Number.isNaN(Date.parse(seen?.approvedAt ?? ''))).toBe(false);

    // The drafts an approver is looking for are the complement, and the approved
    // batch is not among them.
    const drafts = (await (await batchList(`${scopedQuery}&status=draft`)).json()) as PageBody<{
      id: string;
      status: string;
    }>;
    expect(drafts.items.every((row) => row.status === 'draft')).toBe(true);
    expect(drafts.items.map((row) => row.id)).not.toContain(batchId);

    // An unregistered status is refused rather than silently ignored.
    const bogus = await batchList(`${scopedQuery}&status=cancelled`);
    expect(bogus.status).toBe(422);
    expect(await codeOf(bogus)).toBe('ERR-VAL-001');
  });

  it('pages by keyset without overlap, and tells a bad cursor from a bad param', async () => {
    authAs(INV_FULL);
    const pageOne = (await (await batchList(`${scopedQuery}&limit=1`)).json()) as PageBody<{
      id: string;
    }>;
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.hasMore).toBe(true);
    const pageTwo = (await (
      await batchList(
        `${scopedQuery}&limit=1&cursor=${encodeURIComponent(pageOne.nextCursor ?? '')}`
      )
    ).json()) as PageBody<{ id: string }>;
    expect(pageTwo.items[0]?.id).not.toBe(pageOne.items[0]?.id);

    const badCursor = await batchList(`${scopedQuery}&cursor=not-a-cursor`);
    expect(badCursor.status).toBe(400);
    expect(await codeOf(badCursor)).toBe('ERR-PAG-001');
  });

  it('refuses a branch the caller holds no stock permission in — application check, not RLS', async () => {
    // THE decisive isolation case. `INV_PERMISSION_ELSEWHERE` holds inv.stock.read
    // scoped to A2 AND an unrelated grant on A1, so A1 IS inside its
    // permission-blind allowed-branch union and A1's batches are visible to RLS.
    // Only the scoped permission check can refuse (P1-18-A-01).
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await batchList(scopedQuery);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    // The same principal succeeds in the branch it IS scoped to, so the refusal is
    // about scope and not a missing permission or a broken route.
    const allowed = await batchList(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A2}`);
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as PageBody<BatchRow>;
    expect(body.items.every((row) => row.branchId === BRANCH_A2)).toBe(true);
    expect(body.items.map((row) => row.id)).toContain(otherBranch);
  });

  it('is refused when RLS hides the branch entirely, and is cross-tenant isolated', async () => {
    // `INV_SCOPED_A2` has NO widening grant, so A1 is outside its allowed-branch
    // union. Stated honestly: this proves isolation and proves RLS is doing it. It
    // is NOT the application-check proof — that is the case above.
    authAs(INV_SCOPED_A2);
    expect([403, 404]).toContain((await batchList(scopedQuery)).status);

    // Tenant B holds inv.stock.read unrestricted, so this refusal is the tenant
    // boundary. It must not be a 200 listing tenant A's counts.
    authAs(INV_TENANT_B);
    const foreign = await batchList(scopedQuery);
    if (foreign.status === 200) {
      const body = (await foreign.json()) as PageBody<{ id: string }>;
      expect(body.items).toHaveLength(0);
    } else {
      expect([403, 404]).toContain(foreign.status);
    }
  });
});

// ---------------------------------------------------------------------------
// inv.opening-batch-read
// ---------------------------------------------------------------------------

describe('inv.opening-batch-read', () => {
  it('401 unauthenticated, and 403 without inv.stock.read', async () => {
    __resetAuthenticatorForTests();
    expect((await batchRead(firstA1)).status).toBe(401);

    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    const refused = await batchRead(firstA1);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('reads the counted lines back with the codes and the exact quantities', async () => {
    const batchId = await createBatch(BRANCH_A1);
    // Counted out of order, so the ordering assertion below is not vacuous:
    // `FX-WH-A1` sorts after `FX-ST-A1`.
    await addLine(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '12.250' });
    await addLine(batchId, { itemId: ITEM_A_ALT, locationId: STORAGE_A1, quantity: '3.500' });

    authAs(INV_FULL);
    const response = await batchRead(batchId);
    expect(response.status).toBe(200);
    const detail = (await response.json()) as DetailBody;

    // The header the detail publishes is the row the list publishes — one
    // projection, so a reader never has to discover which fields each answers.
    const listed = ((await (await batchList(scopedQuery)).json()) as PageBody<BatchRow>).items.find(
      (row) => row.id === batchId
    );
    expect(detail.batch).toEqual(listed);
    expect(detail.batch.status).toBe('draft');
    expect(detail.batch.lineCount).toBe(2);

    expect(detail.lines).toHaveLength(2);
    // Ordered by location code, then SKU — the order the shelves are walked in.
    expect(detail.lines.map((line) => line.locationCode)).toEqual(['FX-ST-A1', 'FX-WH-A1']);
    const warehouseLine = detail.lines.find((line) => line.locationId === WAREHOUSE_A1);
    // numeric(12,3) crosses as an exact decimal STRING, third place intact.
    expect(typeof warehouseLine?.quantity).toBe('string');
    expect(warehouseLine?.quantity).toBe('12.250');
    // Ids are paired with the labels an operator reads, never published bare.
    expect(warehouseLine?.sku).toBe('FX-P121-A');
    expect(warehouseLine?.itemName).toBe('Fixture brake pad');
    expect(warehouseLine?.batchId).toBe(batchId);
    expect(detail.lines.find((line) => line.locationId === STORAGE_A1)?.quantity).toBe('3.500');
  });

  it('survives approval: the same lines, now attributed to the approver', async () => {
    // The recovery case the maker-checker rule needs. The approver reads the batch
    // they did not create, approves it, and reads it back.
    const batchId = await createBatch(BRANCH_A1);
    await addLine(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '9.000' });

    authAs(INV_APPROVER);
    const beforeApproval = (await (await batchRead(batchId)).json()) as DetailBody;
    expect(beforeApproval.batch.status).toBe('draft');
    expect(beforeApproval.lines).toHaveLength(1);

    await approve(batchId);

    authAs(INV_APPROVER);
    const after = (await (await batchRead(batchId)).json()) as DetailBody;
    expect(after.batch.status).toBe('approved');
    expect(after.batch.approvedBy).toBe(INV_APPROVER.userId);
    expect(after.batch.countedBy).toBe(INV_FULL.userId);
    expect(typeof after.batch.approvedAt).toBe('string');
    // The count itself is unchanged — approval posts movements, it does not edit
    // the lines it attests to.
    expect(after.batch.lineCount).toBe(1);
    expect(after.lines).toEqual(beforeApproval.lines);
  });

  it('answers not-found for an unknown id and for another tenant batch (cross-tenant)', async () => {
    authAs(INV_FULL);
    const unknown = await batchRead(randomUUID());
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe('ERR-RES-001');

    // A malformed id is a validation refusal, not a 404 — the two must not be
    // conflated, or an unparseable id would look like a missing resource.
    expect((await batchRead('not-a-uuid')).status).toBe(422);

    // Tenant B cannot see tenant A's batch, and learns nothing about it: the same
    // 404 an id that names nothing gets, decided before any scope check.
    authAs(INV_TENANT_B);
    const foreign = await batchRead(firstA1);
    expect(foreign.status).toBe(404);
    expect(await codeOf(foreign)).toBe('ERR-RES-001');
  });

  it('refuses a batch in a branch the caller holds no stock permission in (isolation)', async () => {
    // The mutation target. `INV_PERMISSION_ELSEWHERE` has A1 inside its
    // permission-blind allowed-branch union, so RLS serves the row: deleting the
    // in-service `authorizeScope` turns this case from 403 into 200.
    authAs(INV_PERMISSION_ELSEWHERE);
    const refused = await batchRead(firstA1);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    // And it reads the batch of the branch it IS scoped to, so the refusal above
    // is about scope rather than a broken route.
    const allowed = await batchRead(otherBranch);
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as DetailBody).batch.branchId).toBe(BRANCH_A2);

    // `INV_SCOPED_A2` has no widening grant, so RLS hides the row outright and the
    // answer is the 404 an invisible batch gets — not a 403 confirming it exists.
    authAs(INV_SCOPED_A2);
    const hidden = await batchRead(firstA1);
    expect(hidden.status).toBe(404);
    expect(await codeOf(hidden)).toBe('ERR-RES-001');
  });
});
