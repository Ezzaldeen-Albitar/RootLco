/**
 * /api/v1/items — the inventory item catalog (Phase 1-21, P1-21-BE-001).
 *
 * Cursor-paginated, tenant-scoped, ordered by `(sku, id)` — a total order backed
 * by `uq_item_master_sku`, so a page is stable even when two items share a name.
 *
 * ## Why this is `scope: 'tenant'` and offers no branch filter
 *
 * `inv.item_master` has no `company_id` and no `branch_id`: an item is tenant-wide
 * catalog reference data. A branch filter here would be decorative — it would
 * narrow nothing — and declaring `scope: 'branch'` would be worse than useless,
 * because `requireScopedPermissions` fails closed on an empty target and an
 * unfiltered listing names no branch, so every caller would receive 403. Stock at a
 * branch is a different question, answered by `/stock-availability`.
 *
 * ## What this endpoint deliberately does not return
 *
 * **Cost.** `inv.item_cost_details` is a restricted 1:1 detail whose every RLS
 * policy is gated by `iam.has_permission('inv.cost.view')`, and no query behind
 * this route reads it. Bolting a standard cost onto the catalog read would leak
 * margin data to every holder of `inv.item.read`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { ITEM_LIFECYCLE_STATES, ITEM_TYPES, MAX_NAME, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Query surface — a closed allow-list. */
const Query = z
  .object({
    categoryId: schemas.uuid.optional(),
    itemType: z.enum(ITEM_TYPES).optional(),
    lifecycleStatus: z.enum(ITEM_LIFECYCLE_STATES).optional(),
    stockTrackedOnly: z.enum(['true', 'false']).optional(),
    search: z.string().min(1).max(MAX_NAME).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const ITEM_SEARCH_OPERATION = defineOperation({
  id: 'inv.item-search',
  module: 'inventory',
  method: 'GET',
  path: '/items',
  summary: 'Search the tenant inventory item catalog.',
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(ITEM_SEARCH_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return {
      body: await inventoryModule().reads.searchItems(
        db,
        {
          ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
          ...(query.itemType === undefined ? {} : { itemType: query.itemType }),
          ...(query.lifecycleStatus === undefined
            ? {}
            : { lifecycleStatus: query.lifecycleStatus }),
          ...(query.stockTrackedOnly === undefined
            ? {}
            : { stockTrackedOnly: query.stockTrackedOnly === 'true' }),
          ...(query.search === undefined ? {} : { search: query.search }),
        },
        {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        }
      ),
    };
  });
}
