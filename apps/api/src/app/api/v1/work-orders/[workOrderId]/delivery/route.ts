/**
 * GET /api/v1/work-orders/{workOrderId}/delivery (Phase 1-31, prerequisite P-2).
 *
 * The live delivery a work order has, or the fact that it has none.
 *
 * ## This route is the recovery seam
 *
 * `DeliveryRepository.findLiveDeliveryForWorkOrder` has existed since P1-22 and had
 * no route in front of it. Its only caller was internal: the duplicate-create
 * refusal in `DeliveryService`, which answers `ERR-RES-002` naming the work order
 * and NOT the delivery. So once a create response was gone the delivery id was
 * unrecoverable, and with it every read addressed by that id — the record, the
 * eligibility, the receiver, the checklist, the signatures. Six of P1-31's sixteen
 * scope items failed on that one absence.
 *
 * This publishes the existing read; it adds no query and no second mapper. It is
 * the same shape as `sal.work-order-invoice-read`, which published
 * `BillingRepository.liveInvoiceForWorkOrder` from the identical position in P1-30
 * A2, and it is deliberately not a different one.
 *
 * ## At most one row, by partial unique index
 *
 * `uq_delivery_records_work_order_active` — `status <> 'exception' AND deleted_at IS
 * NULL` — makes the live delivery for a work order unique, and the query mirrors
 * that predicate exactly. So this is a singleton read: no pagination, no ordering
 * contract, no cursor. There is no ordered set to page.
 *
 * A delivery marked `exception` is reported as `null`, deliberately: the index
 * permits a new delivery for that work order, so "the live delivery" is absent in
 * the only sense the schema recognises. `GET /deliveries/{deliveryId}` still reads
 * it by id.
 *
 * ## Absence is a 200, not a 404
 *
 * A visible work order with no live delivery answers
 * `{ workOrderId, delivery: null }` at 200. A work order that is not visible answers
 * `ERR-RES-001`, decided by `requireWorkOrder` BEFORE any scope decision.
 * Collapsing those two would tell a caller "no delivery" for a work order in a
 * branch they cannot see — an existence oracle disguised as an empty result.
 *
 * ## Permission
 *
 * `sal.delivery.view`, the code the eligibility read already declares and the only
 * delivery READ code the catalogue seeds. **NOT `sal.delivery.read`**: `navigation.ts`
 * named that code while it was absent from the seeded catalogue (**RES-05**), and
 * declaring it here would have gated this route on a permission no actor can hold.
 * P1-31 prerequisite P-8 re-points that navigation entry at `sal.delivery.view`, which
 * closes the mismatch where it was — on the navigation side — and leaves this route's
 * declared code untouched. A navigation label is not authorization truth.
 *
 * ## Money
 *
 * None crosses here. A delivery record carries no amount column of any kind;
 * `finalOdometerReadingId` is a `veh.odometer_readings` REFERENCE, not a reading
 * value, so nothing on this response is a number that should have been a decimal
 * string.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid }).strict();

export const WORK_ORDER_DELIVERY_READ_OPERATION = defineOperation({
  id: 'sal.work-order-delivery-read',
  module: 'delivery',
  method: 'GET',
  path: '/work-orders/{workOrderId}/delivery',
  summary: 'Read the live delivery a work order has, if it has one.',
  permissions: ['sal.delivery.view'],
  // `branch`, and the target is NOT empty: the handler resolves company and branch
  // from the WORK ORDER row and authorizes those before reading the delivery.
  // Without that a declared scope is inert on an id-addressed read —
  // `requiresScopedEvaluation` returns false for an empty target whatever the
  // declaration says (P1-18-A-01).
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    WORK_ORDER_DELIVERY_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await deliveryModule().reads.readWorkOrderDelivery(
          db,
          params.workOrderId,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
