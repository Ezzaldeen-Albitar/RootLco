/**
 * /api/v1/invoices/{invoiceId}/outstanding — what is still owed on this invoice
 * (P1-22-BE-006).
 *
 * ## Server-derived by construction, not by discipline
 *
 * Nothing stores a balance anywhere in `sal`. `sal.invoice_open_receivable` computes
 * `round(gross − allocations − approved_credits, 4)` on every call, excluding reversed
 * receipts (H-fin-1). So "the outstanding balance is never client-authoritative" is not a
 * rule this code remembers — there is no column a client could write, and no cached value
 * that could drift.
 *
 * ## Why this is a separate operation rather than a field on the invoice
 *
 * The invoice header is readable without `sal.finance.view`; the balance is not. Folding
 * the balance into `GET /invoices/{invoiceId}` would mean either denying the header to a
 * caller who may see it, or building a response whose shape changes silently with the
 * caller's permissions in a way a consumer cannot detect. A separate operation makes the
 * authority explicit: ask for money, hold the money permission.
 *
 * ## The currency is always beside the amount
 *
 * `sal.invoice_open_receivable` returns a **bare numeric with no currency predicate at
 * all**. It is single-invoice, so the invoice's own `currency_code` is what labels it —
 * and this operation always returns the pair, never the scalar.
 *
 * That distinction is why `sal.partner_outstanding_balance` is NOT exposed anywhere in
 * this phase: it loops a partner's issued invoices with no currency filter, so its answer
 * is unlabellable at source rather than merely unlabelled at the boundary.
 * `tests/db/p1-22-protected-residuals.test.ts` shows it returning `150.0000` for one USD
 * invoice open 100 and one JOD invoice open 50.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ invoiceId: schemas.uuid }).strict();

export const INVOICE_OUTSTANDING_OPERATION = defineOperation({
  id: 'sal.invoice-outstanding-read',
  module: 'billing',
  method: 'GET',
  path: '/invoices/{invoiceId}/outstanding',
  summary: 'Report an invoice’s open receivable, always with its currency.',
  permissions: ['sal.finance.view'],
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
    INVOICE_OUTSTANDING_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const outstanding = await billingModule().reads.readOutstanding(
        db,
        params.invoiceId,
        authorizeScope
      );
      return { body: outstanding };
    },
    { params: raw }
  );
}
