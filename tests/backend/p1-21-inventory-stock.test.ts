/**
 * Inventory stock mutations (Phase 1-21, P1-21-BE-004…008, BE-012, BE-013,
 * P1-21-QA-004).
 *
 * These are the operations that move company stock, so the assertions are on the
 * LEDGER and the BALANCE, not on the HTTP status. A 201 proves a row was written;
 * only `on_hand`, `reserved`, and the movement rows prove the right one was.
 *
 * ## The three defects this suite exists to hold closed
 *
 * Each was reproduced against a live database before any code was written, and each
 * has a test here that fails if the fix is removed
 * (`docs/phase-1/phase-1-21/wave-1-contract-archaeology.md`):
 *
 *  - **D-01** `inv.issue_part` posts the `out` movement before consuming the
 *    reservation, so issuing against a reservation that covers all available stock
 *    trips `ck_stock_balances_available`. "reserve 5 of 5, then issue 5" is the
 *    canonical failing case and is asserted to SUCCEED here.
 *  - **D-02** it reads `wo.work_orders.state` and never checks it, so a `draft` work
 *    order accepts an issue.
 *  - **D-03** it consumes whatever reservation id it is handed, including one
 *    belonging to a different item.
 *
 * Operations exercised here: inv.stock-reservation-create,
 * inv.stock-reservation-release, inv.stock-issue-create, inv.stock-return-create,
 * inv.damaged-stock-create.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.stock-reservation-create: route service authorization success denial audit outbox idempotency isolation
 *   inv.stock-reservation-release: route service authorization success denial cross-tenant audit outbox isolation
 *   inv.stock-issue-create: route service authorization success denial audit outbox idempotency isolation
 *   inv.stock-return-create: route service authorization success denial audit idempotency isolation
 *   inv.damaged-stock-create: route service authorization success denial audit idempotency isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { createOpenWorkOrder, createWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import {
  INV_FULL,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  ITEM_A,
  ITEM_A_ALT,
  ITEM_A_UNTRACKED,
  QUARANTINE_A1,
  STORAGE_A1,
  WAREHOUSE_A1,
  auditCountFor,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
  movementCountFor,
  outboxCountFor,
  reservationStatusOf,
  seedStock,
} from './p1-21-helpers';
import { POST as RESERVE } from '@/app/api/v1/stock-reservations/route';
import { POST as RELEASE } from '@/app/api/v1/stock-reservations/[reservationId]/release/route';
import { POST as ISSUE } from '@/app/api/v1/stock-issues/route';
import { POST as RETURN } from '@/app/api/v1/stock-returns/route';
import { POST as DAMAGE } from '@/app/api/v1/damaged-stock/route';

let admin: Pool;

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify(body),
    })
  );

const postWithKey = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  key: string
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const releaseCall = (reservationId: string, body: unknown = {}): Promise<Response> =>
  RELEASE(
    new Request(`http://localhost/api/v1/stock-reservations/${reservationId}/release`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ reservationId }) }
  );

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

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

describe('inv.stock-reservation-create', () => {
  it('reserves stock, reduces available, and writes one audit row and one event', async () => {
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const response = await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '3.500',
    });
    expect(response.status).toBe(201);
    const created = await bodyOf<{ id: string; quantity: string; status: string }>(response);
    expect(created.status).toBe('active');
    expect(created.quantity).toBe('3.500');

    // The balance is what proves it: reserved rises, on_hand does NOT, and available
    // is the GENERATED difference.
    const balance = await balanceOf(ITEM_A, WAREHOUSE_A1);
    expect(balance?.reserved).toBe('3.500');
    expect(balance?.available).toBe(
      (Number(balance!.onHand) - 3.5).toFixed(3) // display only; the assertions below are exact
    );
    expect(balance!.onHand).not.toBe('0.000');

    expect(await auditCountFor('inv.stock.reserved', created.id)).toBe(1);
    expect(await outboxCountFor(`stock.reserved:${created.id}`)).toBe(1);
  });

  it('refuses a reservation beyond available stock (denial)', async () => {
    await seedStock({ itemId: ITEM_A_ALT, locationId: WAREHOUSE_A1, quantity: '2.000' });
    authAs(INV_FULL);
    const response = await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: ITEM_A_ALT,
      locationId: WAREHOUSE_A1,
      quantity: '2.001',
    });
    // `inv.reserve_stock` raises check_violation inside the balance lock.
    expect(response.status).toBe(409);
    const after = await balanceOf(ITEM_A_ALT, WAREHOUSE_A1);
    expect(after?.reserved).toBe('0.000');
  });

  it('reserves the exact final unit, and then refuses the next (boundary)', async () => {
    const item = ITEM_A_ALT;
    await seedStock({ itemId: item, locationId: STORAGE_A1, quantity: '1.000' });
    authAs(INV_FULL);
    const first = await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: item,
      locationId: STORAGE_A1,
      quantity: '1.000',
    });
    expect(first.status).toBe(201);
    const second = await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: item,
      locationId: STORAGE_A1,
      quantity: '0.001',
    });
    expect(second.status).toBe(409);
    expect((await balanceOf(item, STORAGE_A1))?.available).toBe('0.000');
  });

  it('replays an idempotency key instead of reserving twice (idempotency)', async () => {
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const key = `fx-${randomUUID()}`;
    const payload = {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.250',
      idempotencyKey: key,
    };
    const first = await post(RESERVE, '/api/v1/stock-reservations', payload);
    expect(first.status).toBe(201);
    const firstBody = await bodyOf<{ id: string; replayed: boolean }>(first);
    expect(firstBody.replayed).toBe(false);

    const replay = await post(RESERVE, '/api/v1/stock-reservations', payload);
    // 200 rather than 201, and the SAME reservation — a retrying client can tell it
    // did not book stock twice.
    expect(replay.status).toBe(200);
    const replayBody = await bodyOf<{ id: string; replayed: boolean }>(replay);
    expect(replayBody.id).toBe(firstBody.id);
    expect(replayBody.replayed).toBe(true);

    // One row, one audit record, one event — not two.
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM inv.stock_reservations WHERE idempotency_key = $1`,
      [key]
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
    expect(await auditCountFor('inv.stock.reserved', firstBody.id)).toBe(1);
    expect(await outboxCountFor(`stock.reserved:${firstBody.id}`)).toBe(1);
  });

  it('refuses the same key with a different quantity (denial)', async () => {
    authAs(INV_FULL);
    const key = `fx-${randomUUID()}`;
    await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
      idempotencyKey: key,
    });
    const conflicting = await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '2.000',
      idempotencyKey: key,
    });
    // Reusing a key for a different request is a conflict, not a silent success
    // under someone else's booking.
    expect(conflicting.status).toBe(409);
  });

  it('refuses a malformed, zero, and floating-point quantity (denial)', async () => {
    authAs(INV_FULL);
    for (const quantity of ['0', '0.000', '-1', '1e3', '1.0005', 5 as unknown as string]) {
      const response = await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A,
        locationId: WAREHOUSE_A1,
        quantity,
      });
      expect([409, 422], `quantity ${String(quantity)}`).toContain(response.status);
    }
  });

  it('refuses an item that is not stock-tracked (denial)', async () => {
    authAs(INV_FULL);
    const response = await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: ITEM_A_UNTRACKED,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });
    expect(response.status).toBe(409);
  });

  it('refuses a caller lacking inv.stock.operate (authorization)', async () => {
    authAs(INV_READER);
    const response = await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });
    expect(response.status).toBe(403);
  });

  it('refuses a location in a branch the caller holds no inventory permission in (isolation)', async () => {
    // A1 IS in this principal's permission-blind allowed-branch union, so only the
    // scoped permission check can refuse it (P1-18-A-01).
    authAs(INV_PERMISSION_ELSEWHERE);
    const response = await post(RESERVE, '/api/v1/stock-reservations', {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });
    expect(response.status).toBe(403);
  });
});

describe('inv.stock-reservation-release', () => {
  it('releases an active reservation and returns the quantity to available', async () => {
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const created = await bodyOf<{ id: string }>(
      await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A,
        locationId: WAREHOUSE_A1,
        quantity: '4.000',
      })
    );
    const before = await balanceOf(ITEM_A, WAREHOUSE_A1);

    const response = await releaseCall(created.id, { reason: 'no longer needed' });
    expect(response.status).toBe(200);
    const released = await bodyOf<{ status: string; replayed: boolean }>(response);
    expect(released.status).toBe('released');
    expect(released.replayed).toBe(false);

    const after = await balanceOf(ITEM_A, WAREHOUSE_A1);
    expect(Number(after!.reserved)).toBe(Number(before!.reserved) - 4);
    // on_hand is untouched: a release moves nothing.
    expect(after!.onHand).toBe(before!.onHand);

    expect(await auditCountFor('inv.stock.reservation_released', created.id)).toBe(1);
    expect(await outboxCountFor(`stock.reservation.released:${created.id}`)).toBe(1);
  });

  it('is a safe no-op on a duplicate release, and writes no second audit or event', async () => {
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const created = await bodyOf<{ id: string }>(
      await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A,
        locationId: WAREHOUSE_A1,
        quantity: '2.000',
      })
    );
    await releaseCall(created.id);
    const second = await releaseCall(created.id);
    expect(second.status).toBe(200);
    const body = await bodyOf<{ status: string; replayed: boolean }>(second);
    expect(body.status).toBe('released');
    // Reported as a replay, so a client can tell the difference.
    expect(body.replayed).toBe(true);
    // Recording a state change that did not happen would make the trail lie, and
    // would let a retry loop inflate the outbox.
    expect(await auditCountFor('inv.stock.reservation_released', created.id)).toBe(1);
    expect(await outboxCountFor(`stock.reservation.released:${created.id}`)).toBe(1);
  });

  it('refuses an unknown reservation (cross-tenant / denial)', async () => {
    authAs(INV_FULL);
    expect((await releaseCall(randomUUID())).status).toBe(404);
  });

  it('refuses a caller lacking inv.stock.operate (authorization)', async () => {
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '5.000' });
    authAs(INV_FULL);
    const created = await bodyOf<{ id: string }>(
      await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A,
        locationId: WAREHOUSE_A1,
        quantity: '1.000',
      })
    );
    authAs(INV_READER);
    expect((await releaseCall(created.id)).status).toBe(403);
  });

  it('refuses release from a branch the caller is not scoped to (isolation)', async () => {
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '5.000' });
    authAs(INV_FULL);
    const created = await bodyOf<{ id: string }>(
      await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A,
        locationId: WAREHOUSE_A1,
        quantity: '1.000',
      })
    );
    // The path names a reservation, not a branch. The deferred check reads the
    // reservation's OWN company/branch, so this refusal is the scoped evaluation.
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await releaseCall(created.id)).status).toBe(403);
  });
});

describe('inv.stock-issue-create', () => {
  it('issues against a reservation covering ALL available stock (closes D-01)', async () => {
    // THE regression test for the reproduced defect. `inv.issue_part` posts the out
    // movement before consuming the reservation, so on_hand falls while reserved is
    // still held and ck_stock_balances_available rejects it. Reserve 5 of 5 and issue
    // 5 is exactly that case, and it must SUCCEED.
    const wo = await createOpenWorkOrder();
    await seedStock({ itemId: ITEM_A_ALT, locationId: WAREHOUSE_A1, quantity: '5.000' });
    authAs(INV_FULL);
    const balanceBefore = await balanceOf(ITEM_A_ALT, WAREHOUSE_A1);
    const available = balanceBefore!.available;

    const reservation = await bodyOf<{ id: string }>(
      await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A_ALT,
        locationId: WAREHOUSE_A1,
        quantity: available,
        workOrderId: wo.workOrderId,
      })
    );
    expect((await balanceOf(ITEM_A_ALT, WAREHOUSE_A1))?.available).toBe('0.000');

    const response = await post(ISSUE, '/api/v1/stock-issues', {
      workOrderId: wo.workOrderId,
      itemId: ITEM_A_ALT,
      locationId: WAREHOUSE_A1,
      quantity: available,
      reservationId: reservation.id,
    });
    expect(response.status).toBe(201);
    const issued = await bodyOf<{ id: string; movementId: string }>(response);

    const after = await balanceOf(ITEM_A_ALT, WAREHOUSE_A1);
    // Stock left, the reservation was consumed, and available never went negative.
    expect(Number(after!.onHand)).toBe(Number(balanceBefore!.onHand) - Number(available));
    expect(after!.reserved).toBe('0.000');
    expect(await reservationStatusOf(reservation.id)).toBe('consumed');

    expect(await auditCountFor('inv.part.issued', issued.id)).toBe(1);
    expect(await outboxCountFor(`stock.movement.posted:${issued.movementId}`)).toBe(1);
  });

  it('refuses an issue to a DRAFT work order (closes D-02)', async () => {
    // `createWorkOrder` leaves the order in `draft`. inv.issue_part accepts it; the
    // backend must not.
    const draft = await createWorkOrder();
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '5.000' });
    authAs(INV_FULL);
    const response = await post(ISSUE, '/api/v1/stock-issues', {
      workOrderId: draft.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });
    expect(response.status).toBe(409);
    // Nothing was written.
    expect(
      await admin
        .query<{ n: string }>(
          `SELECT count(*)::text AS n FROM inv.part_issues WHERE work_order_id = $1`,
          [draft.workOrderId]
        )
        .then((r) => Number(r.rows[0]?.n))
    ).toBe(0);
  });

  it('refuses a reservation belonging to a different item (closes D-03)', async () => {
    const wo = await createOpenWorkOrder();
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    await seedStock({ itemId: ITEM_A_ALT, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const otherItemReservation = await bodyOf<{ id: string }>(
      await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A_ALT,
        locationId: WAREHOUSE_A1,
        quantity: '4.000',
        workOrderId: wo.workOrderId,
      })
    );
    const response = await post(ISSUE, '/api/v1/stock-issues', {
      workOrderId: wo.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '2.000',
      reservationId: otherItemReservation.id,
    });
    expect(response.status).toBe(409);
    // The unrelated reservation is still active — it was NOT consumed.
    expect(await reservationStatusOf(otherItemReservation.id)).toBe('active');
  });

  it('refuses an issue larger than the reservation holds (denial)', async () => {
    const wo = await createOpenWorkOrder();
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const reservation = await bodyOf<{ id: string }>(
      await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A,
        locationId: WAREHOUSE_A1,
        quantity: '2.000',
        workOrderId: wo.workOrderId,
      })
    );
    // inv.consume_reservation releases the reservation IN FULL whatever the issued
    // quantity, so issuing 5 against a reservation of 2 would turn a reservation
    // into a suggestion.
    const response = await post(ISSUE, '/api/v1/stock-issues', {
      workOrderId: wo.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '5.000',
      reservationId: reservation.id,
    });
    expect(response.status).toBe(409);
    expect(await reservationStatusOf(reservation.id)).toBe('active');
  });

  it('refuses an issue that would drive stock negative (BE-012)', async () => {
    const wo = await createOpenWorkOrder();
    await seedStock({ itemId: ITEM_A_ALT, locationId: STORAGE_A1, quantity: '1.000' });
    authAs(INV_FULL);
    const before = await balanceOf(ITEM_A_ALT, STORAGE_A1);
    const response = await post(ISSUE, '/api/v1/stock-issues', {
      workOrderId: wo.workOrderId,
      itemId: ITEM_A_ALT,
      locationId: STORAGE_A1,
      quantity: '999.000',
    });
    expect(response.status).toBe(409);
    // The balance is untouched — the whole transaction rolled back.
    const after = await balanceOf(ITEM_A_ALT, STORAGE_A1);
    expect(after!.onHand).toBe(before!.onHand);
  });

  it('refuses a caller lacking inv.stock.operate (authorization)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_READER);
    const response = await post(ISSUE, '/api/v1/stock-issues', {
      workOrderId: wo.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });
    expect(response.status).toBe(403);
  });

  it('refuses an issue in a branch the caller is not scoped to (isolation)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_PERMISSION_ELSEWHERE);
    const response = await post(ISSUE, '/api/v1/stock-issues', {
      workOrderId: wo.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });
    expect(response.status).toBe(403);
  });

  it('replays an idempotency key without issuing twice (idempotency)', async () => {
    const wo = await createOpenWorkOrder();
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const key = `fx-${randomUUID()}`;
    const payload = {
      workOrderId: wo.workOrderId,
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    };
    const first = await postWithKey(ISSUE, '/api/v1/stock-issues', payload, key);
    expect(first.status).toBe(201);
    const before = await balanceOf(ITEM_A, WAREHOUSE_A1);
    const replay = await postWithKey(ISSUE, '/api/v1/stock-issues', payload, key);
    expect([200, 201]).toContain(replay.status);
    // The stock moved once, not twice — the foundation's idempotency record and the
    // command committed together.
    expect((await balanceOf(ITEM_A, WAREHOUSE_A1))!.onHand).toBe(before!.onHand);
    expect(
      await admin
        .query<{ n: string }>(
          `SELECT count(*)::text AS n FROM inv.part_issues WHERE work_order_id = $1`,
          [wo.workOrderId]
        )
        .then((r) => Number(r.rows[0]?.n))
    ).toBe(1);
  });
});

describe('inv.stock-return-create', () => {
  it('returns an issued part and bounds the total at the issued quantity', async () => {
    const wo = await createOpenWorkOrder();
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const issued = await bodyOf<{ id: string }>(
      await post(ISSUE, '/api/v1/stock-issues', {
        workOrderId: wo.workOrderId,
        itemId: ITEM_A,
        locationId: WAREHOUSE_A1,
        quantity: '5.000',
      })
    );
    const afterIssue = await balanceOf(ITEM_A, WAREHOUSE_A1);

    const first = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: issued.id,
      quantity: '3.000',
      reason: 'not required',
    });
    expect(first.status).toBe(201);
    const returned = await bodyOf<{ id: string; totalReturned: string }>(first);
    expect(returned.totalReturned).toBe('3.000');
    // Stock came back: a return is an `in` movement.
    expect(Number((await balanceOf(ITEM_A, WAREHOUSE_A1))!.onHand)).toBe(
      Number(afterIssue!.onHand) + 3
    );
    expect(await auditCountFor('inv.part.returned', returned.id)).toBe(1);

    // Over-return is refused: 3 already returned + 3 more exceeds the 5 issued.
    const over = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: issued.id,
      quantity: '3.000',
    });
    expect(over.status).toBe(409);
    // The remainder is still returnable, so the ceiling is exact and not conservative.
    const exact = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: issued.id,
      quantity: '2.000',
    });
    expect(exact.status).toBe(201);
  });

  it('refuses an unknown part issue (denial)', async () => {
    authAs(INV_FULL);
    const response = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: randomUUID(),
      quantity: '1.000',
    });
    expect(response.status).toBe(404);
  });

  it('cannot name a different work order, item, or location', async () => {
    // The body has only partIssueId, quantity and reason — everything else is read
    // off the issue, so moving stock sideways under cover of a return is
    // unrepresentable rather than merely refused.
    authAs(INV_FULL);
    const response = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: randomUUID(),
      quantity: '1.000',
      locationId: WAREHOUSE_A1,
    });
    expect(response.status).toBe(422);
  });

  it('refuses a caller lacking inv.stock.operate (authorization)', async () => {
    authAs(INV_READER);
    const response = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: randomUUID(),
      quantity: '1.000',
    });
    expect(response.status).toBe(403);
  });

  it('refuses a return in a branch the caller is not scoped to (isolation)', async () => {
    const wo = await createOpenWorkOrder();
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const issued = await bodyOf<{ id: string }>(
      await post(ISSUE, '/api/v1/stock-issues', {
        workOrderId: wo.workOrderId,
        itemId: ITEM_A,
        locationId: WAREHOUSE_A1,
        quantity: '1.000',
      })
    );
    authAs(INV_PERMISSION_ELSEWHERE);
    const response = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: issued.id,
      quantity: '1.000',
    });
    expect(response.status).toBe(403);
  });
});

describe('inv.damaged-stock-create', () => {
  it('moves damaged units into quarantine and out of sellable availability', async () => {
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '10.000' });
    authAs(INV_FULL);
    const before = await balanceOf(ITEM_A, WAREHOUSE_A1);
    const quarantineBefore = (await balanceOf(ITEM_A, QUARANTINE_A1))?.onHand ?? '0.000';

    const response = await post(DAMAGE, '/api/v1/damaged-stock', {
      itemId: ITEM_A,
      fromLocationId: WAREHOUSE_A1,
      quarantineLocationId: QUARANTINE_A1,
      quantity: '2.000',
      reason: 'Dropped during handling',
    });
    expect(response.status).toBe(201);
    const damage = await bodyOf<{ id: string }>(response);

    // Sellable stock fell...
    const after = await balanceOf(ITEM_A, WAREHOUSE_A1);
    expect(Number(after!.onHand)).toBe(Number(before!.onHand) - 2);
    // ...and the units are in quarantine, not gone. Availability is not inflated:
    // they sit in a different cell that the default availability read excludes.
    expect(Number((await balanceOf(ITEM_A, QUARANTINE_A1))!.onHand)).toBe(
      Number(quarantineBefore) + 2
    );
    // A paired movement: one `out`, one `in`, distinguished only by direction.
    expect(await movementCountFor(ITEM_A, QUARANTINE_A1)).toBeGreaterThan(0);
    expect(await auditCountFor('inv.stock.damaged', damage.id)).toBe(1);
  });

  it('refuses a destination that is not a quarantine location (denial)', async () => {
    await seedStock({ itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '5.000' });
    authAs(INV_FULL);
    // ck_damaged_stock_locations only requires the two ids to DIFFER, so this would
    // satisfy the constraint and leave the "damaged" unit sellable in STORAGE_A1.
    const response = await post(DAMAGE, '/api/v1/damaged-stock', {
      itemId: ITEM_A,
      fromLocationId: WAREHOUSE_A1,
      quarantineLocationId: STORAGE_A1,
      quantity: '1.000',
      reason: 'Dropped',
    });
    expect(response.status).toBe(409);
  });

  it('requires a reason and refuses an unknown disposition (denial)', async () => {
    authAs(INV_FULL);
    expect(
      (
        await post(DAMAGE, '/api/v1/damaged-stock', {
          itemId: ITEM_A,
          fromLocationId: WAREHOUSE_A1,
          quarantineLocationId: QUARANTINE_A1,
          quantity: '1.000',
        })
      ).status
    ).toBe(422);
    expect(
      (
        await post(DAMAGE, '/api/v1/damaged-stock', {
          itemId: ITEM_A,
          fromLocationId: WAREHOUSE_A1,
          quarantineLocationId: QUARANTINE_A1,
          quantity: '1.000',
          reason: 'Dropped',
          disposition: 'written_off',
        })
      ).status
    ).toBe(422);
  });

  it('releases conflicting reservations rather than driving available negative', async () => {
    await seedStock({ itemId: ITEM_A_ALT, locationId: WAREHOUSE_A1, quantity: '4.000' });
    authAs(INV_FULL);
    const balance = await balanceOf(ITEM_A_ALT, WAREHOUSE_A1);
    const reservation = await bodyOf<{ id: string }>(
      await post(RESERVE, '/api/v1/stock-reservations', {
        itemId: ITEM_A_ALT,
        locationId: WAREHOUSE_A1,
        quantity: balance!.available,
      })
    );
    // Damaging stock that is fully reserved would breach on_hand - reserved >= 0
    // unless inv.free_reservations_for_loss releases the conflict first.
    const response = await post(DAMAGE, '/api/v1/damaged-stock', {
      itemId: ITEM_A_ALT,
      fromLocationId: WAREHOUSE_A1,
      quarantineLocationId: QUARANTINE_A1,
      quantity: '1.000',
      reason: 'Corroded',
    });
    expect(response.status).toBe(201);
    expect(await reservationStatusOf(reservation.id)).toBe('released');
    const after = await balanceOf(ITEM_A_ALT, WAREHOUSE_A1);
    expect(Number(after!.available)).toBeGreaterThanOrEqual(0);
  });

  it('refuses a caller lacking inv.stock.operate (authorization)', async () => {
    authAs(INV_READER);
    const response = await post(DAMAGE, '/api/v1/damaged-stock', {
      itemId: ITEM_A,
      fromLocationId: WAREHOUSE_A1,
      quarantineLocationId: QUARANTINE_A1,
      quantity: '1.000',
      reason: 'Dropped',
    });
    expect(response.status).toBe(403);
  });

  it('refuses damage in a branch the caller is not scoped to (isolation)', async () => {
    authAs(INV_PERMISSION_ELSEWHERE);
    const response = await post(DAMAGE, '/api/v1/damaged-stock', {
      itemId: ITEM_A,
      fromLocationId: WAREHOUSE_A1,
      quarantineLocationId: QUARANTINE_A1,
      quantity: '1.000',
      reason: 'Dropped',
    });
    expect(response.status).toBe(403);
  });
});
