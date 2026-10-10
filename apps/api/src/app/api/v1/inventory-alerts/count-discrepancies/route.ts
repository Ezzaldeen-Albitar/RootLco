/**
 * /api/v1/inventory-alerts/count-discrepancies — where the shelf and the ledger
 * disagreed.
 *
 * One row per reconciled stock-count line whose variance is not zero, with the
 * variance quantity, the three figures it is generated from, the date the count
 * was reconciled, and the approval state of the adjustment the variance raised.
 *
 * ## Reconciled counts only
 *
 * An open count's lines are a tally in progress: `variance_qty` on one is the
 * difference between a snapshot and a half-finished walk down the aisle, and
 * publishing it as a discrepancy would raise an alarm about work that has not
 * finished. The variance itself is the stored GENERATED column, so the figure here
 * is the same one the adjustment was raised from and cannot drift from it.
 *
 * ## The adjustment's state travels with the finding
 *
 * A variance whose adjustment is still `pending` is an open question; one that was
 * `approved` has already moved the ledger; one that was `rejected` was judged not
 * to be real. Without that field the three are indistinguishable, and a reader
 * would chase a discrepancy somebody else has already settled.
 *
 * Company and branch are required for the authorization reason
 * `GET /stock-availability` records.
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
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const COUNT_DISCREPANCY_ALERT_OPERATION = defineOperation({
  id: 'inv.count-discrepancy-alert-read',
  module: 'inventory',
  method: 'GET',
  path: '/inventory-alerts/count-discrepancies',
  summary: 'Read reconciled stock-count lines carrying a variance, with their adjustment state.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    COUNT_DISCREPANCY_ALERT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().alerts.listCountDiscrepancies(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
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
