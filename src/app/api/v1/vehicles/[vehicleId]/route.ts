/**
 * PATCH /api/v1/vehicles/{vehicleId} — edit the vehicle master (Phase 1-17,
 * FR-VEH-001, P1-17-BE-003).
 *
 * A partial edit of descriptive master fields: VIN, catalog references, model
 * year, powertrain category, colour, and display number. A field that is absent is
 * left untouched; a nullable field set to `null` is cleared. Lifecycle, workshop
 * status, and merge state are deliberately *not* editable here — each is its own
 * operation with its own permission, append-only history, and (where relevant)
 * event. A merged vehicle is frozen and the edit is refused with a 409.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  MAX_COLOR,
  MAX_DISPLAY_NUMBER,
  MAX_VIN_INPUT,
  MODEL_YEAR_MAX,
  MODEL_YEAR_MIN,
  POWERTRAIN_CATEGORIES,
  vehicleModule,
} from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });

const Body = z
  .object({
    vin: z.string().min(1).max(MAX_VIN_INPUT).nullable().optional(),
    makeId: schemas.uuid.nullable().optional(),
    modelId: schemas.uuid.nullable().optional(),
    trimId: schemas.uuid.nullable().optional(),
    bodyTypeId: schemas.uuid.nullable().optional(),
    powertrainTypeId: schemas.uuid.nullable().optional(),
    modelYear: z.number().int().min(MODEL_YEAR_MIN).max(MODEL_YEAR_MAX).nullable().optional(),
    powertrainCategory: z.enum(POWERTRAIN_CATEGORIES).optional(),
    color: z.string().min(1).max(MAX_COLOR).nullable().optional(),
    displayNumber: z.string().min(1).max(MAX_DISPLAY_NUMBER).nullable().optional(),
  })
  .strict();

export const VEHICLE_UPDATE_OPERATION = defineOperation({
  id: 'veh.vehicle-update',
  module: 'vehicle',
  method: 'PATCH',
  path: '/vehicles/{vehicleId}',
  summary: 'Edit descriptive fields of a vehicle master.',
  permissions: ['veh.vehicle.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.updated',
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
    VEHICLE_UPDATE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 200,
      body: await vehicleModule().vehicleWrite.update(
        db,
        params.vehicleId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
