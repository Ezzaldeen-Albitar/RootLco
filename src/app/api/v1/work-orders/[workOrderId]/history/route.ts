/**
 * GET /api/v1/work-orders/{workOrderId}/history — the status ledger (Phase 1-19,
 * P1-19-BE-008).
 *
 * `wo.work_order_status_history` is append-only and has no UPDATE or DELETE grant
 * for any application role, so this is a faithful record rather than a
 * reconstruction. It is keyset-paginated newest-first: the ledger grows without
 * bound on a long-running order, and returning all of it is exactly the unbounded
 * response the pagination contract exists to prevent.
 *
 * The response also carries an `origin` block, and that is not decoration. The
 * emitter `wo.emit_work_order_status_history` is AFTER UPDATE only, so the insert
 * that OPENS a work order writes no ledger row and the oldest entry is the first
 * transition. Backfilling a genesis row would be worse than omitting one:
 * `shared.stamp_status_history` forces `occurred_at := now()`, so the fabricated
 * row would claim the order opened at the moment of the backfill. The opening is
 * therefore reported from columns that genuinely hold it — `opened_at`,
 * `created_by`, and the oldest entry's own `fromState`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const WORK_ORDER_HISTORY_OPERATION = defineOperation({
  id: 'wo.work-order-history',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders/{workOrderId}/history',
  summary: 'Read the append-only status history of a work order, newest first.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  // Both schemas run INSIDE the pipeline, so a malformed id or cursor is rendered
  // as the shared problem document instead of escaping the route as a 500.
  const raw = await route.params;
  const rawQuery = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    WORK_ORDER_HISTORY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(Query, rawQuery, 'query');
      return {
        body: await workOrderModule().workOrders.history(
          db,
          params.workOrderId,
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
