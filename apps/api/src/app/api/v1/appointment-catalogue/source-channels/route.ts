/**
 * GET / POST /api/v1/appointment-catalogue/source-channels (P1-27 remediation executed by
 * P1-18, `P1-27-INT-018`).
 *
 * The POST is the management half. `sourceChannelId` is an optional reference on `apt.appointment-create`, and the picker meant to offer it had nothing to offer: the table ships zero rows by the no-fake-data policy and no operation anywhere could add one. The database has permitted the
 * write since the table was created (`GRANT SELECT, INSERT, UPDATE ... TO
 * app_runtime` plus `ins_source_channels_tenant`); only the API published nothing.
 *
 * Creating is NOT seeding: no row ships, and the operator decides what their
 * catalogue contains.
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

export const SOURCE_CHANNEL_CREATE_OPERATION = defineOperation({
  id: 'apt.catalogue-source-channel-create',
  module: 'reception',
  method: 'POST',
  path: '/appointment-catalogue/source-channels',
  summary: 'Add an intake source channel to the caller tenant catalogue.',
  permissions: ['apt.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'apt.source_channel.created',
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
    SOURCE_CHANNEL_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, CreateBody);
      const created = await receptionModule().intakeCatalogues.create(db, 'source_channels', input);
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
