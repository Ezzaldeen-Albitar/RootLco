/**
 * POST /api/v1/work-orders/{workOrderId}/closure (Phase 1-19, P1-19-BE-005).
 *
 * The same graph move as `POST .../transition`, behind a second permission.
 *
 * Closure is its own authority: ending the workshop's liability for a customer's
 * vehicle is not the same act as parking the order awaiting parts, and permissions
 * are evaluated as a conjunction — one operation declaring both
 * `wo.work_order.transition` and `wo.work_order.close` would demand the closing
 * authority for every ordinary move, while an operation declaring only the first
 * would leave the seeded `wo.work_order.close` code enforced nowhere.
 *
 * It is NOT an alternate write path, and that is enforced rather than asserted:
 * both commands enter `WorkOrderService` through one private move, which checks the
 * target state against the command it arrived on. A terminal non-cancellation state
 * is reachable only here; anything else is refused here and belongs on
 * `.../transition`. So the closure-eligibility service, the full B1–B6 pre-report,
 * the `record_version` predicate and `wo.guard_work_order_closure` itself apply
 * identically whichever URL the caller chose.
 *
 * `wo.guard_work_order_closure` remains the enforcement point. The pre-report
 * exists so a caller learns every unmet blocker at once instead of one per rejected
 * attempt — the guard raises on the first and aborts — and it never licenses
 * closure: the guard runs on the UPDATE, in the same statement, including in the
 * window between the report and the write.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_REASON, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

/**
 * `toState` is required rather than defaulted to `closed`.
 *
 * `wo.work_order_states` is tenant-overridable and a tenant may define more than
 * one terminal non-cancellation state; defaulting would silently pick the platform
 * one and close an order into a state the caller did not choose.
 */
export const Body = z
  .object({
    toState: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'must be a lower-snake state code'),
    reason: z.string().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const WORK_ORDER_CLOSURE_OPERATION = defineOperation({
  id: 'wo.work-order-closure',
  module: 'work-order',
  method: 'POST',
  path: '/work-orders/{workOrderId}/closure',
  summary: 'Close a work order once every closure condition is met.',
  permissions: ['wo.work_order.transition', 'wo.work_order.close'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.work_order.closed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  // Both schemas run INSIDE the pipeline so a malformed id or body is rendered as
  // the shared problem document rather than escaping the route as a 500.
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    WORK_ORDER_CLOSURE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const closed = await workOrderModule().workOrders.close(
        db,
        params.workOrderId,
        { toState: parsed.toState, reason: parsed.reason, expectedVersion },
        authorizeScope
      );
      return { status: 200, body: closed, recordVersion: closed.recordVersion };
    },
    { params: raw, body }
  );
}
