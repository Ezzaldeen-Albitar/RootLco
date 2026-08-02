/**
 * /api/v1/opening-inventory-batches/{batchId}/approval — approve an opening count
 * (P1-21-BE-002).
 *
 * This is the **only** operation in the platform that creates stock from nothing.
 * `inv.approve_opening_batch` flips the batch to `approved` and posts one
 * `opening`/`in` movement per counted line, each bound by
 * `inv.guard_stock_movement_provenance` to that line's own quantity, item, and
 * location — so the movements cannot say anything the count did not.
 *
 * ## Why it needs a different permission from the count
 *
 * `inv.adjustment.approve` (high risk), not `inv.stock.operate`. Counting and
 * approving a count are separate authorities, and
 * `ck_opening_inventory_batches_maker_checker` enforces in the database that the
 * approver is not the counter. A single permission covering both would make the
 * maker-checker rule depend on who happened to call which endpoint.
 *
 * ## Why an empty batch is refused
 *
 * Approving a batch with no lines would record an approval that attests to no
 * count. That is worse than an error, because it looks like evidence — so the
 * service refuses it before the function is called.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ batchId: schemas.uuid }).strict();

export const OPENING_BATCH_APPROVE_OPERATION = defineOperation({
  id: 'inv.opening-batch-approve',
  module: 'inventory',
  method: 'POST',
  path: '/opening-inventory-batches/{batchId}/approval',
  summary: 'Approve an opening-inventory batch, posting one opening movement per counted line.',
  permissions: ['inv.adjustment.approve'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'inv.opening_batch.approved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    OPENING_BATCH_APPROVE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { batchId } = parseOrFail(Params, raw, 'path');
      const approved = await inventoryModule().intake.approveBatch(db, batchId, authorizeScope);
      return { body: approved, recordVersion: approved.recordVersion };
    },
    { params: raw }
  );
}
