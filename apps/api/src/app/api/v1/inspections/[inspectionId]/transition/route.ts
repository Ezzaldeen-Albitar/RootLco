/**
 * POST /api/v1/inspections/{inspectionId}/transition (Phase 1-19, P1-19-BE-011).
 *
 * Moves a diagnostic report along the fixed lifecycle
 * `draft → in_progress | cancelled`, `in_progress → completed | cancelled`, held in
 * `dia.guard_diagnostic_report_transition` and mirrored in this module's domain layer.
 *
 * ## This endpoint cannot complete a report
 *
 * Completion is its own command behind its own permission, exactly as work-order
 * closure is. `dia.diagnostic.record` is what a technician needs to fill a report in;
 * `dia.diagnostic.complete` is the authority to declare it finished and frozen, and
 * declaring a vehicle inspected is a different act from writing down what was
 * measured. Permissions are a conjunction, so declaring both here would demand the
 * completing authority for every ordinary move — and declaring only the first would
 * leave the seeded `dia.diagnostic.complete` code enforced nowhere.
 *
 * Asking THIS endpoint for `completed` is therefore refused rather than accepted, or
 * the second permission would be bypassable by choosing the other URL. Both commands
 * funnel into one service write path, so the mandatory-item gate and
 * `dia.guard_diagnostic_report_transition` apply identically either way.
 *
 * `If-Match` is mandatory: a status change on a shared aggregate is not something a
 * caller can ask for without having seen the current version.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { REPORT_STATUSES, diagnosticsModule } from '@/modules/diagnostics';
import { MAX_REASON } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });

export const Body = z
  .object({
    // A closed CHECK vocabulary, unlike the work-order and job graphs whose codes
    // live in tenant-extensible catalog tables — so an enum is exact here.
    toStatus: z.enum(REPORT_STATUSES),
    reason: z.string().trim().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const DIAGNOSTIC_TRANSITION_OPERATION = defineOperation({
  id: 'dia.diagnostic-transition',
  module: 'diagnostics',
  method: 'POST',
  path: '/inspections/{inspectionId}/transition',
  summary: 'Move a diagnostic report to another status in its fixed lifecycle.',
  permissions: ['dia.diagnostic.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'dia.diagnostic.state_changed',
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
    DIAGNOSTIC_TRANSITION_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const moved = await diagnosticsModule().reports.transition(
        db,
        params.inspectionId,
        { toStatus: parsed.toStatus, reason: parsed.reason, expectedVersion },
        authorizeScope
      );
      return { status: 200, body: moved, recordVersion: moved.recordVersion };
    },
    { params: raw, body }
  );
}
