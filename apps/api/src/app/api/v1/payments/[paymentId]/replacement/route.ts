/**
 * /api/v1/payments/{paymentId}/replacement — record the receipt that replaces a
 * REVERSED one (ADR-023, D4).
 *
 * Once a reversal of a mis-recorded receipt is approved, the right receipt is
 * recorded here and linked to the reversed one, so each names the other: the
 * reversed receipt's detail shows its replacement and the replacement's shows the
 * receipt it replaces (`sal.receipts.replaces_receipt_id`).
 *
 * ## Every rule of an ordinary receipt, and two more
 *
 * The body is `sal.payment-record`'s minus the company and branch, which are the
 * reversed receipt's own: the method, the payer, the currency and the amount, with
 * the same checks (an active method this organisation owns, an active currency, an
 * amount no finer than the currency's minor unit, a provisioned receipt number
 * sequence). The payer and currency are offered prefilled by the screen and may be
 * changed — a wrong payer may be exactly what the reversal corrected. The two more
 * rules: the receipt in the path was reversed by an APPROVED reversal
 * (`receipt_replacement_not_reversed`), and has no replacement yet
 * (`receipt_replacement_exists`). The database holds both
 * (`sal.guard_receipt_replacement`, `uq_receipts_replaces`).
 *
 * ## Who may record it
 *
 * `sal.payment.record` and `sal.finance.view`, exactly what recording a receipt
 * declares, authorized in the reversed receipt's company and branch.
 *
 * ## Idempotent, not version-guarded
 *
 * Like `sal.payment-record`: the key is also the receipt's business key, so a
 * retry answers the replacement it already recorded and never consumes a second
 * receipt number. Nothing is edited, so there is no version to guard.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { paymentsModule } from '@/modules/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ paymentId: schemas.uuid }).strict();

/** `numeric(18,4)`, unsigned. See the note in `src/app/api/v1/payments/route.ts`. */
const MoneyAmount = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,4})?$/,
    'must be an unsigned decimal string of at most 14 integer digits and 4 decimal places'
  );

export const ReplacementBody = z
  .object({
    paymentMethodId: schemas.uuid,
    payerPartnerId: schemas.uuid,
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code'),
    amount: MoneyAmount,
  })
  .strict();

export const RECEIPT_REPLACEMENT_RECORD_OPERATION = defineOperation({
  id: 'sal.receipt-replacement-record',
  successStatus: 201,
  module: 'payments',
  method: 'POST',
  path: '/payments/{paymentId}/replacement',
  summary: 'Record the receipt that replaces a receipt whose reversal was approved.',
  permissions: ['sal.payment.record', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.receipt.replacement_recorded',
  idempotent: true,
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
    RECEIPT_REPLACEMENT_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(ReplacementBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const receipt = await paymentsModule().payments.recordReplacement(
        db,
        params.paymentId,
        {
          paymentMethodId: parsed.paymentMethodId,
          payerPartnerId: parsed.payerPartnerId,
          currencyCode: parsed.currency,
          amount: parsed.amount,
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return { status: 201, body: receipt };
    },
    { params: raw, body }
  );
}
