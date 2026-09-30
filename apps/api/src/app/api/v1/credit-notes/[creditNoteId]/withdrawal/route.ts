/**
 * /api/v1/credit-notes/{creditNoteId}/withdrawal — the requester withdraws their
 * own pending credit note (ADR-023, D3; finance review GAP-03).
 *
 * Until this operation a pending note could only be approved: a duplicate or
 * mistaken request stayed "waiting for a second person" forever. The requester
 * may now withdraw it. Withdrawal only reduces exposure — a pending note credits
 * nothing and a withdrawn one never will — so it asks no second person, and the
 * invoice's open receivable and derived credit status are unchanged by it.
 *
 * ## The requester, and nobody else
 *
 * The declared permission is `sal.credit.manage`, authorized in the note's own
 * company and branch. Holding it is not enough: only the person who raised the
 * note may withdraw it. The service refuses anyone else with the named rule
 * `credit_note_withdraw_not_requester`, and the database refuses them again
 * (`sal.withdraw_credit_note`, `sal.guard_credit_note_decision`). The note's
 * whole row is gated by `sal.finance.view`, so a caller without it cannot find
 * the note at all and is answered as though it did not exist.
 *
 * ## Version-guarded and idempotent
 *
 * `If-Match` carries the NOTE's `recordVersion` from the detail read, compared
 * with the locked row: a note that changed since it was read is a 409 the screen
 * answers by reading it again. A note already withdrawn by its requester answers
 * `replayed: true` with no second audit record; approved and rejected notes are
 * terminal and refused with `credit_note_decision_frozen`. A refusal by rule is
 * recorded as a security event after the command rolls back (D12).
 *
 * No body: the requester is the session and the note names everything else.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ creditNoteId: schemas.uuid }).strict();

export const CREDIT_NOTE_WITHDRAW_OPERATION = defineOperation({
  id: 'sal.credit-note-withdraw',
  module: 'billing',
  method: 'POST',
  path: '/credit-notes/{creditNoteId}/withdrawal',
  summary: 'Withdraw your own pending credit-note request; it will never credit anything.',
  permissions: ['sal.credit.manage'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.credit_note.withdrawn',
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
  return handleOperation(
    CREDIT_NOTE_WITHDRAW_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const withdrawn = await billingModule().invoices.withdrawCreditNote(
        db,
        params.creditNoteId,
        expectedVersion,
        authorizeScope
      );
      return { body: withdrawn, recordVersion: withdrawn.creditNote.recordVersion };
    },
    { params: raw }
  );
}
