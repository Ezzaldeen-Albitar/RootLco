/**
 * POST /api/v1/work-orders/{workOrderId}/transition (Phase 1-19, P1-19-BE-003).
 *
 * Moves a work order along the graph held in `wo.work_order_transitions`. The
 * graph is read, never mirrored: those are tenant-overridable catalog TABLES, so a
 * TypeScript copy would refuse legitimate tenant edges and drift the moment one is
 * added or deactivated.
 *
 * `wo.guard_work_order_transition` remains the authority — it re-resolves the edge,
 * the target state's `reason_required` and the terminal-source refusal inside the
 * same statement as the write. What this route adds is a readable refusal instead
 * of a bare `23514`, and, for a terminal non-cancellation target, the FULL closure
 * blocker list rather than the guard's first one.
 *
 * `If-Match` is mandatory. A transition is a state change on a shared aggregate and
 * a caller who has not seen the current version cannot know which edge they are
 * asking for.
 *
 * ## This endpoint cannot close a work order
 *
 * Closure authority is separate by design: a service advisor who may park an order
 * `awaiting_parts` must not thereby be able to end the workshop's liability for the
 * vehicle. Permissions are a conjunction, so declaring `wo.work_order.close`
 * alongside `wo.work_order.transition` here would demand the closing authority for
 * every ordinary move. Closure is therefore its own operation
 * (`POST /work-orders/{workOrderId}/closure`), and asking THIS endpoint for a
 * terminal non-cancellation state is refused with `ERR-VAL-001` rather than
 * silently accepted — otherwise the second permission would be bypassable by
 * choosing the other URL. Both commands funnel into one service write path, so
 * B1–B6 and `wo.guard_work_order_closure` apply identically either way.
 *
 * Cancellation stays here even though `cancelled` is terminal, because
 * `wo.guard_work_order_closure` exempts a cancellation target from B1–B6:
 * cancelling is abandoning the work, not certifying it complete.
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
 * `toState` is a catalog CODE, not a value from a hardcoded enum: the vocabulary
 * lives in `wo.work_order_states` and a tenant may extend it. The format matches
 * `ck_work_order_states_code`, so a syntactically impossible code is refused here
 * rather than sent to the database as a lookup that cannot match.
 */
const Body = z
  .object({
    toState: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'must be a lower-snake state code'),
    reason: z.string().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const WORK_ORDER_TRANSITION_OPERATION = defineOperation({
  id: 'wo.work-order-transition',
  module: 'work-order',
  method: 'POST',
  path: '/work-orders/{workOrderId}/transition',
  summary: 'Move a work order to another state in its configured graph.',
  permissions: ['wo.work_order.transition'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.work_order.state_changed',
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
    WORK_ORDER_TRANSITION_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const moved = await workOrderModule().workOrders.transition(
        db,
        params.workOrderId,
        {
          toState: parsed.toState,
          reason: parsed.reason,
          expectedVersion,
        },
        authorizeScope
      );
      return { status: 200, body: moved, recordVersion: moved.recordVersion };
    },
    { params: raw, body }
  );
}
