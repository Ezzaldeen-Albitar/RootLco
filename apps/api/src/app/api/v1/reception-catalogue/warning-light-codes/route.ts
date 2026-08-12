/**
 * GET /api/v1/reception-catalogue/warning-light-codes (P1-27 remediation executed by P1-18,
 * `P1-27-INT-018`).
 *
 * `rec.warning_light_codes` is a dual-scope configuration catalogue the intake writes
 * reference by uuid, and nothing published its rows — the warning-light evidence kind demands a code id and was unusable in practice (RMC-11).
 *
 * Tenant scoping is RLS's: the SELECT policy is
 * `scope = 'platform' OR tenant_id = iam.current_tenant_id()`, so a caller
 * sees the platform catalogue plus their tenant's own additions, and the
 * handler adds no tenant predicate. Active rows only: these lists feed pickers
 * for writes that are about to reference a row, so a retired code is not
 * offered. Zero rows ship (no-fake-data policy) — an empty page is the
 * catalogue working, and population is a separately recorded provisioning
 * decision, never a seed.
 *
 * `low-risk-metadata` (600/min, keyed per tenant), not `expensive-read`: a
 * cheap reference read a picker opens constantly, carrying no personal data.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const WARNING_LIGHT_CODE_LIST_OPERATION = defineOperation({
  id: 'rec.catalogue-warning-light-code-list',
  module: 'reception',
  method: 'GET',
  path: '/reception-catalogue/warning-light-codes',
  summary: 'List the active dashboard warning-light codes visible to the caller tenant.',
  permissions: ['rec.reception.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    WARNING_LIGHT_CODE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await receptionModule().intakeCatalogues.listWarningLightCodes(
        db,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    })
  );
}
