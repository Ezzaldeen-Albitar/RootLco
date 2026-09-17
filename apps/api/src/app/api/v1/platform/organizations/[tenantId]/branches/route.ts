/**
 * POST /api/v1/platform/organizations/{tenantId}/branches (P1-32-PRE-151).
 *
 * Opens a branch in a company of an organisation that is already running.
 *
 * Everything the sibling company route says applies here, and one thing more:
 * three of the eight registered numbering runs — invoice, quotation and receipt
 * — are configured PER BRANCH, and `shared.next_display_number` refuses rather
 * than degrading when a row is missing. A branch created without them cannot
 * issue an invoice, quote a job or receipt a payment, and the failure arrives
 * weeks later as an error nobody can explain. That is why the console goes
 * through `iam`'s branch port rather than issuing an INSERT: the port writes the
 * runs and refuses the whole act if any is still missing, so there is no
 * half-configured branch to discover.
 *
 * The parent company is resolved INSIDE the target organisation before the
 * insert, so a company of another organisation never reaches the composite
 * foreign key as a 500. The shared `iam` port answers an unreachable parent as
 * a DENIAL — `403 ERR-IAM-001` — and the console inherits that answer
 * unchanged, so an operator learns the identifier is not theirs to build on
 * rather than whether it exists somewhere else. `tg_branches_capacity` owns the
 * ceiling.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid }).strict();

/**
 * The tenant operation's own body. `timezone` is required and has no default:
 * `org.branches.timezone_name` is NOT NULL against the approved IANA list and
 * picking one for the operator would be inventing a fact about where somebody
 * else's business is.
 */
export const BranchCreateBody = z
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

export const ORGANIZATION_BRANCH_CREATE_OPERATION = defineOperation({
  id: 'platform.organization-branch-create',
  successStatus: 201,
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/branches',
  summary: 'Open a branch in a company of an existing organization.',
  permissions: ['platform.organization.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.branch.created',
  idempotent: true,
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ tenantId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ORGANIZATION_BRANCH_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(BranchCreateBody, body, 'body');
      const result = await platformModule().organizations.addBranch(db, params.tenantId, {
        companyId: input.companyId,
        branchCode: input.code,
        name: input.name,
        timezoneName: input.timezone,
        ...(input.city === undefined ? {} : { city: input.city }),
        ...(input.countryCode === undefined ? {} : { countryCode: input.countryCode }),
      });
      return { status: 201, body: result, recordVersion: result.branch.recordVersion };
    },
    { params: raw, body }
  );
}
