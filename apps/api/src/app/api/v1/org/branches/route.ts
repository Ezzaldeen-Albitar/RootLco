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
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
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

/**
 * `timezone` is REQUIRED and has no default.
 *
 * `org.branches.timezone_name` is NOT NULL with a foreign key into the approved
 * IANA list, and there is no platform-wide default timezone to fall back on. A
 * branch inherits nothing here: picking one for the operator would be inventing
 * a fact about where their business is.
 */
export const CreateBody = z
  .object({
    companyId: schemas.uuid,
    code: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'must match ^[a-z][a-z0-9_]{1,62}$'),
    name: z.string().trim().min(1).max(200),
    timezone: z.string().trim().min(3).max(64),
    city: z.string().trim().min(1).max(120).optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, 'must be a two-letter country code')
      .optional(),
  })
  .strict();

/**
 * POST /api/v1/org/branches — the Owner directive.
 *
 * The FIRST operation that can add a branch to a company. `org.provision_organization`
 * creates the pilot branch and nothing after it, so an organisation that opened
 * a second workshop had no way to record it.
 *
 * `scope: 'company'` with the company taken from the BODY, because there is no
 * branch to resolve yet — the same arrangement `org.department-create` uses, and
 * for the same reason. The service re-checks the company against what this
 * session can SEE before the insert, so a cross-tenant identifier is a denial
 * rather than a composite-foreign-key 500.
 */
export const BRANCH_CREATE_OPERATION = defineOperation({
  id: 'org.branch-create',
  successStatus: 201,
  module: 'iam',
  method: 'POST',
  path: '/org/branches',
  summary: 'Add a branch to a legal company.',
  permissions: ['org.branch.manage'],
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'org.branch.created',
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
    BRANCH_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const result = await iamModule().organizationAdministration.createBranch(
        db,
        {
          companyId: parsed.companyId,
          branchCode: parsed.code,
          name: parsed.name,
          timezoneName: parsed.timezone,
          ...(parsed.city === undefined ? {} : { city: parsed.city }),
          ...(parsed.countryCode === undefined ? {} : { countryCode: parsed.countryCode }),
        },
        authorizeScope
      );
      return {
        status: 201,
        body: result,
        recordVersion: result.branch.recordVersion,
      };
    },
    { body }
  );
}
