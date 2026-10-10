/**
 * /api/v1/items/{itemId}/label — what a label printer needs for one item
 * (P1-32-PRE-104).
 *
 * The SKU, the name, the code to print with a symbology hint (`code128` for internal
 * and free-text codes, `ean13`/`ean8`/`upca`/`itf14` for retail codes by length), and
 * the unit and pack quantity that code stands for. The code chosen is the item's
 * primary identifier, else its internal code, else the first live code by kind;
 * `primaryBarcode` is `null` when the item carries none.
 *
 * ## No price
 *
 * `inv.item_sale_prices` does hold a selling price for an item, but a label is
 * TENANT-WIDE — the operation is `scope: 'tenant'` and addresses the item by id alone —
 * while a price is narrowed to a company and a branch, one live row per
 * `(tenant, item, company, branch)`. Nothing here could say which of those rows the
 * printed figure would be, so printing one would be printing an arbitrary pick. A caller
 * that needs the price asks `inv.item-sale-price-list`, which publishes every configured
 * row most specific first, each labelled with the company and branch it names.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ itemId: schemas.uuid }).strict();

export const ITEM_LABEL_DATA_OPERATION = defineOperation({
  id: 'inv.item-label-data',
  module: 'inventory',
  method: 'GET',
  path: '/items/{itemId}/label',
  summary: 'Read the data a label printer needs for one item.',
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
    ITEM_LABEL_DATA_OPERATION,
    request,
    async ({ db }) => {
      const { itemId } = parseOrFail(Params, params, 'path');
      return { body: await inventoryModule().identifiers.label(db, itemId) };
    },
    { params }
  );
}
