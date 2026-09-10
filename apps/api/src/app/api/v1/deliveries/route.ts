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
 *
 * ## GET — the branch list (P1-31 prerequisite P-2b)
 *
 * The chapter's first declared API, and the read the delivery-records screen needs.
 * The P-2 … P-5 seam made a delivery RECOVERABLE from something the caller already
 * held — its own id, or its work order's — and left the set unreadable: nothing
 * answered "which deliveries does this branch have". This does, and it is the last
 * limb of that seam rather than a new one.
 *
 * `companyId` and `branchId` are REQUIRED and are the `authorizationTarget`, checked
 * before a row is read; the three optional filters are columns of the record itself.
 * See `DeliveryReadService.listDeliveries` for why the authorization order is the
 * reverse of every other read here.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { DELIVERY_STATUSES, deliveryModule } from '@/modules/delivery';

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

/**
 * `.strict()`, so an unknown parameter is `ERR-VAL-001` (422) rather than a filter
 * silently dropped, and a malformed cursor stays a distinguishable `ERR-PAG-001`
 * (400). A caller who mistyped `vehicleId` and was shown the whole branch's
 * deliveries would read them as that vehicle's.
 *
 * `status` is validated against `DELIVERY_STATUSES`, the module's transcription of
 * `ck_delivery_records_status`, so an unknown value is refused at the boundary
 * instead of matching nothing and answering an empty page that reads as "none".
 */
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(DELIVERY_STATUSES).optional(),
    workOrderId: schemas.uuid.optional(),
    vehicleId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const DELIVERY_LIST_OPERATION = defineOperation({
  id: 'sal.delivery-list',
  module: 'delivery',
  method: 'GET',
  path: '/deliveries',
  summary: "List a branch's delivery records, newest first.",
  permissions: ['sal.delivery.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    DELIVERY_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      // Parsed INSIDE the handler so a malformed query renders the shared problem
      // document rather than an unhandled 500.
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await deliveryModule().reads.listDeliveries(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.status === undefined ? {} : { status: query.status }),
            ...(query.workOrderId === undefined ? {} : { workOrderId: query.workOrderId }),
            ...(query.vehicleId === undefined ? {} : { vehicleId: query.vehicleId }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    // The target comes from the RAW query, before validation: `handleOperation`
    // needs it to choose the scoped permission evaluation, and a pair that is not
    // two uuids yields no target and is then refused by the schema.
    scopeTargetOption(raw)
  );
}
