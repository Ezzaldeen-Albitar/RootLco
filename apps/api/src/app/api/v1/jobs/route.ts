/**
 * GET /api/v1/jobs (PRE-P1-29-BR-06 — `INS-03`, `INS-13`, `DEP-B4`, `DEP-B5`).
 *
 * The branch job board. Before this route, `apps/api/src/app/api/v1/jobs/` held
 * exactly one directory — `[jobId]` — exporting `PATCH` only, so **no job list
 * existed at any scope** and a supervisor's board was unbuildable.
 *
 * ## The scope pair is REQUIRED, and this is the whole security story
 *
 * `scope: 'branch'` is **inert on a collection read**: there is no target row
 * whose branch the pre-handler could evaluate. RLS cannot compensate, because
 * `app.branch_ids` is the permission-BLIND union of every active grant
 * (`P1-18-A-01`) — a caller holding `wo.work_order.read` in branch X and *any*
 * grant at all in branch Y would otherwise read Y's board.
 *
 * So the pair is required by the schema and handed to `scopeTargetOption`, which
 * reads it out of not-yet-validated input and yields NO target unless both are
 * well-formed UUIDs. That helper can only ever make authorization stricter, and a
 * malformed pair falls through to the 422 below. This is `T-02`.
 *
 * ## `state` is an opaque code, and an unknown one is an EMPTY PAGE
 *
 * `wo.job_states` is tenant-extensible, so a code this process has never seen may
 * be perfectly valid for the caller's tenant. Declaring a TypeScript enum here
 * would make the API disagree with the catalogue it is paired with, and refusing
 * an unknown code with a 422 would do the same at runtime. It is validated as a
 * FORMAT (`^[a-z][a-z0-9_]{1,62}$`, mirroring `ck_jobs_state_format`) and matched
 * as data.
 *
 * The mirror must therefore declare **no enum** for this field — while declaring
 * one for `overallResult` on the QC list, which is genuinely closed. Getting that
 * backwards in either direction is a defect.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { STATE_CODE_PATTERN, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const JobListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    state: z.string().regex(STATE_CODE_PATTERN, 'must be a lower-snake state code').optional(),
    workOrderId: schemas.uuid.optional(),
    technicianProfileId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const JOB_LIST_OPERATION = defineOperation({
  id: 'wo.job-list',
  module: 'work-order',
  method: 'GET',
  path: '/jobs',
  summary: 'List the jobs of one branch, newest first, with their board context.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    JOB_LIST_OPERATION,
    request,
    async ({ db }) => {
      // Parsed INSIDE the handler so a malformed query renders as the shared
      // problem document rather than escaping as an unhandled 500.
      const query = parseOrFail(JobListQuery, raw, 'query');
      return {
        body: await workOrderModule().jobBoard.listJobs(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            state: query.state,
            workOrderId: query.workOrderId,
            technicianProfileId: query.technicianProfileId,
          },
          { cursor: query.cursor, limit: query.limit }
        ),
      };
    },
    scopeTargetOption(raw)
  );
}
