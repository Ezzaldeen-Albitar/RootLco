/**
 * POST /api/v1/vehicles/{vehicleId}/authorized-parties/{relationshipId}/retirement
 * — retire an authorized party (Phase 1-17, P1-17-BE-009).
 *
 * Closes the open `authorized_person` interval by setting its end date; history is
 * append-only, so the authorization is retained, not deleted. Expressed as a
 * `/retirement` sub-resource because the phase's route convention rules out
 * colon-verb paths (unbuildable as Windows directories).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid, relationshipId: schemas.uuid });
const Body = z.object({ effectiveDate: z.string().min(10).max(10).nullable().optional() }).strict();

export const VEHICLE_AUTHORIZED_PARTY_RETIRE_OPERATION = defineOperation({
  id: 'veh.vehicle-authorized-party-retire',
  module: 'vehicle',
  method: 'POST',
  path: '/vehicles/{vehicleId}/authorized-parties/{relationshipId}/retirement',
  summary: 'Retire an authorized party by closing its authorization interval.',
  permissions: ['veh.vehicle.relationship.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.authorized_party_retired',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ vehicleId: string; relationshipId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    VEHICLE_AUTHORIZED_PARTY_RETIRE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 200,
      body: await vehicleModule().vehicleRelations.retireAuthorizedParty(
        db,
        params.vehicleId,
        params.relationshipId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
