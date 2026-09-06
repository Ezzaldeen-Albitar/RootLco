/**
 * P1-30 W4 — the inventory contract the frontend consumes (FE-008, FE-009, FE-010).
 *
 * The inventory screen renders three reads and two writes. This suite proves, on
 * the SHIPPED routes, the exact properties the screen relies on and states to the
 * operator — not the routes' full behaviour, which `p1-21-inventory-reads`,
 * `p1-21-inventory-stock` and `p1-30-a2-inventory-reads` own.
 *
 * ## What the screen says, and where each statement is proved here
 *
 * - "This screen shows no cost or price; none is published with the catalogue."
 *   The item search's rows are checked for ANY key naming a cost or a price.
 * - "The figures are the branch records as held by the server; nothing is summed."
 *   Availability quantities are asserted to be strings, and equal to the balance
 *   row's own strings, before and after a reservation moves them.
 * - "Quarantine locations are left out unless included." The quarantine cell is
 *   asserted absent by default and present under `includeQuarantine=true`.
 * - "This reservation had already been recorded; nothing further was booked."
 *   The screen sends one body `idempotencyKey` per opened form. A second POST
 *   naming the same BODY key — under a fresh transport header key, as a retry
 *   from the screen would — is 200 with `replayed: true` and the SAME id. (The
 *   header key alone replays the STORED 201 body, whose `replayed` is false; the
 *   first draft of this suite asserted the flag on a header replay and was red.)
 * - "That reservation had already ended; nothing changed." A second release is
 *   200 with `replayed: true`, and the balance does not move again.
 * - The reserve and release actions are offered behind `inv.stock.operate`; the
 *   server refuses a reader who holds every other read.
 *
 * ## Falsifiability
 *
 * Every expected quantity below is a LITERAL string the server must produce
 * (`'17.500'` after reserving `2.500` from `20.000`), compared with the balance row
 * the database holds. No expectation is computed in this file, so a route that
 * started rounding, netting in floating point or returning numbers would fail
 * these cases rather than be mirrored by them.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.item-search: route service authorization success denial cross-tenant
 *   inv.stock-availability-read: route service authorization success denial isolation
 *   inv.stock-reservation-create: route service authorization success denial idempotency
 *   inv.stock-reservation-release: route service authorization success denial idempotency
 *   inv.stock-reservation-list: route service authorization success
 *   inv.stock-location-list: route service authorization success
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
import { createOpenWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import {
  INV_FULL,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  INV_TENANT_B,
  ITEM_A,
  ITEM_A_ALT,
  ITEM_A_ARCHIVED,
  ITEM_A_UNTRACKED,
  QUARANTINE_A1,
  STORAGE_A1,
  WAREHOUSE_A1,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
  seedStock,
} from './p1-21-helpers';
import type { Principal } from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as ITEM_SEARCH } from '@/app/api/v1/items/route';
import { GET as AVAILABILITY } from '@/app/api/v1/stock-availability/route';
import { GET as LOCATION_LIST } from '@/app/api/v1/stock-locations/route';
import { GET as RESERVATION_LIST, POST as RESERVE } from '@/app/api/v1/stock-reservations/route';
import { POST as RELEASE } from '@/app/api/v1/stock-reservations/[reservationId]/release/route';

let admin: Pool;
let runtime: Pool;
let workOrderId: string;

interface PageBody<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface ItemRow {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  readonly unitOfMeasure: { readonly id: string; readonly code: string };
  readonly isStockTracked: boolean;
  readonly lifecycleStatus: string;
}

interface Cell {
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationType: string;
  readonly onHand: string;
  readonly reserved: string;
  readonly available: string;
}

interface ReservationEcho {
  readonly id: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: string;
  readonly replayed: boolean;
}

interface ReservationRow {
  readonly id: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: string;
}

/** A tenant-A principal holding work-order permissions and NO inventory permission. */
const NO_INVENTORY: Principal = { ...INV_READER, subject: 'fx_p1_19_full' };

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const get = (handler: (request: Request) => Promise<Response>, path: string): Promise<Response> =>
  handler(new Request(`http://localhost${path}`));

