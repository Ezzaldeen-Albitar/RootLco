/**
 * GET /api/v1/vehicles/{vehicleId}/history — the vehicle attribute-change history
 * (Phase 1-17, P1-17-BE-011).
 *
 * A keyset page of the append-only `veh.vehicle_attribute_history` ledger, newest
 * change first: which master attribute changed, from what to what, when, and by
 * whom. Only internal master attributes are tracked — no restricted identifier can
 * appear (they are not master columns).
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

export const VEHICLE_HISTORY_OPERATION = defineOperation({
  id: 'veh.vehicle-history',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicles/{vehicleId}/history',
  summary: 'List a vehicle’s attribute-change history.',
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
    VEHICLE_HISTORY_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(
        Query,
        searchParamsToObject(new URL(raw.url).searchParams),
        'query'
      );
      return {
        body: await vehicleModule().vehicleHistory.listHistory(db, params.vehicleId, {
          cursor: query.cursor,
          limit: query.limit,
        }),
      };
    },
    { params }
  );
}
