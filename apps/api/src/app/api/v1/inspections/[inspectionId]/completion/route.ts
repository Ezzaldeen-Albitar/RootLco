/**
 * POST /api/v1/inspections/{inspectionId}/completion (Phase 1-19, P1-19-BE-011).
 *
 * Completes a diagnostic report, behind `dia.diagnostic.complete` rather than
 * `dia.diagnostic.record` — see the transition route's header for why the two are
 * separate authorities and why the transition endpoint refuses `completed`.
 *
 * ## Every outstanding mandatory item comes back at once
 *
 * `dia.guard_diagnostic_report_transition` is the enforcement and runs inside the
 * same statement as the write: it re-counts unanswered mandatory items of the pinned
 * version and aborts. But it can only say "not yet", and a technician told "not yet"
 * without being told which of forty items is missing has been told nothing. So the
 * service reports the whole list as `ERR-DIA-001` violations keyed by item code —
 * the template's own identifier, which the caller is already reading to fill the
 * report in.
 *
 * An item counts as answered by a VALUE **or** by a documented not-applicable reason.
 * `ck_report_item_results_answered` demands one of the two, so a mandatory item can be
 * skipped — never silently.
 *
 * The optional `summary` is written in the SAME transaction and BEFORE the status
 * change, so a completed report is never briefly complete without the summary that
 * explains it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_SUMMARY, diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });
const Body = z.object({ summary: z.string().trim().min(1).max(MAX_SUMMARY).optional() }).strict();

export const DIAGNOSTIC_COMPLETE_OPERATION = defineOperation({
  id: 'dia.diagnostic-complete',
  module: 'diagnostics',
  method: 'POST',
  path: '/inspections/{inspectionId}/completion',
  summary: 'Complete a diagnostic report once every mandatory item is resolved.',
  permissions: ['dia.diagnostic.complete'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'dia.diagnostic.completed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ inspectionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DIAGNOSTIC_COMPLETE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body ?? {}, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const completed = await diagnosticsModule().reports.complete(
        db,
        params.inspectionId,
        { summary: parsed.summary, expectedVersion },
        authorizeScope
      );
      return { status: 200, body: completed, recordVersion: completed.recordVersion };
    },
    { params: raw, body }
  );
}
