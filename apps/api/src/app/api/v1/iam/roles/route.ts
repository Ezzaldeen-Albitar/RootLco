/**
 * GET / POST /api/v1/iam/roles (P1-14).
 *
 * Creating a role creates an empty container: it confers nothing until
 * permissions are mapped onto it, and mapping is separately delegation-checked.
 * `is_system` is written as `false` and is not an input — `ins_roles_admin`
 * refuses `is_system = true` and `org.guard_immutable_columns` freezes it
 * afterwards, so a tenant role can never become platform contract.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
  cursor: schemas.cursor.optional(),
  limit: schemas.limit.optional(),
});

export const CreateBody = z
  .object({
    /** Matches `ck_roles_code_format`; checked here so a bad code is a 422, not a 23514. */
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
  })
  .strict();

export const ROLE_LIST_OPERATION = defineOperation({
  id: 'iam.role-list',
  module: 'iam',
  method: 'GET',
  path: '/iam/roles',
  summary: 'List roles in the caller tenant.',
  permissions: ['iam.role.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const ROLE_CREATE_OPERATION = defineOperation({
  id: 'iam.role-create',
  successStatus: 201,
  module: 'iam',
  method: 'POST',
  path: '/iam/roles',
  summary: 'Create a tenant role.',
  permissions: ['iam.role.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.role.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(ROLE_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return {
      body: await iamModule().access.listRoles(db, {
        cursor: query.cursor,
        limit: query.limit,
      }),
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ROLE_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await iamModule().access.createRole(db, await parseJsonBody(raw, CreateBody)),
    }),
    { body }
  );
}
