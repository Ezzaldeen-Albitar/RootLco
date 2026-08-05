/**
 * GET /api/v1/vehicle-catalogue/models/{modelId}/trims (P1-17 remediation,
 * `P1-27-INT-007`).
 *
 * Nested under the model for the same reason models are nested under makes:
 * `uq_trims_platform_code` is unique on `(model_id, code)`, so a trim code is
 * only meaningful relative to its model.
 *
 * An unknown or invisible model returns an empty page, not a 404.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ modelId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const VEHICLE_TRIM_LIST_OPERATION = defineOperation({
  id: 'veh.catalogue-trim-list',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicle-catalogue/models/{modelId}/trims',
  summary: 'List the trims of one vehicle model.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ modelId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    VEHICLE_TRIM_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await vehicleModule().vehicleCatalogue.listTrims(
        db,
        params.modelId,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    }),
    { params }
  );
}
