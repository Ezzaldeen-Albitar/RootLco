/**
 * P1-32 preparatory slice 2 — item barcodes and packaging identifiers, end to end
 * through their route handlers (P1-32-PRE-100…104).
 *
 * The assertions rest on identifier ROWS and AUDIT rows, not only on statuses. The
 * properties this suite exists to hold:
 *
 *  - an identifier write needs `inv.item.manage` granted TENANT-WIDE, because a code
 *    resolves its item in every branch;
 *  - a retail code with a wrong check digit never reaches the table, and a live
 *    duplicate is a conflict — but a doubled request under one Idempotency-Key is a
 *    replay, not a duplicate;
 *  - the internal code is allocated once per item;
 *  - a scan resolves to exactly one item or is refused (unknown: 404; ambiguous: 409),
 *    and reading stock at a branch through a scan needs authority at that branch;
 *  - nothing of tenant A resolves or reads for tenant B.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.item-identifier-list: route service authorization success cross-tenant isolation
 *   inv.item-identifier-add: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.item-identifier-retire: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.item-barcode-assign: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.barcode-resolve: route service authorization success denial cross-tenant isolation
 *   inv.item-label-data: route service authorization success cross-tenant isolation
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
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  INV_CATALOG,
  INV_CATALOG_SCOPED_A1,
  INV_READER,
  INV_SCOPED_A2,
  INV_TENANT_B,
  INV_TENANT_B_CATALOG,
  ITEM_A,
  ITEM_A_ALT,
  ITEM_A_ARCHIVED,
  ITEM_A_UNTRACKED,
  auditCountFor,
  authAs,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
  seedStock,
} from './p1-21-helpers';
import {
  GET as IDENTIFIER_LIST,
  POST as IDENTIFIER_ADD,
} from '@/app/api/v1/items/[itemId]/identifiers/route';
import { POST as IDENTIFIER_RETIRE } from '@/app/api/v1/items/[itemId]/identifiers/[identifierId]/retirement/route';
import { POST as BARCODE_ASSIGN } from '@/app/api/v1/items/[itemId]/internal-barcode/route';
import { GET as LABEL } from '@/app/api/v1/items/[itemId]/label/route';
import { GET as RESOLVE } from '@/app/api/v1/barcodes/[value]/route';

let admin: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const postAt = <P>(
  handler: ParamHandler<P>,
  path: string,
  params: P,
  body: unknown,
  key: string = randomUUID()
) =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve(params) }
  );

const getAt = <P>(handler: ParamHandler<P>, path: string, params: P) =>
  handler(new Request(`http://localhost${path}`, { method: 'GET' }), {
    params: Promise.resolve(params),
  });

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

interface IdentifierBody {
  id: string;
  itemId: string;
  kind: string;
  value: string;
  normalizedValue: string;
  packQuantity: string;
  isPrimary: boolean;
  symbology: string;
  retired: boolean;
  replayed: boolean;
}

const addTo = (itemId: string, body: Record<string, unknown>, key?: string) =>
  postAt(IDENTIFIER_ADD, `/api/v1/items/${itemId}/identifiers`, { itemId }, body, key);

const rowsFor = (itemId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM inv.item_identifiers WHERE item_id = $1`, [itemId]);

/** A supplier code no other case in this file uses. */
const uniqueCode = (): string => `ODINV-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await admin.query(`DELETE FROM inv.item_identifiers WHERE item_id = ANY($1)`, [
    [ITEM_A, ITEM_A_ALT, ITEM_A_ARCHIVED, ITEM_A_UNTRACKED],
  ]);
}, 180_000);

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('inv.item-identifier-add', () => {
  it('attaches a retail code, derives its symbology, and audits the write', async () => {
    authAs(INV_CATALOG);
    const response = await addTo(ITEM_A, {
      kind: 'ean',
      value: '4006-381 333931',
      packQuantity: '1',
      isPrimary: true,
    });
    expect(response.status).toBe(201);
    const created = await bodyOf<IdentifierBody>(response);
    expect(created.normalizedValue).toBe('4006381333931');
    expect(created.symbology).toBe('ean13');
    expect(created.packQuantity).toBe('1.000');
    expect(created.isPrimary).toBe(true);
    expect(created.replayed).toBe(false);
    expect(await auditCountFor('inv.item_identifier.added', created.id)).toBe(1);

    // A case code with its pack size; marking it primary demotes the unit code.
    const caseCode = await addTo(ITEM_A, {
      kind: 'gtin',
      value: '10012345678902',
      packQuantity: '12',
      isPrimary: true,
    });
    expect(caseCode.status).toBe(201);
    const caseBody = await bodyOf<IdentifierBody>(caseCode);
    expect(caseBody.packQuantity).toBe('12.000');
    expect(caseBody.symbology).toBe('itf14');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_identifiers
          WHERE item_id = $1 AND is_primary AND retired_at IS NULL`,
        [ITEM_A]
      )
    ).toBe(1);
  });

  it('refuses a wrong check digit on the field and a live duplicate as a conflict', async () => {
    authAs(INV_CATALOG);
    const before = await rowsFor(ITEM_A_ALT);
    const invalid = await addTo(ITEM_A_ALT, { kind: 'upc', value: '036000291453' });
    expect(invalid.status).toBe(422);
    const problem = await bodyOf<{ code: string; violations?: { path: string }[] }>(invalid);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(await rowsFor(ITEM_A_ALT)).toBe(before);

    const duplicate = await addTo(ITEM_A_ALT, { kind: 'ean', value: '4006381333931' });
    expect(duplicate.status).toBe(409);
    expect(await rowsFor(ITEM_A_ALT)).toBe(before);

    // `internal` is not an enterable kind.
    const internal = await addTo(ITEM_A_ALT, { kind: 'internal', value: 'RL0000000017' });
    expect(internal.status).toBe(422);
  });

  it('replays a doubled request under one Idempotency-Key instead of refusing it (idempotency)', async () => {
    authAs(INV_CATALOG);
    const key = randomUUID();
    const payload = { kind: 'supplier_code', value: uniqueCode() };
    const first = await addTo(ITEM_A_ALT, payload, key);
    expect(first.status).toBe(201);
    const replay = await addTo(ITEM_A_ALT, payload, key);
    expect(replay.status).toBe(200);
    const [a, b] = [await bodyOf<IdentifierBody>(first), await bodyOf<IdentifierBody>(replay)];
    expect(b.id).toBe(a.id);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_identifiers WHERE normalized_value = $1`,
        [a.normalizedValue]
      )
    ).toBe(1);
    expect(await auditCountFor('inv.item_identifier.added', a.id)).toBe(1);
  });

  it('requires inv.item.manage tenant-wide: a reader and a branch-scoped holder are refused (denial, isolation)', async () => {
    const before = await rowsFor(ITEM_A_ALT);
    authAs(INV_READER);
    expect((await addTo(ITEM_A_ALT, { kind: 'supplier_code', value: uniqueCode() })).status).toBe(
      403
    );
    authAs(INV_CATALOG_SCOPED_A1);
    expect((await addTo(ITEM_A_ALT, { kind: 'supplier_code', value: uniqueCode() })).status).toBe(
      403
    );
    expect(await rowsFor(ITEM_A_ALT)).toBe(before);
  });

  it('refuses a new identifier on an archived item', async () => {
    authAs(INV_CATALOG);
    const response = await addTo(ITEM_A_ARCHIVED, { kind: 'supplier_code', value: uniqueCode() });
    expect(response.status).toBe(409);
    expect(await rowsFor(ITEM_A_ARCHIVED)).toBe(0);
  });
});

describe('cross-tenant identifier writes', () => {
  it('answers 404 to tenant B for every write on a tenant A item (cross-tenant, isolation)', async () => {
    authAs(INV_CATALOG);
    const created = await bodyOf<IdentifierBody>(
      await addTo(ITEM_A_ALT, { kind: 'supplier_code', value: uniqueCode() })
    );
    const before = await rowsFor(ITEM_A_ALT);

    authAs(INV_TENANT_B_CATALOG);
    expect((await addTo(ITEM_A_ALT, { kind: 'supplier_code', value: uniqueCode() })).status).toBe(
      404
    );
    const retire = await postAt(
      IDENTIFIER_RETIRE,
      `/api/v1/items/${ITEM_A_ALT}/identifiers/${created.id}/retirement`,
      { itemId: ITEM_A_ALT, identifierId: created.id },
      undefined
    );
    expect(retire.status).toBe(404);
    const assign = await postAt(
      BARCODE_ASSIGN,
      `/api/v1/items/${ITEM_A_ALT}/internal-barcode`,
      { itemId: ITEM_A_ALT },
      undefined
    );
    expect(assign.status).toBe(404);

    expect(await rowsFor(ITEM_A_ALT)).toBe(before);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_identifiers WHERE id = $1 AND retired_at IS NULL`,
        [created.id]
      )
    ).toBe(1);
  });
});

