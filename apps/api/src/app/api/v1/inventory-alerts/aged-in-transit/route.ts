/**
 * /api/v1/inventory-alerts/aged-in-transit — consignments that left and never
 * arrived.
 *
 * A transfer is reported when it was dispatched more than `minimumAgeDays` ago and
 * is still `dispatched` or only `partially_received`. The finding carries the age
 * in whole days, the quantity still in transit, both branches and both locations,
 * so the reader knows who to ask.
 *
 * ## The remaining quantity is the schema's own figure
 *
 * `inv.stock_transfers.outstanding_quantity` is GENERATED — dispatched less
 * received less resolved — so the quantity published here cannot disagree with the
 * quantity the transfer surface reports. Nothing is subtracted in TypeScript.
 *
 * ## Both ends are served
 *
 * The named branch is matched as the SOURCE or as the DESTINATION. A consignment
 * lost in transit is the receiving branch's problem as much as the sending one's,
 * and `sel_stock_transfers_destination` exists for exactly that reason, so a
 * destination-only predicate would have been a narrower answer than RLS allows.
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
    /** How old a dispatch must be before it is reported. Bounded by the service. */
    minimumAgeDays: z.coerce.number().int().optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const AGED_IN_TRANSIT_ALERT_OPERATION = defineOperation({
  id: 'inv.aged-in-transit-alert-read',
  module: 'inventory',
  method: 'GET',
  path: '/inventory-alerts/aged-in-transit',
  summary: 'Read transfers dispatched long ago that are still in transit or only partly received.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    AGED_IN_TRANSIT_ALERT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().alerts.listAgedInTransit(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.minimumAgeDays === undefined ? {} : { minimumAgeDays: query.minimumAgeDays }),
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
