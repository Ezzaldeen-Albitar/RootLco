/**
 * POST /api/v1/additional-work/{requestId}/withdrawal (Phase 1-19, P1-19-BE-006).
 *
 * The workshop retracting its own request. `withdrawn` is one of the four values in
 * `ck_additional_work_requests_state`, and it is the only exit from `pending` that
 * does not involve the customer — which is why it sits behind
 * `wo.additional_work.request` (the authority that raised it) rather than behind
 * `wo.additional_work.approve` (the authority that records the customer's decision).
 * Retracting a question you asked is not deciding the answer.
 *
 * This is the operation that keeps a mistaken request from becoming permanent. A
 * required `pending` request blocks BOTH the closure gate (B3) and, for its
 * originating job, entry into any state where labour is allowed — so without a
 * withdrawal path a request raised in error would stop the work and the closure
 * indefinitely, and the only remaining exit would be to ask a customer to decide on
 * work that was never really needed.
 *
 * A reason is mandatory here even though the schema has no column for one: the row
 * records only the state, so the reason lives in the audit record, and that is stated
 * rather than left to be discovered. `If-Match` is mandatory because a withdrawal
 * races a decision — both move the same request out of `pending`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_REASON, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid });
const Body = z.object({ reason: z.string().trim().min(1).max(MAX_REASON) }).strict();

export const ADDITIONAL_WORK_WITHDRAW_OPERATION = defineOperation({
  id: 'wo.additional-work-withdraw',
  module: 'work-order',
  method: 'POST',
  path: '/additional-work/{requestId}/withdrawal',
  summary: 'Withdraw an additional-work request the workshop raised.',
  permissions: ['wo.additional_work.request'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.additional_work.state_changed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ADDITIONAL_WORK_WITHDRAW_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const withdrawn = await workOrderModule().additionalWork.withdraw(
        db,
        params.requestId,
        { reason: parsed.reason, expectedVersion },
        authorizeScope
      );
      return { status: 200, body: withdrawn, recordVersion: withdrawn.recordVersion };
    },
    { params: raw, body }
  );
}
