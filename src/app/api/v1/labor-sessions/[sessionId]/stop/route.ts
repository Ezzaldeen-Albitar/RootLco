/**
 * POST /api/v1/labor-sessions/{sessionId}/stop (Phase 1-19, P1-19-BE-018).
 *
 * Stops an open session. `ended_at` is stamped with the server clock and is
 * WRITE-ONCE: `tech.guard_labor_session` refuses any later change to a non-null
 * `ended_at`, so amending recorded hours is a correction — a new linked row — rather
 * than an edit. This route therefore refuses an already-stopped session rather than
 * letting the attempt reach the trigger as a rewrite.
 *
 * Stopping the clock is not the same act as pausing the job. `tech.labor_sessions`
 * has no pause column, so a pause is this request plus a job transition into
 * `paused`, whose `reason_required` is true — which is why the reason for stopping
 * lives in `wo.job_status_history` and not here. A technician may also stop their
 * clock at the end of a shift while the job stays exactly where it is.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ sessionId: schemas.uuid });

export const LABOR_SESSION_STOP_OPERATION = defineOperation({
  id: 'tech.labor-session-stop',
  module: 'technician',
  method: 'POST',
  path: '/labor-sessions/{sessionId}/stop',
  summary: 'Stop an open labour session.',
  permissions: ['tech.labor.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.labor.session_stopped',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    LABOR_SESSION_STOP_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const stopped = await technicianModule().laborSessions.stop(
        db,
        params.sessionId,
        { expectedVersion },
        authorizeScope
      );
      return { body: stopped, recordVersion: stopped.recordVersion };
    },
    { params: raw }
  );
}
