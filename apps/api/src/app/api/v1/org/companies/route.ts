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
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail } from '@/server/http/validation';
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

/**
 * Mirrors the column constraints exactly, so a malformed value is a 422 naming
 * the field rather than a 23514 from a check constraint. `.strict()` because an
 * unknown member is a caller who believes they are setting something.
 *
 * `status` is absent and cannot be supplied: a company is born `active` and
 * moves through `org.company-status-set`, which writes the history row. The
 * registration identifiers are optional and jurisdiction-neutral, exactly as the
 * columns are.
 */
export const CreateBody = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'must match ^[a-z][a-z0-9_]{1,62}$'),
    legalName: z.string().trim().min(1).max(200),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter currency code'),
    registrationNumber: z.string().trim().min(1).max(100).optional(),
    taxRegistrationNumber: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/**
 * POST /api/v1/org/companies — the Owner directive.
 *
 * The FIRST operation in the product that can add a legal company to an
 * organisation. Until now the only writer of `org.legal_companies` was
 * `org.provision_organization`, which creates exactly one company at the moment
 * the tenant is born, so an organisation that later acquired a second legal
 * entity had no way to record it.
 *
 * `scope: 'tenant'`, not `company`: there is no company to narrow by until this
 * operation has run. The narrowing that does apply is
 * `ins_legal_companies_capacity_authority`, which refuses a session that is
 * itself scoped to particular companies.
 *
 * Idempotent because a create is exactly the operation a retried request must
 * not perform twice.
 */
export const COMPANY_CREATE_OPERATION = defineOperation({
  id: 'org.company-create',
  successStatus: 201,
  module: 'iam',
  method: 'POST',
  path: '/org/companies',
  summary: 'Add a legal company to the organisation.',
  permissions: ['org.company.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.company.created',
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
    COMPANY_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const result = await iamModule().organizationAdministration.createCompany(db, {
        companyCode: parsed.code,
        legalName: parsed.legalName,
        baseCurrencyCode: parsed.baseCurrency,
        ...(parsed.registrationNumber === undefined
          ? {}
          : { registrationNumber: parsed.registrationNumber }),
        ...(parsed.taxRegistrationNumber === undefined
          ? {}
          : { taxRegistrationNumber: parsed.taxRegistrationNumber }),
      });
      return {
        status: 201,
        body: result,
        recordVersion: result.company.recordVersion,
      };
    },
    { body }
  );
}
