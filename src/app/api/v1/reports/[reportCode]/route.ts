/**
 * GET /api/v1/reports/{reportCode} (P1-23).
 *
 * One published report DEFINITION: its scope, the allowlist of filters it
 * accepts (`parameterSchema`), and the permission an export of it would
 * require.
 *
 * It does not RUN the report. The frozen `rpt` schema binds no data source to a
 * report code, so there is no approved contract saying what a given code should
 * select, and inventing one would mean inventing a business report definition
 * nobody approved. `executable: false` states that in the response rather than
 * leaving a client to infer it.
 *
 * A draft, an archived report, another tenant's report and a code that never
 * existed all answer ERR-RES-001 identically — the catalogue must not be usable
 * to discover which codes a tenant has configured.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail } from '@/server/http/validation';
import { z } from 'zod';
import { reportingModule } from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The schema's own `ck_report_configurations_code` shape, enforced before any query. */
const ReportCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, 'report code must match ^[a-z][a-z0-9_]{1,62}$');

export const REPORT_READ_OPERATION = defineOperation({
  id: 'rpt.report-read',
  module: 'reporting',
  method: 'GET',
  path: '/reports/{reportCode}',
  summary: 'Read one published report definition, including its filter allowlist.',
  permissions: ['rpt.report.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'standard-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  context: { params: Promise<{ reportCode: string }> }
): Promise<Response> {
  const { reportCode } = await context.params;
  return handleOperation(REPORT_READ_OPERATION, request, async ({ db }) => {
    const code = parseOrFail(ReportCode, reportCode, 'path.reportCode');
    return { body: await reportingModule().catalogue.readByCode(db, code) };
  });
}
