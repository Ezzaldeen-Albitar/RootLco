/**
 * GET/POST /api/v1/vehicles/{vehicleId}/odometer-readings — odometer entry, anomaly
 * handling, and history (Phase 1-17, P1-17-BE-010, P1-17-BE-011).
 *
 * POST records a reading. A normal reading (reception / delivery / manual) that
 * would fall below the current effective odometer is refused with a structured
 * `below_current_odometer` anomaly; a correction (with a reason) records the
 * disposition and may lower the value. Readings are append-only — never updated or
 * deleted. GET returns the history, newest observed first, keyset-paginated.
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
import {
  MAX_ODOMETER_VALUE,
  ODOMETER_ANOMALY_REASONS,
  ODOMETER_CAPTURE_METHODS,
  ODOMETER_UNITS,
  vehicleModule,
} from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();
export const Body = z
  .object({
    value: z.number().min(0).max(MAX_ODOMETER_VALUE),
    unit: z.enum(ODOMETER_UNITS),
    observedAt: z.string().min(16).max(40),
    captureMethod: z.enum(ODOMETER_CAPTURE_METHODS).optional(),
    correctionOf: schemas.uuid.nullable().optional(),
    correctionReason: z.enum(ODOMETER_ANOMALY_REASONS).nullable().optional(),
  })
  .strict();

export const VEHICLE_ODOMETER_LIST_OPERATION = defineOperation({
  id: 'veh.vehicle-odometer-history',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicles/{vehicleId}/odometer-readings',
  summary: 'List a vehicle’s odometer readings.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const VEHICLE_ODOMETER_RECORD_OPERATION = defineOperation({
  id: 'veh.vehicle-odometer-record',
  successStatus: 201,
  module: 'vehicle',
  method: 'POST',
  path: '/vehicles/{vehicleId}/odometer-readings',
  summary: 'Record an odometer reading or a correction for a vehicle.',
  permissions: ['veh.vehicle.odometer.record'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.odometer_recorded',
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
    VEHICLE_ODOMETER_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(
        Query,
        searchParamsToObject(new URL(raw.url).searchParams),
        'query'
      );
      return {
        body: await vehicleModule().vehicleOdometer.listReadings(db, params.vehicleId, {
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
    VEHICLE_ODOMETER_RECORD_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await vehicleModule().vehicleOdometer.recordReading(
        db,
        params.vehicleId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
