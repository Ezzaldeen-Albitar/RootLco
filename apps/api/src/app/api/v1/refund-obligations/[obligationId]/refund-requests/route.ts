/**
 * /api/v1/refund-obligations/{obligationId}/refund-requests — a payment recorder
 * asks for (part of) a refund obligation to be paid back (ADR-023 D2, part 2,
 * P1-32-PRE-OD-FD2B).
 *
 * A refund obligation records that a customer is owed money back because an
 * approved credit exceeded what the invoice still owed. Nothing pays it
 * automatically. This raises the request; a DIFFERENT person decides it
 * (`sal.refund-approve` / `sal.refund-reject`), the requester may withdraw it
 * (`sal.refund-withdraw`), and once approved its payout is recorded once
 * (`sal.refund-execute`).
 *
 * ## The body
 *
 * The amount (a decimal string, above zero, to the currency's minor unit, at most
 * what is still owed on the obligation), the tenant payment method the money is to
 * be paid by, and the reason. The payee and the currency are the obligation's own,
 * never the caller's — a third-party payee is an open Owner question.
 *
 * ## Who may ask
 *
 * `sal.payment.record` — the code that records a receipt — and `sal.finance.view`,
 * whose whole-row gate covers both refund tables, authorized in the obligation's
 * own company and branch. The database checks `sal.payment.record` in that scope
 * again (`sal.guard_refund_request_insert`).
 *
 * ## Idempotent, not version-guarded
 *
 * A repeated `Idempotency-Key` answers the request it already raised
 * (`replayed: true`, no second audit record). An obligation that is not open, one
 * that already has a live request (`refund_request_live_exists`), an amount above
 * what is still owed (`refund_exceeds_obligation`) and an inactive method are
 * refused by name, and each refusal by rule is recorded after the rollback (D12).
 * Nothing here moves money: a request pays nothing.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REFUND_REASON, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ obligationId: schemas.uuid }).strict();

/** `numeric(18,4)`, unsigned, and strictly positive per `ck_refund_requests_amount`. */
const MoneyAmount = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,4})?$/,
    'must be an unsigned decimal string of at most 14 integer digits and 4 decimal places'
  );

export const RefundRequestBody = z
  .object({
    amount: MoneyAmount,
    paymentMethodId: schemas.uuid,
    reason: z.string().min(1).max(MAX_REFUND_REASON),
  })
  .strict();

export const REFUND_REQUEST_OPERATION = defineOperation({
  id: 'sal.refund-request',
  successStatus: 201,
  module: 'billing',
  method: 'POST',
  path: '/refund-obligations/{obligationId}/refund-requests',
  summary: 'Ask for a refund owed to a customer to be paid back; another person decides.',
  permissions: ['sal.payment.record', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.refund_request.requested',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ obligationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REFUND_REQUEST_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RefundRequestBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const requested = await billingModule().refunds.requestRefund(
        db,
        params.obligationId,
        {
          amount: parsed.amount,
          paymentMethodId: parsed.paymentMethodId,
          reason: parsed.reason,
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return {
        status: 201,
        body: requested,
        recordVersion: requested.refundRequest.recordVersion,
      };
    },
    { params: raw, body }
  );
}
