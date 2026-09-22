/**
 * GET /api/v1/auth/working-context (Owner directive, P1-32-PRE-OD-UX).
 *
 * The companies and branches the caller may act in, by name.
 *
 * ## Why this is not the administration reach read
 *
 * `org.company-list` and `org.branch-list` answer the same shape and are guarded by
 * `org.company.read` / `org.branch.read` — the codes that let an ADMINISTRATOR
 * maintain the organisation. Every branch-scoped screen in the product has to know
 * which branch it is showing before it can ask for anything, and the people using
 * those screens hold no administration code at all. Routing the product's own
 * navigation through an administration permission would push a tenant towards
 * granting it, which is the opposite of what that permission is for.
 *
 * So this operation carries `iam.user.read` — the code the session read already
 * carries — and returns strictly the caller's own reach. Nothing here is a fact the
 * caller does not already hold: the narrowing is `sel_legal_companies_tenant` and
 * `sel_branches_scope` reading the caller's own resolved grants, and a principal
 * holding no active grant is answered with two empty arrays.
 *
 * `scope: 'tenant'`, and there is no company or branch parameter: the request names
 * no target, because naming one is the very thing the caller cannot yet do.
 *
 * `auditClass: 'none'` matches the session read beside it: a caller reading its own
 * scope writes no audit trail, and the two reads are the same act of a client
 * rendering itself.
 *
 * `cacheCategory: 'never'`, for the reason the session read gives — a cached reach
 * is a stale reach, and a revoked grant must stop working immediately.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const WORKING_CONTEXT_OPERATION = defineOperation({
  id: 'iam.working-context-read',
  module: 'iam',
  method: 'GET',
  path: '/auth/working-context',
  summary: 'List the companies and branches the acting user may work in.',
  permissions: ['iam.user.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(WORKING_CONTEXT_OPERATION, request, async ({ db }) => ({
    body: await iamModule().workingContext.describe(db),
  }));
}
