/**
 * GET /api/v1/jobs/{jobId}/history (Phase 1-19, P1-19-BE-012).
 *
 * `wo.job_status_history` is append-only with no UPDATE or DELETE grant for any
 * application role, so this is the record rather than a reconstruction of it. It is
 * keyset-paginated newest-first, and it carries the same `origin` block the
 * work-order history does and for the same reason: `wo.emit_job_status_history` is
 * AFTER UPDATE only, so the insert that CREATES a job emits no ledger row, and the
 * oldest entry is the first transition rather than the creation.
 *
 * The pause reason lives here, not on a labour session. `tech.labor_sessions` has
 * only `started_at` and `ended_at` — no pause column — so a pause is a job
 * transition into `paused` (whose `reason_required` is true) plus the end of the
 * open session. The ledger is therefore where "why did this stop" is answered.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const JOB_HISTORY_OPERATION = defineOperation({
  id: 'wo.job-history',
  module: 'work-order',
  method: 'GET',
  path: '/jobs/{jobId}/history',
  summary: 'Read the append-only status history of a job, newest first.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const rawQuery = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    JOB_HISTORY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(Query, rawQuery, 'query');
      return {
        body: await workOrderModule().workOrders.jobHistory(
          db,
          params.jobId,
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
