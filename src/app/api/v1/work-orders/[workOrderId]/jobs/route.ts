/**
 * POST /api/v1/work-orders/{workOrderId}/jobs (Phase 1-19, P1-19-BE-009).
 *
 * Adds one job to a work order. The parent preconditions are the database's:
 * `wo.guard_job_refs` locks the parent work order `FOR UPDATE` and refuses a
 * terminal parent, a parent whose state has `allows_jobs = false`, or a terminal
 * initial job state. The service's own check ahead of the insert exists to turn
 * those into readable refusals, not to replace them — and the guard's lock is what
 * makes a job insert serialise against a concurrent close rather than race it.
 *
 * `state` is optional and, when omitted, is resolved from `wo.job_states` rather
 * than defaulted to a literal. `wo.jobs.state` carries only a FORMAT check
 * (`ck_jobs_state_format`), so the vocabulary lives entirely in that catalog table
 * and a tenant may shadow it; a hardcoded `'planned'` would be a second, silently
 * diverging definition of where a job begins.
 *
 * Idempotent: an `Idempotency-Key` replay returns the first response rather than
 * adding a second job with the same title. No event is published — the approved
 * catalog reserves `job.assigned` and `job.state-changed` and nothing for creation,
 * and `buildEventEnvelope` refuses an unregistered type.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_JOB_TITLE, MAX_JOB_TYPE, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

const Body = z
  .object({
    // `.trim()` before the length check, so trailing whitespace cannot buy length
    // and a blank-but-not-empty title is refused here rather than by
    // `ck_jobs_title_not_blank` as a raw constraint violation.
    title: z.string().trim().min(1).max(MAX_JOB_TITLE),
    jobType: z.string().trim().min(1).max(MAX_JOB_TYPE).optional(),
    state: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,62}$/, 'must be a lower-snake state code')
      .optional(),
    requiresDiagnostic: z.boolean().optional(),
  })
  .strict();

export const JOB_CREATE_OPERATION = defineOperation({
  id: 'wo.job-create',
  module: 'work-order',
  method: 'POST',
  path: '/work-orders/{workOrderId}/jobs',
  summary: 'Add a job to a work order.',
  permissions: ['wo.job.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  // Both schemas run INSIDE the pipeline so a malformed id or body is rendered as
  // the shared problem document rather than escaping the route as a 500.
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    JOB_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const job = await workOrderModule().workOrders.createJob(
        db,
        params.workOrderId,
        {
          title: parsed.title,
          jobType: parsed.jobType,
          state: parsed.state,
          requiresDiagnostic: parsed.requiresDiagnostic,
        },
        authorizeScope
      );
      return { status: 201, body: job, recordVersion: job.recordVersion };
    },
    { params: raw, body }
  );
}
