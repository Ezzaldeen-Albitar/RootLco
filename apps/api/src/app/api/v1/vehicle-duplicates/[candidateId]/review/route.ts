/**
 * POST /api/v1/vehicle-duplicates/{candidateId}/review (Phase 1-17, FR-VEH-003,
 * P1-17-BE-004).
 *
 * Records a human decision on a candidate pair. The plan text writes this as
 * `{candidateId}:review`; it is a `/review` sub-resource because the phase's route
 * convention rules out colon-verb paths and a `:` is not a legal directory name on
 * Windows. The operation, permission, and semantics are exactly as specified.
 *
 * Only `dismissed` is recordable. `merged` is set by the merge operation — a
 * reviewer who could mark a pair merged without a merge happening would leave two
 * live duplicates the system believes were reconciled.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { DUPLICATE_DECISIONS, MAX_REASON, MIN_REASON, vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ candidateId: schemas.uuid });
export const Body = z
  .object({
    decision: z.enum(DUPLICATE_DECISIONS),
    reason: z.string().min(MIN_REASON).max(MAX_REASON),
  })
  .strict();

export const VEHICLE_DUPLICATE_REVIEW_OPERATION = defineOperation({
  id: 'veh.vehicle-duplicate-review',
  module: 'vehicle',
  method: 'POST',
  path: '/vehicle-duplicates/{candidateId}/review',
  summary: 'Record a review decision on a duplicate vehicle candidate.',
  permissions: ['veh.vehicle.duplicate.review'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.duplicate_reviewed',
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
    VEHICLE_DUPLICATE_REVIEW_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 200,
      body: await vehicleModule().vehicleIdentity.reviewCandidate(
        db,
        params.candidateId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