describe('inv.item-identifier-list', () => {
  it('lists live identifiers, and retired ones only when asked (success)', async () => {
    authAs(INV_CATALOG);
    const code = uniqueCode();
    const created = await bodyOf<IdentifierBody>(
      await addTo(ITEM_A_UNTRACKED, { kind: 'supplier_code', value: code })
    );
    await postAt(
      IDENTIFIER_RETIRE,
      `/api/v1/items/${ITEM_A_UNTRACKED}/identifiers/${created.id}/retirement`,
      { itemId: ITEM_A_UNTRACKED, identifierId: created.id },
      undefined
    );

    authAs(INV_READER);
    const live = await getAt(IDENTIFIER_LIST, `/api/v1/items/${ITEM_A_UNTRACKED}/identifiers`, {
      itemId: ITEM_A_UNTRACKED,
    });
    expect(live.status).toBe(200);
    const liveBody = await bodyOf<{ sku: string; identifiers: IdentifierBody[] }>(live);
    expect(liveBody.identifiers.some((row) => row.id === created.id)).toBe(false);

    const all = await getAt(
      IDENTIFIER_LIST,
      `/api/v1/items/${ITEM_A_UNTRACKED}/identifiers?includeRetired=true`,
      { itemId: ITEM_A_UNTRACKED }
    );
    const allBody = await bodyOf<{ identifiers: IdentifierBody[] }>(all);
    expect(allBody.identifiers.find((row) => row.id === created.id)?.retired).toBe(true);
  });

  it('answers 404 for an item of another tenant (cross-tenant, isolation)', async () => {
    authAs(INV_TENANT_B);
    const response = await getAt(IDENTIFIER_LIST, `/api/v1/items/${ITEM_A}/identifiers`, {
      itemId: ITEM_A,
    });
    expect(response.status).toBe(404);
  });
});

