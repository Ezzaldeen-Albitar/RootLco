/**
 * /api/v1/stock-transfer-settlements/{settlementId}/decision — decide a pending
 * transfer write-off (P1-32-PRE-130).
 *
 * `decision: approved` takes the written-off units out of transit; `decision:
 * rejected` leaves them there, free to be received or returned. The requester may not
 * decide (`ck_stock_transfer_settlements_separation`), and the authority is
 * `inv.adjustment.approve` — a write-off is a stock loss, and every other stock loss
 * is approved under that code by a second person.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { ADJUSTMENT_DECISIONS, MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ settlementId: schemas.uuid }).strict();

export const WriteOffDecisionBody = z
  .object({
    decision: z.enum(ADJUSTMENT_DECISIONS),
    reason: z.string().trim().min(1).max(MAX_REASON),
  })
  .strict();

export const STOCK_TRANSFER_WRITE_OFF_DECIDE_OPERATION = defineOperation({
  id: 'inv.stock-transfer-write-off-decide',
  module: 'inventory',
  method: 'POST',
  path: '/stock-transfer-settlements/{settlementId}/decision',
  summary: 'Approve or reject a pending transfer write-off requested by someone else.',
  permissions: ['inv.adjustment.approve'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'inv.stock_transfer.write_off_approved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ settlementId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STOCK_TRANSFER_WRITE_OFF_DECIDE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { settlementId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(WriteOffDecisionBody, body, 'body');
      const decided = await inventoryModule().transfers.decideWriteOff(
        db,
        settlementId,
        { decision: parsed.decision, reason: parsed.reason },
        authorizeScope
      );
      return { body: decided, recordVersion: decided.recordVersion };
    },
    { params: raw, body }
  );
}
