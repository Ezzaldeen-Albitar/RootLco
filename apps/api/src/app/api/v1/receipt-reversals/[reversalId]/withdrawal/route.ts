/**
 * /api/v1/receipt-reversals/{reversalId}/withdrawal — the requester withdraws their
 * own pending receipt reversal (ADR-023, D4; D3 parity).
 *
 * Withdrawal only reduces exposure: a pending reversal reverses nothing and a
 * withdrawn one never will, so no second person is asked. The receipt is untouched
 * and takes allocations again, and a corrected request may be raised.
 *
 * ## The requester, and nobody else
 *
 * The declared codes are the request's own, `sal.payment.record` and
 * `sal.finance.view`, authorized in the receipt's company and branch. Holding them
 * is not enough: only the person who raised the request may withdraw it
 * (`receipt_reversal_withdraw_not_requester`), refused here and again by
 * `sal.guard_receipt_reversal_decision`.
 *
 * ## Version-guarded and idempotent
 *
 * `If-Match` carries the REVERSAL's `recordVersion` from the receipt detail. A
 * reversal already withdrawn by its requester answers `replayed: true` with no
 * second audit record; approved and rejected ones are terminal and refused
 * (`receipt_reversal_decision_frozen`). A refusal by rule is recorded after the
 * rollback (D12).
 *
 * No body: the requester is the session and the reversal names everything else.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { paymentsModule } from '@/modules/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ reversalId: schemas.uuid }).strict();

export const RECEIPT_REVERSAL_WITHDRAW_OPERATION = defineOperation({
  id: 'sal.receipt-reversal-withdraw',
  module: 'payments',
  method: 'POST',
  path: '/receipt-reversals/{reversalId}/withdrawal',
  summary: 'Withdraw your own pending receipt reversal; the receipt stays as it is.',
  permissions: ['sal.payment.record', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.receipt_reversal.withdrawn',
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
  return handleOperation(
    RECEIPT_REVERSAL_WITHDRAW_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const withdrawn = await paymentsModule().reversals.withdrawReversal(
        db,
        params.reversalId,
        expectedVersion,
        authorizeScope
      );
      return { body: withdrawn, recordVersion: withdrawn.reversal.recordVersion };
    },
    { params: raw }
  );
}
