/**
 * DELETE /api/v1/iam/grants/{grantId} (P1-14).
 *
 * Revokes a grant. Not a row deletion — `app_runtime` holds no DELETE on
 * `iam.role_grants`, and it should not: the record that someone once held a role
 * is exactly what an auditor needs. `status` moves to `revoked` and `revoked_at`
 * is set, together, because `ck_role_grants_revoke_consistency` requires it.
 *
 * Effective immediately: `resolveScopeFor()` and `iam.has_permission` both read
 * `status = 'active'` on every request, and nothing caches the result — so the
 * revoked principal's next request is already denied.
 *
 * Refused when it would remove the last holder of `iam.user.manage`,
 * `iam.grant.manage`, or `iam.role.manage` in the tenant. The count is taken
 * `FOR UPDATE` inside this transaction, so two concurrent revocations cannot
 * both see a survivor and both proceed.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ grantId: schemas.uuid });
export const RevokeBody = z.object({ reason: z.string().min(1).max(500) }).strict();

export const GRANT_REVOKE_OPERATION = defineOperation({
  id: 'iam.grant-revoke',
  module: 'iam',
  method: 'DELETE',
  path: '/iam/grants/{grantId}',
  summary: 'Revoke a role grant with immediate effect.',
  permissions: ['iam.grant.manage'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'iam.grant.revoked',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function DELETE(
  request: Request,
  route: { params: Promise<{ grantId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    GRANT_REVOKE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const body = await parseJsonBody(raw, RevokeBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      await iamModule().access.revokeGrant(db, params.grantId, expectedVersion, body.reason);
      return { body: { status: 'revoked' } };
    },
    { params }
  );
}
