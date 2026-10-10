/**
 * /api/v1/stock-transfers/{transferId}/cancellation — cancel a dispatched transfer
 * (P1-32-PRE-041).
 *
 * Returns the quantity from transit to the origin through `inv.cancel_transfer`.
 * Nothing is deleted and nothing is reversed in place: the ledger keeps the dispatch
 * pair and the return pair, four movements with a net effect of zero, so the
 * history still shows that the stock left and came back.
 *
 * Only a `dispatched` transfer can be cancelled. A received transfer has already
 * delivered its stock, and moving it back is a new transfer in the other direction.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ transferId: schemas.uuid }).strict();

export const CancellationBody = z
  .object({ reason: z.string().trim().min(1).max(MAX_REASON) })
  .strict();

export const STOCK_TRANSFER_CANCEL_OPERATION = defineOperation({
  id: 'inv.stock-transfer-cancel',
  module: 'inventory',
  method: 'POST',
  path: '/stock-transfers/{transferId}/cancellation',
  summary: 'Cancel a dispatched stock transfer, returning its quantity to the origin.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_transfer.cancelled',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ transferId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STOCK_TRANSFER_CANCEL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { transferId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(CancellationBody, body, 'body');
      const cancelled = await inventoryModule().transfers.cancel(
        db,
        transferId,
        { reason: parsed.reason },
        authorizeScope
      );
      return { body: cancelled, recordVersion: cancelled.recordVersion };
    },
    { params: raw, body }
  );
}
