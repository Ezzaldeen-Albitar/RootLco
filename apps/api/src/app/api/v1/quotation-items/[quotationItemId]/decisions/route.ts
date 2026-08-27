/**
 * POST /api/v1/quotation-items/{quotationItemId}/decisions
 * (Phase 1-20, P1-20-BE-008, BE-009, BE-012).
 *
 * Records the customer's approval or rejection of ONE quotation line.
 *
 * ## Why the item is the resource
 *
 * Because that is what the protected schema stores. `quo.record_item_decision`
 * takes a `quotation_item_id`, and `uq_approval_decisions_item` makes one decision
 * per `(tenant, company, branch, revision, item)` permanent. There is no
 * revision-level decision row anywhere in `quo`, so a `/quotation-revisions/{id}`
 * resource that *persisted* a decision would be a fiction. The revision-wide
 * command exists at `POST /quotation-revisions/{revisionId}/decisions` and is an
 * atomic orchestration over this same per-item function — not a second store.
 *
 * ## `presentedRevisionId` is required, and it is the point
 *
 * Without it, a client that fetched revision 2 and then had revision 3 issued
 * underneath it would approve revision 3 while believing it approved revision 2.
 * Approval of revision N must never approve revision N+1. The service compares the
 * presented id against the revision actually being decided and refuses a mismatch
 * with `ERR-CON-001`.
 *
 * ## Evidence
 *
 * `documentVersionId` is a `shared.document_versions` id — never a storage key, which
 * this surface cannot express at all. The shared attachment service confirms the
 * version is in the caller's scope, shares the quotation's company and branch, and
 * is actually linked to THIS quotation; without that last check any visible document
 * could be attached as evidence for any quotation. `referenceNote` is free text and
 * is never echoed into an event payload, an audit detail or a problem document.
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

const Params = z.object({ quotationItemId: schemas.uuid });

const Evidence = z
  .object({
    evidenceKind: z.enum(EVIDENCE_KINDS),
    documentVersionId: schemas.uuid.optional(),
    referenceNote: z.string().min(1).max(MAX_REFERENCE_NOTE).optional(),
  })
  .strict();

export const Body = z
  .object({
    // `rejected`, not `declined` — the real vocabulary from
    // `ck_approval_decisions_decision`.
    decision: z.enum(DECISIONS),
    channel: z.enum(DECISION_CHANNELS),
    decidingPartyRef: schemas.uuid.optional(),
    evidence: Evidence.optional(),
    presentedRevisionId: schemas.uuid,
  })
  .strict();

export const QUOTATION_ITEM_DECIDE_OPERATION = defineOperation({
  id: 'quo.quotation-item-decide',
  module: 'quotation',
  method: 'POST',
  path: '/quotation-items/{quotationItemId}/decisions',
  summary: "Record the customer's approval or rejection of one quotation line.",
  permissions: ['quo.decision.record'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'quo.quotation_item.decided',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ quotationItemId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    QUOTATION_ITEM_DECIDE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const decision = await quotationModule().decisions.decideItem(
        db,
        params.quotationItemId,
        {
          decision: parsed.decision,
          channel: parsed.channel,
          decidingPartyRef: parsed.decidingPartyRef,
          evidence: parsed.evidence,
          presentedRevisionId: parsed.presentedRevisionId,
        },
        authorizeScope
      );
      return { status: 201, body: decision };
    },
    { params: raw, body }
  );
}
