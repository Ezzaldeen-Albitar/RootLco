/**
 * PATCH /api/v1/org/companies/{companyId} (PRE-P1-29 Wave C — G-4).
 *
 * `org.company.manage` was seeded and guarded NOTHING: zero references in
 * `apps/api/src` and zero in `apps/web/src`. Holding it conferred exactly
 * nothing. This is the operation it was written for.
 *
 * ## `status` is absent from the body, deliberately
 *
 * A company's status moves through `org.company-status-set`, which calls
 * `org.change_company_status` so that migration 133's emitter writes the history
 * row. Accepting `status` here would create a second transition path with no
 * reason, no history and no graph — and because the body is `.strict()`, a
 * caller who sends it is told 422 rather than having it silently dropped.
 *
 * `companyCode` and `tenantId` are absent for a different reason: they are
 * frozen by `tg_legal_companies_immutable`, so the database would refuse them.
 * Leaving them out of the schema turns a confusing 23514 into a clear 422.
 *
 * ## Authorization is decided against the ROW, after resolving it
 *
 * The service reads the company first and then calls `authorizeScope` with the
 * company's own id. A caller cannot reach another company by naming it, because
 * nothing they sent is used as the authorization target.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ companyId: schemas.uuid }).strict();

export const Body = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    baseCurrencyCode: z.string().length(3).optional(),
    // Nullable AND optional: these are legitimately clearable, and the two
    // states differ. `undefined` means "leave it"; `null` means "remove it".
    registrationNumber: z.string().trim().min(1).max(100).nullable().optional(),
    taxRegistrationNumber: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be supplied',
  });

export const COMPANY_UPDATE_OPERATION = defineOperation({
  id: 'org.company-update',
  module: 'iam',
  method: 'PATCH',
  path: '/org/companies/{companyId}',
  summary: 'Update a legal company.',
  permissions: ['org.company.manage'],
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'org.company.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ companyId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    COMPANY_UPDATE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const result = await iamModule().organizationAdministration.updateCompany(
        db,
        params.companyId,
        parsed,
        expectedVersion,
        authorizeScope
      );
      return { body: result, recordVersion: result.company.recordVersion };
    },
    { params: raw, body }
  );
}
