/**
 * /api/v1/invoices — create a draft invoice from approved commercial data
 * (P1-22-BE-003).
 *
 * ## Client totals are not ignored — they are unexpressible
 *
 * The body below has no `amount`, no `total`, no `tax`, no `lines` and no `unitPrice`,
 * and `.strict()` means a body carrying any of them is REFUSED rather than silently
 * dropped. There is therefore no code path on which a client-supplied total could be
 * trusted, because there is no field through which one could arrive.
 *
 * Every line and every amount is derived server-side from the approved quotation
 * revision and the captured pricing behind it, then snapshotted onto the invoice. The
 * work order names WHAT to bill; the approved commercial record decides HOW MUCH.
 *
 * ## Born draft, and the database insists
 *
 * `sal.guard_invoice_freeze` raises `check_violation` on any INSERT whose status is not
 * `'draft'`, so this route accepts no status field either — an invoice cannot be created
 * already-issued, which is what would otherwise bypass the numbering allocator and the
 * completeness event.
 *
 * `uq_invoices_work_order_active` permits AT MOST ONE live invoice per work order, so
 * staged or progress billing is structurally impossible and a second attempt is `23505`
 * — surfaced as a conflict, never a 500.
 *
 * ## Why `sal.finance.view` is required to CREATE
 *
 * `sal.invoice_amounts` and `sal.invoice_line_amounts` are gated by it on INSERT as well
 * as SELECT. Creation writes both, so a caller holding only `sal.invoice.manage` would
 * have its write refused by RLS. Declaring one permission and needing two would
 * advertise an operation that always fails.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const CreateBody = z
  .object({
    workOrderId: schemas.uuid,
    /**
     * Optional. Omitted, the payer is derived from the work order's own customer.
     *
     * Accepted only so a third-party payer (an insurer, a fleet operator) can be named
     * where the commercial arrangement differs from the vehicle's owner. It is a
     * partner identity, never an amount.
     */
    payerPartnerId: schemas.uuid.optional(),
  })
  .strict();

export const INVOICE_CREATE_OPERATION = defineOperation({
  id: 'sal.invoice-create',
  module: 'billing',
  method: 'POST',
  path: '/invoices',
  summary: 'Create a draft invoice for a work order from its approved commercial data.',
  permissions: ['sal.invoice.manage', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.invoice.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    INVOICE_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const invoice = await billingModule().invoices.createInvoice(
        db,
        {
          workOrderId: parsed.workOrderId,
          ...(parsed.payerPartnerId === undefined ? {} : { payerPartnerId: parsed.payerPartnerId }),
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return { status: 201, body: invoice };
    },
    { body }
  );
}
