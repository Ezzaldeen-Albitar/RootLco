/**
 * POST /api/v1/inspections/{inspectionId}/reviews (Phase 1-19, P1-19-BE-012).
 *
 * Records a review of a COMPLETED diagnostic report.
 *
 * ## Attribution cannot be forged; separation is this layer's rule
 *
 * `dia.stamp_review()` overwrites `reviewer_id` with `iam.current_user_id()` and
 * `reviewed_at` with `now()` on EVERY insert, and raises when the session carries no
 * actor. So a review can never name someone else, and neither field is accepted from
 * the request — sending them would be sending values the database discards, which
 * reads as though the caller chose them.
 *
 * What the schema does NOT do is stop the report's own author being that actor.
 * `dia.diagnostic_reviews` has no constraint referencing
 * `dia.diagnostic_reports.created_by`, and that column is the only authorship the
 * schema records at report level. Separation is therefore enforced here, and its
 * limits are written down rather than glossed: it compares the report's CREATOR, so a
 * reviewer who recorded some of the entries but did not create the report is not
 * caught — the schema records no per-entry authorship a review could be checked
 * against.
 *
 * ## Only a completed report may be reviewed
 *
 * Also this layer's rule: `dia.diagnostic_reviews` references the report and never
 * reads its status, so a draft could be signed off and then changed underneath the
 * signature.
 *
 * The table is append-only (SELECT + INSERT only), so the rows ARE the review history
 * and a second review does not replace the first. `needs_rework` is in the vocabulary
 * precisely so a reviewer can send a report back without erasing what they read.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REVIEW_NOTES, REVIEW_RESULTS, diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });

export const Body = z
  .object({
    reviewResult: z.enum(REVIEW_RESULTS),
    notes: z.string().trim().min(1).max(MAX_REVIEW_NOTES).optional(),
  })
  .strict();

export const DIAGNOSTIC_REVIEW_OPERATION = defineOperation({
  id: 'dia.diagnostic-review',
  module: 'diagnostics',
  method: 'POST',
  path: '/inspections/{inspectionId}/reviews',
  summary: 'Review a completed diagnostic report.',
  // High-risk in the seeded catalog, and separate from `dia.diagnostic.complete`:
  // finishing a report and independently checking it are different authorities, which
  // is the whole point of a review.
  permissions: ['dia.diagnostic.review'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'dia.diagnostic.reviewed',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ inspectionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DIAGNOSTIC_REVIEW_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const review = await diagnosticsModule().reports.review(
        db,
        params.inspectionId,
        { reviewResult: parsed.reviewResult, notes: parsed.notes },
        authorizeScope
      );
      return { status: 201, body: review };
    },
    { params: raw, body }
  );
}
