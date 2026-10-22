/**
 * /api/v1/refund-requests/{requestId}/withdrawal — the requester withdraws their own
 * pending refund request (ADR-023 D2, part 2, P1-32-PRE-OD-FD2B).
 *
 * Only the person who raised it may (`refund_withdraw_not_requester`), and only while
 * it waits for a decision. The obligation stays owed and a corrected request may be
 * raised afterwards.
 *
 * `sal.payment.record` and `sal.finance.view` in the obligation's own company and
 * branch — the codes that raised it. `If-Match` carries the REQUEST's
 * `recordVersion`; a request already withdrawn answers `replayed: true` with no
 * second audit record, and a decided one is refused by name. No body.
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

export const REFUND_WITHDRAW_OPERATION = defineOperation({
  id: 'sal.refund-withdraw',
  module: 'billing',
  method: 'POST',
  path: '/refund-requests/{requestId}/withdrawal',
  summary: 'Withdraw your own pending refund request; the customer stays owed.',
  permissions: ['sal.payment.record', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.refund_request.withdrawn',
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
    REFUND_WITHDRAW_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const withdrawn = await billingModule().refunds.withdrawRefund(
        db,
        params.requestId,
        expectedVersion,
        authorizeScope
      );
      return { body: withdrawn, recordVersion: withdrawn.refundRequest.recordVersion };
    },
    { params: raw }
  );
}
