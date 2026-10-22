/**
 * /api/v1/goods-receipts/{receiptId}/posting — post a draft goods receipt
 * (P1-32-PRE-043, BE-045).
 *
 * `inv.post_goods_receipt` locks the receipt, refuses anything that is not a draft
 * with at least one line, and then — in the same transaction as the status change —
 * posts one `receipt`/`in` movement per line and APPENDS one restricted cost layer
 * per priced line. No earlier layer is revised and `inv.item_cost_details` is not
 * touched, so posting a receipt at a new price leaves every previous price readable.
 *
 * ## If-Match
 *
 * `versionGuarded`: the caller names the receipt's `record_version`. A draft that
 * changed after the poster read it is refused with `ERR-CON-001` rather than posted
 * as something the poster never saw.
 *
 * ## Cost authority
 *
 * A receipt with priced lines writes cost history, which the database permits only
 * to a caller holding `inv.cost.view`. The service asks first and refuses with a
 * sentence rather than letting the gated INSERT fail as an opaque policy violation.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receiptId: schemas.uuid }).strict();

export const GOODS_RECEIPT_POST_OPERATION = defineOperation({
  id: 'inv.goods-receipt-post',
  module: 'inventory',
  method: 'POST',
  path: '/goods-receipts/{receiptId}/posting',
  summary: 'Post a draft goods receipt, adding its stock and appending its cost history.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.goods_receipt.posted',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ receiptId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    GOODS_RECEIPT_POST_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const { receiptId } = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const posted = await inventoryModule().receipts.post(
        db,
        receiptId,
        { expectedVersion },
        authorizeScope
      );
      return { body: posted, recordVersion: posted.recordVersion };
    },
    { params: raw }
  );
}
