/**
 * GET /api/v1/org/companies (PRE-P1-29 Wave C — P-1 / G-5).
 *
 * Half of P-1's obligation: *"Where a human must choose among several authorised
 * places, they choose from a named list the Backend gave them — and the list is
 * what they may reach, not what exists."*
 *
 * Before this operation the session published company identifiers with no names
 * and nothing returned the names, so a human-readable selector could not be
 * built at all. That is G-5.
 *
 * ## The reach rule is the RLS predicate, and is not restated here
 *
 * `sel_legal_companies_tenant` is
 * `tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR
 * id = ANY (iam.allowed_company_ids()))`, and the request context pushes those
 * GUCs from the actor's own active grants. So an unrestricted actor sees the
 * tenant's companies and a company-scoped actor sees only theirs — one rule, in
 * one place.
 *
 * A TypeScript filter over `context.companyIds` would be a second copy, and it
 * would be wrong in the direction that matters: an unrestricted actor's list is
 * EMPTY, which means "everything", and a naive filter reads it as "nothing".
 *
 * ## Why `org.company.read` and why `scope: 'tenant'`
 *
 * `org.company.read` is seeded at risk `low` and its description is already the
 * plural "Read legal companies" — it was written for exactly this. Requiring
 * `org.company.manage` instead would force every workspace picker to hold the
 * authority to RESTRUCTURE the organisation, which is the over-grant-by-omission
 * the permission catalogue argues against in its own commentary.
 *
 * `scope: 'tenant'` is correct rather than lax: the permission answers "may you
 * see a directory at all", and there is no target to narrow by — the narrowing
 * is the RLS predicate. A `scope: 'company'` declaration with no target would
 * be inert anyway (`requiresScopedEvaluation` returns false on an empty target)
 * and would merely look narrower than it is.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const COMPANY_LIST_OPERATION = defineOperation({
  id: 'org.company-list',
  module: 'iam',
  method: 'GET',
  path: '/org/companies',
  summary: 'List the legal companies the acting user may reach, by name.',
  permissions: ['org.company.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  // NEVER cached. A cached reach list is a stale reach list, and the session
  // route makes the same call for the same reason: a permission set that is one
  // revocation out of date is worse than one that is slow.
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(COMPANY_LIST_OPERATION, request, async ({ db }) =>
    // No query parameter at all. A companyId filter would be a convenience
    // parameter on a list the policy has already narrowed, and it would invite
    // callers to believe the filter is the control.
    ({ body: await iamModule().organizationAdministration.listCompanies(db) })
  );
}
