/**
 * GET /api/v1/org/reference-values (P1-32-PRE-OD-REF).
 *
 * The currencies, time zones and languages a tenant's organisation screens offer
 * as choices: the company base currency, the branch time zone, and the tenant's
 * default language and time zone. ACTIVE rows of shared.currencies,
 * shared.timezones and shared.languages, each in code order, so a value seeded
 * later appears without a code change.
 *
 * It declares `org.tenant.read`, the code `iam.tenant-settings-read` already
 * declares for the same screen, so a caller who can read the tenant settings can
 * read the choices beside them. It reads as `app_runtime` through the existing
 * `sel_*_all` policies. The registers hold no tenant data, so the read is never
 * narrowed to a working company or branch, and none is resolved for it.
 *
 * The body is `ReferenceValuesView`, the same named shape
 * `platform.reference-values-read` serialises to the console. Nothing is
 * written, so there is no audit action and no idempotency.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, searchParamsToObject } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deliberately empty and `.strict()`: the registers are small and unpaged, and
 * an unknown parameter is a client defect worth naming rather than ignoring.
 */
const Query = z.object({}).strict();

export const ORG_REFERENCE_VALUES_READ_OPERATION = defineOperation({
  id: 'org.reference-values-read',
  module: 'iam',
  method: 'GET',
  path: '/org/reference-values',
  summary: 'List the active currencies, time zones and languages the organisation screens offer.',
  permissions: ['org.tenant.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    ORG_REFERENCE_VALUES_READ_OPERATION,
    request,
    async ({ db, request: raw }) => {
      parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query');
      return { body: await iamModule().organization.readReferenceValues(db) };
    }
  );
}
