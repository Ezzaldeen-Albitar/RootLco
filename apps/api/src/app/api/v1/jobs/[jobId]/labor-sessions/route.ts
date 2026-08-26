/**
 * Labour sessions on a job (Phase 1-19, P1-19-BE-017…018).
 *
 * `POST` starts one; `GET` returns the job's labour log, corrections included.
 *
 * ## No timestamp is accepted
 *
 * There is no `startedAt` in the body. `started_at` is the column default — the
 * server clock — and `tech.guard_labor_session` enforces a backdating window
 * precisely because a caller-chosen start would let recorded hours be written after
 * the fact. The one place an explicit window is legal is a correction, which is its
 * own operation behind its own higher-risk permission.
 *
 * ## Pause and resume are not operations here
 *
 * `tech.labor_sessions` has `started_at` and `ended_at` and nothing else temporal, so
 * a pause is: stop the open session (here), and transition the job to `paused`
 * (`POST /jobs/{jobId}/transition`, whose target state has `reason_required`). The
 * REASON for pausing therefore lives in `wo.job_status_history` rather than on the
 * session. They stay separate requests because they are separate facts with different
 * permissions, and a technician may stop their clock at the end of a shift without
 * changing the job's state at all.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });
export const Body = z.object({ technicianProfileId: schemas.uuid }).strict();
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const LABOR_SESSION_START_OPERATION = defineOperation({
  id: 'tech.labor-session-start',
  module: 'technician',
  method: 'POST',
  path: '/jobs/{jobId}/labor-sessions',
  summary: 'Start a labour session for a technician on a job.',
  permissions: ['tech.labor.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.labor.session_started',
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
    LABOR_SESSION_START_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const session = await technicianModule().laborSessions.start(
        db,
        { technicianProfileId: parsed.technicianProfileId, jobId: params.jobId },
        authorizeScope
      );
      return { status: 201, body: session, recordVersion: session.recordVersion };
    },
    { params: raw, body }
  );
}

export const LABOR_SESSION_LIST_OPERATION = defineOperation({
  id: 'tech.labor-session-list',
  module: 'technician',
  method: 'GET',
  path: '/jobs/{jobId}/labor-sessions',
  summary: 'Read the labour log of a job, newest start first.',
  // Employee-derived data: a session says who worked, and for how long. A caller who
  // may read the work-order board is not thereby entitled to timesheets.
  permissions: ['tech.technician.read'],
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
    LABOR_SESSION_LIST_OPERATION,
    request,
    // `authorizeScope` is destructured and FORWARDED, which the first version of this
    // handler did not do — it took `{ db }` only, and the path names no branch, so the
    // pre-handler check fell back to scope-blind `iam.has_permission` and
    // `scope: 'branch'` above was inert (P1-18-A-01). The service now re-checks against
    // the job's own company and branch.
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(Query, rawQuery, 'query');
      return {
        body: await technicianModule().laborSessions.forJob(
          db,
          params.jobId,
          {
            cursor: query.cursor,
            limit: query.limit,
          },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
