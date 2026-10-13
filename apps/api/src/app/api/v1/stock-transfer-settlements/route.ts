/**
 * /api/v1/stock-transfer-settlements — list a branch's transfer discrepancy
 * settlements (P1-32-PRE-141).
 *
 * A write-off of units that did not arrive waits for a second person, and
 * `POST /stock-transfer-settlements/{settlementId}/decision` names the settlement.
 * Until this list existed nothing published that id to anyone but the requester, so
 * the person who must decide could not reach the request. It lists returns to the
 * origin and write-offs — never a receipt, which is visible on the transfer and is
 * not decided — for the branch that sent the transfer and for its destination,
 * exactly the two readers `inv.stock_transfers` admits.
 *
 * `status` narrows by decision: `pending` and `rejected` write-offs, or `approved`
 * ones. A return to the origin posts at once, is never decided, and matches none of
 * the three.
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
import { TRANSFER_DISCREPANCY_KINDS, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `companyId` and `branchId` are REQUIRED and are the `authorizationTarget`, for the
 * reason `inv.stock-movement-list` records.
 */
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    kind: z.enum(TRANSFER_DISCREPANCY_KINDS).optional(),
    transferId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const STOCK_TRANSFER_SETTLEMENT_LIST_OPERATION = defineOperation({
  id: 'inv.stock-transfer-settlement-list',
  module: 'inventory',
  method: 'GET',
  path: '/stock-transfer-settlements',
  summary:
    "List a branch's transfer returns to origin and write-offs, sent or inbound, newest first.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    STOCK_TRANSFER_SETTLEMENT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().transfers.listSettlements(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.status === undefined ? {} : { decision: query.status }),
            ...(query.kind === undefined ? {} : { kind: query.kind }),
            ...(query.transferId === undefined ? {} : { transferId: query.transferId }),
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
