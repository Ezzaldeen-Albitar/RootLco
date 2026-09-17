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
 * `svc.resolve_price` prices services only and no table holds a selling price for an
 * inventory item, so there is no figure to print whatever the caller may read. When
 * an item price source exists, the price belongs here behind `svc.price.read`.
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
