/**
 * GET / DELETE /api/v1/iam/users/{userId}/sessions (P1-14).
 *
 * Listing another principal's sessions requires `iam.session.view_all`, which is
 * also the permission the `sel_user_sessions_admin` policy checks — so a caller
 * without it sees nothing even if this operation were mis-declared.
 *
 * DELETE is the privileged "sign that person out everywhere" action. It is
 * separate from `POST /auth/logout` on purpose: ending your own session and
 * ending someone else's are the same mechanism with very different authority,
 * and only one of them should be reachable without a permission.
 *
 * Revocation is terminal — both session UPDATE policies carry
 * `revoked_at IS NULL` in `USING`, so a revoked session cannot be resurrected.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ userId: schemas.uuid });
const RevokeBody = z.object({ reason: z.string().min(1).max(500) }).strict();

export const USER_SESSION_LIST_OPERATION = defineOperation({
  id: 'iam.user-session-list',
  module: 'iam',
  method: 'GET',
  path: '/iam/users/{userId}/sessions',
  summary: 'List the sessions of a user.',
  permissions: ['iam.session.view_all'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const USER_SESSION_REVOKE_OPERATION = defineOperation({
  id: 'iam.user-session-revoke-all',
  module: 'iam',
  method: 'DELETE',
  path: '/iam/users/{userId}/sessions',
  summary: 'Revoke every live session of a user.',
  permissions: ['iam.user.manage'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'iam.session.revoked_all',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    USER_SESSION_LIST_OPERATION,
    request,
    async ({ db }) => ({
      body: { items: await iamModule().users.listSessions(db, params.userId) },
    }),
    { params }
  );
}

export async function DELETE(
  request: Request,
  route: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    USER_SESSION_REVOKE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const body = await parseJsonBody(raw, RevokeBody);
      const revoked = await iamModule().users.revokeAllSessions(db, params.userId, body.reason);
      return { body: { revoked } };
    },
    { params }
  );
}
