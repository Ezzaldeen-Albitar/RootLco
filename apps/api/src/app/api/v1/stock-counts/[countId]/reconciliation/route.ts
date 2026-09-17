/**
 * /api/v1/stock-counts/{countId}/reconciliation — reconcile a stock count
 * (P1-32-PRE-048).
 *
 * `inv.reconcile_stock_count` re-reads, for every counted line, the movements
 * posted at that item and location AFTER the snapshot, stores them as
 * `movementDeltaDuringCount`, and raises one PENDING `inv.stock_adjustments` row for
 * each line whose counted quantity still differs from snapshot + delta.
 *
 * It POSTS NOTHING. `adjustmentsRaised` in the response is the number of requests
 * now waiting for a different person to approve them through
 * `POST /stock-adjustments/{adjustmentId}/approval` — the same maker-checker path
 * every other quantity correction takes. Uncounted lines raise nothing.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ countId: schemas.uuid }).strict();

export const STOCK_COUNT_RECONCILE_OPERATION = defineOperation({
  id: 'inv.stock-count-reconcile',
  module: 'inventory',
  method: 'POST',
  path: '/stock-counts/{countId}/reconciliation',
  summary: 'Reconcile a stock count, raising pending adjustments for its variances.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_count.reconciled',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ countId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    STOCK_COUNT_RECONCILE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { countId } = parseOrFail(Params, raw, 'path');
      const reconciled = await inventoryModule().counts.reconcile(db, countId, authorizeScope);
      return { body: reconciled, recordVersion: reconciled.recordVersion };
    },
    { params: raw }
  );
}
