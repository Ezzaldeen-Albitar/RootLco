/**
 * GET /api/v1/work-orders/{workOrderId}/invoice (Phase 1-30 A2, seam S-10).
 *
 * The invoices a work order has, or the fact that it has none.
 *
 * ## Why this is class A
 *
 * `BillingRepository.liveInvoiceForWorkOrder` (now `liveInvoicesForWorkOrder`) had no
 * route in front of it. Its only two callers are internal: the duplicate-create
 * refusal in `InvoiceService`, and the delivery module's financial-blocker port —
 * neither reachable by a screen. So a work-order screen could not answer "has this
 * been invoiced?" without listing invoices and filtering client-side. This publishes
 * the existing read; it adds no query and no second mapper.
 *
 * ## The current invoice, and every live one
 *
 * Since ADR-023 D5/D15 (P1-32-PRE-OD-FD5) a work order may carry several live
 * invoices, each billing approved quantity none of the others holds. `invoice` is the
 * one a screen acts on — the open draft when there is one (`uq_invoices_work_order_draft`
 * allows one), else the newest — and `invoices` lists every live one, draft first and
 * then newest first, bounded (`invoicesTruncated` says when the bound was reached).
 * `approvedWorkToInvoice` says whether approved quotation work remains that no live
 * invoice holds. No pagination: the set is the live invoices of one work order.
 *
 * ## Absence is a 200, not a 404
 *
 * A visible work order with no invoice answers `{ workOrderId, invoice: null }` at 200.
 * A work order that is not visible answers `ERR-RES-001`. Collapsing those two would
 * tell a caller "no invoice" for a work order in a branch they cannot see — an
 * existence oracle disguised as an empty result.
 *
 * ## Money
 *
 * `net_total`, `tax_total` and `gross_total` are `numeric(18,4)` and cross the wire as
 * DECIMAL STRINGS inside `totals`. `totals` is legitimately `null` when the caller
 * lacks `sal.finance.view`: `sel_invoice_amounts_gated` hides the amounts row, the
 * query is a LEFT JOIN precisely so that yields NULL rather than no invoice, and
 * `toInvoiceView` folds it to `totals: null`. Money OMITTED, never zeroed.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

export const WORK_ORDER_INVOICE_READ_OPERATION = defineOperation({
  id: 'sal.work-order-invoice-read',
  module: 'billing',
  method: 'GET',
  path: '/work-orders/{workOrderId}/invoice',
  summary: 'Read the invoice a work order has, if it has one.',
  // `sal.invoice.manage`, the same code the sibling read of this row declares
  // (`sal.invoice-detail`). NOT `sal.invoice.read`: `navigation.ts` names that code
  // but it is ABSENT from the 118-code catalogue (RES-05), so declaring it would gate
  // this route on a permission no actor can hold. A navigation label is not
  // authorization truth.
  permissions: ['sal.invoice.manage'],
  // `branch`, and the target is NOT empty: the handler resolves company and branch
  // from the WORK ORDER row and authorizes those before reading. Without that a
  // declared scope is inert on an id-addressed read — `requiresScopedEvaluation`
  // returns false for an empty target whatever the declaration says (P1-18-A-01).
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    WORK_ORDER_INVOICE_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await billingModule().reads.readWorkOrderInvoice(
          db,
          params.workOrderId,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
