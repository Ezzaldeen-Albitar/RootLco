/**
 * /api/v1/stock-availability — what a branch actually holds (P1-21-BE-003).
 *
 * Returns exactly the four concepts the protected schema stores: `onHand`,
 * `reserved`, `available` (the `GENERATED` column, never application arithmetic),
 * and the location's type. There is no `damagedQty` field, because damage is
 * represented as stock sitting in a `quarantine` location rather than as a flag —
 * so quarantine is excluded by default and `includeQuarantine` is the only way to
 * see it, which keeps "available" honest.
 *
 * ## Why the branch filter is authorized before it is used
 *
 * `branchId` and `locationId` are scope targets, not search terms. Without
 * `authorizeScope` the difference between an empty and a non-empty page would
 * itself disclose whether a branch exists and stocks an item — and RLS alone
 * cannot close that, because `app.branch_ids` is the union of every active grant
 * regardless of which permission carries it (P1-18-A-01). `locationId` is resolved
 * to its own company and branch first, so it cannot be used to sidestep the branch
 * check.
 *
 * The operation stays `scope: 'tenant'` for the same reason `/items` does: an
 * unfiltered availability read names no branch, and `requireScopedPermissions`
 * fails closed on an empty target, so `scope: 'branch'` would 403 every caller
 * including an unrestricted one. The service's own re-authorization against the
 * named branch is strictly stronger than the declaration would have been.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    itemId: schemas.uuid.optional(),
    locationId: schemas.uuid.optional(),
    branchId: schemas.uuid.optional(),
    includeQuarantine: z.enum(['true', 'false']).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const STOCK_AVAILABILITY_OPERATION = defineOperation({
  id: 'inv.stock-availability-read',
  module: 'inventory',
  method: 'GET',
  path: '/stock-availability',
  summary: 'Read on-hand, reserved, and available stock for an item, location, or branch.',
  permissions: ['inv.stock.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    STOCK_AVAILABILITY_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => {
      const url = new URL(raw.url);
      const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
      return {
        body: await inventoryModule().reads.readAvailability(
          db,
          {
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
            ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
            ...(query.includeQuarantine === undefined
              ? {}
              : { includeQuarantine: query.includeQuarantine === 'true' }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    }
  );
}
