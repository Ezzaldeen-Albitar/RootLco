/**
 * /api/v1/credit-notes/{creditNoteId}/approval — approve a credit note under dual control
 * (P1-22-BE-008).
 *
 * The moment a credit becomes real: `sal.approve_credit_note` sets `approval_state`,
 * stamps `issued_at`, writes the `credit_note_issued` financial event, and the invoice's
 * open receivable falls by the credited amount.
 *
 * ## Why this is a second operation and not a flag on the request
 *
 * `sal.guard_dual_control_approval` raises `check_violation` when
 * `approved_by = requested_by`, and both are stamped from `iam.current_user_id()` — the
 * maker by `stamp_dual_control_maker` on INSERT, the approver by
 * `guard_dual_control_approval` on UPDATE. So the two acts MUST come from two sessions
 * belonging to two different users, and a single endpoint could not satisfy that however
 * it was shaped. The audit class is `approval` rather than `financial` for the same
 * reason: the fact recorded is a second person's decision.
 *
 * The refusal is translated into a caller-safe message saying the approver must differ
 * from the requester, rather than surfacing a constraint name.
 *
 * ## Idempotent, and the primitive is what makes it so
 *
 * `sal.approve_credit_note` returns silently when the note is already `'approved'`, and
 * rejects any other non-`pending` state. A replay therefore neither double-credits nor
 * writes a second financial event — `uq_financial_events_source` would refuse the second
 * event with `23505` in any case, which is a free backstop.
 *
 * ## Refusals are recorded
 *
 * A self-approval, an approval of a note that is no longer pending and an approval
 * above the invoice's open amount are refused as before, and each refused attempt
 * is now also recorded as one security event after the command rolls back
 * (ADR-023, D12). The answer the caller receives is unchanged.
 *
 * ## What is NOT here
 *
 * Rejection and withdrawal are their own operations since ADR-023 D3:
 * `sal.credit-note-reject` (another authorised person, with a reason) and
 * `sal.credit-note-withdraw` (the requester). Both are terminal, like an approval.
 *
 * No refund and no partial reversal: both are structurally absent from `sal`
 * (`P1-22-L-05`).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ creditNoteId: schemas.uuid }).strict();

export const CREDIT_NOTE_APPROVE_OPERATION = defineOperation({
  id: 'sal.credit-note-approve',
  module: 'billing',
  method: 'POST',
  path: '/credit-notes/{creditNoteId}/approval',
  summary: 'Approve a pending credit note under dual control, reducing the open receivable.',
  permissions: ['sal.credit.manage', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'sal.credit_note.approved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ creditNoteId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    CREDIT_NOTE_APPROVE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const approved = await billingModule().invoices.approveCreditNote(
        db,
        params.creditNoteId,
        authorizeScope
      );
      return { body: approved };
    },
    // No body: the approver is the session, and the amount was fixed at request time —
    // `guard_dual_control_approval` freezes `amount` once the state leaves `pending`, so
    // accepting one here would be offering a field the database refuses to honour.
    { params: raw }
  );
}
