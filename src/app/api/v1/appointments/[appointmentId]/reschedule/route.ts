/**
 * POST /api/v1/appointments/{appointmentId}/reschedule (Phase 1-18, P1-18-BE-002).
 *
 * Moves the CONFIRMED window, never the requested one: `requested_from` and
 * `requested_to` are listed in `tg_appointments_immutable` because they record what
 * the customer asked for, so the original request survives every reschedule as
 * history.
 *
 * Agreeing a firm window IS confirming, so this command also moves
 * `requested`|`pending_confirmation` -> `confirmed` and writes the status ledger
 * row for it. That is not a second operation smuggled in: canonical UC-APT-001 is
 * one use case, "Confirm or reschedule appointment". Leaving the lifecycle behind
 * would be worse than moving it — `confirmed` is the state the same-vehicle overlap
 * EXCLUDE is partial on, and the only state a no-show or an appointment-originated
 * check-in is reachable from, so a confirmed window on a `requested` row would be a
 * booking nothing guards. An already-`confirmed` appointment simply moves its
 * window; a terminal one is refused.
 *
 * The plan text writes this as `{appointmentId}:reschedule`; it is a sub-resource
 * because the phase's route convention rules out colon-verb paths and `:` is not a
 * legal directory name on Windows. Same operation, same semantics.
 *
 * `If-Match` is mandatory: two schedulers moving one appointment is the ordinary
 * case, and the loser must be told rather than silently overwritten.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ appointmentId: schemas.uuid });

/** Bounded but not decoded here; the offset rule belongs to the module domain. */
const Instant = z.string().min(1).max(64);

const Body = z.object({ confirmedFrom: Instant, confirmedTo: Instant }).strict();

export const APPOINTMENT_RESCHEDULE_OPERATION = defineOperation({
  id: 'apt.appointment-reschedule',
  module: 'reception',
  method: 'POST',
  path: '/appointments/{appointmentId}/reschedule',
  summary: 'Set or move the confirmed window of an appointment.',
  permissions: ['apt.appointment.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'apt.appointment.rescheduled',
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
    APPOINTMENT_RESCHEDULE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const input = await parseJsonBody(raw, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await receptionModule().appointments.reschedule(
        db,
        params.appointmentId,
        expectedVersion,
        input
      );
      return { status: 200, body: changed, recordVersion: changed.recordVersion };
    },
    { params, body }
  );
}