const jsonPost = (url: string, payload: unknown, key: string): Request =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(payload),
  });

const reserve = (payload: unknown, key = randomUUID()): Promise<Response> =>
  RESERVE(jsonPost('http://localhost/api/v1/stock-reservations', payload, key));

const release = (reservationId: string, payload: unknown = {}): Promise<Response> =>
  RELEASE(
    new Request(`http://localhost/api/v1/stock-reservations/${reservationId}/release`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ reservationId }) }
  );

const target = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

async function cellOf(itemId: string, locationId: string, extra = ''): Promise<Cell | undefined> {
  authAs(INV_READER);
  const response = await get(
    AVAILABILITY,
    `/api/v1/stock-availability?${target}&itemId=${itemId}&limit=100${extra}`
  );
  expect(response.status).toBe(200);
  const body = await bodyOf<PageBody<Cell>>(response);
  return body.items.find((cell) => cell.locationId === locationId);
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
  // The cell the reservation cases move. Nothing else in this suite touches it,
  // so its strings are known before and after each write.
  await seedStock({ itemId: ITEM_A_ALT, locationId: STORAGE_A1, quantity: '20.000' });
  // Stock in quarantine, so "excluded unless included" has a cell to exclude.
  await seedStock({ itemId: ITEM_A, locationId: QUARANTINE_A1, quantity: '5.000' });
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
// FE-008 — the item search
// ---------------------------------------------------------------------------

describe('FE-008 inv.item-search', () => {
  it('401 unauthenticated, 403 without inv.item.read', async () => {
    __resetAuthenticatorForTests();
    expect((await get(ITEM_SEARCH, '/api/v1/items?search=FX-P121')).status).toBe(401);
    authAs(NO_INVENTORY);
    expect((await get(ITEM_SEARCH, '/api/v1/items?search=FX-P121')).status).toBe(403);
  });

  it('publishes the fields the catalogue renders, and nothing that names a cost or a price', async () => {
    authAs(INV_READER);
    const response = await get(ITEM_SEARCH, '/api/v1/items?search=FX-P121&limit=100');
    expect(response.status).toBe(200);
    const body = await bodyOf<PageBody<ItemRow>>(response);
    const brakePad = body.items.find((row) => row.id === ITEM_A);
    expect(brakePad).toMatchObject({
      sku: 'FX-P121-A',
      name: 'Fixture brake pad',
      isStockTracked: true,
      lifecycleStatus: 'active',
    });
    expect(typeof brakePad?.itemType).toBe('string');
    expect(typeof brakePad?.unitOfMeasure.code).toBe('string');
    for (const row of body.items) {
      const keys = Object.keys(row);
      expect(keys.filter((key) => /cost|price|valuation/i.test(key))).toEqual([]);
    }
  });

  it('lists active items by default, archived only when asked, and tracked only when asked', async () => {
    authAs(INV_READER);
    const byDefault = await bodyOf<PageBody<ItemRow>>(
      await get(ITEM_SEARCH, '/api/v1/items?search=FX-P121&limit=100')
    );
    expect(byDefault.items.some((row) => row.id === ITEM_A_ARCHIVED)).toBe(false);
    expect(byDefault.items.some((row) => row.id === ITEM_A_UNTRACKED)).toBe(true);

    const archived = await bodyOf<PageBody<ItemRow>>(
      await get(ITEM_SEARCH, '/api/v1/items?search=FX-P121&lifecycleStatus=archived&limit=100')
    );
    expect(archived.items.map((row) => row.id)).toEqual([ITEM_A_ARCHIVED]);

    const tracked = await bodyOf<PageBody<ItemRow>>(
      await get(ITEM_SEARCH, '/api/v1/items?search=FX-P121&stockTrackedOnly=true&limit=100')
    );
    expect(tracked.items.some((row) => row.id === ITEM_A_UNTRACKED)).toBe(false);
    expect(tracked.items.some((row) => row.id === ITEM_A)).toBe(true);
  });

  it('another tenant sees none of these items', async () => {
    authAs(INV_TENANT_B);
    const response = await get(ITEM_SEARCH, '/api/v1/items?search=FX-P121&limit=100');
    expect(response.status).toBe(200);
    const body = await bodyOf<PageBody<ItemRow>>(response);
    // Tenant B has a fixture item of its own under this prefix; the boundary is
    // proved by tenant A's IDENTIFIERS being absent, not by the answer being empty.
    const tenantA = [ITEM_A, ITEM_A_ALT, ITEM_A_ARCHIVED, ITEM_A_UNTRACKED];
    expect(body.items.filter((row) => tenantA.includes(row.id))).toEqual([]);
    expect(body.items.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// FE-009 — availability, one row per cell
// ---------------------------------------------------------------------------

describe('FE-009 inv.stock-availability-read', () => {
  it('requires the branch target, and refuses a target the caller does not hold', async () => {
    authAs(INV_READER);
    expect((await get(AVAILABILITY, '/api/v1/stock-availability')).status).toBe(422);
    authAs(NO_INVENTORY);
    expect((await get(AVAILABILITY, `/api/v1/stock-availability?${target}`)).status).toBe(403);
    // Scoped to A2 with A1 inside its allowed branches: only the scoped permission
    // check can refuse this, and it must.
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await get(AVAILABILITY, `/api/v1/stock-availability?${target}`)).status).toBe(403);
  });

  it('publishes the three quantities as strings equal to the balance row', async () => {
    const cell = await cellOf(ITEM_A_ALT, STORAGE_A1);
    expect(cell).toBeDefined();
    expect(cell).toMatchObject({
      sku: 'FX-P121-B',
      locationCode: 'FX-ST-A1',
      locationType: 'storage',
      onHand: '20.000',
      reserved: '0.000',
      available: '20.000',
    });
    expect(typeof cell?.onHand).toBe('string');
    expect(typeof cell?.reserved).toBe('string');
    expect(typeof cell?.available).toBe('string');
    const balance = await balanceOf(ITEM_A_ALT, STORAGE_A1);
    expect(balance).toEqual({ onHand: '20.000', reserved: '0.000', available: '20.000' });
  });

  it('leaves quarantine out until asked for, then includes it', async () => {
    expect(await cellOf(ITEM_A, QUARANTINE_A1)).toBeUndefined();
    expect(await cellOf(ITEM_A, WAREHOUSE_A1)).toMatchObject({ onHand: '500.000' });
    const quarantined = await cellOf(ITEM_A, QUARANTINE_A1, '&includeQuarantine=true');
    expect(quarantined).toMatchObject({ locationType: 'quarantine', onHand: '5.000' });
  });

  it('the location list offers every location of the branch, quarantine included, for the pickers', async () => {
    authAs(INV_READER);
    const response = await get(LOCATION_LIST, `/api/v1/stock-locations?${target}&limit=100`);
    expect(response.status).toBe(200);
    const body = await bodyOf<PageBody<{ id: string; locationCode: string }>>(response);
    const ids = body.items.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([WAREHOUSE_A1, STORAGE_A1, QUARANTINE_A1]));
  });
});

// ---------------------------------------------------------------------------
// FE-010 — reserve, replay, release, release again
// ---------------------------------------------------------------------------

describe('FE-010 reservations', () => {
  let reservationId: string;
  const bodyKey = randomUUID();
  const payload = () => ({
    itemId: ITEM_A_ALT,
    locationId: STORAGE_A1,
    quantity: '2.500',
    workOrderId,
    idempotencyKey: bodyKey,
  });

  it('a reader who holds every inventory read may not reserve', async () => {
    authAs(INV_READER);
    const refused = await reserve(payload());
    expect(refused.status).toBe(403);
    expect(await cellOf(ITEM_A_ALT, STORAGE_A1)).toMatchObject({ reserved: '0.000' });
  });

  it('reserves: 201, the quantity echoed as a string, the balance moved by the server', async () => {
    authAs(INV_FULL);
    const response = await reserve(payload());
    expect(response.status).toBe(201);
    const echo = await bodyOf<ReservationEcho>(response);
    reservationId = echo.id;
    expect(echo).toMatchObject({
      itemId: ITEM_A_ALT,
      locationId: STORAGE_A1,
      workOrderId,
      quantity: '2.500',
      status: 'active',
      replayed: false,
    });
    expect(typeof echo.quantity).toBe('string');
    const cell = await cellOf(ITEM_A_ALT, STORAGE_A1);
    expect(cell).toMatchObject({ onHand: '20.000', reserved: '2.500', available: '17.500' });
    expect(await balanceOf(ITEM_A_ALT, STORAGE_A1)).toEqual({
      onHand: '20.000',
      reserved: '2.500',
      available: '17.500',
    });
  });

  it('the same body key again, under a new header key, is 200, replayed, the same reservation, and books nothing further', async () => {
    authAs(INV_FULL);
    const response = await reserve(payload());
    expect(response.status).toBe(200);
    const echo = await bodyOf<ReservationEcho>(response);
    expect(echo.id).toBe(reservationId);
    expect(echo.replayed).toBe(true);
    expect(await cellOf(ITEM_A_ALT, STORAGE_A1)).toMatchObject({ reserved: '2.500' });
  });

  it('the list answers the work-order filter the screen carries from the address', async () => {
    authAs(INV_READER);
    const response = await get(
      RESERVATION_LIST,
      `/api/v1/stock-reservations?${target}&workOrderId=${workOrderId}&status=active&limit=100`
    );
    expect(response.status).toBe(200);
    const body = await bodyOf<PageBody<ReservationRow>>(response);
    expect(body.items.map((row) => row.id)).toEqual([reservationId]);
    expect(body.items[0]).toMatchObject({ workOrderId, quantity: '2.500', status: 'active' });
  });

  it('a reader may not release', async () => {
    authAs(INV_READER);
    expect((await release(reservationId)).status).toBe(403);
    expect(await cellOf(ITEM_A_ALT, STORAGE_A1)).toMatchObject({ reserved: '2.500' });
  });

  it('releases: 200, not replayed, the balance restored by the server', async () => {
    authAs(INV_FULL);
    const response = await release(reservationId, {});
    expect(response.status).toBe(200);
    const echo = await bodyOf<ReservationEcho>(response);
    expect(echo).toMatchObject({ id: reservationId, status: 'released', replayed: false });
    expect(await cellOf(ITEM_A_ALT, STORAGE_A1)).toMatchObject({
      onHand: '20.000',
      reserved: '0.000',
      available: '20.000',
    });
  });

  it('releasing again is 200, replayed, and moves nothing', async () => {
    authAs(INV_FULL);
    const response = await release(reservationId, { reason: 'again' });
    expect(response.status).toBe(200);
    const echo = await bodyOf<ReservationEcho>(response);
    expect(echo).toMatchObject({ id: reservationId, status: 'released', replayed: true });
    expect(await balanceOf(ITEM_A_ALT, STORAGE_A1)).toEqual({
      onHand: '20.000',
      reserved: '0.000',
      available: '20.000',
    });
    authAs(INV_READER);
    const active = await bodyOf<PageBody<ReservationRow>>(
      await get(
        RESERVATION_LIST,
        `/api/v1/stock-reservations?${target}&workOrderId=${workOrderId}&status=active&limit=100`
      )
    );
    expect(active.items).toEqual([]);
    const released = await bodyOf<PageBody<ReservationRow>>(
      await get(
        RESERVATION_LIST,
        `/api/v1/stock-reservations?${target}&workOrderId=${workOrderId}&status=released&limit=100`
      )
    );
    expect(released.items.map((row) => row.id)).toEqual([reservationId]);
  });

  it('a zero quantity is refused by the server as well as by the screen', async () => {
    authAs(INV_FULL);
    const refused = await reserve({
      ...payload(),
      idempotencyKey: randomUUID(),
      quantity: '0.000',
    });
    expect([400, 422]).toContain(refused.status);
    expect(await cellOf(ITEM_A_ALT, STORAGE_A1)).toMatchObject({ reserved: '0.000' });
  });
});
