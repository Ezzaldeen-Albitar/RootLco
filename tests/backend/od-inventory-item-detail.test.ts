/**
 * P1-32-PRE-OD-INV2A — one item, for its own page, end to end through its route
 * handler.
 *
 * The item page named its item only by the id in its address. This read answers
 * the item's code, name, unit, lifecycle and archived flag, and the chain of
 * categories it is filed under, top level first. The properties held here:
 *
 *  - the chain is the item's real ancestry, walked in the database, top level
 *    first and the item's own category last;
 *  - an archived item is answered and says so;
 *  - no cost and no price field is on the wire;
 *  - an unknown id, and an item of another tenant, are both 404 and read alike;
 *  - a caller without `inv.item.read` is refused.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.item-detail: route service authorization success denial cross-tenant isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  CATEGORY_A,
  INV_READER,
  INV_TENANT_B,
  ITEM_A,
  ITEM_A_ARCHIVED,
  ITEM_B,
  UOM_EACH,
  authAs,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
} from './p1-21-helpers';
import { GET as ITEM_DETAIL } from '@/app/api/v1/items/[itemId]/route';

let admin: Pool;

/** A category under `CATEGORY_A`, and an item filed under it — a two-step chain. */
const CATEGORY_CHILD = 'e1000000-0000-4000-8000-00000000d211';
const ITEM_NESTED = 'e1000000-0000-4000-8000-00000000d2a1';
const UNKNOWN_ITEM = 'e1000000-0000-4000-8000-00000000d2ff';

const read = (itemId: string) =>
  ITEM_DETAIL(new Request(`http://localhost/api/v1/items/${itemId}`, { method: 'GET' }), {
    params: Promise.resolve({ itemId }),
  });

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

interface DetailBody {
  id: string;
  sku: string;
  name: string;
  itemCategoryId: string;
  categoryPath: { id: string; code: string; name: string }[];
  unitOfMeasure: { id: string; code: string; name: string };
  itemType: string;
  lifecycleStatus: string;
  archived: boolean;
  recordVersion: number;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO inv.item_categories (id, tenant_id, parent_category_id, code, name, created_by)
       VALUES ($1,$2,$3,'fx_od_inv2a_pads','Pads',$4) ON CONFLICT (id) DO NOTHING`,
      [CATEGORY_CHILD, TENANT_A, CATEGORY_A, USER_A]
    );
    await client.query(
      `INSERT INTO inv.item_master
         (id, tenant_id, item_category_id, sku, name, uom_id, created_by)
       VALUES ($1,$2,$3,'FX-ODINV2A-PAD','Fixture nested pad',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [ITEM_NESTED, TENANT_A, CATEGORY_CHILD, UOM_EACH, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}, 180_000);

afterAll(async () => {
  // Newest dependency first: the item cites the child category, which cites its parent.
  await admin.query(`DELETE FROM inv.item_master WHERE id = $1`, [ITEM_NESTED]);
  await admin.query(`DELETE FROM inv.item_categories WHERE id = $1`, [CATEGORY_CHILD]);
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('inv.item-detail', () => {
  it('answers the item with its unit, lifecycle and category chain, top level first (success)', async () => {
    authAs(INV_READER);
    const response = await read(ITEM_NESTED);
    expect(response.status).toBe(200);
    const item = await bodyOf<DetailBody>(response);
    expect(item.id).toBe(ITEM_NESTED);
    expect(item.sku).toBe('FX-ODINV2A-PAD');
    expect(item.name).toBe('Fixture nested pad');
    expect(item.itemCategoryId).toBe(CATEGORY_CHILD);
    expect(item.categoryPath).toEqual([
      { id: CATEGORY_A, code: 'fx_p1_21_parts', name: 'P1-21 parts' },
      { id: CATEGORY_CHILD, code: 'fx_od_inv2a_pads', name: 'Pads' },
    ]);
    expect(item.unitOfMeasure).toEqual({ id: UOM_EACH, code: 'fx_each', name: 'Fixture each' });
    expect(item.lifecycleStatus).toBe('active');
    expect(item.archived).toBe(false);
  });

  it('answers a top-level item with a one-step chain', async () => {
    authAs(INV_READER);
    const item = await bodyOf<DetailBody>(await read(ITEM_A));
    expect(item.categoryPath.map((step) => step.id)).toEqual([CATEGORY_A]);
  });

  it('answers an archived item and says it is archived', async () => {
    authAs(INV_READER);
    const response = await read(ITEM_A_ARCHIVED);
    expect(response.status).toBe(200);
    const item = await bodyOf<DetailBody>(response);
    expect(item.lifecycleStatus).toBe('archived');
    expect(item.archived).toBe(true);
  });

  it('carries no cost and no price field', async () => {
    authAs(INV_READER);
    const item = await bodyOf<Record<string, unknown>>(await read(ITEM_A));
    for (const key of Object.keys(item)) {
      expect(key.toLowerCase()).not.toMatch(/cost|price|amount/);
    }
  });

  it('answers 404 for an id that does not exist (not found)', async () => {
    authAs(INV_READER);
    const response = await read(UNKNOWN_ITEM);
    expect(response.status).toBe(404);
  });

  it('answers 404 for an item of another tenant, alike with an unknown id (cross-tenant, isolation)', async () => {
    authAs(INV_TENANT_B);
    const foreign = await read(ITEM_A);
    expect(foreign.status).toBe(404);
    const unknown = await read(UNKNOWN_ITEM);
    expect(unknown.status).toBe(404);
    const [a, b] = [
      await bodyOf<{ code: string }>(foreign),
      await bodyOf<{ code: string }>(unknown),
    ];
    expect(a.code).toBe(b.code);
    // Tenant B's own item reads, so the 404 above is the tenant boundary.
    expect((await read(ITEM_B)).status).toBe(200);
  });

  it('refuses a caller without inv.item.read (denial)', async () => {
    // A tenant-A principal holding wo.work_order.read but no inventory permission at
    // all — so the refusal is authority and not tenancy.
    authAs({ ...INV_READER, subject: 'fx_p1_19_full' });
    const response = await read(ITEM_A);
    expect(response.status).toBe(403);
  });

  it('refuses an id that is not a uuid on the path', async () => {
    authAs(INV_READER);
    const response = await read('not-a-uuid');
    expect(response.status).toBe(422);
  });
});
