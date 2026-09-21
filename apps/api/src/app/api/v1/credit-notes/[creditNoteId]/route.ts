/**
 * /api/v1/credit-notes/{creditNoteId} — read one credit note (DEF-T-07).
 *
 * The note the approval operation acts on, so the second person can see what they
 * are being asked to approve: the amount, the reason the requester gave, the
 * invoice it is raised against, who requested it and — once approved — who
 * approved it and when.
 *
 * `recordVersion` is published and echoed as the response ETag for the same
 * reason every other detail read publishes one. `sal.credit-note-approve` carries
 * no `If-Match` today, so this version guards nothing yet; it is reported because
 * the row has one, not as a claim that the approval is version-guarded.
 *
 * ## An absent note and an invisible one are the same answer
 *
 * `sel_credit_notes_gated` gates the whole row on `sal.finance.view`, so a caller
 * outside the tenant, or inside it without that permission, cannot tell "no such
 * note" from "not yours to see" and the service deliberately does not try: both
 * are `ERR-RES-001`. Confirming that a financial document exists is the
 * disclosure the gate exists to prevent, which is why the permission is declared
 * here rather than left to RLS to refuse silently.
 *
 * That indistinguishability is NOT claimed across branches of the same tenant.
 * Scope is authorized after the row is read — the repository's established
 * deferred-scope order, so the answer names the company and branch the caller
 * must hold — and an in-tenant caller scoped elsewhere therefore receives
 * `ERR-IAM-001`, which does tell them the note exists. That is the same trade
 * every branch-scoped detail read in this module makes, and the suite asserts it
 * rather than leaving it to be discovered.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ creditNoteId: schemas.uuid }).strict();

export const CREDIT_NOTE_DETAIL_OPERATION = defineOperation({
  id: 'sal.credit-note-detail',
  module: 'billing',
  method: 'GET',
  path: '/credit-notes/{creditNoteId}',
  summary: 'Read one credit note: its amount, its reason and its approval state.',
  permissions: ['sal.credit.manage', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ creditNoteId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    CREDIT_NOTE_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const note = await billingModule().reads.readCreditNote(
        db,
        params.creditNoteId,
        authorizeScope
      );
      return { body: note, recordVersion: note.recordVersion };
    },
    { params: raw }
  );
}
