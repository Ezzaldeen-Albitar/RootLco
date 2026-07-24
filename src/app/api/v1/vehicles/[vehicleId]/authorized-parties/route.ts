/**
 * POST /api/v1/vehicles/{vehicleId}/authorized-parties — add an authorized party
 * (Phase 1-17, P1-17-BE-009).
 *
 * Creates an `authorized_person` relationship carrying a bounded
 * `authorization_scope` (a duplicate-free subset of the approved actions) and the
 * id of who granted it. An authorized party is never the legal owner; the overlap
 * EXCLUDE keeps a customer from being authorized twice for the same vehicle at
 * once. The scope can only grant the six approved actions — nothing escalates.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AUTHORIZED_ACTIONS, vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });
const Body = z
  .object({
    partnerId: schemas.uuid,
    allowedActions: z.array(z.enum(AUTHORIZED_ACTIONS)).min(1).max(AUTHORIZED_ACTIONS.length),
    effectiveDate: z.string().min(10).max(10).nullable().optional(),
  })
  .strict();

export const VEHICLE_AUTHORIZED_PARTY_ADD_OPERATION = defineOperation({
  id: 'veh.vehicle-authorized-party-add',
  module: 'vehicle',
  method: 'POST',
  path: '/vehicles/{vehicleId}/authorized-parties',
  summary: 'Authorize a customer as a scoped authorized party for a vehicle.',
  permissions: ['veh.vehicle.relationship.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.authorized_party_added',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ vehicleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    VEHICLE_AUTHORIZED_PARTY_ADD_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await vehicleModule().vehicleRelations.addAuthorizedParty(
        db,
        params.vehicleId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
