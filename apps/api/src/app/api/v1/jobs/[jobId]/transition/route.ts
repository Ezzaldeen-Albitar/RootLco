/**
 * POST /api/v1/jobs/{jobId}/transition (Phase 1-19, P1-19-BE-011).
 *
 * The ONLY way a job's state changes. `PATCH /jobs/{jobId}` cannot write the
 * column at all, so this route and `wo.job_transitions` are the whole of the job
 * lifecycle — there is no second path that could skip the graph, the reason
 * requirement or the assignment precondition.
 *
 * `wo.guard_job_transition` remains the authority, and it enforces one thing worth
 * naming here because it is invisible in the graph: the assignments migration
 * REPLACED the guard to refuse a target whose `assignment_required` is true unless
 * an ACTIVE `wo.job_assignments` row exists for the job. So `planned → assigned` is
 * a perfectly valid edge that still fails without an assignment, and it surfaces as
 * `ERR-TECH-001` rather than a bare `23514`.
 *
 * A separate permission from `wo.job.manage`: creating and describing work is not
 * the same authority as declaring it started, paused or finished, and the seeded
 * catalog gives `wo.job.transition` its own code for exactly that reason.
 *
 * `If-Match` is mandatory — a caller who has not seen the current version cannot
 * know which edge they are asking for.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_REASON, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });

export const Body = z
  .object({
    toState: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'must be a lower-snake state code'),
    reason: z.string().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const JOB_TRANSITION_OPERATION = defineOperation({
  id: 'wo.job-transition',
  module: 'work-order',
  method: 'POST',
  path: '/jobs/{jobId}/transition',
  summary: 'Move a job to another state in its configured graph.',
  permissions: ['wo.job.transition'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.state_changed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    JOB_TRANSITION_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const moved = await workOrderModule().workOrders.transitionJob(
        db,
        params.jobId,
        { toState: parsed.toState, reason: parsed.reason, expectedVersion },
        authorizeScope
      );
      return { status: 200, body: moved, recordVersion: moved.recordVersion };
    },
    { params: raw, body }
  );
}
