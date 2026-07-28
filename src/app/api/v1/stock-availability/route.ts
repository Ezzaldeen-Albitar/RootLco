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
 * ## Company and branch are REQUIRED, for authorization rather than convenience
 *
 * They were optional, and that was a cross-branch disclosure: `authorizeScope` ran
 * only when a filter was supplied, so omitting it skipped the check entirely and
 * left `tenant_id` plus RLS as the only narrowing. RLS cannot carry that weight —
 * `app.branch_ids` is the union of every active grant regardless of which
 * permission carries it (P1-18-A-01) — so a caller holding `inv.stock.read` in one
 * branch and any grant at all in another read the second branch's stock. Measured:
 * the same principal was refused with `branchId=A1` (403) and served A1 with the
 * parameter simply left out (200).
 *
 * Naming the pair makes it the `authorizationTarget`, so
 * `iam.has_permission_in_scope` decides against the branch actually read, and the
 * operation can honestly declare `scope: 'branch'`. `GET /work-orders` requires the
 * same pair for the same reason. A `locationId`, when given, is additionally
 * resolved to its own company and branch and checked against this pair, so it
 * cannot be used to reach past it.
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
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    itemId: schemas.uuid.optional(),
    locationId: schemas.uuid.optional(),
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
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    STOCK_AVAILABILITY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      // Parsed INSIDE the handler so a malformed query becomes the shared problem
      // document; parsing outside would let the AppFailure escape as a 500.
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().reads.readAvailability(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
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
    },
    // The pre-handler check runs before the schema, so it reads the pair out of the
    // raw query. `scopeTargetOption` yields NO target unless both are well-formed
    // UUIDs, so it can only make authorization stricter and a malformed pair falls
    // through to the 422 above.
    scopeTargetOption(raw)
  );
}
