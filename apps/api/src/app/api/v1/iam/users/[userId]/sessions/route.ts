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
 *
 * ===========================================================================
 * WHY REVOCATION ALSO DECLARES `iam.session.view_all` (P1-15-SR-006)
 * ===========================================================================
 * It looks redundant beside `iam.user.manage`, which is what the
 * `upd_user_sessions_admin` UPDATE policy checks. It is not.
 *
 * PostgreSQL applies **SELECT** policies to an `UPDATE` whose `WHERE` clause
 * reads columns of the relation, and revocation's WHERE clause does exactly
 * that (`tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`). The two
 * SELECT policies on `iam.user_sessions` are `sel_user_sessions_own`
 * (`user_id = iam.current_user_id()`) and `sel_user_sessions_admin`
 * (`iam.has_permission('iam.session.view_all')`).
 *
 * So a caller holding `iam.user.manage` **without** `iam.session.view_all`
 * could not see another user's session rows, the scan matched nothing, and the
 * UPDATE policy that names their permission was never reached. The request
 * answered `200 {"revoked": 0}`, appended a `security`-class audit record, and
 * published a `session.revoked` event — while the compromised session stayed
 * live. A security control that reports success and does nothing is worse than
 * one that fails, because nothing surfaces it.
 *
 * Declaring the read permission moves that outcome to a 403 at the gate, before
 * any audit record or event is written. It is the honest declaration: this
 * operation genuinely cannot function without read visibility of the rows it
 * intends to change. The alternative — a new SELECT policy gated on
 * `iam.user.manage` — is a database change and belongs to a change request, not
 * to a feature branch.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ userId: schemas.uuid });
export const RevokeBody = z.object({ reason: z.string().min(1).max(500) }).strict();

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
  // Both, and the second is not redundant — see the note at the top of this file.
  permissions: ['iam.user.manage', 'iam.session.view_all'],
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
