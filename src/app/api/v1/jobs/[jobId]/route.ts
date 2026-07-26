/**
 * PATCH /api/v1/jobs/{jobId} (Phase 1-19, P1-19-BE-010).
 *
 * Updates a job's descriptive fields under optimistic concurrency.
 *
 * ## `state` is not accepted, and the schema is `.strict()` so saying so is a 422
 *
 * A job moves through `wo.job_transitions` and nowhere else. Accepting `state`
 * here would be a second path that skips the graph, the reason requirement and
 * `wo.guard_job_transition` entirely — and it would be the easiest one to reach,
 * because it looks like an ordinary field edit. The repository's UPDATE does not
 * name the column at all, so even a service defect could not write it.
 *
 * ## The job is addressed by its own id, which is why the scope check is deferred
 *
 * There is no branch in the path, so the pre-handler authorization check has
 * nothing to narrow by and `scope: 'branch'` would be inert — `requiresScopedEvaluation`
 * returns false on an empty target whatever the declaration says, and RLS cannot
 * compensate because `app.branch_ids` unions every active grant regardless of the
 * permission it carries (P1-18-A-01). The service re-decides against the LOCKED
 * job's own company and branch, which `fk_jobs_work_order` — the composite key
 * `(tenant, company, branch, work_order_id)` — guarantees equal the parent work
 * order's.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_JOB_TITLE, MAX_JOB_TYPE, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });

/**
 * `title` is required: this is a full replacement of the descriptive fields, and
 * `jobType` being absent means "clear it" rather than "leave it". `requiresDiagnostic`
 * is the exception — it drives closure blocker B4, so omitting it keeps the current
 * value rather than silently resetting a diagnostic requirement to false.
 */
const Body = z
  .object({
    title: z.string().trim().min(1).max(MAX_JOB_TITLE),
    jobType: z.string().trim().min(1).max(MAX_JOB_TYPE).nullable().optional(),
    requiresDiagnostic: z.boolean().optional(),
  })
  .strict();

export const JOB_UPDATE_OPERATION = defineOperation({
  id: 'wo.job-update',
  module: 'work-order',
  method: 'PATCH',
  path: '/jobs/{jobId}',
  summary: "Update a job's descriptive fields.",
  permissions: ['wo.job.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  // Both schemas run INSIDE the pipeline so a malformed id or body is rendered as
  // the shared problem document rather than escaping the route as a 500.
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    JOB_UPDATE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const job = await workOrderModule().workOrders.updateJob(
        db,
        params.jobId,
        {
          title: parsed.title,
          jobType: parsed.jobType ?? undefined,
          requiresDiagnostic: parsed.requiresDiagnostic,
          expectedVersion,
        },
        authorizeScope
      );
      return { body: job, recordVersion: job.recordVersion };
    },
    { params: raw, body }
  );
}
