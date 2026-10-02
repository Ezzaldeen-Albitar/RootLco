/**
 * /api/v1/receipt-reversals/{reversalId}/approval — a different authorised person
 * approves a pending receipt reversal (ADR-023, D4).
 *
 * The moment a receipt is reversed. `sal.approve_receipt_reversal` approves the
 * reversal, flips the receipt to `reversed` and writes the `receipt_reversed`
 * financial event in this transaction, beside the audit record. The original
 * receipt is retained and its allocations stay recorded; they stop counting, so
 * every invoice the receipt paid opens again by exactly what it applied. Nothing is
 * refunded: a reversal is bookkeeping (refunds are ADR-023 D2).
 *
 * ## Who may approve
 *
 * `sal.reversal.approve` and `sal.finance.view`, authorized in the receipt's own
 * company and branch, held by someone who is NOT the requester
 * (`receipt_reversal_self_approval`). `sal.reversal.approve` is a code of its own:
 * `sal.credit.manage` and `sal.credit.approve` do not satisfy it. The database
 * checks the code in the receipt's scope and refuses the requester again
 * (`sal.guard_receipt_reversal_decision`), so the rule does not depend on this
 * route being the only way in.
 *
 * ## Idempotent, not version-guarded
 *
 * Like `sal.credit-note-approve`: an approved reversal answers `replayed: true`
 * with no second audit record and no second financial event, and a rejected or
 * withdrawn one is refused (`receipt_reversal_decision_frozen`). The amount was
 * fixed when the request was raised and is frozen, so there is nothing a stale read
 * could overwrite. Each refusal by rule is recorded after the rollback (D12).
 *
 * No body: the approver is the session, and the reversal names everything else.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { paymentsModule } from '@/modules/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ reversalId: schemas.uuid }).strict();

export const RECEIPT_REVERSAL_APPROVE_OPERATION = defineOperation({
  id: 'sal.receipt-reversal-approve',
  module: 'payments',
  method: 'POST',
  path: '/receipt-reversals/{reversalId}/approval',
  summary: 'Approve a receipt reversal someone else requested, reversing the whole receipt.',
  permissions: ['sal.reversal.approve', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'sal.receipt_reversal.approved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ reversalId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    RECEIPT_REVERSAL_APPROVE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const approved = await paymentsModule().reversals.approveReversal(
        db,
        params.reversalId,
        authorizeScope
      );
      return { body: approved };
    },
    { params: raw }
  );
}
