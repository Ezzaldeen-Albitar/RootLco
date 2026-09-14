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
import { parseJsonBody, parseOrFail, schemas, scopeTargetOption } from '@/server/http/validation';
import { z } from 'zod';
import { reportingModule, type ReportExportView } from '@/modules/reporting';

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
  // Was the unregistered `'standard-read'`, which made every request to this
  // operation an unhandled 500 (`P1-27-INT-113`). `expensive-read` is the policy
  // whose own rationale names reports, and it keys on operation+tenant+user.
  rateLimitPolicy: 'expensive-read',
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

const ExportBody = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const ExportResult = z
  .object({
    reportCode: ReportCode,
    generated: z.literal(true),
    freshness: z.literal('live'),
    generatedAt: z.iso.datetime(),
    filters: z.object({ companyId: schemas.uuid, branchId: schemas.uuid }).strict(),
    period: z.object({ from: z.string(), to: z.string(), timezone: z.string() }).strict(),
    rowCount: z.number().int().nonnegative(),
    summaryCount: z.number().int().nonnegative(),
    file: z
      .object({
        filename: z.string(),
        mediaType: z.literal('text/csv'),
        encoding: z.literal('utf-8'),
        content: z.string(),
      })
      .strict(),
  })
  .strict();

export const REPORT_EXPORT_OPERATION = defineOperation({
  id: 'rpt.report-export',
  module: 'reporting',
  method: 'POST',
  path: '/reports/{reportCode}:export',
  summary: 'Generate a bounded CSV report under explicit scoped export permissions.',
  permissions: ['rpt.export', 'rpt.report.read'],
  scope: 'branch',
  auditClass: 'export',
  auditAction: 'rpt.report.exported',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  requestBodySchema: z.toJSONSchema(ExportBody),
  successBodySchema: z.toJSONSchema(ExportResult),
  pathParameterSchemas: { reportCode: z.toJSONSchema(ReportCode) },
});

/** Next receives the whole final segment; only the canonical :export action is accepted. */
export async function POST(
  request: Request,
  context: { params: Promise<{ reportCode: string }> }
): Promise<Response> {
  const { reportCode: segment } = await context.params;
  const raw: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REPORT_EXPORT_OPERATION,
    request,
    async ({ db, request: incoming, authorizeScope, requireScopeClaim }) => {
      const action = parseOrFail(
        z.string().regex(/^[a-z][a-z0-9_]{1,62}:export$/),
        segment,
        'path.reportCode'
      );
      const body = await parseJsonBody(incoming, ExportBody);
      const target = { companyId: body.companyId, branchId: body.branchId };
      await authorizeScope(target);
      await requireScopeClaim(target);
      const result: ReportExportView = await reportingModule().exports.generate(db, {
        ...body,
        reportCode: action.slice(0, -':export'.length),
      });
      ExportResult.parse(result);
      return { body: result };
    },
    { ...scopeTargetOption(raw), body: raw }
  );
}
