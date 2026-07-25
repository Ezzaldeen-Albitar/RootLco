/**
 * POST /api/v1/appointments — book an appointment (Phase 1-18, P1-18-BE-001).
 *
 * The requested window records what the customer asked for and the frozen
 * `tg_appointments_immutable` trigger never lets it be rewritten, so this is the
 * only operation that can set it. A firm window may be supplied at booking, but the
 * lifecycle always starts at `requested`: creation is not a transition, and a caller
 * able to post an already-confirmed appointment would bypass both the transition
 * guard and the append-only status ledger.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, schemas } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * An RFC 3339 instant, bounded but not decoded here. That both instants must carry
 * an explicit UTC offset is the module domain's rule, and it is the layer that can
 * explain why a timezone-less value is refused rather than resolved against the
 * server zone; restating it here would be a second opinion on the same field.
 */
const Instant = z.string().min(1).max(64);

const Body = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    vehicleId: schemas.uuid,
    requesterPartnerId: schemas.uuid,
    appointmentTypeId: schemas.uuid,
    sourceChannelId: schemas.uuid.nullable().default(null),
    requestedFrom: Instant,
    requestedTo: Instant,
    confirmedFrom: Instant.nullable().default(null),
    confirmedTo: Instant.nullable().default(null),
  })
  .strict();

export const APPOINTMENT_CREATE_OPERATION = defineOperation({
  id: 'apt.appointment-create',
  module: 'reception',
  method: 'POST',
  path: '/appointments',
  summary: 'Book an appointment for a vehicle on a branch calendar.',
  permissions: ['apt.appointment.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'apt.appointment.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    APPOINTMENT_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const created = await receptionModule().appointments.create(
        db,
        await parseJsonBody(raw, Body)
      );
      // The ETag is the version the next guarded command must present, so a
      // reschedule or a cancellation needs no re-read to obtain it.
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
