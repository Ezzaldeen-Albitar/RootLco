/**
 * GET /api/v1/work-orders/{workOrderId}/evidence (PRE-P1-29-BR-07).
 *
 * Every piece of work evidence on a work order, across all of its jobs, in one
 * call — so a work-order detail screen can render a gallery without one request
 * per job.
 *
 * ## Why this is a join and not a second table
 *
 * `wo.job_evidence` is parented on the JOB, because Owner requirement 12 is about
 * the work done and work is done on a job. A work order inherits its jobs'
 * evidence by parentage, so the work-order view is a JOIN rather than a second
 * store — which is what keeps the two from ever disagreeing.
 *
 * Each row carries `jobTitle` for the same reason the join exists: a gallery that
 * shows six photographs and cannot say which piece of work each one evidences is
 * not much of a gallery.
 *
 * ## Unpaged, and that is a decision with a stated fallback
 *
 * A work order's evidence is bounded by its job count in practice. If that proves
 * wrong it becomes a PAGED read in a later slice — never a silently truncated
 * one, which is the P1-28 round-two defect and is worse than either.
 *
 * ## No storage key, no URL, no bytes
 *
 * Rows carry `documentVersionId` only (`T-09`). The attachments module resolves a
 * version under its own authorization; a URL constructed here would make evidence
 * readable by reference.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

export const WORK_ORDER_EVIDENCE_LIST_OPERATION = defineOperation({
  id: 'wo.work-order-evidence-list',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders/{workOrderId}/evidence',
  summary: 'List the work evidence of a work order across all of its jobs.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    WORK_ORDER_EVIDENCE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await workOrderModule().jobBoard.listWorkOrderEvidence(
            db,
            params.workOrderId,
            authorizeScope
          ),
        },
      };
    },
    { params: raw }
  );
}
