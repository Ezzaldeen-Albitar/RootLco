/**
 * /api/v1/invoices/{invoiceId}/cancellation — void a draft invoice before issue
 * (P1-22-BE-007).
 *
 * ## Only a draft, and that is the whole design
 *
 * `sal.guard_invoice_freeze` permits `draft → void_before_issue` and nothing else reaches
 * that state. An **issued** invoice can never be cancelled: the status is named
 * `void_before_issue` precisely so the vocabulary itself refuses the idea. A number that
 * has been shown to a customer is never withdrawn; the instruments after issue are a
 * credit note and a new invoice.
 *
 * `ck_invoices_number_iff_issued` makes it structural — a voided invoice must carry a NULL
 * number and a NULL `issued_at`, so there is no state in which a voided invoice holds a
 * number.
 *
 * ## A reason is required, and it is recorded where a reader will find it
 *
 * Written to `sal.invoice_status_history.reason` alongside the transition, and into the
 * audit details. The history row's actor and timestamp are server-stamped by
 * `shared.stamp_status_history`, so neither is a client input.
 *
 * ## Idempotent, and honestly so
 *
 * A replay against an already-void invoice returns the same result rather than refusing:
 * the caller asked for the invoice to be void and it is void. What it must not do is
 * write a second history row or a second audit record, so the service short-circuits on
 * the terminal state rather than re-running the transition.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ invoiceId: schemas.uuid }).strict();

const CancelBody = z.object({ reason: z.string().min(1).max(MAX_REASON) }).strict();

export const INVOICE_CANCEL_OPERATION = defineOperation({
  id: 'sal.invoice-cancel',
  module: 'billing',
  method: 'POST',
  path: '/invoices/{invoiceId}/cancellation',
  summary: 'Void a draft invoice before issue, recording the reason.',
  permissions: ['sal.invoice.manage'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.invoice.voided',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ invoiceId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    INVOICE_CANCEL_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(CancelBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const voided = await billingModule().invoices.cancelInvoice(
        db,
        params.invoiceId,
        parsed.reason,
        expectedVersion,
        authorizeScope
      );
      return { body: voided, recordVersion: voided.invoice.recordVersion };
    },
    { params: raw, body }
  );
}
