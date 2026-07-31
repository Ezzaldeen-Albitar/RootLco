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
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { reportingModule } from '@/modules/reporting';

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
  return handleOperation(REPORT_CATALOGUE_OPERATION, request, async ({ db }) => ({
    body: await reportingModule().catalogue.listPublished(db),
  }));
}
