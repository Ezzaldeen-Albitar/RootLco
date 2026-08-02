/**
 * GET /api/v1/work-orders/{workOrderId} — the work-order aggregate (Phase 1-19,
 * P1-19-BE-007).
 *
 * Returns the work order, its live jobs, and the edges it can currently take. The
 * job list is one query rather than one per job, and the reachable states come
 * from `wo.work_order_states` / `wo.work_order_transitions` — the same catalog
 * tables `wo.guard_work_order_transition` resolves — so the API never advertises a
 * move the database would refuse. A terminal order reports no next states at all,
 * because the guard freezes it (BR-WO-002) whatever the graph contains.
 *
 * Assignments, approvals, diagnostics, QC and rework references join this
 * projection in Waves 5–8, as each becomes writable through a real path. An
 * always-empty block for them now would publish a contract nothing can populate.
 *
 * The work order is addressed by id, so the pre-handler authorization check has no
 * branch to narrow by and `authorizeScope` re-decides against the row's own
 * company and branch once it is read (P1-18-A-01).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

export const WORK_ORDER_DETAIL_OPERATION = defineOperation({
  id: 'wo.work-order-detail',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders/{workOrderId}',
  summary: 'Read one work order with its jobs and reachable states.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  // The raw params go to the pipeline and the schema runs INSIDE it, so a
  // malformed id is rendered as the shared problem document. Parsing before
  // `handleOperation` would let the `AppFailure` escape the route function and
  // surface as an unhandled 500 rather than a 422 naming the path segment.
  const raw = await route.params;
  return handleOperation(
    WORK_ORDER_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const detail = await workOrderModule().workOrders.detail(
        db,
        params.workOrderId,
        authorizeScope
      );
      // The ETag lets a caller drive a transition without a second read: the
      // version it must send back as `If-Match` is the one it just saw.
      return { body: detail, recordVersion: detail.workOrder.recordVersion };
    },
    { params: raw }
  );
}
