/**
 * GET /api/v1/quality-controls/{recordId} (Phase 1-19, P1-19-BE-017).
 *
 * The record, its per-check outcomes, and the mandatory checks it has no result for.
 *
 * `unresolvedMandatory` is REPORTED, not enforced. `wo.guard_work_order_closure`'s B5b
 * asks only whether a PASSED record exists when any mandatory check is configured — it
 * never looks at per-check results — so refusing finalization on an unticked mandatory
 * check would be this layer inventing a rule the closure gate does not apply, and a
 * caller clearing it would gain nothing. What the endpoint can honestly do is tell the
 * checker what they have not looked at.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ recordId: schemas.uuid });

export const QC_RECORD_DETAIL_OPERATION = defineOperation({
  id: 'qms.qc-record-detail',
  module: 'quality',
  method: 'GET',
  path: '/quality-controls/{recordId}',
  summary: 'Read a quality-control record with its check outcomes.',
  permissions: ['qms.quality_control.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ recordId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    QC_RECORD_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const detail = await qualityModule().qualityControl.detail(
        db,
        params.recordId,
        authorizeScope
      );
      return { body: detail, recordVersion: detail.record.recordVersion };
    },
    { params: raw }
  );
}
