/**
 * /api/v1/refund-requests/{requestId}/rejection — a different authorised person
 * rejects a pending refund request, stating why (ADR-023 D2, part 2,
 * P1-32-PRE-OD-FD2B).
 *
 * The obligation stays owed. A rejection is terminal; a corrected request may be
 * raised afterwards, because only a live request blocks one
 * (`uq_refund_requests_obligation_live`).
 *
 * ## Who may reject
 *
 * The same two codes an approval declares, `sal.refund.approve` and
 * `sal.finance.view`, in the obligation's own company and branch, held by someone
 * who is not the requester (`refund_self_rejection`) — the requester withdraws
 * instead. The database holds both rules itself.
 *
 * ## The reason is the record
 *
 * Required, trimmed, at most `MAX_REFUND_REASON` characters and never blank: a blank
 * one is a field error on `body.reason` (422), not a refusal of the request. Stored
 * on the request (`decision_reason`) and in the audit record.
 *
 * ## Version-guarded
 *
 * `If-Match` carries the REQUEST's `recordVersion`, compared with the locked row. A
 * request already rejected answers `replayed: true` with no second audit record;
 * approved, withdrawn and paid-out ones are refused by name.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REFUND_REASON, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid }).strict();

export const RefundRejectBody = z
  .object({ reason: z.string().min(1).max(MAX_REFUND_REASON) })
  .strict();

export const REFUND_REJECT_OPERATION = defineOperation({
  id: 'sal.refund-reject',
  module: 'billing',
  method: 'POST',
  path: '/refund-requests/{requestId}/rejection',
  summary: 'Reject a refund request someone else raised, stating why.',
  permissions: ['sal.refund.approve', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'sal.refund_request.rejected',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REFUND_REJECT_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RefundRejectBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const rejected = await billingModule().refunds.rejectRefund(
        db,
        params.requestId,
        { reason: parsed.reason },
        expectedVersion,
        authorizeScope
      );
      return { body: rejected, recordVersion: rejected.refundRequest.recordVersion };
    },
    { params: raw, body }
  );
}
