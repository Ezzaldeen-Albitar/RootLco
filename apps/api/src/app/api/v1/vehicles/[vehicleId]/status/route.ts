/**
 * PATCH /api/v1/vehicles/{vehicleId}/status — lifecycle / workshop status change
 * (Phase 1-17, P1-17-BE-009).
 *
 * Moves a live vehicle along the approved lifecycle graph (draft → active →
 * inactive, with scrap as a terminal exit) and/or its coarse workshop axis, in one
 * controlled transaction. The change is validated against the current state (each
 * axis must actually move and must be an approved transition), applied to the
 * master, and audited; the frozen AFTER-UPDATE trigger writes the append-only
 * status-history row. `merged` is never a settable target — a vehicle is merged
 * only through the merge operation — and a merged vehicle is frozen (409).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { VEHICLE_LIFECYCLE_STATUSES, WORKSHOP_STATUSES, vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });
export const Body = z
  .object({
    lifecycleStatus: z.enum(VEHICLE_LIFECYCLE_STATUSES).optional(),
    workshopStatus: z.enum(WORKSHOP_STATUSES).optional(),
  })
  .strict();

export const VEHICLE_STATUS_CHANGE_OPERATION = defineOperation({
  id: 'veh.vehicle-status-change',
  module: 'vehicle',
  method: 'PATCH',
  path: '/vehicles/{vehicleId}/status',
  summary: 'Change a vehicle’s lifecycle and/or workshop status.',
  permissions: ['veh.vehicle.status.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.status_changed',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ vehicleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    VEHICLE_STATUS_CHANGE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 200,
      body: await vehicleModule().vehicleLifecycle.changeStatus(
        db,
        params.vehicleId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
