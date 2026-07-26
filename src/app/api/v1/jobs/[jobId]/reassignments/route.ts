/**
 * POST /api/v1/jobs/{jobId}/reassignments (Phase 1-19, P1-19-BE-015).
 *
 * Hands a job from its current primary technician to another, in ONE transaction.
 *
 * It is a distinct operation rather than "end then assign" from the client, and the
 * reason is atomicity: two separate calls leave a window in which the job is
 * unassigned, and `wo.guard_job_transition` refuses an `assignment_required` state
 * with no active assignment — so a job in `in_progress` would become untransitionable
 * for exactly as long as the client took to make its second call, or forever if that
 * call never arrived. One transaction writes the end, the new assignment, both audit
 * records and one event, or none of them.
 *
 * The reason is required and applies to the END of the outgoing assignment, which is
 * what `ck_job_assignments_end_reason` demands. A reassignment onto the technician who
 * already holds the job is refused rather than being made a no-op that would silently
 * churn the history.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });

const Body = z
  .object({
    technicianProfileId: schemas.uuid,
    reason: z.string().trim().min(1).max(MAX_REASON),
    requiredSkills: z
      .array(
        z
          .object({
            skillCode: z.string().min(1).max(64),
            minimumRank: z.number().int().min(1).max(1000),
          })
          .strict()
      )
      .max(20)
      .optional(),
    requiredCertificationCodes: z.array(z.string().min(1).max(64)).max(20).optional(),
    window: z
      .object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

export const JOB_REASSIGNMENT_OPERATION = defineOperation({
  id: 'wo.job-reassignment',
  module: 'work-order',
  method: 'POST',
  path: '/jobs/{jobId}/reassignments',
  summary: 'Hand a job from its current primary technician to another.',
  permissions: ['tech.assignment.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  // The declared action is the one for the assignment this command OPENS; the end of
  // the outgoing assignment is recorded under `wo.job.assignment_ended` in the same
  // transaction, because a handover has two facts and hiding one of them would make
  // the trail unreadable.
  auditAction: 'wo.job.assigned',
  idempotent: true,
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
    JOB_REASSIGNMENT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const moved = await workOrderModule().jobAssignments.reassign(
        db,
        params.jobId,
        {
          technicianProfileId: parsed.technicianProfileId,
          reason: parsed.reason,
          requiredSkills: parsed.requiredSkills,
          requiredCertificationCodes: parsed.requiredCertificationCodes,
          window: { from: new Date(parsed.window.from), to: new Date(parsed.window.to) },
        },
        authorizeScope
      );
      return { status: 201, body: moved, recordVersion: moved.opened.recordVersion };
    },
    { params: raw, body }
  );
}
