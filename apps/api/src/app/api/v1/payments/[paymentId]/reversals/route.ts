/**
 * /api/v1/payments/{paymentId}/reversals — a payment recorder asks for the WHOLE
 * receipt to be reversed (ADR-023, D4; finance review GAP-06).
 *
 * A receipt's amount, payer, method and currency are frozen once recorded, and its
 * allocations take inserts only, so a mistyped amount or money applied to the wrong
 * invoice is corrected by reversing the whole receipt and recording the right one.
 * This raises the request; a different person decides it
 * (`sal.receipt-reversal-approve` / `-reject`), and the requester may withdraw it
 * (`sal.receipt-reversal-withdraw`).
 *
 * ## The amount is never the caller's
 *
 * The body is the reason and nothing else. A reversal reverses the whole receipt,
 * so its amount and currency are the receipt's own, read by the database under the
 * receipt lock (`sal.request_receipt_reversal`, `sal.guard_receipt_reversal_request`).
 * There is no field a caller could put a partial amount in.
 *
 * ## Who may ask
 *
 * `sal.payment.record` — the code that records a receipt — and `sal.finance.view`,
 * whose whole-row gate covers `sal.receipt_reversals` as it covers `sal.receipts`,
 * both authorized in the receipt's own company and branch. The database checks
 * `sal.payment.record` in that scope again, so a raw insert is held to the rule.
 *
 * ## Version-guarded and idempotent
 *
 * `If-Match` carries the RECEIPT's `recordVersion` from its detail read, compared
 * with the locked row: an allocation recorded since the screen was read is a 409
 * the operator answers by reading again. A repeated `Idempotency-Key` answers the
 * request it already raised (`replayed: true`, no second audit record). A reversed
 * receipt and one that already has a pending or approved reversal are refused by
 * name, and each refusal by rule is recorded after the rollback (D12).
 *
 * While the request is pending, the receipt takes no new allocation. Nothing here
 * returns money: a reversal is not a refund (ADR-023 D2).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REVERSAL_REASON, paymentsModule } from '@/modules/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ paymentId: schemas.uuid }).strict();

export const RequestBody = z
  .object({ reason: z.string().min(1).max(MAX_REVERSAL_REASON) })
  .strict();

export const RECEIPT_REVERSAL_REQUEST_OPERATION = defineOperation({
  id: 'sal.receipt-reversal-request',
  successStatus: 201,
  module: 'payments',
  method: 'POST',
  path: '/payments/{paymentId}/reversals',
  summary: 'Ask for a whole receipt to be reversed, stating why; another person decides.',
  permissions: ['sal.payment.record', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.receipt_reversal.requested',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ paymentId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEIPT_REVERSAL_REQUEST_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope, request: inbound }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RequestBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const requested = await paymentsModule().reversals.requestReversal(
        db,
        params.paymentId,
        { reason: parsed.reason, ...(key === null ? {} : { idempotencyKey: key }) },
        expectedVersion,
        authorizeScope
      );
      return {
        status: 201,
        body: requested,
        recordVersion: requested.reversal.recordVersion,
      };
    },
    { params: raw, body }
  );
}
