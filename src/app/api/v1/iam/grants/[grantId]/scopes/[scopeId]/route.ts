/**
 * DELETE /api/v1/iam/grants/{grantId}/scopes/{scopeId} (P1-14).
 *
 * Removes one scope from a grant. `iam.grant_scopes` is the second of the two
 * tables where `app_runtime` holds DELETE, for the same reason as
 * `iam.role_permissions`: an association row carries no history of its own.
 *
 * Removing the **last** scope of a `scoped` grant is refused — but at COMMIT,
 * by `tg_grant_scopes_require_scope`, which is DEFERRABLE INITIALLY DEFERRED.
 * That is the database's deliberate design: it lets a caller swap scopes inside
 * one transaction. The refusal therefore arrives as a failed request with
 * nothing committed, which is correct, just later in the transaction than a
 * row-level check would be.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ grantId: schemas.uuid, scopeId: schemas.uuid });

export const GRANT_SCOPE_REMOVE_OPERATION = defineOperation({
  id: 'iam.grant-scope-remove',
  module: 'iam',
  method: 'DELETE',
  path: '/iam/grants/{grantId}/scopes/{scopeId}',
  summary: 'Remove a scope from a grant.',
  permissions: ['iam.grant.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.grant.scope_removed',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function DELETE(
  request: Request,
  route: { params: Promise<{ grantId: string; scopeId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    GRANT_SCOPE_REMOVE_OPERATION,
    request,
    async ({ db }) => {
      await iamModule().access.removeScope(db, params.grantId, params.scopeId);
      return { body: { status: 'removed' } };
    },
    { params }
  );
}
