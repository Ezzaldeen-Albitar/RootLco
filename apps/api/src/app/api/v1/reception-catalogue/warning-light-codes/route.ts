/**
 * GET / POST /api/v1/reception-catalogue/warning-light-codes (P1-27 remediation executed by
 * P1-18, `P1-27-INT-018`).
 *
 * The POST is the management half. RMC-11. The `warning_light` condition-evidence kind requires a code id, the table ships zero rows by the no-fake-data policy, and no operation anywhere could add one — so that evidence kind could not be recorded at all. The database has permitted the
 * write since the table was created (`GRANT SELECT, INSERT, UPDATE ... TO
 * app_runtime` plus `ins_warning_light_codes_tenant`); only the API published nothing.
 *
 * Creating is NOT seeding: no row ships, and the operator decides what their
 * catalogue contains.
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
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import { CATALOGUE_CODE_PATTERN, MAX_CATALOGUE_NAME, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

/**
 * `code` mirrors the relation's `code_format` CHECK so a bad code is a 422 that
 * names the field rather than a CHECK violation. `scope` and `tenantId` are
 * absent by design: both come from the resolved principal, and accepting either
 * from the client is how a tenant writes another tenant's row.
 */
export const CreateBody = z
  .object({
    code: z.string().regex(CATALOGUE_CODE_PATTERN),
    name: z.string().trim().min(1).max(MAX_CATALOGUE_NAME),
  })
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

export const WARNING_LIGHT_CODE_CREATE_OPERATION = defineOperation({
  id: 'rec.catalogue-warning-light-code-create',
  successStatus: 201,
  module: 'reception',
  method: 'POST',
  path: '/reception-catalogue/warning-light-codes',
  summary: 'Add a warning-light code to the caller tenant catalogue.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.warning_light_code.created',
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
    WARNING_LIGHT_CODE_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, CreateBody);
      const created = await receptionModule().intakeCatalogues.create(
        db,
        'warning_light_codes',
        input
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
