/**
 * /api/v1/inventory-alerts/low-stock — what the branch is running out of.
 *
 * An item is low when its available quantity — on hand less reserved, the balance
 * row's own GENERATED column — is at or below the reorder level configured for it.
 * The response carries the level, the on-hand, the reserved, the available, the
 * shortfall and the preferred order quantity, plus the rule in words and the
 * instant the database answered, so a reader can check the arithmetic rather than
 * take the finding on trust.
 *
 * ## An item with no configured level is never low
 *
 * The query starts from `inv.item_reorder_levels`, so "low" is only a fact once
 * somebody has said what low means for that item. There is no fallback threshold,
 * no percentage of anything, and no inference from past consumption — those would
 * all be the platform inventing a number nobody agreed to.
 *
 * ## Company and branch are REQUIRED, for authorization rather than convenience
 *
 * Exactly as `GET /stock-availability` records: `app.branch_ids` is the union of
 * every active grant regardless of which permission carries it (P1-18-A-01), so
 * omitting the pair would leave RLS — which narrows on that permission-blind union
 * — as the only barrier. Naming the pair makes it the `authorizationTarget`, so
 * `iam.has_permission_in_scope` decides against the branch actually read.
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
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const LOW_STOCK_ALERT_OPERATION = defineOperation({
  id: 'inv.low-stock-alert-read',
  module: 'inventory',
  method: 'GET',
  path: '/inventory-alerts/low-stock',
  summary: 'Read the items whose available stock is at or below their configured reorder level.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    LOW_STOCK_ALERT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().alerts.listLowStock(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
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
