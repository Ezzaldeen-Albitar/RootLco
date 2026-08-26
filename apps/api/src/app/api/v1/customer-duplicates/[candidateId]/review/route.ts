/**
 * POST /api/v1/customer-duplicates/{candidateId}/review (Phase 1-16,
 * FR-CRM-003, P1-16-BE-014).
 *
 * Records a human decision on a candidate pair.
 *
 * ## Route shape
 *
 * The plan text writes this as `{candidateId}:review`. It is expressed here as
 * a `/review` sub-resource for two reasons: the phase's own route convention
 * rules out colon-verb paths, and a path segment containing `:` cannot be
 * represented as a directory on Windows, where this repository is developed —
 * so the colon form is not merely discouraged, it is unbuildable. The operation,
 * permission, and semantics are exactly as specified; only the separator differs.
 *
 * ## Only `dismissed` is recordable
 *
 * `merged` is set by the merge operation. A reviewer who could mark a pair
 * merged without a merge happening would leave two live duplicates that the
 * system believes were reconciled.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, DUPLICATE_DECISIONS, MAX_REASON, MIN_REASON } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ candidateId: schemas.uuid });
export const Body = z
  .object({
    decision: z.enum(DUPLICATE_DECISIONS),
    reason: z.string().min(MIN_REASON).max(MAX_REASON),
  })
  .strict();

export const DUPLICATE_REVIEW_OPERATION = defineOperation({
  id: 'crm.duplicate-review',
  module: 'crm',
  method: 'POST',
  path: '/customer-duplicates/{candidateId}/review',
  summary: 'Record a review decision on a duplicate candidate.',
  permissions: ['crm.customer.duplicate.review'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.duplicate_reviewed',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ candidateId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DUPLICATE_REVIEW_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 200,
      body: await crmModule().customerIdentity.reviewCandidate(
        db,
        params.candidateId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