describe('inv.item-identifier-retire', () => {
  it('retires once, keeps the row, frees the value, and replays a second retirement', async () => {
    authAs(INV_CATALOG);
    const code = uniqueCode();
    const created = await bodyOf<IdentifierBody>(
      await addTo(ITEM_A_ALT, { kind: 'supplier_code', value: code })
    );
    const path = `/api/v1/items/${ITEM_A_ALT}/identifiers/${created.id}/retirement`;
    const params = { itemId: ITEM_A_ALT, identifierId: created.id };

    const first = await postAt(IDENTIFIER_RETIRE, path, params, undefined);
    expect(first.status).toBe(200);
    const retired = await bodyOf<IdentifierBody>(first);
    expect(retired.retired).toBe(true);
    expect(retired.replayed).toBe(false);

    // A fresh key: the replay here is the service's, not the header store's.
    const second = await postAt(IDENTIFIER_RETIRE, path, params, undefined);
    expect(second.status).toBe(200);
    expect((await bodyOf<IdentifierBody>(second)).replayed).toBe(true);
    expect(await auditCountFor('inv.item_identifier.retired', created.id)).toBe(1);

    // The value is free again.
    expect((await addTo(ITEM_A_ALT, { kind: 'supplier_code', value: code })).status).toBe(201);
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM inv.item_identifiers WHERE id = $1`, [
        created.id,
      ])
    ).toBe(1);
  });

  it('refuses a caller without tenant-wide authority, and an identifier of a different item (denial, isolation)', async () => {
    authAs(INV_CATALOG);
    const created = await bodyOf<IdentifierBody>(
      await addTo(ITEM_A_ALT, { kind: 'supplier_code', value: uniqueCode() })
    );
    authAs(INV_CATALOG_SCOPED_A1);
    const scoped = await postAt(
      IDENTIFIER_RETIRE,
      `/api/v1/items/${ITEM_A_ALT}/identifiers/${created.id}/retirement`,
      { itemId: ITEM_A_ALT, identifierId: created.id },
      undefined
    );
    expect(scoped.status).toBe(403);

    authAs(INV_CATALOG);
    const wrongItem = await postAt(
      IDENTIFIER_RETIRE,
      `/api/v1/items/${ITEM_A}/identifiers/${created.id}/retirement`,
      { itemId: ITEM_A, identifierId: created.id },
      undefined
    );
    expect(wrongItem.status).toBe(404);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_identifiers WHERE id = $1 AND retired_at IS NULL`,
        [created.id]
      )
    ).toBe(1);
  });
});

