/**
 * /api/v1/stock-counts/{countId} — one stock count with every line
 * (P1-32-PRE-049).
 *
 * Each line carries the snapshot, the movements posted during the count, the
 * counted quantity, the GENERATED variance, and the status of the adjustment the
 * variance raised — so the reader can see both what the count found and whether
 * anyone has yet approved doing something about it. `varianceQty` is `null` until
 * a line is counted, which is distinct from a counted line that matched.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ countId: schemas.uuid }).strict();

export const STOCK_COUNT_READ_OPERATION = defineOperation({
  id: 'inv.stock-count-read',
  module: 'inventory',
  method: 'GET',
  path: '/stock-counts/{countId}',
  summary: 'Read one stock count with its lines, variances and raised adjustments.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ countId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    STOCK_COUNT_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { countId } = parseOrFail(Params, raw, 'path');
      const count = await inventoryModule().counts.read(db, countId, authorizeScope);
      return { body: count, recordVersion: count.recordVersion };
    },
    { params: raw }
  );
}
