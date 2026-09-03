/**
 * POST / GET /api/v1/jobs/{jobId}/work-logs (PRE-P1-29-BR-06 — `INS-27`, Owner
 * requirement 8).
 *
 * The progressive work log. Before `wo.job_work_logs`, a grep for any log, note
 * or comment table across `wo`/`tech`/`qms`/`dia` returned **nothing**: a
 * technician could record what state a job was in and how long they spent on it,
 * and had no way to say what they actually did.
 *
 * ## Two different permissions, on purpose
 *
 * The WRITE costs `tech.labor.record` — *"Start, pause, resume and stop labor
 * sessions"* — because the work log is the technician's narration of the labour
 * they are already recording, by the same person, in the same act. Requiring
 * `wo.job.manage` would mean a technician cannot describe their own work.
 *
 * The READ costs `wo.work_order.read`, matching `wo.job-history`, which uses the
 * work-order code rather than a job or tech code. A work log describes **work,
 * not a person**: unlike an assignment it names no member of staff beyond the
 * `created_by` attribution every row in this platform carries.
 *
 * ## Append-only, and the grant is what means it
 *
 * `wo.job_work_logs` is granted `SELECT, INSERT` to `app_runtime` and nothing
 * else — no UPDATE, no DELETE, no `record_version`, no soft-delete column. So
 * there is no correction endpoint here and there cannot be one: a correction is a
 * NEW entry, which is what an append-only log means. The suite proves the
 * absence at the grant layer rather than trusting this comment.
 *
 * ## No state compatibility check
 *
 * An entry may be recorded in any job state, including a terminal one. A
 * technician writing up finished work is the normal case, and refusing it would
 * make the log unusable exactly when it matters most.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import { MAX_WORK_LOG_ENTRY, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });

/**
 * `loggedAt` is the caller's CLAIM about when the work happened, and it is
 * bounded on both sides by the service: not in the future, and not before the job
 * existed. `createdBy` is absent and `.strict()` refuses it — a log whose author
 * the author chooses is not evidence.
 */
export const WorkLogCreateBody = z
  .object({
    entry: z.string().trim().min(1).max(MAX_WORK_LOG_ENTRY),
    loggedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const WorkLogListQuery = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const JOB_WORK_LOG_RECORD_OPERATION = defineOperation({
  id: 'wo.job-work-log-record',
  successStatus: 201,
  module: 'work-order',
  method: 'POST',
  path: '/jobs/{jobId}/work-logs',
  summary: 'Append one progress entry to a job work log.',
  permissions: ['tech.labor.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.work_log_recorded',
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
    JOB_WORK_LOG_RECORD_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, WorkLogCreateBody);
      return {
        status: 201,
        body: await workOrderModule().jobBoard.recordWorkLog(
          db,
          params.jobId,
          { entry: input.entry, loggedAt: input.loggedAt },
          authorizeScope
        ),
      };
    },
    { params: raw, body }
  );
}

export const JOB_WORK_LOG_LIST_OPERATION = defineOperation({
  id: 'wo.job-work-log-list',
  module: 'work-order',
  method: 'GET',
  path: '/jobs/{jobId}/work-logs',
  summary: 'Read one job work log, newest entry first.',
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
    JOB_WORK_LOG_LIST_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(
        WorkLogListQuery,
        searchParamsToObject(new URL(req.url).searchParams),
        'query'
      );
      return {
        body: await workOrderModule().jobBoard.listWorkLogs(
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
