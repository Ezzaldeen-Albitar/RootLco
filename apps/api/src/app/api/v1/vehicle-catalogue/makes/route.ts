/**
 * GET /api/v1/vehicle-catalogue/makes (P1-17 remediation, `P1-27-INT-007`).
 *
 * `veh.makes` had no read operation. `POST /vehicles` and `PATCH /vehicles/{id}`
 * both accept a `makeId` uuid and nothing published the makes, so a creation form
 * could not offer one and a vehicle could only ever be created with `make_id`
 * left null.
 *
 * Tenant scoping is RLS's: `sel_makes_visible` is
 * `scope = 'platform' OR tenant_id = iam.current_tenant_id()`, so a caller sees
 * the platform catalogue plus their tenant's own additions. The handler adds no
 * tenant predicate — one here would hide every platform row.
 *
 * `veh.vehicle.read`, because a catalogue is only useful to somebody who may see
 * vehicles, and it carries no personal data of any kind.
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

export const VEHICLE_MAKE_LIST_OPERATION = defineOperation({
  id: 'veh.catalogue-make-list',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicle-catalogue/makes',
  summary: 'List the vehicle makes visible to the caller tenant.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  // `low-risk-metadata` (600/min, keyed per tenant), not `expensive-read`
  // (30/min, per user). A catalogue is a cheap reference read that a picker
  // opens constantly and that carries no personal data at all. Under
  // `expensive-read` an operator filling in one vehicle — make, then models,
  // then trims — would exhaust a third of their minute's budget on the form.
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(VEHICLE_MAKE_LIST_OPERATION, request, async ({ db, request: raw }) => ({
    body: await vehicleModule().vehicleCatalogue.listMakes(
      db,
      parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
    ),
  }));
}
