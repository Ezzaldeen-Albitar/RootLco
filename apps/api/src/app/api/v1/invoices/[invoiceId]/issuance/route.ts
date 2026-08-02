/**
 * /api/v1/invoices/{invoiceId}/issuance — issue a draft invoice (P1-22-BE-004).
 *
 * The irreversible one. After this, post-issue correction is impossible by design: the
 * amount and line tables refuse any write whose parent is not `draft`, the number and
 * issue timestamp are frozen, and `issued` may only ever advance to `credited`. The only
 * remaining instruments are a credit note and a new invoice.
 *
 * ## Exactly one number, and the primitive is what guarantees it
 *
 * `sal.issue_invoice` takes the invoice row `FOR UPDATE`, and if the status is ALREADY
 * `'issued'` it returns the existing `invoice_number` without allocating a second one.
 * So a replay — HTTP-level or otherwise — cannot mint a second number, and two
 * concurrent issues serialise on that lock: one allocates, the other returns what the
 * first allocated.
 *
 * The number itself is opaque text. This route never constructs, parses,
 * regex-validates or sorts by it; no prefix or format exists in schema or seeds.
 *
 * ## An unprovisioned tenant is refused, and nothing is invented
 *
 * `shared.next_display_number` raises `no_data_found` (`P0002`) when no sequence row
 * exists for `(tenant, company, branch, sequence_code)`, and `app_runtime` holds no
 * `INSERT` grant and no `INSERT` policy on `shared.number_sequences` — so the backend
 * **cannot** self-heal, by design. It returns a controlled configuration error naming
 * the missing tuple, and the service pre-checks provisioning so an unprovisioned tenant
 * is refused BEFORE the transaction does the expensive work.
 *
 * What it must never do, and does not: invent a fallback number, use a timestamp or a
 * UUID, or fall back to a tenant-wide sequence. See
 * `docs/phase-1/phase-1-22/number-sequence-runbook.md`.
 *
 * A failed issue claims no number: the counter advance and the business write share one
 * transaction, so a rollback takes the allocation with it. That is proved directly in
 * `tests/db/p1-22-protected-residuals.test.ts`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ invoiceId: schemas.uuid }).strict();

export const INVOICE_ISSUE_OPERATION = defineOperation({
  id: 'sal.invoice-issue',
  module: 'billing',
  method: 'POST',
  path: '/invoices/{invoiceId}/issuance',
  summary: 'Issue a draft invoice, allocating exactly one number from its branch sequence.',
  permissions: ['sal.invoice.issue', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.invoice.issued',
  idempotent: true,
  // A caller working from a stale read must be told so rather than issuing an invoice
  // whose amounts have changed under it. The lock inside the primitive prevents a
  // double number; `If-Match` prevents a confident issue of the wrong document.
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ invoiceId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    INVOICE_ISSUE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const issued = await billingModule().invoices.issueInvoice(
        db,
        params.invoiceId,
        expectedVersion,
        authorizeScope
      );
      // The version travels on the nested invoice, not on the result wrapper: the
      // wrapper also carries `replayed`, which is a fact about this request rather than
      // about the row, and an ETag must describe the row.
      return { body: issued, recordVersion: issued.invoice.recordVersion };
    },
    // No body: issuance has no parameters. There is nothing a caller could decide about
    // it, and offering a field would imply otherwise.
    { params: raw }
  );
}
