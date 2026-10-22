/**
 * /api/v1/refund-requests/{requestId}/approval — a different authorised person
 * approves a pending refund request (ADR-023 D2, part 2, P1-32-PRE-OD-FD2B).
 *
 * An approval pays nothing. The payout is a separate, later step
 * (`sal.refund-execute`), recorded once by a payment recorder.
 *
 * ## Who may approve
 *
 * `sal.refund.approve` and `sal.finance.view`, authorized in the obligation's own
 * company and branch, held by someone who is NOT the requester
 * (`refund_self_approval`). `sal.refund.approve` is a code of its own: no credit-note
 * code and not `sal.reversal.approve` satisfies it. The database checks the code in
 * that scope and refuses the requester again (`sal.guard_refund_request_update`), so
 * the rule does not depend on this route being the only way in. A refusal for want
 * of the code is recorded as a permission refusal (ADR-023 D12 extension).
 *
 * ## Version-guarded
 *
 * `If-Match` carries the REQUEST's `recordVersion` from its read, compared with the
 * locked row. A request already approved under the version read answers
 * `replayed: true` with no second audit record; a rejected, withdrawn or paid-out one
 * is refused by name. No body: the approver is the session.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid }).strict();

export const REFUND_APPROVE_OPERATION = defineOperation({
  id: 'sal.refund-approve',
  module: 'billing',
  method: 'POST',
  path: '/refund-requests/{requestId}/approval',
  summary: 'Approve a refund request someone else raised; the payout is recorded separately.',
  permissions: ['sal.refund.approve', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'sal.refund_request.approved',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REFUND_APPROVE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const approved = await billingModule().refunds.approveRefund(
        db,
        params.requestId,
        expectedVersion,
        authorizeScope
      );
      return { body: approved, recordVersion: approved.refundRequest.recordVersion };
    },
    { params: raw }
  );
}
