/**
 * /api/v1/stock-transfers/{transferId}/discrepancy-resolution — settle units of a
 * transfer that did not arrive (P1-32-PRE-130).
 *
 * After a short receipt the remainder is still in transit. It leaves only by an act
 * with a reason:
 *
 *  - `return_to_origin` moves it out of transit and back into the origin at once;
 *  - `write_off` is born PENDING and moves nothing until a person other than the
 *    requester approves it on `POST /stock-transfer-settlements/{settlementId}/decision`.
 *    It claims its quantity at once, so the same units cannot also be received or
 *    returned while the decision is outstanding.
 *
 * Damaged units that did arrive are not a discrepancy: they are received, then
 * quarantined through `POST /damaged-stock`.
 *
 * ## Duplicate frames
 *
 * `idempotent: true`, and the key is carried into
 * `uq_stock_transfer_settlements_idempotency`, so a retry replays the first
 * settlement instead of returning the same units twice.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  MAX_REASON,
  QUANTITY_MAX,
  TRANSFER_DISCREPANCY_KINDS,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ transferId: schemas.uuid }).strict();

export const DiscrepancyBody = z
  .object({
    kind: z.enum(TRANSFER_DISCREPANCY_KINDS),
    quantity: z
      .string()
      .regex(
        /^\d{1,9}(\.\d{1,3})?$/,
        `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
      ),
    reason: z.string().trim().min(1).max(MAX_REASON),
  })
  .strict();

export const STOCK_TRANSFER_DISCREPANCY_RESOLVE_OPERATION = defineOperation({
  id: 'inv.stock-transfer-discrepancy-resolve',
  module: 'inventory',
  method: 'POST',
  path: '/stock-transfers/{transferId}/discrepancy-resolution',
  summary: 'Return undelivered transfer units to the origin, or put them forward for write-off.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_transfer.discrepancy_resolved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ transferId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STOCK_TRANSFER_DISCREPANCY_RESOLVE_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const { transferId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(DiscrepancyBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const settled = await inventoryModule().transfers.resolveDiscrepancy(
        db,
        transferId,
        {
          kind: parsed.kind,
          quantity: parsed.quantity,
          reason: parsed.reason,
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return {
        status: settled.replayed ? 200 : 201,
        body: settled,
        recordVersion: settled.recordVersion,
      };
    },
    { params: raw, body }
  );
}
