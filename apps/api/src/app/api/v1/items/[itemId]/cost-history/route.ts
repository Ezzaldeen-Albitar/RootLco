/**
 * /api/v1/items/{itemId}/cost-history — one item's cost layers in a branch, and the
 * reference costs derived from them (P1-32-PRE-045).
 *
 * The ONLY read in the inventory module that returns a cost figure, and it is gated
 * twice: the operation declares `inv.cost.view`, and every row of
 * `inv.item_cost_layers` is behind an RLS policy that requires it again. A caller who
 * somehow reached the query without the permission would read an empty history from
 * the database, not a leaked one.
 *
 * ## Derived, never stored
 *
 * `latestUnitCost` is the most recent layer's figure; `weightedAverageCost` is
 * Σ(quantity × unit cost) / Σ quantity over every layer, computed in SQL `numeric`
 * and returned as a decimal string. Neither is a column. A new receipt appends a
 * layer and both figures move, and there is no stored value it could overwrite —
 * which is what "cost history is never rewritten" means in practice. When the layers
 * span more than one currency the average is `null` and `mixedCurrencies` is true,
 * because an average across currencies is not a cost.
 *
 * `companyId` and `branchId` are REQUIRED and are the `authorizationTarget`: cost is
 * recorded per branch, and a tenant-wide figure would average prices paid by
 * branches the caller may not see.
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

const Params = z.object({ itemId: schemas.uuid }).strict();

const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const ITEM_COST_HISTORY_OPERATION = defineOperation({
  id: 'inv.item-cost-history-read',
  module: 'inventory',
  method: 'GET',
  path: '/items/{itemId}/cost-history',
  summary: "Read an item's append-only cost history in a branch and its derived costs.",
  permissions: ['inv.cost.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ itemId: string }> }
): Promise<Response> {
  const params = await route.params;
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    ITEM_COST_HISTORY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { itemId } = parseOrFail(Params, params, 'path');
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().receipts.costHistory(
          db,
          itemId,
          { companyId: query.companyId, branchId: query.branchId },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    { params, ...scopeTargetOption(raw) }
  );
}
