/**
 * POST /api/v1/assignments/{assignmentId}/end (Phase 1-19, P1-19-BE-014).
 *
 * Ends an assignment by stamping `valid_to`. The row is never deleted — the set of
 * rows for a job is its assignment history, and a deletion would erase who worked a
 * customer's vehicle.
 *
 * The reason is mandatory, and not only here: `ck_job_assignments_end_reason` refuses
 * an end without one, because removing a technician from work is accountable. The end
 * TIME is server-stamped rather than accepted, so it can neither be pushed before
 * `valid_from` (which `ck_job_assignments_window` would refuse anyway) nor used to
 * rewrite when the technician actually came off the job.
 *
 * Modelled as `POST .../end` rather than `PATCH .../{id}`: this is a state change on
 * a temporal record, not an edit of its fields, and every other column is immutable
 * under `tg_job_assignments_immutable`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_REASON, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ assignmentId: schemas.uuid });
const Body = z.object({ reason: z.string().trim().min(1).max(MAX_REASON) }).strict();

export const JOB_ASSIGNMENT_END_OPERATION = defineOperation({
  id: 'wo.job-assignment-end',
  module: 'work-order',
  method: 'POST',
  path: '/assignments/{assignmentId}/end',
  summary: 'End a job assignment, recording why.',
  permissions: ['tech.assignment.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.assignment_ended',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    JOB_ASSIGNMENT_END_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const ended = await workOrderModule().jobAssignments.end(
        db,
        params.assignmentId,
        { reason: parsed.reason, expectedVersion },
        authorizeScope
      );
      return { body: ended, recordVersion: ended.recordVersion };
    },
    { params: raw, body }
  );
}
