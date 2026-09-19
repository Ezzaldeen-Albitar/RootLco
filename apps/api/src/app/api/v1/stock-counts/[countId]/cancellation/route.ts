/**
 * /api/v1/stock-counts/{countId}/cancellation — cancel an open stock count
 * (P1-32-PRE-048).
 *
 * Only a count still `open` or `counting` can be cancelled. Cancelling raises no
 * adjustment and moves no stock; the lines already recorded stay on the row as the
 * record of what was counted before the count was abandoned.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ countId: schemas.uuid }).strict();

export const CancellationBody = z
  .object({ reason: z.string().trim().min(1).max(MAX_REASON) })
  .strict();

export const STOCK_COUNT_CANCEL_OPERATION = defineOperation({
  id: 'inv.stock-count-cancel',
  module: 'inventory',
  method: 'POST',
  path: '/stock-counts/{countId}/cancellation',
  summary: 'Cancel an open stock count without raising any adjustment.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_count.cancelled',
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
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STOCK_COUNT_CANCEL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { countId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(CancellationBody, body, 'body');
      const cancelled = await inventoryModule().counts.cancel(
        db,
        countId,
        { reason: parsed.reason },
        authorizeScope
      );
      return { body: cancelled, recordVersion: cancelled.recordVersion };
    },
    { params: raw, body }
  );
}
