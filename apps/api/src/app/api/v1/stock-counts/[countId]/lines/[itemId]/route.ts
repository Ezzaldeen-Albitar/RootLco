/**
 * /api/v1/stock-counts/{countId}/lines/{itemId} — record what was counted for one
 * item (P1-32-PRE-048).
 *
 * `PUT`, because recording the same counted quantity twice leaves the line exactly
 * as once did. An item the snapshot did not include is accepted with a zero
 * snapshot: finding stock the ledger does not know about is precisely what a count
 * is for. A counted quantity of zero is legal — an empty shelf is the finding that
 * matters most.
 *
 * ## If-Match
 *
 * `versionGuarded` on the COUNT's `record_version`. The count is the aggregate two
 * counters race on — the first line recorded moves it from `open` to `counting` —
 * so a second counter holding a stale read is told so with `ERR-CON-001`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { QUANTITY_MAX, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ countId: schemas.uuid, itemId: schemas.uuid }).strict();

export const LineBody = z
  .object({
    countedQty: z
      .string()
      .regex(
        /^\d{1,9}(\.\d{1,3})?$/,
        `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
      ),
  })
  .strict();

export const STOCK_COUNT_LINE_RECORD_OPERATION = defineOperation({
  id: 'inv.stock-count-line-record',
  module: 'inventory',
  method: 'PUT',
  path: '/stock-counts/{countId}/lines/{itemId}',
  summary: 'Record the physically counted quantity of one item on an open stock count.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_count.line_recorded',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ countId: string; itemId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STOCK_COUNT_LINE_RECORD_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const { countId, itemId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(LineBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const count = await inventoryModule().counts.recordLine(
        db,
        countId,
        itemId,
        { countedQty: parsed.countedQty, expectedVersion },
        authorizeScope
      );
      return { body: count, recordVersion: count.recordVersion };
    },
    { params: raw, body }
  );
}
