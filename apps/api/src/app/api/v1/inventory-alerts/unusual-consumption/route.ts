/**
 * /api/v1/inventory-alerts/unusual-consumption — items being consumed far faster
 * than they have been.
 *
 * ## The rule, stated exactly
 *
 * An item is reported when the quantity ISSUED in the chosen period is
 *
 *   * at least `multiple` times the MEDIAN of the same item's issued quantity in
 *     the `baselinePeriods` immediately preceding windows of the same length, AND
 *   * at least `minimumQty` units in absolute terms.
 *
 * Every one of those numbers is a request parameter within published bounds, every
 * one is echoed in the response, and every compared window is listed on the finding
 * with the quantity issued in it. Nothing is weighted, nothing is smoothed, no
 * window is dropped, and no model of any kind is consulted: the decision is two
 * comparisons a reader can redo on paper from the response.
 *
 * The baseline is the MEDIAN and not the mean, because one busy fortnight would
 * otherwise raise the bar for the following month and hide the next spike. It is
 * `percentile_disc` — the lower of the two middle values on an even count — rather
 * than `percentile_cont`, because the continuous form averages two observations
 * into a quantity nobody issued and returns it as a float.
 *
 * ## When the baseline is zero
 *
 * Any quantity is at least `multiple` times zero, so the multiple stops deciding
 * and `minimumQty` is the whole of the test. That is the honest behaviour — an item
 * that was never issued and is suddenly issued in volume IS the case this read
 * exists for — and it is stated in the rule the response carries rather than left
 * for a reader to discover.
 *
 * Company and branch are required for the authorization reason
 * `GET /stock-availability` records. The bounds on the period parameters are also
 * what keeps the aggregate over `inv.stock_movements` finite.
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

/** A decimal string, never a JSON number — the bounds are checked as decimals. */
const DecimalString = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'must be a decimal string of at most 3 places');

const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    itemId: schemas.uuid.optional(),
    /** Length of the observed window and of every baseline window, in days. */
    periodDays: z.coerce.number().int().optional(),
    /** How many preceding windows the median is taken over. */
    baselinePeriods: z.coerce.number().int().optional(),
    /** How many times the median the observed quantity must reach. */
    multiple: DecimalString.optional(),
    /** The absolute floor, so a jump between two tiny quantities is not an alert. */
    minimumQty: DecimalString.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const UNUSUAL_CONSUMPTION_ALERT_OPERATION = defineOperation({
  id: 'inv.unusual-consumption-alert-read',
  module: 'inventory',
  method: 'GET',
  path: '/inventory-alerts/unusual-consumption',
  summary:
    'Read items whose issued quantity in a period far exceeds the median of their own preceding periods.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    UNUSUAL_CONSUMPTION_ALERT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().alerts.listUnusualConsumption(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.periodDays === undefined ? {} : { periodDays: query.periodDays }),
            ...(query.baselinePeriods === undefined
              ? {}
              : { baselinePeriods: query.baselinePeriods }),
            ...(query.multiple === undefined ? {} : { multiple: query.multiple }),
            ...(query.minimumQty === undefined ? {} : { minimumQty: query.minimumQty }),
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
