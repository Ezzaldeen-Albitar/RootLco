/**
 * POST /api/v1/customers/{customerId}/vehicles (Phase 1-16, FR-VEH-003,
 * P1-16-BE-018).
 *
 * Links a customer to an existing vehicle in a role. This route creates **no**
 * vehicle schema and no vehicle: `veh.vehicles` is the vehicle module's, and
 * this operation only records a relationship between two records that already
 * exist. Both sides are resolved under the caller's tenant first, so a
 * relationship can never span two tenants.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, VEHICLE_RELATIONSHIP_ROLES } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    vehicleId: schemas.uuid,
    relationshipRole: z.enum(VEHICLE_RELATIONSHIP_ROLES),
  })
  .strict();

export const VEHICLE_LINK_OPERATION = defineOperation({
  id: 'crm.vehicle-link',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/vehicles',
  summary: 'Link a customer to a vehicle in a relationship role.',
  permissions: ['crm.customer.vehicle.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.vehicle_linked',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    VEHICLE_LINK_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await crmModule().customerIdentity.linkVehicle(
        db,
        params.customerId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
