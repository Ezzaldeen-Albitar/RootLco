/**
 * /api/v1/payments/{paymentId} — read one receipt with its allocations
 * (P1-22-BE-012).
 *
 * ## Why this requires `sal.finance.view` where the invoice detail does not
 *
 * The asymmetry is the schema's, not a policy choice made here. `sal.invoices` is
 * scope-gated only, so an invoice header is visible without the finance permission and
 * its money simply is not — the amount tables are separately gated, and §3 of the
 * archaeology recorded that such a caller must get a header WITHOUT money rather than
 * a 403 on the whole resource.
 *
 * `sal.receipts` is different: it is gated **whole-row** by
 * `iam.has_permission('sal.finance.view')` on SELECT. A caller without it sees zero
 * receipts, not redacted ones. So there is no honest "receipt without amounts"
 * projection to build, and declaring the permission is the truthful contract: the
 * alternative would be an endpoint that returns 404 for a receipt that exists.
 *
 * ## The receipt reference is stable, and is not a second identity
 *
 * `receipt_number` is allocated once by `sal.record_receipt` and frozen by
 * `sal.guard_receipt_freeze` — the trigger is unconditional on every UPDATE and covers
 * the number as well as the money. A replay of the recording command returns the same
 * receipt, so this read returns the same reference; there is no path that mints a
 * second number for one payment.
 *
 * The response carries no payment credential, because none is stored. See
 * `src/app/api/v1/payments/route.ts`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { paymentsModule } from '@/modules/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ paymentId: schemas.uuid }).strict();

export const RECEIPT_DETAIL_OPERATION = defineOperation({
  id: 'sal.receipt-detail',
  module: 'payments',
  method: 'GET',
  path: '/payments/{paymentId}',
  summary: 'Read a receipt with its amount, method and allocation history.',
  permissions: ['sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ paymentId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    RECEIPT_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const receipt = await paymentsModule().reads.readReceipt(
        db,
        params.paymentId,
        authorizeScope
      );
      return { body: receipt };
    },
    { params: raw }
  );
}
