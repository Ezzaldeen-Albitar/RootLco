/**
 * /api/v1/items/{itemId} — one item, for its own page (P1-32-PRE-OD-INV2A).
 *
 * The item page named its item only by the id in its address: the catalogue had a
 * search and a create, and no read of one item. This answers the item's code,
 * name, unit, type, lifecycle and archived flag, and the chain of categories it is
 * filed under (top level first), so the page can say which item it is about.
 *
 * ## Tenant-wide, like the item search
 *
 * `inv.item_master` has no company or branch column, so this is `scope: 'tenant'`
 * under the same `inv.item.read` the search declares. An id this tenant cannot see
 * — another tenant's included — answers 404, never told apart from an id that
 * does not exist.
 *
 * ## What it deliberately does not return
 *
 * No cost (`inv.item_cost_details` is `inv.cost.view` data) and no price (the sale
 * prices have their own read). Nothing here writes: there is no item update
 * operation, and this read does not stand in for one.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ itemId: schemas.uuid }).strict();

export const ITEM_DETAIL_OPERATION = defineOperation({
  id: 'inv.item-detail',
  module: 'inventory',
  method: 'GET',
  path: '/items/{itemId}',
  summary: 'Read one item of the tenant inventory catalogue, with its category path.',
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ itemId: string }> }
): Promise<Response> {
  const params = await route.params;
  return handleOperation(
    ITEM_DETAIL_OPERATION,
    request,
    async ({ db }) => {
      const { itemId } = parseOrFail(Params, params, 'path');
      return { body: await inventoryModule().reads.readItemDetail(db, itemId) };
    },
    { params }
  );
}
