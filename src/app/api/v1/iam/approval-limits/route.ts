/**
 * GET / POST /api/v1/iam/approval-limits (P1-14).
 *
 * Money crosses this boundary as a **decimal string** with an ISO-4217 code and
 * stays a string all the way to the bound parameter. It is never parsed into a
 * JavaScript number: IEEE-754 cannot represent 0.1 exactly, and
 * `iam.approval_limits.amount` is `numeric(18,4)` — turning an exact contract
 * into an approximate one at the API edge would be silent and permanent.
 *
 * Escalation controls: exactly one subject (role **or** user, never both), no
 * limit for yourself, the company must be inside your own scope, and the two
 * EXCLUDE constraints refuse an overlapping window for the same subject and
 * type — which is what stops "raise my ceiling by adding a second, higher,
 * overlapping limit".
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
  companyId: schemas.uuid.optional(),
  userId: schemas.uuid.optional(),
});

const CreateBody = z
  .object({
    companyId: schemas.uuid,
    roleId: schemas.uuid.nullable().optional(),
    userId: schemas.uuid.nullable().optional(),
    /** Matches `ck_approval_limits_type_format`. */
    limitType: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    /** Decimal string, never a number. Validated against `numeric(18,4)`. */
    amount: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .strict();

export const APPROVAL_LIMIT_LIST_OPERATION = defineOperation({
  id: 'iam.approval-limit-list',
  module: 'iam',
  method: 'GET',
  path: '/iam/approval-limits',
  summary: 'List approval limits in the caller tenant.',
  permissions: ['iam.approval.manage'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const APPROVAL_LIMIT_CREATE_OPERATION = defineOperation({
  id: 'iam.approval-limit-create',
  module: 'iam',
  method: 'POST',
  path: '/iam/approval-limits',
  summary: 'Create an approval limit for a role or a user within a company.',
  permissions: ['iam.approval.manage'],
  scope: 'tenant',
  auditClass: 'approval',
  auditAction: 'iam.approval_limit.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(APPROVAL_LIMIT_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return {
      body: { items: await iamModule().access.listApprovalLimits(db, query) },
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    APPROVAL_LIMIT_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await iamModule().access.createApprovalLimit(db, await parseJsonBody(raw, CreateBody)),
    }),
    { body }
  );
}
