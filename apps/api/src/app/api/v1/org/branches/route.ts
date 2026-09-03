/**
 * GET /api/v1/org/branches (PRE-P1-29 Wave C — P-1 / G-5).
 *
 * The second half of P-1. Together with `org.company-list` it satisfies the
 * canonical obligation to return *the companies and branches an actor may
 * reach, by name*.
 *
 * ## Why this is a separate operation rather than one combined reach read
 *
 * `evaluatePermissions` requires EVERY declared code to be true, so a combined
 * operation declaring both `org.company.read` and `org.branch.read` would refuse
 * an actor who holds one and not the other — and a branch-only reader is a real
 * shape, not a hypothetical. Splitting them is what makes each list reachable by
 * exactly the authority it needs.
 *
 * ## `companyId` travels with every row
 *
 * A branch name is only unambiguous underneath its company: two companies in one
 * tenant may each have a "Main Workshop". The selector P-1 describes is a
 * two-level choice, so the relationship is part of the minimum data, not an
 * extra. The projection stops there — no address lines, no created-by, nothing
 * a picker does not need.
 *
 * The reach rule is `sel_branches_scope`, not this file. See the sibling
 * company list for why it is not restated in TypeScript.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const BRANCH_LIST_OPERATION = defineOperation({
  id: 'org.branch-list',
  module: 'iam',
  method: 'GET',
  path: '/org/branches',
  summary: 'List the branches the acting user may reach, by name.',
  permissions: ['org.branch.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(BRANCH_LIST_OPERATION, request, async ({ db }) => ({
    body: await iamModule().organizationAdministration.listBranches(db),
  }));
}
