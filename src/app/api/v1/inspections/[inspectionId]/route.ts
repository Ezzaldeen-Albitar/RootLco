/**
 * GET /api/v1/inspections/{inspectionId} (Phase 1-19, P1-19-BE-009).
 *
 * The report and everything recorded on it — item results, measurements, DTCs,
 * findings, recommendations, evidence and reviews — plus two derived blocks.
 *
 * `outstandingMandatory` is here rather than at its own endpoint: it is the same list
 * the completion refusal returns, and a technician filling a report in wants to know
 * BEFORE attempting rather than after being refused. It is computed against the
 * report's PINNED template version, so a template that has since published a new
 * version cannot change what this report owes.
 *
 * `nextStatuses` comes from the graph mirrored in the domain layer, which the
 * reconciliation test pins against the deployed
 * `dia.guard_diagnostic_report_transition`. Mirroring is correct here and wrong for
 * work orders and jobs: those graphs are tenant-overridable catalog TABLES, and this
 * one is a fixed PL/pgSQL `IF` chain with no catalog and no override.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });

export const DIAGNOSTIC_DETAIL_OPERATION = defineOperation({
  id: 'dia.diagnostic-detail',
  module: 'diagnostics',
  method: 'GET',
  path: '/inspections/{inspectionId}',
  summary: 'Read a diagnostic report with every entry recorded on it.',
  permissions: ['dia.diagnostic.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ inspectionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    DIAGNOSTIC_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const detail = await diagnosticsModule().reports.detail(
        db,
        params.inspectionId,
        authorizeScope
      );
      return { body: detail, recordVersion: detail.report.recordVersion };
    },
    { params: raw }
  );
}
