/**
 * /api/v1/receipt-reversals/{reversalId}/rejection — a different authorised person
 * rejects a pending receipt reversal, stating why (ADR-023, D4).
 *
 * The receipt is untouched: it keeps counting toward every invoice it paid, and
 * takes allocations again. A rejection is terminal; the requester may raise a new,
 * corrected request afterwards, because only a pending or approved reversal blocks
 * one (`uq_receipt_reversals_receipt_live`).
 *
 * ## Who may reject
 *
 * The same two codes an approval declares, `sal.reversal.approve` and
 * `sal.finance.view`, in the receipt's own company and branch, held by someone who
 * is not the requester (`receipt_reversal_self_rejection`) — the requester
 * withdraws instead. The database holds both rules itself.
 *
 * ## The reason is the record
 *
 * Required, trimmed, at most `MAX_REVERSAL_REASON` characters, and never blank: a
 * blank one is a field error on `body.reason` (422), not a refusal of the reversal.
 * Stored on the reversal (`decision_reason`) and in the audit record.
 *
 * ## Version-guarded and idempotent
 *
 * `If-Match` carries the REVERSAL's `recordVersion` from the receipt detail,
 * compared with the locked row. A reversal already rejected answers
 * `replayed: true` with no second audit record; approved and withdrawn ones are
 * refused (`receipt_reversal_decision_frozen`). A refusal by rule is recorded after
 * the rollback (D12).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REVERSAL_REASON, paymentsModule } from '@/modules/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ reversalId: schemas.uuid }).strict();

export const RejectBody = z.object({ reason: z.string().min(1).max(MAX_REVERSAL_REASON) }).strict();

export const RECEIPT_REVERSAL_REJECT_OPERATION = defineOperation({
  id: 'sal.receipt-reversal-reject',
  module: 'payments',
  method: 'POST',
  path: '/receipt-reversals/{reversalId}/rejection',
  summary: 'Reject a receipt reversal someone else requested, stating why.',
  permissions: ['sal.reversal.approve', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'sal.receipt_reversal.rejected',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ reversalId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEIPT_REVERSAL_REJECT_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RejectBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const rejected = await paymentsModule().reversals.rejectReversal(
        db,
        params.reversalId,
        { reason: parsed.reason },
        expectedVersion,
        authorizeScope
      );
      return { body: rejected, recordVersion: rejected.reversal.recordVersion };
    },
    { params: raw, body }
  );
}
