/**
 * PUT /api/v1/quality-controls/{recordId}/checks/{qcCheckId} (Phase 1-19, P1-19-BE-017).
 *
 * Records or replaces one configured check's outcome inside a record.
 *
 * `PUT` because the outcome is 1:1 with the check —
 * `uq_qc_check_results_record_check` is a partial unique index over live rows — and a
 * checker correcting a mis-click should not need a whole new record.
 *
 * Replacement stops the moment the record is FINALIZED, and that is an application
 * rule: `qms.guard_qc_finalize` freezes the RECORD's result, checker and time, but
 * `qms.qc_check_results` references the record and never reads its `overall_result`,
 * so a finalized record would otherwise accept new outcomes and change what it says
 * after it was signed. The record is locked before its status is read, so a
 * concurrent finalization cannot slip in between.
 *
 * The check must be in the tenant's own active catalog.
 * `fk_qc_check_results_check` references `qms.qc_checks (id)` with NO tenant column,
 * so a tenant-scoped check belonging to ANOTHER tenant satisfies the foreign key — the
 * catalog read is the only thing that refuses it.
 *
 * `na` is a first-class outcome, not a missing one: `ck_qc_check_results_result` is
 * `pass | fail | na`, and a check that does not apply to this vehicle is a recorded
 * fact rather than a gap.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_QC_NOTE, QC_CHECK_RESULTS, qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ recordId: schemas.uuid, qcCheckId: schemas.uuid });

export const Body = z
  .object({
    result: z.enum(QC_CHECK_RESULTS),
    note: z.string().trim().min(1).max(MAX_QC_NOTE).optional(),
  })
  .strict();

export const QC_CHECK_RESULT_OPERATION = defineOperation({
  id: 'qms.qc-check-result',
  module: 'quality',
  method: 'PUT',
  path: '/quality-controls/{recordId}/checks/{qcCheckId}',
  summary: 'Record the outcome of one configured quality check.',
  permissions: ['qms.quality_control.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'qms.quality_control.check_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ recordId: string; qcCheckId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    QC_CHECK_RESULT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const result = await qualityModule().qualityControl.recordCheck(
        db,
        params.recordId,
        params.qcCheckId,
        { result: parsed.result, note: parsed.note },
        authorizeScope
      );
      return { status: 200, body: result, recordVersion: result.recordVersion };
    },
    { params: raw, body }
  );
}
