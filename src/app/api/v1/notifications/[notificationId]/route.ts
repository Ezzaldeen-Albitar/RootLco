/**
 * GET /api/v1/notifications/{notificationId} (P1-23).
 *
 * One notification from the caller's own inbox. A message addressed to somebody
 * else answers ERR-NTF-001 exactly as a non-existent id does, so the endpoint
 * cannot be used to probe which notification ids are real inside the tenant.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const NOTIFICATION_READ_OPERATION = defineOperation({
  id: 'shared.notification-read',
  module: 'shared-services',
  method: 'GET',
  path: '/notifications/{notificationId}',
  summary: "Read one of the authenticated user's own in-app notifications.",
  permissions: ['shared.notification.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'standard-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  context: { params: Promise<{ notificationId: string }> }
): Promise<Response> {
  const { notificationId } = await context.params;
  return handleOperation(NOTIFICATION_READ_OPERATION, request, async ({ db }) => {
    const id = parseOrFail(schemas.uuid, notificationId, 'path.notificationId');
    return { body: await sharedServicesModule().notificationReads.readMine(db, id) };
  });
}
