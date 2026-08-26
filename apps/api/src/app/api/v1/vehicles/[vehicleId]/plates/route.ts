/**
 * GET/POST /api/v1/vehicles/{vehicleId}/plates — plate history and assignment
 * (Phase 1-17, P1-17-BE-006).
 *
 * GET returns the vehicle's plate history, newest first, keyset-paginated. POST
 * assigns a new active plate, closing the current one in one transaction; the
 * frozen temporal EXCLUDE constraints prevent two vehicles holding the same active
 * plate and prevent a plate overlapping this vehicle's own history (surfaced as a
 * stable 409). History is append-only — a plate is closed, never deleted.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import { MAX_PLATE_RAW, vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();
export const Body = z
  .object({
    countryCode: z.string().min(2).max(3),
    plateRaw: z.string().min(1).max(MAX_PLATE_RAW),
    effectiveDate: z.string().min(10).max(10).nullable().optional(),
  })
  .strict();

export const VEHICLE_PLATE_LIST_OPERATION = defineOperation({
  id: 'veh.vehicle-plate-history',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicles/{vehicleId}/plates',
  summary: 'List a vehicle’s plate history.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const VEHICLE_PLATE_ASSIGN_OPERATION = defineOperation({
  id: 'veh.vehicle-plate-assign',
  module: 'vehicle',
  method: 'POST',
  path: '/vehicles/{vehicleId}/plates',
  summary: 'Assign a new active plate to a vehicle, closing the current one.',
  permissions: ['veh.vehicle.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.plate_assigned',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ vehicleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    VEHICLE_PLATE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(
        Query,
        searchParamsToObject(new URL(raw.url).searchParams),
        'query'
      );
      return {
        body: await vehicleModule().vehicleRegistration.listPlates(db, params.vehicleId, {
          cursor: query.cursor,
          limit: query.limit,
        }),
      };
    },
    { params }
  );
}

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
    VEHICLE_PLATE_ASSIGN_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await vehicleModule().vehicleRegistration.assignPlate(
        db,
        params.vehicleId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
