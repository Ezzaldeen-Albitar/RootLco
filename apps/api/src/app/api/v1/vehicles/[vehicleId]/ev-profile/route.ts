/**
 * GET/POST /api/v1/vehicles/{vehicleId}/ev-profile — the electric-drive profile
 * (Phase 1-17, P1-17-BE-008).
 *
 * GET returns the vehicle's single active EV profile. POST sets it (creating the
 * profile the first time, replacing it thereafter) inside one controlled
 * transaction that also writes audit. The profile is allowed only when the
 * vehicle's powertrain category matches the EV kind — pre-checked in the service
 * and enforced by the frozen `veh.guard_ev_profile_powertrain`. No battery-health
 * value is computed here; state-of-health is telemetry, not a derived field.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  EV_KINDS,
  MAX_CHARGE_PORT,
  MAX_USABLE_CAPACITY_KWH,
  vehicleModule,
} from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });
const Body = z
  .object({
    evKind: z.enum(EV_KINDS),
    usableCapacityKwh: z.number().min(0).max(MAX_USABLE_CAPACITY_KWH).nullable().optional(),
    chargePortType: z.string().min(1).max(MAX_CHARGE_PORT).nullable().optional(),
    highVoltageWarning: z.boolean().optional(),
  })
  .strict();

export const VEHICLE_EV_PROFILE_READ_OPERATION = defineOperation({
  id: 'veh.vehicle-ev-profile-read',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicles/{vehicleId}/ev-profile',
  summary: 'Read a vehicle’s electric-drive profile.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const VEHICLE_EV_PROFILE_SET_OPERATION = defineOperation({
  id: 'veh.vehicle-ev-profile-set',
  module: 'vehicle',
  method: 'POST',
  path: '/vehicles/{vehicleId}/ev-profile',
  summary: 'Set (create or replace) a vehicle’s electric-drive profile.',
  permissions: ['veh.vehicle.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.ev_profile_set',
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
    VEHICLE_EV_PROFILE_READ_OPERATION,
    request,
    async ({ db }) => ({
      body: await vehicleModule().vehicleLifecycle.getEvProfile(db, params.vehicleId),
    }),
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
    VEHICLE_EV_PROFILE_SET_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const result = await vehicleModule().vehicleLifecycle.setEvProfile(
        db,
        params.vehicleId,
        await parseJsonBody(raw, Body)
      );
      return { status: result.created ? 201 : 200, body: result };
    },
    { params, body }
  );
}