describe('inv.item-barcode-assign', () => {
  it('allocates RL + ten digits once per item and replays the second call', async () => {
    authAs(INV_CATALOG);
    const path = `/api/v1/items/${ITEM_A_UNTRACKED}/internal-barcode`;
    const first = await postAt(BARCODE_ASSIGN, path, { itemId: ITEM_A_UNTRACKED }, undefined);
    expect(first.status).toBe(201);
    const assigned = await bodyOf<IdentifierBody>(first);
    expect(assigned.kind).toBe('internal');
    expect(assigned.value).toMatch(/^RL\d{10}$/);
    expect(assigned.symbology).toBe('code128');
    expect(await auditCountFor('inv.item_barcode.assigned', assigned.id)).toBe(1);

    const again = await postAt(BARCODE_ASSIGN, path, { itemId: ITEM_A_UNTRACKED }, undefined);
    expect(again.status).toBe(200);
    const replay = await bodyOf<IdentifierBody>(again);
    expect(replay.id).toBe(assigned.id);
    expect(replay.replayed).toBe(true);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_identifiers
          WHERE item_id = $1 AND identifier_kind = 'internal'`,
        [ITEM_A_UNTRACKED]
      )
    ).toBe(1);
    expect(await auditCountFor('inv.item_barcode.assigned', assigned.id)).toBe(1);
  });

  it('refuses a reader and a branch-scoped holder (denial, isolation)', async () => {
    authAs(INV_READER);
    const path = `/api/v1/items/${ITEM_A_ALT}/internal-barcode`;
    expect((await postAt(BARCODE_ASSIGN, path, { itemId: ITEM_A_ALT }, undefined)).status).toBe(
      403
    );
    authAs(INV_CATALOG_SCOPED_A1);
    expect((await postAt(BARCODE_ASSIGN, path, { itemId: ITEM_A_ALT }, undefined)).status).toBe(
      403
    );
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_identifiers
          WHERE item_id = $1 AND identifier_kind = 'internal'`,
        [ITEM_A_ALT]
      )
    ).toBe(0);
  });
});

