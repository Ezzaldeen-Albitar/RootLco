/**
 * /api/v1/opening-inventory-batches — start an opening stock count (P1-21-BE-002).
 *
 * ## Opening balances are the only path that mints stock, so they are a batch
 *
 * A batch is created `draft` and no parameter offers anything else. Stock appears
 * only when `/opening-inventory-batches/{batchId}/approval` runs
 * `inv.approve_opening_batch`, which posts one immutable `opening` movement per
 * counted line and is subject to `ck_opening_inventory_batches_maker_checker`
 * (approver ≠ counter). This route therefore cannot create a balance — it creates a
 * counted intention that someone else must approve.
 *
 * That shape is the reason the API has no "set stock level" endpoint at all.
 * Overwriting `inv.stock_balances.on_hand_qty` directly is grantable — `app_runtime`
 * holds UPDATE — but `inv.guard_stock_balance_coherence` would reject it, because
 * `on_hand` must equal `Σ signed_qty` of the movement ledger. Stock without a
 * movement behind it is unrepresentable, and that is deliberate.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, scopeTargetOption } from '@/server/http/validation';
import { MAX_DESCRIPTION, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateBody = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    // `as_of_date` is a `date`, so a plain ISO date — accepting a timestamp would
    // imply a precision the column does not have.
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
    countedBy: schemas.uuid.optional(),
    notes: z.string().min(1).max(MAX_DESCRIPTION).optional(),
  })
  .strict();

export const OPENING_BATCH_CREATE_OPERATION = defineOperation({
  id: 'inv.opening-batch-create',
  module: 'inventory',
  method: 'POST',
  path: '/opening-inventory-batches',
  summary: 'Open a draft opening-inventory batch for a branch.',
  permissions: ['inv.stock.operate'],
  // The body names the company and branch the batch belongs to, so
  // `scopeTargetOption` gives the pre-handler check a concrete target and evaluation
  // uses `iam.has_permission_in_scope`. The service re-authorizes the same pair.
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.opening_batch.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    OPENING_BATCH_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const batch = await inventoryModule().intake.openBatch(
        db,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          asOfDate: parsed.asOfDate,
          ...(parsed.countedBy === undefined ? {} : { countedBy: parsed.countedBy }),
          ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
        },
        authorizeScope
      );
      return { status: 201, body: batch, recordVersion: batch.recordVersion };
    },
    { body, ...scopeTargetOption(body) }
  );
}
