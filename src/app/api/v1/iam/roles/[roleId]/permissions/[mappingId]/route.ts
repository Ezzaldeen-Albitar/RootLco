/**
 * PATCH / DELETE /api/v1/iam/roles/{roleId}/permissions/{mappingId} (P1-14).
 *
 * PATCH flips a mapping between `allow` and `deny`; it is the only mutable
 * column on `iam.role_permissions` and the only one the grant covers. Flipping
 * *to* `allow` is delegation-checked; flipping to `deny` is not, for the reason
 * given on the collection route.
 *
 * DELETE removes the mapping entirely. `iam.role_permissions` is one of exactly
 * two tables in the whole platform where `app_runtime` holds DELETE, and that is
 * deliberate: an association row has no history worth preserving, unlike the
 * grant it feeds.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ roleId: schemas.uuid, mappingId: schemas.uuid });
const PatchBody = z.object({ effect: z.enum(['allow', 'deny']) }).strict();

export const ROLE_PERMISSION_UPDATE_OPERATION = defineOperation({
  id: 'iam.role-permission-update',
  module: 'iam',
  method: 'PATCH',
  path: '/iam/roles/{roleId}/permissions/{mappingId}',
  summary: 'Change a permission mapping between allow and deny.',
  permissions: ['iam.role.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.role.permission_changed',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export const ROLE_PERMISSION_REMOVE_OPERATION = defineOperation({
  id: 'iam.role-permission-remove',
  module: 'iam',
  method: 'DELETE',
  path: '/iam/roles/{roleId}/permissions/{mappingId}',
  summary: 'Remove a permission mapping from a role.',
  permissions: ['iam.role.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.role.permission_removed',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ roleId: string; mappingId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    ROLE_PERMISSION_UPDATE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const body = await parseJsonBody(raw, PatchBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      await iamModule().access.changeRolePermissionEffect(
        db,
        params.roleId,
        params.mappingId,
        expectedVersion,
        body.effect
      );
      return { body: { status: 'updated' } };
    },
    { params }
  );
}

export async function DELETE(
  request: Request,
  route: { params: Promise<{ roleId: string; mappingId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    ROLE_PERMISSION_REMOVE_OPERATION,
    request,
    async ({ db }) => {
      await iamModule().access.removeRolePermission(db, params.roleId, params.mappingId);
      return { body: { status: 'removed' } };
    },
    { params }
  );
}
