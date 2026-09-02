/**
 * GET /api/v1/diagnostic-types (P1-29-W5).
 *
 * The diagnostic-type vocabulary the caller tenant is configured with —
 * platform rows and the tenant's own, a tenant row shadowing the platform row
 * of the same code. `dia.diagnostic_types` has been read by this module since
 * P1-19 and published by nothing; the P1-29 canonical plan named this operation
 * PLANNED for exactly that reason (`canonical-plan.md` §4, W5).
 *
 * ## Read on `dia.diagnostic.read`, and no new permission
 *
 * A vocabulary is metadata about the reports it classifies. The caller who may
 * read a diagnostic report may learn what kinds of report exist; requiring
 * `dia.catalogue.manage` here would mean a technician cannot see the name of
 * the type on the report they are filling in.
 *
 * ## Deliberately empty and `.strict()`
 *
 * The catalogue is small, bounded by the tenant's own configuration, and
 * unpaged — the same reasoning as `wo.work-order-catalogue`. A `cursor` or
 * `limit` would imply a page boundary that does not exist, and an unknown
 * parameter is a client defect worth naming rather than ignoring. `status` is
 * not a filter either: both statuses come back, each row saying which, so a
 * report typed against a retired type can still name it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, searchParamsToObject } from '@/server/http/validation';
import { diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DiagnosticTypeListQuery = z.object({}).strict();

export const DIAGNOSTIC_TYPE_LIST_OPERATION = defineOperation({
  id: 'dia.diagnostic-type-list',
  module: 'diagnostics',
  method: 'GET',
  path: '/diagnostic-types',
  summary: 'Read the diagnostic-type vocabulary the caller tenant is configured with.',
  permissions: ['dia.diagnostic.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(DIAGNOSTIC_TYPE_LIST_OPERATION, request, async ({ db, request: raw }) => {
    parseOrFail(
      DiagnosticTypeListQuery,
      searchParamsToObject(new URL(raw.url).searchParams),
      'query'
    );
    return { body: { items: await diagnosticsModule().catalogue.diagnosticTypes(db) } };
  });
}
