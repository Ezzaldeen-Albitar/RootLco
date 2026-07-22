/**
 * GET / POST /api/v1/iam/grants/{grantId}/scopes (P1-14).
 *
 * Adding a scope widens what a grant reaches, so it is bounded by the same rule
 * as issuing one: an administrator cannot scope a grant into a company or branch
 * they do not themselves hold, and the branch's company is resolved from the
 * database rather than taken from the request.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ grantId: schemas.uuid });
const ScopeBody = z
  .object({
    scopeType: z.enum(['company', 'branch', 'department']),
    companyId: schemas.uuid,
    branchId: schemas.uuid.nullable().optional(),
    departmentId: schemas.uuid.nullable().optional(),
  })
  .strict();

export const GRANT_SCOPE_LIST_OPERATION = defineOperation({
  id: 'iam.grant-scope-list',
  module: 'iam',
  method: 'GET',
  path: '/iam/grants/{grantId}/scopes',
  summary: 'List the scopes attached to a grant.',
  permissions: ['iam.role.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const GRANT_SCOPE_ADD_OPERATION = defineOperation({
  id: 'iam.grant-scope-add',
  module: 'iam',
  method: 'POST',
  path: '/iam/grants/{grantId}/scopes',
  summary: 'Attach a company, branch, or department scope to a grant.',
  permissions: ['iam.grant.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.grant.scope_added',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ grantId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    GRANT_SCOPE_LIST_OPERATION,
    request,
    async ({ db }) => ({
      body: { items: await iamModule().access.listScopes(db, params.grantId) },
    }),
    { params }
  );
}

export async function POST(
  request: Request,
  route: { params: Promise<{ grantId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    GRANT_SCOPE_ADD_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await iamModule().access.addScope(
        db,
        params.grantId,
        await parseJsonBody(raw, ScopeBody)
      ),
    }),
    { params, body }
  );
}
