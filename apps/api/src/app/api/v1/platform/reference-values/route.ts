/**
 * GET /api/v1/platform/reference-values (P1-32-PRE-OD-REF).
 *
 * The currencies, time zones and languages the Platform Owner Console offers as
 * choices when it provisions an organisation or adds a company or a branch to
 * one. Until this read existed those fields were free text, and an operator
 * learned that a code was unknown only when the database refused it. The rows
 * come from shared.currencies, shared.timezones and shared.languages — ACTIVE
 * rows only, each in code order — so a value seeded later appears here without
 * a code change.
 *
 * ## Why `platform.organization.read`
 *
 * It is the console's base entitlement: every platform grant set must contain
 * it (`platformGrantSetRefusal` in scripts/platform/genesis-platform-operator.mjs
 * refuses one that does not), and `platform.session-read` — the first request
 * every console page makes — declares it. So every operator who can open the
 * Provision page already holds it, and declaring it here gates no one out.
 * The `platform.` prefix routes authorization to `iam.has_platform_authority`
 * and the transaction to the platform connection, where migration
 * 20260927090000 grants `app_platform` SELECT on the three registers.
 *
 * The body is `ReferenceValuesView`, the same named shape
 * `org.reference-values-read` serialises to a tenant. Nothing is written, so
 * there is no audit action and no idempotency.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, searchParamsToObject } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deliberately empty and `.strict()`: the registers are small and unpaged, and
 * an unknown parameter is a client defect worth naming rather than ignoring.
 */
const Query = z.object({}).strict();

export const PLATFORM_REFERENCE_VALUES_READ_OPERATION = defineOperation({
  id: 'platform.reference-values-read',
  module: 'platform',
  method: 'GET',
  path: '/platform/reference-values',
  summary: 'List the active currencies, time zones and languages the console offers as choices.',
  permissions: ['platform.organization.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    PLATFORM_REFERENCE_VALUES_READ_OPERATION,
    request,
    async ({ db, request: raw }) => {
      parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query');
      return { body: await platformModule().organizations.referenceValues(db) };
    }
  );
}
