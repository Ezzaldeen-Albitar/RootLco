/**
 * POST /api/v1/labor-sessions/{sessionId}/corrections (Phase 1-19, P1-19-BE-019).
 *
 * Corrects a recorded window. The original is NOT edited:
 * `tech.correct_labor_session` soft-deletes it and inserts a linked replacement
 * carrying `correction_of_id`, in one statement — so the corrected hours and the
 * hours they replaced both survive, and the soft delete is what frees the partial
 * gist EXCLUDE range for the new window.
 *
 * A separate, higher permission by design. `tech.labor.correct` is `high` risk in the
 * seeded catalog while `tech.labor.record` is `low`, because a correction rewrites
 * what a technician was paid for — and it is the one path in this phase that accepts
 * caller-supplied timestamps at all. Both bounds must carry an offset: a
 * timezone-less wall-clock string names no instant.
 *
 * A reason is required, and the protected function refuses one that is blank, so the
 * amendment can never be unattributed.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_UNAVAILABILITY_REASON, technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ sessionId: schemas.uuid });
const Body = z
  .object({
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1).max(MAX_UNAVAILABILITY_REASON),
  })
  .strict();

export const LABOR_SESSION_CORRECT_OPERATION = defineOperation({
  id: 'tech.labor-session-correct',
  module: 'technician',
  method: 'POST',
  path: '/labor-sessions/{sessionId}/corrections',
  summary: 'Correct a labour session window, preserving the original.',
  permissions: ['tech.labor.correct'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.labor.session_corrected',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    LABOR_SESSION_CORRECT_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const corrected = await technicianModule().laborSessions.correct(
        db,
        params.sessionId,
        {
          startedAt: new Date(parsed.startedAt),
          endedAt: new Date(parsed.endedAt),
          reason: parsed.reason,
          expectedVersion,
        },
        authorizeScope
      );
      return { status: 201, body: corrected, recordVersion: corrected.recordVersion };
    },
    { params: raw, body }
  );
}
