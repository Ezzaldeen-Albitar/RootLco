/**
 * GET /api/v1/inspections/{inspectionId}/history (Phase 1-19, P1-19-BE-009).
 *
 * One keyset page of `dia.diagnostic_report_status_history`, newest first, plus the
 * genesis block the ledger cannot hold.
 *
 * `dia.emit_diagnostic_report_status_history` fires AFTER UPDATE only, so creating a
 * report emits no row and the ledger's oldest entry is the FIRST transition rather
 * than the opening. Backfilling a genesis row was not an option:
 * `shared.stamp_status_history` forces `occurred_at := now()`, so the backfilled row
 * would record a time the report was not created at. The opening is therefore
 * reported as its own block, derived from columns that do hold it — the same shape
 * and the same reason as the work-order and job histories.
 *
 * The ledger cannot be written independently either: `dia.guard_diagnostic_report_status_coherence`
 * refuses any row whose `to_state` differs from the report's current status.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });
const Query = z
  .object({ cursor: z.string().min(1).optional(), limit: schemas.limit.optional() })
  .strict();

export const DIAGNOSTIC_HISTORY_OPERATION = defineOperation({
  id: 'dia.diagnostic-history',
  module: 'diagnostics',
  method: 'GET',
  path: '/inspections/{inspectionId}/history',
  summary: 'Read the append-only status ledger of a diagnostic report.',
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
  const query = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    DIAGNOSTIC_HISTORY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Query, query, 'query');
      return {
        body: await diagnosticsModule().reports.history(
          db,
          params.inspectionId,
          { cursor: parsed.cursor, limit: parsed.limit },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
