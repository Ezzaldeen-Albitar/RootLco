/**
 * POST / GET /api/v1/jobs/{jobId}/blockers (P1-29-W6 — Owner requirement 13, `VHM-16`).
 *
 * The blocker record. `VHM-16` measured that "a blocker is currently expressed
 * as `awaiting_parts` or `awaiting_customer` with a mandatory reason" — a
 * WORK-ORDER state, which cannot say that one job of three is waiting for a
 * part while the other two carry on. This record can, and it moves no state:
 * those states remain exactly what they are.
 *
 * ## Two different permissions, on purpose — the work-log precedent
 *
 * The WRITE costs `tech.labor.record`: a blocker is the worker's own statement
 * about the work in front of them, as a work-log entry is, and requiring
 * `wo.job.manage` would mean a technician cannot say why they have stopped.
 * The READ costs `wo.work_order.read`, matching `wo.job-work-log-list`: a
 * blocker describes WORK, not a person.
 *
 * ## Append-only, and the grant is what means it
 *
 * `wo.job_blocker_events` is granted `SELECT, INSERT` and nothing else. A
 * blocker is RESOLVED by a second event that references the raise
 * (`POST /blockers/{blockerId}/resolution`), never by editing the raise, and
 * the list folds the pair into one blocker with a derived status.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { MAX_BLOCKER_NOTE, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });

/**
 * `note` is why the job is blocked, in the worker's words. There is deliberately
 * NO category: no vocabulary of blocker kinds exists in the platform, and
 * inventing one here would be a taxonomy the Owner has not decided, presented
 * as though somebody had. `createdBy` is absent and `.strict()` refuses it.
 */
export const BlockerRaiseBody = z
  .object({ note: z.string().trim().min(1).max(MAX_BLOCKER_NOTE) })
  .strict();

export const JOB_BLOCKER_RAISE_OPERATION = defineOperation({
  id: 'wo.job-blocker-raise',
  successStatus: 201,
  module: 'work-order',
  method: 'POST',
  path: '/jobs/{jobId}/blockers',
  summary: 'Raise a blocker on a job — record that work cannot proceed, and why.',
  permissions: ['tech.labor.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.blocker_raised',
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
    JOB_BLOCKER_RAISE_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, BlockerRaiseBody);
      return {
        status: 201,
        body: await workOrderModule().jobBoard.raiseBlocker(
          db,
          params.jobId,
          { note: input.note },
          authorizeScope
        ),
      };
    },
    { params: raw, body }
  );
}

export const JOB_BLOCKER_LIST_OPERATION = defineOperation({
  id: 'wo.job-blocker-list',
  module: 'work-order',
  method: 'GET',
  path: '/jobs/{jobId}/blockers',
  summary: 'List the blockers of one job, oldest first, each with its derived status.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    JOB_BLOCKER_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await workOrderModule().jobBoard.listBlockers(db, params.jobId, authorizeScope),
        },
      };
    },
    { params: raw }
  );
}
