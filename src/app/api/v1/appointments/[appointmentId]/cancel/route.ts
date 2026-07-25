/**
 * POST /api/v1/appointments/{appointmentId}/cancel (Phase 1-18, P1-18-BE-003).
 *
 * Cancellation is terminal and set-once, and it is a different fact from a no-show:
 * `ck_appointments_cancellation_pairing` requires a catalogued reason and a
 * timestamp together, so the reason is mandatory here rather than optional colour.
 * It carries its own lifecycle permission because ending a booking is not the same
 * authority as arranging one.
 *
 * `If-Match` is mandatory so a cancellation cannot land on top of a reschedule the
 * caller never saw.
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
const Body = z.object({ cancellationReasonId: schemas.uuid }).strict();

export const APPOINTMENT_CANCEL_OPERATION = defineOperation({
  id: 'apt.appointment-cancel',
  module: 'reception',
  method: 'POST',
  path: '/appointments/{appointmentId}/cancel',
  summary: 'Cancel an appointment with a catalogued reason.',
  permissions: ['apt.appointment.lifecycle.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'apt.appointment.cancelled',
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
    APPOINTMENT_CANCEL_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const input = await parseJsonBody(raw, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await receptionModule().appointments.cancel(
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
