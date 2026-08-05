/**
 * GET /api/v1/vehicle-catalogue/makes/{makeId}/models (P1-17 remediation,
 * `P1-27-INT-007`).
 *
 * Nested under the make because a model only means anything relative to one:
 * `uq_models_platform_code` is unique on `(make_id, code)`, so two makes may
 * legitimately both have a model coded `CAMRY`. A flat `/models` list would need
 * a `makeId` filter to be usable at all, and would invite being called without
 * one.
 *
 * An unknown or invisible make returns an **empty page**, not a 404 — the same
 * answer a real make with no models gives. Distinguishing the two would make
 * this an existence oracle for another tenant's catalogue additions.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ makeId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const VEHICLE_MODEL_LIST_OPERATION = defineOperation({
  id: 'veh.catalogue-model-list',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicle-catalogue/makes/{makeId}/models',
  summary: 'List the models of one vehicle make.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ makeId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    VEHICLE_MODEL_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await vehicleModule().vehicleCatalogue.listModels(
        db,
        params.makeId,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    }),
    { params }
  );
}
