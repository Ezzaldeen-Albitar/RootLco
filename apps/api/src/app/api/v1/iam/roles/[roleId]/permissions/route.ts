/**
 * GET / POST /api/v1/iam/roles/{roleId}/permissions (P1-14).
 *
 * Mapping a permission onto a role is the primary escalation surface in the
 * platform, so POST is delegation-checked twice: `DelegationPolicy` refuses an
 * `allow` mapping for a permission the caller does not hold, and
 * `ins_role_permissions_delegable` refuses the same thing in RLS.
 *
 * `deny` is exempt from the check. Refusing to let an administrator *remove*
 * access they do not personally hold would be a safety regression wearing a
 * safety control's clothes — and deny takes precedence over allow everywhere in
 * `iam.has_permission`, so a deny mapping only ever reduces reach.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ roleId: schemas.uuid });
export const AddBody = z
  .object({
    permissionCode: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/),
    effect: z.enum(['allow', 'deny']),
  })
  .strict();

export const ROLE_PERMISSION_LIST_OPERATION = defineOperation({
  id: 'iam.role-permission-list',
  module: 'iam',
  method: 'GET',
  path: '/iam/roles/{roleId}/permissions',
  summary: 'List the permission mappings of a role.',
  permissions: ['iam.role.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const ROLE_PERMISSION_ADD_OPERATION = defineOperation({
  id: 'iam.role-permission-add',
  module: 'iam',
  method: 'POST',
  path: '/iam/roles/{roleId}/permissions',
  summary: 'Map a permission onto a role with an allow or deny effect.',
  permissions: ['iam.role.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.role.permission_added',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ roleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    ROLE_PERMISSION_LIST_OPERATION,
    request,
    async ({ db }) => ({
      body: { items: await iamModule().access.listRolePermissions(db, params.roleId) },
    }),
    { params }
  );
}

export async function POST(
  request: Request,
  route: { params: Promise<{ roleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ROLE_PERMISSION_ADD_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await iamModule().access.addRolePermission(
        db,
        params.roleId,
        await parseJsonBody(raw, AddBody)
      ),
    }),
    { params, body }
  );
}
