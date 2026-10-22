/**
 * /api/v1/refund-requests/{requestId}/execution — a payment recorder records the
 * payout of an approved refund request, once (ADR-023 D2, part 2,
 * P1-32-PRE-OD-FD2B).
 *
 * The refund's second step, separate from its approval: the money was paid back
 * outside the platform — in cash, by card terminal or by bank transfer — and this
 * records that it was, with the payout's reference, the day it was made and the
 * method the request was approved with (`refund_payout_method_mismatch`
 * otherwise). `sal.execute_refund_request` writes one `refund_executed` row of
 * `sal.financial_events` — an operational fact, NOT an accounting entry: no account,
 * no posting, no cash or bank movement — and settles the obligation when what has
 * been paid out on it reaches its amount, in this transaction beside the audit
 * record.
 *
 * ## Who may record it
 *
 * `sal.payment.record` and `sal.finance.view` in the obligation's own company and
 * branch; the database checks `sal.payment.record` again. Only an approved request
 * is paid out (`refund_not_approved`), and only once (`refund_already_executed`).
 *
 * ## Version-guarded and idempotent
 *
 * `If-Match` carries the REQUEST's `recordVersion` from its read, compared with the
 * locked row. A repeat under the `Idempotency-Key` the payout was recorded with
 * answers it (`replayed: true`, no second record, no second event) before the
 * version is compared; any other repeat is refused by name. A payout date in the
 * future is a field error on `body.payoutDate`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_PAYOUT_REFERENCE, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid }).strict();

export const RefundExecuteBody = z
  .object({
    paymentMethodId: schemas.uuid,
    payoutReference: z.string().min(1).max(MAX_PAYOUT_REFERENCE),
    payoutDate: z.iso.date(),
  })
  .strict();

export const REFUND_EXECUTE_OPERATION = defineOperation({
  id: 'sal.refund-execute',
  module: 'billing',
  method: 'POST',
  path: '/refund-requests/{requestId}/execution',
  summary: 'Record, once, that an approved refund was paid out: reference, day and method.',
  permissions: ['sal.payment.record', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.refund_request.executed',
  idempotent: true,
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
    REFUND_EXECUTE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope, request: inbound }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RefundExecuteBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const executed = await billingModule().refunds.executeRefund(
        db,
        params.requestId,
        {
          paymentMethodId: parsed.paymentMethodId,
          payoutReference: parsed.payoutReference,
          payoutDate: parsed.payoutDate,
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        expectedVersion,
        authorizeScope
      );
      return { body: executed, recordVersion: executed.refundRequest.recordVersion };
    },
    { params: raw, body }
  );
}
