/**
 * POST /api/v1/appointments/{appointmentId}/no-show (Phase 1-18, P1-18-BE-004).
 *
 * Records that a confirmed appointment was not honoured. The frozen graph offers
 * `no_show` from `confirmed` only — you cannot fail to show up for an appointment
 * nobody confirmed — and the fact is never inferred from elapsed time: a named
 * actor asserts it, which is why this is a command rather than a scheduled job.
 *
 * It is its own route rather than a body flag on cancellation because `cancelled`
 * and `no_show` are distinct terminal states with separate set-once evidence
 * columns, and one must never be able to stand in for the other.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ appointmentId: schemas.uuid });

/**
 * The command carries no body: the fact is the appointment's own identity plus the
 * actor the session names. The empty strict shape is still declared and enforced so
 * a caller who tries to smuggle a status or a version alongside it gets a 422
 * rather than the quiet impression that it was applied.
 */
const Body = z.object({}).strict().nullable();

export const APPOINTMENT_NO_SHOW_OPERATION = defineOperation({
  id: 'apt.appointment-no-show',
  module: 'reception',
  method: 'POST',
  path: '/appointments/{appointmentId}/no-show',
  summary: 'Record a confirmed appointment as a no-show.',
  permissions: ['apt.appointment.lifecycle.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'apt.appointment.no_show_recorded',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ appointmentId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    APPOINTMENT_NO_SHOW_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await receptionModule().appointments.recordNoShow(
        db,
        params.appointmentId,
        expectedVersion,
        // Re-authorized against the LOCKED appointment's branch, not this
        // request: `scope: 'branch'` is inert without a target (P1-18-A-01).
        authorizeScope
      );
      return { status: 200, body: changed, recordVersion: changed.recordVersion };
    },
    { params, body }
  );
}
