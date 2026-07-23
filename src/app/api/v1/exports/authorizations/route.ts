/**
 * POST /api/v1/exports/authorizations (P1-15).
 *
 * Authorizes an export and records the decision. **No file is produced** — the
 * response says so explicitly (`generated: false`) so no consumer can mistake an
 * authorization for a download.
 *
 * POST rather than GET even though nothing is exported: the call writes an
 * export-class audit record, and an export decision is a disclosure event that
 * must not be cacheable, bookmarkable, or replayable from a browser history.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FilterValue = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(200), z.number()])).max(50),
]);

const Body = z
  .object({
    resource: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    fields: z.array(z.string().max(64)).max(64).default([]),
    filters: z
      .array(
        z
          .object({
            field: z.string().max(64),
            operator: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'prefix']),
            value: FilterValue,
          })
          .strict()
      )
      .max(8)
      .default([]),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const EXPORT_AUTHORIZE_OPERATION = defineOperation({
  id: 'shared.export-authorize',
  module: 'shared-services',
  method: 'POST',
  path: '/exports/authorizations',
  summary: 'Authorize an export of tenant data. Produces no file.',
  permissions: ['rpt.export'],
  scope: 'tenant',
  auditClass: 'export',
  auditAction: 'shared.export.authorized',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    EXPORT_AUTHORIZE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        body: await sharedServicesModule().exports.authorize(db, {
          resource: input.resource,
          fields: input.fields,
          filters: input.filters,
          reason: input.reason,
        }),
      };
    },
    { body }
  );
}
