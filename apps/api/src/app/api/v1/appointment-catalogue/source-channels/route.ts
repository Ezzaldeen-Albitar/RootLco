/**
 * GET /api/v1/appointment-catalogue/source-channels (P1-27 remediation executed by P1-18,
 * `P1-27-INT-018`).
 *
 * `apt.source_channels` is a dual-scope configuration catalogue the intake writes
 * reference by uuid, and nothing published its rows — a booking form could not offer how the request arrived.
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

export const SOURCE_CHANNEL_LIST_OPERATION = defineOperation({
  id: 'apt.catalogue-source-channel-list',
  module: 'reception',
  method: 'GET',
  path: '/appointment-catalogue/source-channels',
  summary: 'List the active intake source channels visible to the caller tenant.',
  permissions: ['apt.appointment.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(SOURCE_CHANNEL_LIST_OPERATION, request, async ({ db, request: raw }) => ({
    body: await receptionModule().intakeCatalogues.listSourceChannels(
      db,
      parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
    ),
  }));
}
