/**
 * POST /api/v1/quality-controls/{recordId}/finalization (Phase 1-19, P1-19-BE-017).
 *
 * Declares a quality-control record passed or failed.
 *
 * ## A separate permission, and the split is real
 *
 * `qms.quality_control.record` (medium) is what a technician needs to tick checks off;
 * `qms.quality_control.finalize` (high) is the authority to declare a vehicle fit to
 * release. Observing work and certifying it are different acts, and the seeded catalog
 * rates them differently for that reason.
 *
 * ## The checker cannot be claimed and the time cannot be back-dated
 *
 * `qms.guard_qc_finalize()` stamps `checker_id` from `iam.current_user_id()` and
 * `finalized_at` from `now()` on the `pending → passed|failed` edge, then FREEZES
 * result, checker and time. Neither field is accepted here, because sending them would
 * be sending values the database discards — which reads as though the caller chose
 * them. A second finalization is refused both by the service, readably, and by the
 * guard, which is the enforcement.
 *
 * A failure is therefore permanent on that record. Clearing closure blocker B5 means
 * opening a NEW record and passing it, which leaves the failure in the ledger — the
 * schema has no unique index on `(work_order_id)` precisely so that is possible.
 *
 * `If-Match` is mandatory: finalization is the state change on a shared record.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_QC_NOTE, qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ recordId: schemas.uuid });

const Body = z
  .object({
    // `pending` is in the CHECK vocabulary and is deliberately not settable: it is
    // where a record starts, and moving back to it would un-finalize a judgement the
    // guard has frozen.
    overallResult: z.enum(['passed', 'failed']),
    notes: z.string().trim().min(1).max(MAX_QC_NOTE).optional(),
  })
  .strict();

export const QC_RECORD_FINALIZE_OPERATION = defineOperation({
  id: 'qms.qc-record-finalize',
  module: 'quality',
  method: 'POST',
  path: '/quality-controls/{recordId}/finalization',
  summary: 'Finalize a quality-control record as passed or failed.',
  permissions: ['qms.quality_control.finalize'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'qms.quality_control.finalized',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ recordId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    QC_RECORD_FINALIZE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const finalized = await qualityModule().qualityControl.finalize(
        db,
        params.recordId,
        { overallResult: parsed.overallResult, notes: parsed.notes, expectedVersion },
        authorizeScope
      );
      return { status: 200, body: finalized, recordVersion: finalized.recordVersion };
    },
    { params: raw, body }
  );
}
