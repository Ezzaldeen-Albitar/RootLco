/**
 * GET /api/v1/vehicle-duplicates — the vehicle duplicate-candidate review queue
 * (P1-17 remediation, `P1-27-INT-005`).
 *
 * The mirror of `customer-duplicates`, and missing for the same reason: the
 * review POST and the scan POST both existed, and nothing listed the queue — so
 * a review screen could only see candidates by re-running a privileged scan that
 * emits an audit record.
 *
 * `matchBasis` travels with every row. It is safe by schema, not by review:
 * `veh.valid_match_basis` admits only `basis`, `classification`, `weight` and
 * `evidence`, restricts `basis` to a closed vocabulary, refuses to let a
 * vin/plate/identifier collision be classified below `restricted`, and runs
 * `veh.jsonb_no_raw_values` over any evidence object. A reviewer learns that two
 * vehicles collided on their VIN without either VIN being disclosed — which is
 * exactly what judging the pair requires and no more.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { DUPLICATE_STATUSES, vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    status: z.enum(DUPLICATE_STATUSES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const VEHICLE_DUPLICATE_LIST_OPERATION = defineOperation({
  id: 'veh.vehicle-duplicate-list',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicle-duplicates',
  summary: 'List duplicate vehicle candidates, newest detection first.',
  permissions: ['veh.vehicle.duplicate.review'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    VEHICLE_DUPLICATE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await vehicleModule().vehicleIdentity.listCandidates(
        db,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    })
  );
}
