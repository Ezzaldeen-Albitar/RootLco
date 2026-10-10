/**
 * /api/v1/stock-transfers/{transferId}/receipt — receive what arrived of a transfer
 * (P1-32-PRE-041, P1-32-PRE-130).
 *
 * Moves the transfer's quantity out of transit and into its destination through
 * `inv.receive_transfer`, which locks the transfer row before reading its status —
 * so two concurrent receipts of one transfer produce exactly one winner, and the
 * second is refused with `ERR-TRN-001` rather than posting stock twice.
 *
 * ## The quantity is what arrived
 *
 * `quantity` is what the receiver counted, up to what is still in transit. The
 * whole dispatched quantity settles the transfer in one step; less leaves it
 * `partially_received`, with the remainder still in transit until a further
 * receipt, or `POST /stock-transfers/{transferId}/discrepancy-resolution` returns
 * it to the origin or puts it forward for write-off. Nothing that did not arrive
 * enters the destination's stock.
 *
 * ## Authority at both ends
 *
 * The settlement posts an `out` leg in the source branch's transit location and an
 * `in` leg at the destination, and both are branch-scoped, so the caller is
 * authorized in both branches — one check when the transfer stays in one branch.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { QUANTITY_MAX, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ transferId: schemas.uuid }).strict();

export const ReceiptBody = z
  .object({
    quantity: z
      .string()
      .regex(
        /^\d{1,9}(\.\d{1,3})?$/,
        `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
      ),
  })
  .strict();

export const STOCK_TRANSFER_RECEIVE_OPERATION = defineOperation({
  id: 'inv.stock-transfer-receive',
  module: 'inventory',
  method: 'POST',
  path: '/stock-transfers/{transferId}/receipt',
  summary: 'Receive what arrived of a stock transfer at its destination, in full or in part.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_transfer.received',
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
    STOCK_TRANSFER_RECEIVE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { transferId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(ReceiptBody, body, 'body');
      const received = await inventoryModule().transfers.receive(
        db,
        transferId,
        { quantity: parsed.quantity },
        authorizeScope
      );
      return { body: received, recordVersion: received.recordVersion };
    },
    { params: raw, body }
  );
}
