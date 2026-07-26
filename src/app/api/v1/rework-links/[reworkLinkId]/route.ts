/**
 * GET /api/v1/rework-links/{reworkLinkId} (Phase 1-19, P1-19-BE-019).
 *
 * One rework case: the original it corrects, the rework order that carries the work,
 * the root cause, the corrective action, the responsibility, the lead technician, the
 * safety-critical flag and the sign-off if it exists.
 *
 * The restricted cost of quality is deliberately NOT here.
 * `qms.rework_link_details` is gated on `iam.sensitive.view` by all three of its
 * policies, so folding it in would make this read silently return an incomplete case
 * for every caller without that permission — the same reason
 * `wo.additional_work_request_details` has its own surface.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ reworkLinkId: schemas.uuid });

export const REWORK_DETAIL_OPERATION = defineOperation({
  id: 'qms.rework-detail',
  module: 'quality',
  method: 'GET',
  path: '/rework-links/{reworkLinkId}',
  summary: 'Read one rework case.',
  permissions: ['qms.quality_control.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ reworkLinkId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REWORK_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const link = await qualityModule().rework.detail(db, params.reworkLinkId, authorizeScope);
      return { body: link, recordVersion: link.recordVersion };
    },
    { params: raw }
  );
}
