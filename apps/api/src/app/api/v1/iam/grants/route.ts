/**
 * POST /api/v1/iam/grants (P1-14).
 *
 * Grants a role to a user, optionally scoped to companies and branches.
 *
 * Four escalation controls apply before anything is written, and the database
 * re-applies the two that matter most:
 *
 *  - **no self-grant** — also `ck_role_grants_no_self_grant`;
 *  - **no composition escalation** — the caller must already hold every
 *    allow-permission the role confers; also `ins_role_grants_delegable`;
 *  - **no scope outside the caller's own authority**;
 *  - **scope parts must belong together** — the branch is resolved to its
 *    company from the database, never taken from the request.
 *
 * Scopes are written in the same transaction because
 * `tg_role_grants_require_scope` is a DEFERRABLE constraint trigger: a `scoped`
 * grant with no scope row fails at COMMIT.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ScopeInput = z
  .object({
    scopeType: z.enum(['company', 'branch', 'department']),
    companyId: schemas.uuid,
    branchId: schemas.uuid.nullable().optional(),
    departmentId: schemas.uuid.nullable().optional(),
  })
  .strict();

export const GrantBody = z
  .object({
    userId: schemas.uuid,
    roleId: schemas.uuid,
    /** ISO-8601. Omit for an open-ended grant. */
    validTo: z.string().datetime().nullable().optional(),
    approvalRef: z.string().max(200).nullable().optional(),
    scopes: z.array(ScopeInput).max(50).optional(),
  })
  .strict();

export const GRANT_ISSUE_OPERATION = defineOperation({
  id: 'iam.grant-issue',
  successStatus: 201,
  module: 'iam',
  method: 'POST',
  path: '/iam/grants',
  summary: 'Grant a role to a user, optionally scoped to companies or branches.',
  permissions: ['iam.grant.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.grant.issued',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    GRANT_ISSUE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await iamModule().access.issueGrant(db, await parseJsonBody(raw, GrantBody)),
    }),
    { body }
  );
}
