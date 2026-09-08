/**
 * GET /api/v1/deliveries/{deliveryId} (Phase 1-31, prerequisite P-3).
 *
 * The delivery record.
 *
 * ## What was missing
 *
 * Before this route the only GET anywhere under `/deliveries` was `.../eligibility`,
 * which answers with BLOCKERS — it never returns the record's own fields. So the
 * work order, the vehicle, the reception visit, the delivering employee, the
 * delivered-at instant and the final odometer reading reference were all written and
 * never readable. Recorded as **P1-27-INT-084**, three of whose four limbs hold.
 *
 * This publishes `DeliveryRepository.findDelivery` through the read service's
 * existing `requireDelivery`, which already decides the uniform 404 and then
 * re-authorizes. It adds no query and no second mapper.
 *
 * ## The 404 is decided before the scope decision
 *
 * `findDelivery` returns null for absent and out-of-scope alike, and
 * `requireDelivery` turns both into one `ERR-RES-001`. Only then does it
 * `authorizeScope` against the row's OWN company and branch — which is the check
 * `iam.has_permission` alone cannot make, because `app.branch_ids` is the
 * permission-blind union of every active grant, so RLS visibility is not authority
 * (P1-18-A-01). A caller from another tenant therefore learns nothing about
 * existence.
 *
 * ## `recordVersion` is published in the body AND as the ETag
 *
 * For the same reason the eligibility read publishes it: `sal.delivery-complete` is
 * version-guarded and `parseIfMatch` accepts only an exact positive integer, with no
 * `*` wildcard, while `tg_delivery_records_touch_metadata` raises the version on
 * every status advance. A caller needs a CURRENT version, and this read is now the
 * cheapest way to get one — the eligibility read composes eight facts across four
 * other modules to publish the same integer.
 *
 * ## Permission
 *
 * `sal.delivery.view`. Not `sal.delivery.read`, which is named by `navigation.ts`
 * and absent from the seeded catalogue (**RES-05**). Not `sal.delivery.manage`
 * either: the eligibility read records why a read on this surface must be holdable
 * by the completing principal, and this record read is that read's companion.
 *
 * ## Money
 *
 * None. `finalOdometerReadingId` is a reference to a `veh.odometer_readings` row and
 * NOT an odometer value; the reading's `numeric(12,1)` crosses as a string through
 * the vehicle odometer-history operation, which is where it lives.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();

export const DELIVERY_READ_OPERATION = defineOperation({
  id: 'sal.delivery-read',
  module: 'delivery',
  method: 'GET',
  path: '/deliveries/{deliveryId}',
  summary: 'Read a delivery record.',
  permissions: ['sal.delivery.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ deliveryId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    DELIVERY_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const delivery = await deliveryModule().reads.readDelivery(
        db,
        params.deliveryId,
        authorizeScope
      );
      return { body: delivery, recordVersion: delivery.recordVersion };
    },
    { params: raw }
  );
}
