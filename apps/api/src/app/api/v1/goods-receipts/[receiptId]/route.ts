/**
 * /api/v1/goods-receipts/{receiptId} — one goods receipt with its lines
 * (P1-32-PRE-044).
 *
 * The lines say whether each is priced (`hasUnitCost`) and never what the price
 * is. Cost is readable only through `GET /items/{itemId}/cost-history`, over the
 * `inv.cost.view`-gated `inv.item_cost_layers`, so this read — which needs only
 * `inv.stock.read` — cannot become a way around that gate.
 *
 * The receipt's own company and branch are resolved before any line is returned
 * and authorized against, so the id cannot reach a receipt in another branch.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receiptId: schemas.uuid }).strict();

export const GOODS_RECEIPT_READ_OPERATION = defineOperation({
  id: 'inv.goods-receipt-read',
  module: 'inventory',
  method: 'GET',
  path: '/goods-receipts/{receiptId}',
  summary: 'Read one goods receipt with its lines, without unit costs.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ receiptId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    GOODS_RECEIPT_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { receiptId } = parseOrFail(Params, raw, 'path');
      const receipt = await inventoryModule().receipts.read(db, receiptId, authorizeScope);
      return { body: receipt, recordVersion: receipt.recordVersion };
    },
    { params: raw }
  );
}
