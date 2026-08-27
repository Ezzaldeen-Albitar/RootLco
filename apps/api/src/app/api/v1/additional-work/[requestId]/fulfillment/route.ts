/**
 * POST /api/v1/additional-work/{requestId}/fulfillment (Phase 1-19, P1-19-BE-008).
 *
 * Records that approved additional work was carried out, or waived.
 *
 * ## Why this operation has to exist
 *
 * Closure blocker B3 fires while a REQUIRED request is `pending`, **or** `approved`
 * with `fulfillment_state = 'unfulfilled'`. Nothing else in this phase writes
 * `fulfillment_state`, so without this endpoint every approved required request would
 * block its work order's closure permanently — a deadlock rather than a control, and
 * one that could only be escaped by never approving required work. Stock reservation
 * and issue are Phase 1-21; recording that agreed work is DONE is not, and the column
 * that records it was created in Phase 1-9 with exactly this purpose.
 *
 * ## `unfulfilled` is not settable, and only an approved request may move
 *
 * The CHECK vocabulary has three values; this endpoint accepts two.
 * `tg_additional_work_requests_immutable` does not freeze the column, so nothing in
 * the schema would refuse a move back to `unfulfilled` — it would un-record a
 * completion nobody retracted, which is why the limit is stated here as this layer's
 * rule rather than pretended to be the schema's.
 *
 * Fulfilling a `pending` request would record work the customer has not authorised;
 * fulfilling a `rejected` or `withdrawn` one would record work that was cancelled. Both
 * are `ERR-TRN-001`.
 *
 * A waiver carries a mandatory reason. Declining to do work a customer already agreed
 * to is accountable, and since the row has no reason column that reason lives in the
 * audit record.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_REASON, SETTABLE_FULFILLMENT_STATES, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid });

export const Body = z
  .object({
    fulfillmentState: z.enum(SETTABLE_FULFILLMENT_STATES),
    reason: z.string().trim().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const ADDITIONAL_WORK_FULFILLMENT_OPERATION = defineOperation({
  id: 'wo.additional-work-fulfillment',
  module: 'work-order',
  method: 'POST',
  path: '/additional-work/{requestId}/fulfillment',
  summary: 'Record approved additional work as carried out, or waive it.',
  // The workshop's own authority, not the customer-decision one: obtaining consent
  // and administering the work already consented to are different acts, and this is
  // the second. Waiving is the sharp case, and it is why the reason is mandatory
  // rather than why the permission is higher.
  permissions: ['wo.additional_work.request'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.additional_work.fulfillment_changed',
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
    ADDITIONAL_WORK_FULFILLMENT_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const updated = await workOrderModule().additionalWork.setFulfillment(
        db,
        params.requestId,
        {
          fulfillmentState: parsed.fulfillmentState,
          reason: parsed.reason,
          expectedVersion,
        },
        authorizeScope
      );
      return { status: 200, body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
