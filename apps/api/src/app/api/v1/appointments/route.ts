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
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { APPOINTMENT_STATUSES, receptionModule } from '@/modules/reception';

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

// ---------------------------------------------------------------------------
// GET /api/v1/appointments — the branch calendar (P1-27 remediation executed by
// P1-18, `P1-27-INT-019`). All four `apt.` operations were writes; there was no
// appointment read and no calendar of any kind. The date filter and the
// ordering both run over the CONFIRMED window falling back to the requested one
// (`COALESCE(confirmed_from, requested_from)`): the confirmed window is what
// the workshop promised, and a calendar ordered by the requested window would
// show a rescheduled appointment on the wrong day. `recordVersion` travels per
// row because the three guarded lifecycle commands are addressed from the list.
// ---------------------------------------------------------------------------

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    vehicleId: schemas.uuid.optional(),
    /** Inclusive range bounds; the effective window must OVERLAP [from, to]. */
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from !== undefined && query.to !== undefined && query.to < query.from) {
      // An inverted range matches nothing by construction; answering it with an
      // empty page would read as "no appointments" rather than "bad request".
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must not be earlier than from',
      });
    }
  });

export const APPOINTMENT_LIST_OPERATION = defineOperation({
  id: 'apt.appointment-list',
  module: 'reception',
  method: 'GET',
  path: '/appointments',
  summary: 'List the appointments of one branch over a date range, soonest first.',
  permissions: ['apt.appointment.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    APPOINTMENT_LIST_OPERATION,
    request,
    async ({ db }) => ({
      // Parsed INSIDE the handler so a malformed query is rendered as the
      // shared problem document rather than an unhandled 500.
      body: await receptionModule().appointmentRead.listAppointments(
        db,
        parseOrFail(ListQuery, raw, 'query')
      ),
    }),
    // The pre-handler check must not be scope-blind, and it runs before the
    // schema. `scopeTargetOption` reads the pair out of not-yet-validated input
    // and yields NO target unless both are well-formed UUIDs — it can only ever
    // make authorization stricter (P1-18-A-01).
    scopeTargetOption(raw)
  );
}
