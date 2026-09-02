/**
 * POST /api/v1/blockers/{blockerId}/resolution (P1-29-W6).
 *
 * Resolves a raised blocker by appending a `resolved` event that references
 * the raise. The raise is never edited: `wo.job_blocker_events` has no UPDATE
 * grant, so a resolution is a NEW row and the record keeps both statements —
 * why the work stopped, and how it was freed.
 *
 * ## One resolution per raise, and the database says so
 *
 * `uq_job_blocker_events_single_resolution` is a partial unique index over the
 * reference. A second resolution of the same raise is a `23505` mapped to
 * `ERR-CON-001` — a conflict, not a validation error, because the blocker WAS
 * open when the caller looked and is not any more. There is no `If-Match`
 * here: the raise carries no version because it cannot change, and the
 * constraint is the whole concurrency story.
 *
 * `tech.labor.record`, as the raise: the worker says the work can continue.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { MAX_BLOCKER_NOTE, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ blockerId: schemas.uuid });

export const BlockerResolveBody = z
  .object({ note: z.string().trim().min(1).max(MAX_BLOCKER_NOTE) })
  .strict();

export const JOB_BLOCKER_RESOLVE_OPERATION = defineOperation({
  id: 'wo.job-blocker-resolve',
  successStatus: 201,
  module: 'work-order',
  method: 'POST',
  path: '/blockers/{blockerId}/resolution',
  summary: 'Resolve a raised blocker — record that the work can continue, and how.',
  permissions: ['tech.labor.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.blocker_resolved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ blockerId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    JOB_BLOCKER_RESOLVE_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, BlockerResolveBody);
      return {
        status: 201,
        body: await workOrderModule().jobBoard.resolveBlocker(
          db,
          params.blockerId,
          { note: input.note },
          authorizeScope
        ),
      };
    },
    { params: raw, body }
  );
}
