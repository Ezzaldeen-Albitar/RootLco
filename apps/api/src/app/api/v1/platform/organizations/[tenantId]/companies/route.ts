/**
 * POST /api/v1/platform/organizations/{tenantId}/companies (P1-32-PRE-151).
 *
 * Adds a legal company to an organisation that is already running.
 *
 * ## Why the console needs its own path to a write `org.company-create` already does
 *
 * `org.company-create` is a TENANT operation: it authorizes with
 * `org.company.manage`, runs as `app_runtime`, and takes its tenant from the
 * caller's own session. A Platform Owner operator holds none of that inside
 * somebody else's organisation, and the situations the console exists for are
 * exactly the ones where nobody inside it can act — an organisation whose
 * administrator has not arrived, or one being restructured on the Owner's
 * instruction.
 *
 * ## The write is the SAME write
 *
 * The handler calls one platform service, which opens a platform-on-target
 * window for the named organisation and calls `iam`'s company port — the same
 * statement, the same duplicate-code refusal, the same capacity refusal. The
 * ceiling is `tg_legal_companies_capacity` on the table: the control plane is
 * inside its arithmetic since 20260916096000 granted it the counting functions,
 * so a console write meets `ERR-CAP-001` exactly where a tenant write does.
 *
 * `platform.organization.manage`, and no tenant permission: the authority to
 * restructure an organisation from outside it is a platform authority, and the
 * policies added with this slice are predicated on that code.
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
 * The tenant operation's own body, field for field.
 *
 * Deliberately identical: a console form that asked for more, or accepted less,
 * would produce companies the tenant surface could not have produced, and the
 * two would drift the first time a column changed.
 */
export const CompanyCreateBody = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'must match ^[a-z][a-z0-9_]{1,62}$'),
    legalName: z.string().trim().min(1).max(200),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter currency code'),
    registrationNumber: z.string().trim().min(1).max(100).optional(),
    taxRegistrationNumber: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const ORGANIZATION_COMPANY_CREATE_OPERATION = defineOperation({
  id: 'platform.organization-company-create',
  successStatus: 201,
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/companies',
  summary: 'Add a legal company to an existing organization.',
  permissions: ['platform.organization.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.company.created',
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
    ORGANIZATION_COMPANY_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(CompanyCreateBody, body, 'body');
      const result = await platformModule().organizations.addCompany(db, params.tenantId, {
        companyCode: input.code,
        legalName: input.legalName,
        baseCurrencyCode: input.baseCurrency,
        ...(input.registrationNumber === undefined
          ? {}
          : { registrationNumber: input.registrationNumber }),
        ...(input.taxRegistrationNumber === undefined
          ? {}
          : { taxRegistrationNumber: input.taxRegistrationNumber }),
      });
      return { status: 201, body: result, recordVersion: result.company.recordVersion };
    },
    { params: raw, body }
  );
}
