/**
 * GET /api/v1/reports (P1-23).
 *
 * The published report catalogue for the caller's tenant. Reports are tenant
 * CONFIGURATION, not code, which is what keeps a pilot tenant's report set out
 * of branching logic.
 *
 * Drafts and archived reports are invisible: a draft is an unfinished decision
 * and an archived one is withdrawn.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { reportingModule } from '@/modules/reporting';

/**
 * `.strict()` so an unknown query parameter is refused rather than ignored: a
 * caller who mistypes a filter should be told, not silently served the whole
 * unfiltered page.
 */
const ListQuery = z
  .object({
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const REPORT_CATALOGUE_OPERATION = defineOperation({
  id: 'rpt.report-catalogue',
  module: 'reporting',
  method: 'GET',
  path: '/reports',
  summary: 'List the published report definitions configured for the tenant.',
  permissions: ['rpt.report.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'standard-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(REPORT_CATALOGUE_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(ListQuery, searchParamsToObject(url.searchParams), 'query');
    return {
      body: await reportingModule().catalogue.listPublished(db, {
        cursor: query.cursor,
        limit: query.limit,
      }),
    };
  });
}
