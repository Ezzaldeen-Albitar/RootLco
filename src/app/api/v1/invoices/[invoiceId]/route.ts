/**
 * /api/v1/invoices/{invoiceId} — read one invoice (P1-22-BE-005).
 *
 * ## The one operation in this phase that deliberately does NOT require
 * `sal.finance.view`
 *
 * `sal.invoices` is scope-gated only. The money lives in two separate tables,
 * `sal.invoice_amounts` and `sal.invoice_line_amounts`, whose RLS policies are gated by
 * `iam.has_permission('sal.finance.view')`.
 *
 * So a caller without the finance permission must receive an invoice header **without
 * money**, not a 403 on the whole resource. That is not a convenience: a service advisor
 * needs to know an invoice exists, which work order it belongs to, whether it has been
 * issued and what its number is, without being entitled to its amounts. Returning 403
 * would deny a fact the schema deliberately leaves visible.
 *
 * The read is built on a LEFT JOIN precisely so RLS invisibility yields NULL rather than
 * zero rows — the header survives and the money sub-object is omitted. **Omitted, not
 * zeroed**: a `total` of `0` would be a lie about the invoice, where an absent `money`
 * key is the truth about the caller.
 *
 * Contrast `sal.receipt-detail`, which DOES require the permission, because
 * `sal.receipts` is gated whole-row — there is no honest partial projection of a receipt
 * to build.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ invoiceId: schemas.uuid }).strict();

export const INVOICE_DETAIL_OPERATION = defineOperation({
  id: 'sal.invoice-detail',
  module: 'billing',
  method: 'GET',
  path: '/invoices/{invoiceId}',
  summary: 'Read an invoice header, with its amounts only where the caller may see them.',
  permissions: ['sal.invoice.manage'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ invoiceId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    INVOICE_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const invoice = await billingModule().reads.readInvoice(db, params.invoiceId, authorizeScope);
      // Returned so a caller can hold a version for the version-guarded issue and
      // cancel commands. `invoice.totals` is null when the caller lacks
      // `sal.finance.view`, and the version is unaffected by that — the row exists
      // either way.
      return { body: invoice, recordVersion: invoice.invoice.recordVersion };
    },
    { params: raw }
  );
}
