/**
 * /api/v1/inventory-reconciliations — inventory audit evidence (P1-21-BE-014).
 *
 * Re-derives every stored balance from the movement ledger and reports where the
 * cache and the movements disagree. This is the evidence an operator needs to show
 * that `on_hand` still equals `Σ signed_qty` and `reserved` still equals the sum of
 * active reservations — computed from the ledger rather than trusted from the
 * balance table that is being audited.
 *
 * ## Why a discrepancy is reported and never repaired
 *
 * `inv.guard_stock_balance_coherence` rejects any incoherent write, so
 * `incoherentCells` should be structurally zero. A non-zero count therefore means
 * the guard was bypassed — a security finding, not a routine drift — and silently
 * "fixing" the balance would destroy the only evidence that it happened.
 *
 * This is a read, so it creates no second audit subsystem: it uses the existing
 * `iam.audit_records` append path like every other audited operation.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    branchId: schemas.uuid.optional(),
    itemId: schemas.uuid.optional(),
    workOrderId: schemas.uuid.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const INVENTORY_RECONCILIATION_OPERATION = defineOperation({
  id: 'inv.inventory-reconciliation-read',
  module: 'inventory',
  method: 'GET',
  path: '/inventory-reconciliations',
  summary: 'Re-derive stored stock balances from the movement ledger and report any disagreement.',
  permissions: ['inv.audit.read'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.reconciliation.performed',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    INVENTORY_RECONCILIATION_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => {
      const url = new URL(raw.url);
      const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
      return {
        body: await inventoryModule().reads.reconcile(
          db,
          {
            ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.workOrderId === undefined ? {} : { workOrderId: query.workOrderId }),
          },
          query.limit,
          authorizeScope
        ),
      };
    }
  );
}
