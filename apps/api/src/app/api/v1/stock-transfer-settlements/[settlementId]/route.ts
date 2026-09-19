/**
 * /api/v1/stock-transfer-settlements/{settlementId} — one transfer return to the
 * origin or write-off (P1-32-PRE-141).
 *
 * Readable from the branch that sent the transfer and from its destination. The
 * source branch authorizes the read when the caller holds `inv.stock.read` there;
 * otherwise the destination does, and a caller who holds it in neither is refused.
 * A receipt settlement answers not found: it is read on its transfer.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ settlementId: schemas.uuid }).strict();

export const STOCK_TRANSFER_SETTLEMENT_READ_OPERATION = defineOperation({
  id: 'inv.stock-transfer-settlement-read',
  module: 'inventory',
  method: 'GET',
  path: '/stock-transfer-settlements/{settlementId}',
  summary: 'Read one transfer return to origin or write-off with its decision.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ settlementId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    STOCK_TRANSFER_SETTLEMENT_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { settlementId } = parseOrFail(Params, raw, 'path');
      const settlement = await inventoryModule().transfers.readSettlement(
        db,
        settlementId,
        authorizeScope
      );
      return { body: settlement, recordVersion: settlement.recordVersion };
    },
    { params: raw }
  );
}
