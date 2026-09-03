/**
 * POST /api/v1/iam/users/{userId}/status (P1-14).
 *
 * The administrative lock, unlock, and archive path. Deliberately separate from
 * the profile PATCH: changing what someone is called and revoking their access
 * are different capabilities with different audit classes, and putting `status`
 * into a general update body is how the second becomes reachable by accident.
 *
 * Losing `active` revokes every live session in the same transaction, so
 * revocation takes effect on the caller's next request rather than at token
 * expiry. An administrator may not change their own status, and the last holder
 * of `iam.user.manage` cannot be locked or archived — a tenant must stay
 * administrable.
 *
 * `iam.session.view_all` is declared alongside `iam.user.manage` for the reason
 * set out in `sessions/route.ts` (P1-15-SR-006): the session revocation this
 * operation performs runs an `UPDATE ... WHERE`, PostgreSQL applies the SELECT
 * policies to it, and a caller who cannot read the rows revokes nothing while
 * the response and the audit record report a completed lock. Locking a user
 * whose sessions stay live is not a partial success — it is a control that
 * reports what it did not do, so the read permission is required rather than
 * assumed.
 *
 * The audit action varies with the target state, so it is recorded by the
 * service rather than by the registration. The registration declares
 * `iam.user.locked` as the representative action for the operation; the service
 * writes the precise one.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ userId: schemas.uuid });
export const StatusBody = z
  .object({
    status: z.enum(['active', 'locked', 'archived']),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const USER_STATUS_OPERATION = defineOperation({
  id: 'iam.user-status-change',
  module: 'iam',
  method: 'POST',
  path: '/iam/users/{userId}/status',
  summary: 'Lock, unlock, or archive a user and revoke their sessions.',
  permissions: ['iam.user.manage', 'iam.session.view_all'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'iam.user.locked',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    USER_STATUS_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const parsed = await parseJsonBody(raw, StatusBody);
      const user = await iamModule().users.changeStatus(
        db,
        params.userId,
        parsed.status,
        parsed.reason
      );
      return { body: user, recordVersion: user.recordVersion };
    },
    { params, body }
  );
}
