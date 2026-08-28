/**
 * POST /api/v1/quotation-revisions/{revisionId}/decisions
 * (Phase 1-20, P1-20-BE-008, BE-009).
 *
 * Records ONE decision against every still-undecided line of a revision, atomically.
 *
 * ## What this is, and what it is not
 *
 * It is an **orchestration** over `quo.record_item_decision`, the protected per-item
 * function. It is **not** a second place a decision is stored: there is no
 * revision-level decision row in `quo`, and this route creates none. Every fact it
 * writes lands in `quo.approval_decisions`, keyed per item, exactly as
 * `POST /quotation-items/{quotationItemId}/decisions` does. The quotation-level
 * outcome is recomputed from those item rows on every read and is never cached.
 *
 * It exists because the business act "the customer accepted this quotation" is real,
 * and expressing it as N client-driven calls would make a partially decided revision
 * an ordinary intermediate state that a dropped connection could leave behind.
 *
 * ## All-or-nothing
 *
 * The whole loop runs inside one transaction, so a failure on line three rolls back
 * lines one and two. A line that already carries the SAME decision is treated as a
 * settled replay; a line carrying the OPPOSITE decision aborts the entire command
 * with `ERR-CON-001` rather than overwriting a recorded customer choice —
 * `uq_approval_decisions_item` makes the first decision on a line final, and
 * silently discarding it would be the worst possible outcome for an approval trail.
 *
 * ## Audit shape
 *
 * One aggregate `quo.quotation_revision.decided` record for the revision-wide act,
 * beside the per-item events. A reviewer needs to see "the customer decided this
 * revision"; a row per line would bury it, while the per-line facts remain the
 * stored truth.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  DECISIONS,
  DECISION_CHANNELS,
  EVIDENCE_KINDS,
  MAX_REFERENCE_NOTE,
  quotationModule,
} from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ revisionId: schemas.uuid });

const Evidence = z
  .object({
    evidenceKind: z.enum(EVIDENCE_KINDS),
    documentVersionId: schemas.uuid.optional(),
    referenceNote: z.string().min(1).max(MAX_REFERENCE_NOTE).optional(),
  })
  .strict();

export const Body = z
  .object({
    decision: z.enum(DECISIONS),
    channel: z.enum(DECISION_CHANNELS),
    decidingPartyRef: schemas.uuid.optional(),
    evidence: Evidence.optional(),
    /**
     * The revision the caller believes it is deciding.
     *
     * Required even though the path already names one: the path id and the
     * *presented* id are different claims. The service refuses unless the revision
     * is also the quotation's `current_revision_id`, so a client holding a
     * superseded revision cannot decide the one that replaced it.
     */
    presentedRevisionId: schemas.uuid,
  })
  .strict();

export const QUOTATION_REVISION_DECIDE_OPERATION = defineOperation({
  id: 'quo.quotation-revision-decide',
  successStatus: 201,
  module: 'quotation',
  method: 'POST',
  path: '/quotation-revisions/{revisionId}/decisions',
  summary: 'Record one decision against every undecided line of a revision, atomically.',
  permissions: ['quo.decision.record'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'quo.quotation_revision.decided',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ revisionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    QUOTATION_REVISION_DECIDE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const outcome = await quotationModule().decisions.decideRevision(
        db,
        params.revisionId,
        {
          decision: parsed.decision,
          channel: parsed.channel,
          decidingPartyRef: parsed.decidingPartyRef,
          evidence: parsed.evidence,
          presentedRevisionId: parsed.presentedRevisionId,
        },
        authorizeScope
      );
      return { status: 201, body: outcome };
    },
    { params: raw, body }
  );
}
