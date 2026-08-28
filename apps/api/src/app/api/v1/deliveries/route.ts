/**
 * /api/v1/deliveries — open a delivery record for a work order (P1-22-BE-013).
 *
 * Creates the parent that eligibility, receiver verification, the checklist, the
 * signature and completion all hang off. It hands nothing over: the record is born
 * `'ready'` and only `POST .../completion` releases custody.
 *
 * ## The vehicle and the visit are NOT client inputs
 *
 * `sal.guard_delivery_coherence` (M-dlv-1) requires `vehicle_id` and
 * `reception_visit_id` to equal the work order's, so the service derives both from the
 * work order rather than accepting them. That is not merely safer — it is a better
 * error: a client that sent a mismatched vehicle would otherwise get a `23514` naming
 * a trigger, where deriving means the mismatch cannot be expressed at all.
 *
 * `uq_delivery_records_work_order_active` permits ONE live delivery per work order, so
 * a second attempt is `23505` and must surface as a conflict rather than a 500.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const CreateBody = z
  .object({
    workOrderId: schemas.uuid,
    // Who is handing the vehicle over. `sal.delivery_records.delivering_employee_id`
    // carries no FK, so this is validated as a uuid and bound to the row; the schema
    // asserts nothing further about it.
    deliveringEmployeeId: schemas.uuid,
  })
  .strict();

export const DELIVERY_CREATE_OPERATION = defineOperation({
  id: 'sal.delivery-create',
  successStatus: 201,
  module: 'delivery',
  method: 'POST',
  path: '/deliveries',
  summary: 'Open a delivery record for a work order, deriving its vehicle and visit.',
  permissions: ['sal.delivery.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'sal.delivery.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DELIVERY_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const delivery = await deliveryModule().deliveries.createDelivery(
        db,
        {
          workOrderId: parsed.workOrderId,
          deliveringEmployeeId: parsed.deliveringEmployeeId,
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      // The body already carried `recordVersion`; publishing it as an ETag too means a
      // client holding this response can use the platform's normal `If-Match` flow
      // rather than having to know that one field of one body is special.
      return { status: 201, body: delivery, recordVersion: delivery.recordVersion };
    },
    { body }
  );
}
