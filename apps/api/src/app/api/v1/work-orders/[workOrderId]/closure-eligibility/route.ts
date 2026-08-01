/**
 * GET /api/v1/work-orders/{workOrderId}/closure-eligibility (Phase 1-19,
 * P1-19-BE-004).
 *
 * Reports EVERY unmet closure condition, which is the whole reason this endpoint
 * exists. `wo.guard_work_order_closure` is the authority and stays the authority —
 * it runs inside the same statement as the state change, so nothing can slip
 * between a check and the write — but it `RAISE`s on the FIRST blocker it hits and
 * aborts. A caller driving closure from the guard alone therefore learns one fact
 * per rejected attempt: clear B1, discover B2, clear B2, discover B3.
 *
 * This endpoint re-evaluates all six independently in a read-only path so the
 * caller learns all of them at once. It is a REPORTER, never an enforcer: a
 * response saying `eligible: true` is a statement about the moment it was read,
 * and closure is still refused by the guard if anything changed since.
 *
 * Two gating facts are reproduced rather than assumed away: the guard evaluates
 * B1–B6 only when the TARGET state is terminal, and a cancellation target bypasses
 * them entirely. An order already in a terminal state therefore reports
 * `alreadyTerminal` with an empty blocker list, because the guard would evaluate
 * nothing.
 *
 * `deferred` names the two conditions the phase brief asked for that the protected
 * schema cannot express — stock reservation and part issue, which are Phase 1-21.
 * They are reported as deferred rather than omitted, because a blocker that always
 * evaluated "clear" would read in this response, and in every audit snapshot built
 * from it, as a check that ran and passed.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

export const WORK_ORDER_CLOSURE_ELIGIBILITY_OPERATION = defineOperation({
  id: 'wo.work-order-closure-eligibility',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders/{workOrderId}/closure-eligibility',
  summary: 'Report every unmet closure condition for a work order.',
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
  // The schema runs INSIDE the pipeline so a malformed id is rendered as the
  // shared problem document rather than escaping the route as an unhandled 500.
  const raw = await route.params;
  return handleOperation(
    WORK_ORDER_CLOSURE_ELIGIBILITY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const eligibility = await workOrderModule().workOrders.closureEligibility(
        db,
        params.workOrderId,
        authorizeScope
      );
      return { status: 200, body: eligibility };
    },
    { params: raw }
  );
}
