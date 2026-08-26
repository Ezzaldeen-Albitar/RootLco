/**
 * /api/v1/payments/{paymentId}/allocations — apply receipt money to one invoice
 * (P1-22-BE-011).
 *
 * A subresource of the receipt, because an allocation has no independent existence:
 * `sal.payment_allocations` is append-only, has no UPDATE or DELETE grant, and no
 * reversal record of its own. A single misallocated line is correctable only by
 * reversing the WHOLE receipt under dual control, which this phase does not expose
 * (`P1-22-L-05`). So this is one of the least reversible operations in the platform,
 * and its refusals are deliberately noisy.
 *
 * ## The one invariant the database does not defend
 *
 * `Σ allocations ≤ receipt.amount` and `Σ allocations ≤ invoice.open` are enforced
 * **only inside `sal.allocate_receipt`**. There is no constraint, no trigger and no
 * exclusion bounding the sum, and `app_runtime` holds raw `INSERT` on the table —
 * `tests/db/p1-22-protected-residuals.test.ts` reproduces the bypass and shows both
 * derivations reaching −400.0000 after one raw insert of 500 against a receipt of 100.
 *
 * That is why the service calls the primitive and why the repository contains no
 * INSERT path at all. This route contributes the third part of that defence: it offers
 * no way to express an allocation other than through this handler.
 *
 * ## Why `currency` is required when the server already knows it
 *
 * `sal.allocate_receipt` compares the receipt's currency to the invoice's, and never
 * sees what the caller believed. Without a declared currency, a client that thinks it
 * is allocating USD against a JOD receipt succeeds — in a currency it did not intend,
 * for an amount that means something different from what it meant to send. Requiring
 * it turns a silent success into an explicit refusal.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
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

export const AllocateBody = z
  .object({
    invoiceId: schemas.uuid,
    amount: MoneyAmount,
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code'),
  })
  .strict();

export const PAYMENT_ALLOCATE_OPERATION = defineOperation({
  id: 'sal.payment-allocate',
  module: 'payments',
  method: 'POST',
  path: '/payments/{paymentId}/allocations',
  summary: 'Allocate part or all of a receipt to one issued invoice.',
  // `sal.finance.view` because both `sal.receipts` and `sal.payment_allocations` are
  // gated whole-row by it, on INSERT as well as SELECT.
  permissions: ['sal.payment.allocate', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.payment.allocated',
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
    PAYMENT_ALLOCATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(AllocateBody, body, 'body');
      const allocation = await paymentsModule().payments.allocatePayment(
        db,
        {
          receiptId: params.paymentId,
          invoiceId: parsed.invoiceId,
          amount: parsed.amount,
          currencyCode: parsed.currency,
        },
        authorizeScope
      );
      return { status: 201, body: allocation };
    },
    { params: raw, body }
  );
}
