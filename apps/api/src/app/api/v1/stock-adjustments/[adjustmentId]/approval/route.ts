/**
 * /api/v1/stock-adjustments/{adjustmentId}/approval — decide a pending stock
 * adjustment (P1-32-PRE-046).
 *
 * `decision: approved` posts the adjustment movement through
 * `inv.approve_adjustment`; `decision: rejected` closes the request through
 * `inv.reject_adjustment` and moves nothing. Either way the decider must not be
 * the requester: `inv.guard_adjustment_approval` enforces it for approvals and
 * `inv.reject_adjustment` for rejections, and the service asks first so the refusal
 * names the rule instead of a generic invariant.
 *
 * `inv.adjustment.approve`, not `inv.stock.operate` — requesting a correction and
 * accepting one are separate authorities, as they are for opening batches. The
 * decision `reason` is recorded on the audit entry; the adjustment row has no column
 * for it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { ADJUSTMENT_DECISIONS, MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ adjustmentId: schemas.uuid }).strict();

export const DecisionBody = z
  .object({
    decision: z.enum(ADJUSTMENT_DECISIONS),
    reason: z.string().trim().min(1).max(MAX_REASON),
  })
  .strict();

export const STOCK_ADJUSTMENT_APPROVE_OPERATION = defineOperation({
  id: 'inv.stock-adjustment-approve',
  module: 'inventory',
  method: 'POST',
  path: '/stock-adjustments/{adjustmentId}/approval',
  summary: 'Approve or reject a pending stock adjustment requested by someone else.',
  permissions: ['inv.adjustment.approve'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'inv.stock_adjustment.approved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ adjustmentId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STOCK_ADJUSTMENT_APPROVE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { adjustmentId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(DecisionBody, body, 'body');
      const decided = await inventoryModule().adjustments.decide(
        db,
        adjustmentId,
        { decision: parsed.decision, reason: parsed.reason },
        authorizeScope
      );
      return { body: decided, recordVersion: decided.recordVersion };
    },
    { params: raw, body }
  );
}
