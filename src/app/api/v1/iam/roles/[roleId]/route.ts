/**
 * PATCH /api/v1/iam/roles/{roleId} (P1-14).
 *
 * Renames, re-describes, or archives a role. `roleCode` and `is_system` are not
 * accepted and are not grantable columns: the code is an identifier other
 * records reference, and a role that could change its own code would silently
 * change what every grant means.
 *
 * Archiving is a soft delete (`deleted_at`). There is no hard delete: grants
 * reference roles with `ON DELETE RESTRICT`, and removing a role would erase the
 * meaning of every historical grant that pointed at it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ roleId: schemas.uuid });
const PatchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    archive: z.boolean().optional(),
  })
  .strict();

export const ROLE_UPDATE_OPERATION = defineOperation({
  id: 'iam.role-update',
  module: 'iam',
  method: 'PATCH',
  path: '/iam/roles/{roleId}',
  summary: 'Rename, re-describe, or archive a tenant role.',
  permissions: ['iam.role.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.role.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ roleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    ROLE_UPDATE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const body = await parseJsonBody(raw, PatchBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const role = await iamModule().access.updateRole(db, params.roleId, expectedVersion, body);
      return { body: role, recordVersion: role.recordVersion };
    },
    { params }
  );
}
