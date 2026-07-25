/**
 * GET /api/v1/vehicles/{vehicleId}/relationships — vehicle-centric read of the
 * single source of truth (Phase 1-17, P1-17-BE-008).
 *
 * Lists every relationship the tenant holds for this vehicle — owner, driver,
 * authorized party, and the rest — newest first, keyset-paginated. It reads the
 * same `veh.vehicle_relationships` table CRM writes its customer→vehicle links to;
 * the vehicle module never writes a plain link, only reads it here and writes
 * authorized parties through the dedicated operation.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const VEHICLE_RELATIONSHIP_LIST_OPERATION = defineOperation({
  id: 'veh.vehicle-relationship-list',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicles/{vehicleId}/relationships',
  summary: 'List a vehicle’s customer relationships.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ vehicleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    VEHICLE_RELATIONSHIP_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(
        Query,
        searchParamsToObject(new URL(raw.url).searchParams),
        'query'
      );
      return {
        body: await vehicleModule().vehicleRelations.listRelationships(db, params.vehicleId, {
          cursor: query.cursor,
          limit: query.limit,
        }),
      };
    },
    { params }
  );
}
