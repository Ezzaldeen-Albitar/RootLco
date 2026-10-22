/**
 * GET /api/v1/org/capacity — the Owner directive.
 *
 * What the organisation may hold, what it holds, and under which subscription.
 *
 * ## Why this operation exists at all
 *
 * `org.subscription_plans.capacity_limits` has been in the schema since P1-03
 * and nothing read it, so the ceilings it declared were decoration. The
 * companion migration makes them real, which immediately creates a second
 * obligation: a refusal an administrator cannot explain is worse than no
 * refusal. `org.company-create` and `iam.invitation-create` now answer
 * ERR-CAP-001 with the kind, the limit and the usage attached — and this read is
 * how the same person sees the picture BEFORE they hit it, rather than
 * discovering the ceiling by walking into it.
 *
 * ## The numbers come from the function the refusal is computed from
 *
 * `org.capacity_usage`, called by name. Reassembling "how many branches count"
 * in TypeScript would give the screen a second definition, and the two would
 * agree until the day the vocabulary moved — at which point the screen would
 * confidently explain a refusal that did not happen for the reason it gave.
 *
 * ## `org.tenant.read` and not a management code
 *
 * The question is "what is my organisation entitled to", which is the same
 * question the tenant profile answers and is seeded at risk `low` for exactly
 * that reason. Requiring `org.company.manage` would mean only the person who can
 * RESTRUCTURE the organisation could see why they were refused, and would hide
 * the explanation from every administrator who merely invites users — the code
 * whose own ceiling is the one most often reached.
 *
 * `scope: 'tenant'`: the numbers are tenant-wide by definition, and there is no
 * target to narrow by. A company-scoped reader sees the whole organisation's
 * allowance here, which is the honest answer — the allowance is not divisible.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const CAPACITY_READ_OPERATION = defineOperation({
  id: 'org.capacity-read',
  module: 'iam',
  method: 'GET',
  path: '/org/capacity',
  summary: 'Read the organisation capacity allowances and the subscription behind them.',
  permissions: ['org.tenant.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  // NEVER cached. A cached allowance is a stale allowance, and this read exists
  // to explain a refusal that was decided one transaction ago.
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(CAPACITY_READ_OPERATION, request, async ({ db }) => ({
    body: await iamModule().organizationAdministration.readCapacity(db),
  }));
}
