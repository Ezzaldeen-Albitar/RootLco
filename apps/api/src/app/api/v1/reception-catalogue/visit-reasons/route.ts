/**
 * GET / POST /api/v1/reception-catalogue/visit-reasons (P1-27 remediation executed by
 * P1-18, `P1-27-INT-018`).
 *
 * The POST is the management half. `rec.visit_reasons` existed with zero rows and zero operations of any kind, so the check-in step that classifies why the vehicle came in had nothing to classify it with. The database has permitted the
 * write since the table was created (`GRANT SELECT, INSERT, UPDATE ... TO
 * app_runtime` plus `ins_visit_reasons_tenant`); only the API published nothing.
 *
 * Creating is NOT seeding: no row ships, and the operator decides what their
 * catalogue contains.
 *
 * `rec.visit_reasons` is a dual-scope configuration catalogue the intake writes
 * reference by uuid, and nothing published its rows — why a vehicle was brought in could not be offered as a coded choice.
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

export const VISIT_REASON_LIST_OPERATION = defineOperation({
  id: 'rec.catalogue-visit-reason-list',
  module: 'reception',
  method: 'GET',
  path: '/reception-catalogue/visit-reasons',
  summary: 'List the active reception visit reasons visible to the caller tenant.',
  permissions: ['rec.reception.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(VISIT_REASON_LIST_OPERATION, request, async ({ db, request: raw }) => ({
    body: await receptionModule().intakeCatalogues.listVisitReasons(
      db,
      parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
    ),
  }));
}

export const VISIT_REASON_CREATE_OPERATION = defineOperation({
  id: 'rec.catalogue-visit-reason-create',
  module: 'reception',
  method: 'POST',
  path: '/reception-catalogue/visit-reasons',
  summary: 'Add a visit reason to the caller tenant catalogue.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.visit_reason.created',
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
    VISIT_REASON_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, CreateBody);
      const created = await receptionModule().intakeCatalogues.create(db, 'visit_reasons', input);
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
