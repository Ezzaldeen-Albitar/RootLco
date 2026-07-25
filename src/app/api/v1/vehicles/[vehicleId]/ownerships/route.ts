/**
 * GET/POST /api/v1/vehicles/{vehicleId}/ownerships — ownership history and transfer
 * (Phase 1-17, P1-17-BE-007, P1-17-BE-016).
 *
 * GET returns the vehicle's ownership history, newest first, keyset-paginated.
 * POST transfers ownership: it resolves and locks the vehicle, closes the current
 * active ownership of the requested kind, and opens the new one in one controlled
 * transaction that also writes audit and the `vehicle.relationship.changed` event.
 * The frozen EXCLUDE constraints keep exactly one registered owner at a time;
 * history is append-only — an ownership is closed, never deleted.
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
import { MAX_TRANSFER_REASON, OWNERSHIP_KINDS, vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();
const Body = z
  .object({
    partnerId: schemas.uuid,
    ownershipKind: z.enum(OWNERSHIP_KINDS).optional(),
    effectiveDate: z.string().min(10).max(10).nullable().optional(),
    transferReason: z.string().min(1).max(MAX_TRANSFER_REASON).nullable().optional(),
  })
  .strict();

export const VEHICLE_OWNERSHIP_LIST_OPERATION = defineOperation({
  id: 'veh.vehicle-ownership-history',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicles/{vehicleId}/ownerships',
  summary: 'List a vehicle’s ownership history.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const VEHICLE_OWNERSHIP_TRANSFER_OPERATION = defineOperation({
  id: 'veh.vehicle-ownership-transfer',
  module: 'vehicle',
  method: 'POST',
  path: '/vehicles/{vehicleId}/ownerships',
  summary: 'Transfer a vehicle’s ownership, closing the prior owner.',
  permissions: ['veh.vehicle.relationship.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.ownership_changed',
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
    VEHICLE_OWNERSHIP_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(
        Query,
        searchParamsToObject(new URL(raw.url).searchParams),
        'query'
      );
      return {
        body: await vehicleModule().vehicleRegistration.listOwnerships(db, params.vehicleId, {
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
    VEHICLE_OWNERSHIP_TRANSFER_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await vehicleModule().vehicleRegistration.transferOwnership(
        db,
        params.vehicleId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
