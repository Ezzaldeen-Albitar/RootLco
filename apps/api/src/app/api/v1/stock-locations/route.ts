/**
 * GET /api/v1/stock-locations (Phase 1-30 A2, seam S-16).
 *
 * One branch's stock locations, by code.
 *
 * ## Why a picker needs this
 *
 * The location is the SCOPE ANCHOR of every stock operation:
 * `inv.post_stock_movement` derives `company_id`/`branch_id` from it rather than
 * from anything the caller sends. Reserving, issuing, returning, adjusting and
 * recording damage all take a `locationId`, and until now no route returned one -
 * so every one of those operations required an id the product could not produce.
 * `readLocation` existed as an internal scope resolver with no list in front of it.
 *
 * ## Scope
 *
 * `companyId` and `branchId` are REQUIRED and are the `authorizationTarget`.
 * A branch-blind location list would be a directory of which branches exist and
 * how they are laid out, narrowed only by `app.branch_ids` - the permission-blind
 * union of every active grant (P1-18-A-01).
 *
 * ## Inactive locations are listed, not hidden
 *
 * Stock already sitting in a location that was later deactivated still has to be
 * findable; a picker that silently omitted it would strand that stock. `status`
 * is on every row and is offered as a filter, so a caller that wants only usable
 * locations asks for them.
 *
 * No amount and no quantity crosses here - a location is reference data.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { LOCATION_TYPES, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    locationType: z.enum(LOCATION_TYPES).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const STOCK_LOCATION_LIST_OPERATION = defineOperation({
  id: 'inv.stock-location-list',
  module: 'inventory',
  method: 'GET',
  path: '/stock-locations',
  summary: "List a branch's stock locations by code.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    STOCK_LOCATION_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().reads.listLocations(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.locationType === undefined ? {} : { locationType: query.locationType }),
            ...(query.status === undefined ? {} : { status: query.status }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    scopeTargetOption(raw)
  );
}
