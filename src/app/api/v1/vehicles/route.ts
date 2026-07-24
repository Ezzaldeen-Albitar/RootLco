/**
 * GET /api/v1/vehicles — bounded, privacy-safe vehicle search (Phase 1-17,
 * FR-VEH-001, NFR-PRV-001).
 *
 * Cursor-paginated, tenant-scoped, deterministically ordered by
 * `(created_at DESC, id DESC)`. The searchable surface is a closed allow-list — an
 * exact normalised VIN, an exact normalised active plate, an exact vehicle number,
 * and the lifecycle and powertrain discriminators — and the projection carries no
 * restricted identifier (chassis / engine number). Page size is clamped to the
 * platform `MAX_PAGE_SIZE`, so scraping is bounded by the same limit as every other
 * list.
 *
 * Everything cross-cutting (correlation, rate limit, authentication, context,
 * scoped session, authorization, problem-document errors, OpenAPI) lives in
 * `handleOperation`; the handler parses and calls one application service.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  MAX_PLATE_FRAGMENT,
  MAX_VIN_FRAGMENT,
  POWERTRAIN_CATEGORIES,
  VEHICLE_LIFECYCLE_STATUSES,
  vehicleModule,
} from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
    /** Matched as an exact normalised VIN; never a leading-wildcard scan. */
    vin: z.string().min(1).max(MAX_VIN_FRAGMENT).optional(),
    /** Matched against the vehicle's active plate, normalised on the SQL side. */
    plate: z.string().min(1).max(MAX_PLATE_FRAGMENT).optional(),
    /** Exact vehicle display number. */
    vehicleNumber: z.string().min(1).max(64).optional(),
    lifecycleStatus: z.enum(VEHICLE_LIFECYCLE_STATUSES).optional(),
    powertrainCategory: z.enum(POWERTRAIN_CATEGORIES).optional(),
  })
  .strict();

export const VEHICLE_SEARCH_OPERATION = defineOperation({
  id: 'veh.vehicle-search',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicles',
  summary: 'Search vehicles in the caller tenant by an allow-listed field set.',
  permissions: ['veh.vehicle.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(VEHICLE_SEARCH_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return {
      body: await vehicleModule().vehicleSearch.search(
        db,
        {
          vin: query.vin,
          plate: query.plate,
          vehicleNumber: query.vehicleNumber,
          lifecycleStatus: query.lifecycleStatus,
          powertrainCategory: query.powertrainCategory,
        },
        { cursor: query.cursor, limit: query.limit }
      ),
    };
  });
}
