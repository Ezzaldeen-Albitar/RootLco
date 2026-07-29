/**
 * /api/v1/work-orders/{workOrderId}/invoice-preview — what this work order would bill
 * (P1-22-BE-002).
 *
 * A read, under the work order it previews, producing nothing. No row is written, no
 * number is consumed and no state moves — so it is safe to call repeatedly while a
 * service advisor negotiates, which is the whole point of it existing separately from
 * `POST /invoices`.
 *
 * ## Every amount is computed by PostgreSQL, not by TypeScript
 *
 * The totals come back from a read-only `SELECT` whose arithmetic is `round(… , 4)` —
 * the same shape `ck_invoice_amounts_gross` enforces and `sal.issue_invoice` later
 * applies when it recomputes the header from the lines. One engine, so the preview
 * cannot disagree with the invoice it is previewing.
 *
 * That is the repository's own recorded decision rather than caution added here:
 * `Money` in `@/modules/pricing` deliberately has no `add` and no `multiply`, because
 * a second arithmetic engine in TypeScript could disagree with the CHECK constraints
 * that validate the database's own output.
 *
 * ## Nothing here is a business-policy default
 *
 * Tax and discount are read from protected configuration. No rate, no jurisdiction, no
 * currency and no tax-inclusive/exclusive assumption is written into this phase. A
 * missing tax configuration is a controlled configuration error — never a silent zero,
 * which would under-bill by exactly the tax and look like a correct answer.
 *
 * Every amount crosses the boundary as a decimal STRING with an explicit currency
 * beside it. There is no unlabelled total anywhere in the response.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid }).strict();

export const INVOICE_PREVIEW_OPERATION = defineOperation({
  id: 'sal.invoice-preview',
  module: 'billing',
  method: 'GET',
  path: '/work-orders/{workOrderId}/invoice-preview',
  summary: 'Preview the invoice a work order would produce, without creating one.',
  // `sal.finance.view` because the preview IS money. A caller who may not see an
  // invoice's amounts must not be able to obtain them from a preview instead — that
  // would make the restricted amount tables pointless.
  permissions: ['sal.invoice.manage', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    INVOICE_PREVIEW_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const preview = await billingModule().reads.previewInvoice(
        db,
        params.workOrderId,
        authorizeScope
      );
      return { body: preview };
    },
    { params: raw }
  );
}
