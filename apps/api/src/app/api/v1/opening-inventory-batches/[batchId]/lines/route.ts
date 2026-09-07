/**
 * /api/v1/opening-inventory-batches/{batchId}/lines — record a counted line
 * (P1-21-BE-002).
 *
 * ## Why the line's location is checked against the batch's branch
 *
 * `inv.approve_opening_batch` posts each movement from the **line's** location, not
 * the batch's. So a batch opened for branch B1 carrying a line whose location sits
 * in B2 would mint stock in B2 while only B1 was ever authorized — the batch's own
 * scope check cannot catch that. The service resolves the location and refuses a
 * cross-branch line, and refuses a quarantine destination too: an opening count is a
 * statement about sellable stock, and counting it straight into quarantine would
 * create damaged stock that was never damaged.
 *
 * ## Lines are only addable while the batch is a draft
 *
 * Once approved, `inv.guard_opening_batch_approval` freezes the batch and its lines.
 * The service refuses an add to an approved batch with `ERR-TRN-001` rather than
 * letting the trigger raise, so the caller learns *why*.
 *
 * ## Why this write carries no idempotency key (P1-30 CC-18, decided)
 *
 * Not an oversight. `uq_opening_inventory_lines_cell` allows one live line per
 * (item, location) inside a batch, so the counted cell is ALREADY exactly-once at
 * the row level — a repeated send cannot add a second line for the same cell, and
 * since this change it answers `409 ERR-RES-002` rather than a 500. Only a
 * genuinely different cell adds a line, which is a different count, not a replay.
 *
 * Declaring `idempotent: true` would add no guarantee and no correction path:
 * `If-Match`-free replay stores the FIRST answer against the caller's key, so a
 * corrected quantity sent under the same key would replay the original refusal,
 * and the same key with a different body is `ERR-INT-001` either way. It would
 * also force the header on every call — the web client mints a fresh key per send
 * — and create a derived idempotency-evidence obligation with nothing to prove.
 *
 * Correcting a counted cell (soft-deleting a draft line, or amending its quantity
 * under `If-Match`) is a real gap and a separate operation; the cell index is
 * partial on `deleted_at` precisely so a re-add stays possible.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { QUANTITY_MAX, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ batchId: schemas.uuid }).strict();

const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

export const CreateBody = z
  .object({
    itemId: schemas.uuid,
    locationId: schemas.uuid,
    quantity: QuantityString,
  })
  .strict();

export const OPENING_BATCH_LINE_CREATE_OPERATION = defineOperation({
  id: 'inv.opening-batch-line-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/opening-inventory-batches/{batchId}/lines',
  summary: 'Record a counted item quantity on a draft opening-inventory batch.',
  permissions: ['inv.stock.operate'],
  // The path names a batch, not a branch. The service loads the batch, which carries
  // its own company and branch, and re-authorizes against those — otherwise the
  // check would degrade to scope-blind `iam.has_permission` (P1-18-A-01).
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    OPENING_BATCH_LINE_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { batchId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(CreateBody, body, 'body');
      const line = await inventoryModule().intake.addLine(
        db,
        {
          batchId,
          itemId: parsed.itemId,
          locationId: parsed.locationId,
          quantity: parsed.quantity,
        },
        authorizeScope
      );
      return { status: 201, body: line };
    },
    { params: raw, body }
  );
}