describe('inv.barcode-resolve', () => {
  it('resolves a differently spelled scan to its item, with branch availability (success)', async () => {
    const location = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: location, quantity: '7.000' });

    authAs(INV_READER);
    const scanned = encodeURIComponent('4006 381-333931');
    const plain = await getAt(RESOLVE, `/api/v1/barcodes/${scanned}`, { value: '4006 381-333931' });
    expect(plain.status).toBe(200);
    const body = await bodyOf<{
      item: { id: string };
      identifier: { kind: string; symbology: string };
      packQuantity: string;
      availability: unknown;
    }>(plain);
    expect(body.item.id).toBe(ITEM_A);
    expect(body.identifier.kind).toBe('ean');
    expect(body.packQuantity).toBe('1.000');
    expect(body.availability).toBeNull();

    const withStock = await getAt(
      RESOLVE,
      `/api/v1/barcodes/4006381333931?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&locationId=${location}`,
      { value: '4006381333931' }
    );
    expect(withStock.status).toBe(200);
    const stock = await bodyOf<{ availability: { locationId: string; onHand: string }[] }>(
      withStock
    );
    expect(stock.availability).toEqual([
      expect.objectContaining({ locationId: location, onHand: '7.000' }),
    ]);

    // The case code resolves the same item with its pack size.
    const caseScan = await getAt(RESOLVE, `/api/v1/barcodes/10012345678902`, {
      value: '10012345678902',
    });
    expect((await bodyOf<{ packQuantity: string }>(caseScan)).packQuantity).toBe('12.000');
  });

  it('answers 404 for an unknown code and 409 for a code live under two items', async () => {
    authAs(INV_READER);
    const unknown = await getAt(RESOLVE, `/api/v1/barcodes/ODINV-NOWHERE`, {
      value: 'ODINV-NOWHERE',
    });
    expect(unknown.status).toBe(404);
    expect((await bodyOf<{ code: string }>(unknown)).code).toBe('ERR-RES-001');

    authAs(INV_CATALOG);
    const shared = uniqueCode();
    expect((await addTo(ITEM_A, { kind: 'supplier_code', value: shared })).status).toBe(201);
    expect(
      (await addTo(ITEM_A_ALT, { kind: 'manufacturer_part_number', value: shared })).status
    ).toBe(201);
    authAs(INV_READER);
    const ambiguous = await getAt(RESOLVE, `/api/v1/barcodes/${shared}`, { value: shared });
    expect(ambiguous.status).toBe(409);
  });

  it('refuses stock at a branch the caller holds no authority in (denial, isolation)', async () => {
    authAs(INV_SCOPED_A2);
    const response = await getAt(
      RESOLVE,
      `/api/v1/barcodes/4006381333931?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`,
      { value: '4006381333931' }
    );
    expect(response.status).toBe(403);
  });

  it('does not resolve a code of another tenant (cross-tenant)', async () => {
    authAs(INV_TENANT_B);
    const response = await getAt(RESOLVE, `/api/v1/barcodes/4006381333931`, {
      value: '4006381333931',
    });
    expect(response.status).toBe(404);
  });
});

describe('inv.item-label-data', () => {
  it('prints the primary code with its symbology, unit and pack quantity (success)', async () => {
    authAs(INV_READER);
    const response = await getAt(LABEL, `/api/v1/items/${ITEM_A}/label`, { itemId: ITEM_A });
    expect(response.status).toBe(200);
    const label = await bodyOf<{
      sku: string;
      primaryBarcode: { kind: string; symbology: string; normalizedValue: string } | null;
      packQuantity: string;
    }>(response);
    expect(label.sku).toBe('FX-P121-A');
    // The GTIN-14 case code was marked primary last.
    expect(label.primaryBarcode?.normalizedValue).toBe('10012345678902');
    expect(label.primaryBarcode?.symbology).toBe('itf14');
    expect(label.packQuantity).toBe('12.000');
    expect(Object.keys(label)).not.toContain('price');

    const bare = await getAt(LABEL, `/api/v1/items/${ITEM_A_ARCHIVED}/label`, {
      itemId: ITEM_A_ARCHIVED,
    });
    expect((await bodyOf<{ primaryBarcode: unknown }>(bare)).primaryBarcode).toBeNull();
  });

  it('answers 404 for an item of another tenant (cross-tenant, isolation)', async () => {
    authAs(INV_TENANT_B);
    const response = await getAt(LABEL, `/api/v1/items/${ITEM_A}/label`, { itemId: ITEM_A });
    expect(response.status).toBe(404);
  });
});
