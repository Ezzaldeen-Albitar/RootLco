/**
 * GET /api/v1/notifications/{notificationId}/deliveries (P1-23).
 *
 * The delivery history of one message, for operators diagnosing a stuck or
 * failing queue.
 *
 * This is deliberately wider than the inbox — an operator must be able to see
 * messages they did not receive — so it takes a **different permission** and is
 * **audited**. Wider visibility that is not accountable is just a leak with a
 * permission attached, which is why `auditClass` is 'security' here and 'none'
 * on the two inbox reads.
 *
 * What comes back is the message lifecycle alongside its append-only attempts.
 * The contract's `accepted` (the provider took it) and `delivered` (the
 * provider evidenced arrival) are reported as they are stored and never
 * collapsed — `ck_delivery_attempts_status` enumerates both, so flattening them
 * would contradict the schema and not merely a policy.
 *
 * `delivery_attempts.details` is not projected. It is the one provider-shaped
 * jsonb column that could carry a raw provider payload; the normalized
 * `status`, `response_code` and `error_summary` beside it are what an operator
 * actually needs.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const NOTIFICATION_DELIVERY_LIST_OPERATION = defineOperation({
  id: 'shared.notification-delivery-list',
  module: 'shared-services',
  method: 'GET',
  path: '/notifications/{notificationId}/deliveries',
  summary: 'Inspect the delivery attempts recorded for one outbound message.',
  permissions: ['shared.notification.delivery.read'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'shared.notification.delivery_inspected',
  // Was the unregistered `'standard-read'`, which made every request to this
  // operation an unhandled 500 (`P1-27-INT-113`). Keyed per user within a tenant,
  // because an inbox is per-recipient — see the list route for the full reasoning.
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  context: { params: Promise<{ notificationId: string }> }
): Promise<Response> {
  const { notificationId } = await context.params;
  return handleOperation(NOTIFICATION_DELIVERY_LIST_OPERATION, request, async ({ db }) => {
    const id = parseOrFail(schemas.uuid, notificationId, 'path.notificationId');
    return { body: await sharedServicesModule().notificationReads.readDeliveries(db, id) };
  });
}
