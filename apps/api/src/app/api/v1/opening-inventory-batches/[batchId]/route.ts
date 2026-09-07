/**
 * GET /api/v1/opening-inventory-batches/{batchId} (Phase 1-30, seam S-17).
 *
 * One opening-inventory batch with the lines counted on it.
 *
 * ## Why this read is what makes the maker-checker rule usable
 *
 * `ck_opening_inventory_batches_maker` requires the approver to be someone other
 * than the counter, and `inv.guard_opening_batch_approval` freezes the batch once
 * that approval lands. Until this route the approver had no way to SEE what they
 * were approving: the batch was write-only on the wire, so the count survived only
 * as React state in the tab that created it. Approving a batch you cannot read is
 * not a second pair of eyes.
 *
 * ## Scope is decided from the row, and not-found comes first
 *
 * The path names a batch, not a branch, so the declared `scope: 'branch'` is
 * carried entirely by the in-service `authorizeScope` on the batch's OWN company
 * and branch (P1-18-A-01) — the route has no target to hand the pre-handler check.
 *
 * A batch id that RLS does not surface, and one that does not exist, both answer
 * `404 ERR-RES-001`, and the service decides that BEFORE it authorizes anything.
 * The order is deliberate: a 403 on an id the caller may not see would confirm
 * that the id names a real batch in some other branch, which is exactly the
 * existence signal a foreign id must not get back.
 *
 * ## Quantities cross as decimal strings
 *
 * `inv.opening_inventory_lines.quantity` is `numeric(12,3)`. A JSON number would
 * lose the third decimal place for some values, silently, so every line quantity
 * is published as the string `pg` returns.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ batchId: schemas.uuid }).strict();

export const OPENING_BATCH_READ_OPERATION = defineOperation({
  id: 'inv.opening-batch-read',
  module: 'inventory',
  method: 'GET',
  path: '/opening-inventory-batches/{batchId}',
  summary: 'Read one opening-inventory batch with its counted lines.',
  // The same permission the count screen already gates on. The 118-code catalogue
  // names no batch-specific read authority and this slice mints none (RES-05).
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    OPENING_BATCH_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { batchId } = parseOrFail(Params, raw, 'path');
      return {
        body: await inventoryModule().reads.readOpeningBatch(db, batchId, authorizeScope),
      };
    },
    { params: raw }
  );
}
