/**
 * GET /api/v1/appointments/{appointmentId} — one appointment (P1-27 remediation
 * executed by P1-18, `P1-27-INT-019`).
 *
 * An operator arriving by URL could previously load nothing: the three guarded
 * lifecycle commands (`reschedule`, `cancel`, `no-show`) demand `If-Match` and
 * the only source of the record version was a prior write's response in the
 * same session. This route publishes the version as an ETag and resolves every
 * id to its label — vehicle, requester, type, channel, cancellation reason — so
 * a screen never shows a uuid where a name belongs.
 *
 * Addressed by id, so the pre-handler authorization check has no branch to
 * narrow by and `authorizeScope` re-decides against the row's own company and
 * branch once it is read (P1-18-A-01).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ appointmentId: schemas.uuid });

export const APPOINTMENT_DETAIL_OPERATION = defineOperation({
  id: 'apt.appointment-detail',
  module: 'reception',
  method: 'GET',
  path: '/appointments/{appointmentId}',
  summary: 'Read one appointment, its windows, status and record version.',
  permissions: ['apt.appointment.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ appointmentId: string }> }
): Promise<Response> {
  // The raw params go to the pipeline and the schema runs INSIDE it, so a
  // malformed id is rendered as the shared problem document rather than an
  // unhandled 500.
  const raw = await route.params;
  return handleOperation(
    APPOINTMENT_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const appointment = await receptionModule().appointmentRead.readAppointment(
        db,
        params.appointmentId,
        authorizeScope
      );
      // The ETag is the If-Match the guarded lifecycle commands demand.
      return { body: appointment, recordVersion: appointment.recordVersion };
    },
    { params: raw }
  );
}
