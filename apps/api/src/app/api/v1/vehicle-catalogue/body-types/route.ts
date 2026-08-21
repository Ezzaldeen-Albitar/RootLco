/**
 * GET /api/v1/vehicle-catalogue/body-types (P1-17 remediation,
 * `P1-27-INT-007`).
 *
 * Same reasoning as `vehicle-catalogue/makes`: the vehicle create and update
 * bodies both accept a `bodyTypeId` uuid and nothing published the options.
 *
 * Tenant scoping is `sel_body_types_visible`'s —
 * `scope = 'platform' OR tenant_id = iam.current_tenant_id()` — so the handler
 * adds no tenant predicate.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const VEHICLE_BODY_TYPE_LIST_OPERATION = defineOperation({
  id: 'veh.catalogue-body-type-list',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicle-catalogue/body-types',
  summary: 'List the vehicle body types visible to the caller tenant.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    VEHICLE_BODY_TYPE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await vehicleModule().vehicleCatalogue.listBodyTypes(
        db,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    })
  );
}
