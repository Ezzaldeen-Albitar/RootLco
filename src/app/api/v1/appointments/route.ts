/**
 * POST /api/v1/appointments — book an appointment (Phase 1-18, P1-18-BE-001).
 *
 * The requested window records what the customer asked for and the frozen
 * `tg_appointments_immutable` trigger never lets it be rewritten, so this is the
 * only operation that can set it. The lifecycle always starts at `requested`:
 * creation is not a transition, and a caller able to post an already-confirmed
 * appointment would bypass both the transition guard and the append-only status
 * ledger.
 *
 * A confirmed window is deliberately NOT accepted here. It was, and it was worse
 * than refusing it: the same-vehicle exclusion constraint is partial on
 * `lifecycle_status IN ('confirmed','checked_in')`, so a confirmed window stored
 * on a `requested` row was checked against nothing and two callers could book the
 * identical slot for one vehicle. The confirmed window is set by
 * `apt.appointment-reschedule`, which also moves the status and therefore lands
 * inside the constraint that refuses a clash.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, schemas, scopeTargetOption } from '@/server/http/validation';
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
    // `scope: 'branch'` alone is inert. With no target the pipeline evaluates
    // `iam.has_permission`, which is scope-blind, and RLS then consults
    // `app.branch_ids` -- the UNION of every branch across ALL of the caller's
    // grants. A user who is a service advisor in one branch and a viewer in
    // another could therefore book into the branch where they only read. Naming
    // the target switches evaluation to `iam.has_permission_in_scope`, which
    // counts an allow only from a grant that is unrestricted or actually covers
    // this company and branch. An unrestricted operator is unaffected. A caller
    // who omits either field gets no target and no bypass: the body schema then
    // refuses the request as 422.
    { body, ...scopeTargetOption(body) }
  );
}
