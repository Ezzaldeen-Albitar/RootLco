/**
 * GET /api/v1/vehicle-catalogue/powertrain-types (P1-17 remediation,
 * `P1-27-INT-007`).
 *
 * Not to be confused with `powertrainCategory`, which is a five-value **enum**
 * on the vehicle itself (`ice`, `ev`, `hybrid`, `phev`, `other`) and needs no
 * lookup. `powertrainTypeId` references `veh.powertrain_types`, a catalogue
 * relation with tenant-extensible rows — a specific engine or drivetrain type
 * rather than a broad category. A form that offered the enum where the uuid
 * belongs would send a value the FK rejects.
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

export const VEHICLE_POWERTRAIN_TYPE_LIST_OPERATION = defineOperation({
  id: 'veh.catalogue-powertrain-type-list',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicle-catalogue/powertrain-types',
  summary: 'List the vehicle powertrain types visible to the caller tenant.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    VEHICLE_POWERTRAIN_TYPE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await vehicleModule().vehicleCatalogue.listPowertrainTypes(
        db,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    })
  );
}
