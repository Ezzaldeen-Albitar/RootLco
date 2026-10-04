/**
 * /api/v1/credit-notes/{creditNoteId}/rejection — another authorised person
 * rejects a pending credit note, with a reason (ADR-023, D3; finance review
 * GAP-03).
 *
 * The schema always admitted `rejected`, and nothing reached it. A note that
 * should not be approved — raised against the wrong invoice, a duplicate — can
 * now be turned down by someone other than the person who raised it, who
 * withdraws their own request instead (`sal.credit-note-withdraw`). A rejected
 * note credits nothing, so the open receivable and the derived credit status are
 * unchanged, and an approval afterwards is refused: rejected is terminal.
 *
 * ## Who may reject
 *
 * The same two codes an approval declares, `sal.credit.approve` and
 * `sal.finance.view`, authorized in the note's own company and branch — only an
 * authorised decision-maker turns a request down (ADR-023 D13) — and a person who
 * is not the requester (`credit_note_self_rejection`). No credit-note limit is
 * needed: a rejection credits nothing. The database holds both rules itself:
 * `sal.guard_credit_note_decision` checks `sal.credit.approve` in the note's scope
 * and refuses the requester, so the rule does not depend on this route being the
 * only way in.
 *
 * ## The reason is the record
 *
 * Required, trimmed, at most `MAX_REASON` characters, and never blank: a blank
 * one is a field error on `body.reason` (422), not a refusal of the note. It is
 * stored on the note (`decision_reason`) and in the audit record.
 *
 * ## Version-guarded and idempotent
 *
 * `If-Match` carries the NOTE's `recordVersion`, compared with the locked row. A
 * note already rejected answers `replayed: true` with no second audit record;
 * approved and withdrawn notes are refused with `credit_note_decision_frozen`. A
 * refusal by rule is recorded as a security event after the command rolls back
 * (D12).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ creditNoteId: schemas.uuid }).strict();

export const RejectBody = z.object({ reason: z.string().min(1).max(MAX_REASON) }).strict();

export const CREDIT_NOTE_REJECT_OPERATION = defineOperation({
  id: 'sal.credit-note-reject',
  module: 'billing',
  method: 'POST',
  path: '/credit-notes/{creditNoteId}/rejection',
  summary: 'Reject a pending credit note raised by someone else, stating why.',
  permissions: ['sal.credit.approve', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'sal.credit_note.rejected',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ creditNoteId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    CREDIT_NOTE_REJECT_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RejectBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const rejected = await billingModule().invoices.rejectCreditNote(
        db,
        params.creditNoteId,
        { reason: parsed.reason },
        expectedVersion,
        authorizeScope
      );
      return { body: rejected, recordVersion: rejected.creditNote.recordVersion };
    },
    { params: raw, body }
  );
}
