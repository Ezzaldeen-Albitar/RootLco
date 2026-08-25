/**
 * DELETE /api/v1/technicians/{technicianProfileId}/availability/{availabilityId} (PRE-P1-29-BR-03).
 *
 * ## Why a withdraw path is not optional
 *
 * `ex_technician_availability_overlap` refuses any window overlapping a live one,
 * and it has no notion of "the wrong one". A window typed as 2026-09-01 →
 * 2027-09-01 instead of 2026-09-02 would therefore block that technician's entire
 * year, permanently, with no correction path. The BR-03 contract named eight
 * operations and not this; the constraint is the proof that it is required.
 *
 * ## Soft delete, and version-guarded
 *
 * `deleted_at` is set rather than the row removed: labor sessions and assignments
 * were decided against these windows, and cascading them away would rewrite the
 * record of why an assignment was legal at the time.
 *
 * The guard is present here where `skills/{skillId}` has none, and the difference
 * is the addressing rather than inconsistency: a window is addressed by its own id
 * and carries `recordVersion` in the detail read, so the caller HAS a version to
 * send. A skill is addressed by `(profile, skill)` and its aggregate view carries
 * none.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Params = z.object({
  technicianProfileId: schemas.uuid,
  availabilityId: schemas.uuid,
});

export const TECHNICIAN_AVAILABILITY_WITHDRAW_OPERATION = defineOperation({
  id: 'tech.technician-availability-withdraw',
  module: 'technician',
  method: 'DELETE',
  path: '/technicians/{technicianProfileId}/availability/{availabilityId}',
  summary: 'Withdraw one availability window, freeing the interval it holds.',
  permissions: ['tech.technician.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.availability_withdrawn',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function DELETE(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string; availabilityId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    TECHNICIAN_AVAILABILITY_WITHDRAW_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      return {
        body: await technicianModule().roster.withdrawAvailability(
          db,
          params.technicianProfileId,
          params.availabilityId,
          expectedVersion,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
