/**
 * The appointment contract (P1-28, Wave A) — every `apt.*` operation the
 * backend publishes, typed from the route source that owns each shape.
 *
 * Read out of `apps/api/src/app/api/v1/appointments/**` and
 * `appointment-catalogue/**`, the domain rules in
 * `apps/api/src/modules/reception/domain/appointment.ts`, and the read
 * repository row shapes in `appointment-read-repository.ts`. Nothing below is
 * inferred; where a rule is restated it is restated as a MIRROR of a frozen
 * server rule, and `tests/appointments-contract.test.ts` holds each row of
 * `APPOINTMENT_OPERATIONS` against the generated operation manifest and the
 * published OpenAPI document so drift fails a test rather than a reviewer.
 *
 * | operation                               | method | path                                        | permission                         |
 * | --------------------------------------- | ------ | ------------------------------------------- | ---------------------------------- |
 * | `apt.appointment-list`                  | GET    | `/appointments`                             | `apt.appointment.read`             |
 * | `apt.appointment-detail`                | GET    | `/appointments/{appointmentId}`             | `apt.appointment.read`             |
 * | `apt.appointment-create`                | POST   | `/appointments`                             | `apt.appointment.manage`           |
 * | `apt.appointment-reschedule`            | POST   | `/appointments/{appointmentId}/reschedule`  | `apt.appointment.manage`           |
 * | `apt.appointment-cancel`                | POST   | `/appointments/{appointmentId}/cancel`      | `apt.appointment.lifecycle.manage` |
 * | `apt.appointment-no-show`               | POST   | `/appointments/{appointmentId}/no-show`     | `apt.appointment.lifecycle.manage` |
 * | `apt.catalogue-appointment-type-list`   | GET    | `/appointment-catalogue/appointment-types`  | `apt.appointment.read`             |
 * | `apt.catalogue-source-channel-list`     | GET    | `/appointment-catalogue/source-channels`    | `apt.appointment.read`             |
 * | `apt.catalogue-cancellation-reason-list`| GET    | `/appointment-catalogue/cancellation-reasons`| `apt.appointment.read`            |
 *
 * ## There is NO confirm operation
 *
 * Canonical UC-APT-001 is one use case — "Confirm or reschedule appointment" —
 * and the platform implements it as one command. `apt.appointment-reschedule`
 * sets the confirmed window AND moves `requested`/`pending_confirmation` →
 * `confirmed` in the same statement, because `confirmed` is the state the
 * same-vehicle overlap EXCLUDE constraint is partial on: a confirmed window on
 * a `requested` row would be a booking nothing guards. A screen offering a
 * separate "Confirm" control would be offering an operation that does not
 * exist; confirmation is rescheduling to a firm window.
 *
 * ## The contract facts every write screen must encode
 *
 * - **`Idempotency-Key` is mandatory on every write here.** The client derives
 *   it from the generated manifest (`P1-27-INT-003`); no adapter sets its own.
 *   A replay with the same key returns the STORED body at **200 — even create,
 *   whose first answer was 201 — with NO ETag** (`route-handler.ts:369-401`).
 *   Key reuse with a different payload is 409 `ERR-INT-001`.
 * - **`If-Match` is mandatory on reschedule, cancel and no-show** (all three
 *   register `versionGuarded: true`). Missing is 428 `ERR-CON-002`; stale is
 *   409 `ERR-CON-001`. Create is NOT guarded — there is no record yet.
 * - The detail read publishes `recordVersion` and emits it as an `ETag`; the
 *   list carries `recordVersion` per row because the guarded commands are
 *   addressed from the list.
 * - An illegal lifecycle move is 409 `ERR-TRN-001`, and re-reading does not
 *   cure it — the state itself refuses the command.
 * - Reschedule window violations report the path `body.confirmedFrom` even when
 *   `confirmedTo` is the offending field (`appointment-service.ts:184`), so a
 *   screen must render window errors against the WINDOW, not one input.
 *
 * ## The list is a branch calendar, and the branch is part of the request
 *
 * `companyId` and `branchId` are REQUIRED query parameters — resource
 * selectors naming which branch's calendar to read, carried as the
 * authorization target (`P1-18-A-01`) — so the adapter builds them through
 * `branchTargetQuery`, the one door `lib/api` opens for that pair. Ordering is
 * fixed: soonest effective window first, `COALESCE(confirmed_from,
 * requested_from)` ascending. There is no sort parameter and no total.
 */

/** One `apt.*` operation row, mirrored by the QA-001 harness. */
export interface AppointmentOperationRow {
  readonly operationId: string;
  /**
   * `PATCH` joined the union with the intake-catalogue management contract
   * (PR #227): a catalogue amend is the first `apt.*` operation that is not a
   * GET or a POST.
   */
  readonly method: 'GET' | 'POST' | 'PATCH';
  /** Path template WITHOUT the `/api/v1` prefix, exactly as published. */
  readonly template: string;
  /** True when the backend refuses the request without an `Idempotency-Key`. */
  readonly idempotent: boolean;
  /** True when the backend refuses the request without `If-Match` (428). */
  readonly versionGuarded: boolean;
  /** The one permission code the operation registers. */
  readonly permission: string;
  /** The published `x-audit-class`. */
  readonly auditClass: string;
}

export const APPOINTMENT_PERMISSIONS = {
  /** Both reads and all three catalogue pickers. */
  read: 'apt.appointment.read',
  /** Booking and rescheduling — arranging the appointment. */
  manage: 'apt.appointment.manage',
  /** Cancelling and recording a no-show — ENDING it is a separate authority. */
  lifecycleManage: 'apt.appointment.lifecycle.manage',
  /**
   * Administering the appointment intake catalogues — appointment types,
   * cancellation reasons and source channels.
   *
   * The code is named here because the backend registers it and this layer must
   * know every code its domain can be denied for; it is NOT consulted by any
   * screen, because there is no catalogue-administration screen. No canonical
   * P1-28 task binds one, and who administers the intake catalogues and through
   * which surface is `P1-28-OD-001` (`docs/phase-1/phase-1-28/canonical-plan.md`
   * §7). The twelve operations behind it are recorded in
   * `docs/phase-1/phase-1-28/write-reachability.json`, the writes among them as
   * DELIBERATELY_ABSENT against that decision.
   */
  catalogueManage: 'apt.catalogue.manage',
} as const;

/**
 * Every `apt.*` operation the platform publishes — the mirror test asserts
 * this set equals the manifest's `apt.` slice in BOTH directions, so a new
 * backend operation fails a test until this layer covers it.
 */
export const APPOINTMENT_OPERATIONS: readonly AppointmentOperationRow[] = Object.freeze([
  {
    operationId: 'apt.appointment-list',
    method: 'GET',
    template: '/appointments',
    idempotent: false,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'apt.appointment-detail',
    method: 'GET',
    template: '/appointments/{appointmentId}',
    idempotent: false,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'apt.appointment-create',
    method: 'POST',
    template: '/appointments',
    idempotent: true,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.manage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.appointment-reschedule',
    method: 'POST',
    template: '/appointments/{appointmentId}/reschedule',
    idempotent: true,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.manage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.appointment-cancel',
    method: 'POST',
    template: '/appointments/{appointmentId}/cancel',
    idempotent: true,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.lifecycleManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.appointment-no-show',
    method: 'POST',
    template: '/appointments/{appointmentId}/no-show',
    idempotent: true,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.lifecycleManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-appointment-type-list',
    method: 'GET',
    template: '/appointment-catalogue/appointment-types',
    idempotent: false,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'apt.catalogue-source-channel-list',
    method: 'GET',
    template: '/appointment-catalogue/source-channels',
    idempotent: false,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'apt.catalogue-cancellation-reason-list',
    method: 'GET',
    template: '/appointment-catalogue/cancellation-reasons',
    idempotent: false,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.read,
    auditClass: 'none',
  },

  /*
   * The intake-catalogue ADMINISTRATION surface (PR #227).
   *
   * These twelve rows mirror a published contract that NO screen in this
   * product reaches, and that is the point of writing them down: this module's
   * claim is "every apt.* operation the platform publishes", and an operation
   * left out because nothing calls it would make the mirror a description of
   * the screens rather than of the contract — which is how a backend code the
   * interface never learned about becomes a denial nobody wrote down.
   *
   * There is no adapter for any of them. No canonical P1-28 task binds a
   * catalogue-administration screen, and who may administer these catalogues
   * and through which surface is `P1-28-OD-001`
   * (`docs/phase-1/phase-1-28/canonical-plan.md` §7). The nine writes among
   * them are recorded DELIBERATELY_ABSENT against that decision in
   * `docs/phase-1/phase-1-28/write-reachability.json`, which the SEC-004 gate
   * resolves against §7 itself.
   */
  {
    operationId: 'apt.catalogue-appointment-type-create',
    method: 'POST',
    template: '/appointment-catalogue/appointment-types',
    idempotent: true,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-appointment-type-management-list',
    method: 'GET',
    template: '/appointment-catalogue/management/appointment-types',
    idempotent: false,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'apt.catalogue-appointment-type-status-set',
    method: 'POST',
    template: '/appointment-catalogue/appointment-types/{appointmentTypeId}/status',
    idempotent: true,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-appointment-type-update',
    method: 'PATCH',
    template: '/appointment-catalogue/appointment-types/{appointmentTypeId}',
    idempotent: false,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-cancellation-reason-create',
    method: 'POST',
    template: '/appointment-catalogue/cancellation-reasons',
    idempotent: true,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-cancellation-reason-management-list',
    method: 'GET',
    template: '/appointment-catalogue/management/cancellation-reasons',
    idempotent: false,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'apt.catalogue-cancellation-reason-status-set',
    method: 'POST',
    template: '/appointment-catalogue/cancellation-reasons/{cancellationReasonId}/status',
    idempotent: true,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-cancellation-reason-update',
    method: 'PATCH',
    template: '/appointment-catalogue/cancellation-reasons/{cancellationReasonId}',
    idempotent: false,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-source-channel-create',
    method: 'POST',
    template: '/appointment-catalogue/source-channels',
    idempotent: true,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-source-channel-management-list',
    method: 'GET',
    template: '/appointment-catalogue/management/source-channels',
    idempotent: false,
    versionGuarded: false,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'apt.catalogue-source-channel-status-set',
    method: 'POST',
    template: '/appointment-catalogue/source-channels/{sourceChannelId}/status',
    idempotent: true,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'apt.catalogue-source-channel-update',
    method: 'PATCH',
    template: '/appointment-catalogue/source-channels/{sourceChannelId}',
    idempotent: false,
    versionGuarded: true,
    permission: APPOINTMENT_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
]);

/* ------------------------------------------------------------------ *
 * Lifecycle — the frozen `ck_appointments_status` vocabulary and the
 * `apt.guard_appointment_transition` graph, mirrored
 * ------------------------------------------------------------------ */

/** Frozen `ck_appointments_status`, in lifecycle order. */
export const APPOINTMENT_STATUSES = [
  'requested',
  'pending_confirmation',
  'confirmed',
  'checked_in',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/**
 * The frozen transition graph, restated so a screen offers only moves that can
 * succeed. Two rows deserve their footnotes:
 *
 * - `pending_confirmation` is reachable by NO published operation — the
 *   creation always lands `requested` and no command targets it. It is a
 *   render-only state: a screen must LABEL it, and must never offer a control
 *   that promises to reach it.
 * - `checked_in` is reached ONLY as a side effect of `rec.reception-create`
 *   consuming a confirmed appointment, in the same transaction, with no version
 *   predicate. No appointment command sets it.
 */
export const APPOINTMENT_TRANSITIONS: Readonly<Record<string, readonly AppointmentStatus[]>> =
  Object.freeze({
    requested: ['pending_confirmation', 'confirmed', 'cancelled'],
    pending_confirmation: ['confirmed', 'cancelled'],
    confirmed: ['checked_in', 'cancelled', 'no_show'],
    checked_in: [],
    cancelled: [],
    no_show: [],
  });

/** No transition leaves these. A command against one is 409 `ERR-TRN-001`. */
export const TERMINAL_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'checked_in',
  'cancelled',
  'no_show',
];

/** Reschedule is legal while the appointment can still be honoured. */
export function canReschedule(status: AppointmentStatus): boolean {
  return !TERMINAL_APPOINTMENT_STATUSES.includes(status);
}

/** Cancellation is legal from any non-terminal state (frozen graph). */
export function canCancel(status: AppointmentStatus): boolean {
  return (APPOINTMENT_TRANSITIONS[status] ?? []).includes('cancelled');
}

/**
 * No-show is reachable from `confirmed` ONLY — a business rule, not a graph
 * accident: nobody can fail to show up for an appointment nobody confirmed.
 */
export function canRecordNoShow(status: AppointmentStatus): boolean {
  return (APPOINTMENT_TRANSITIONS[status] ?? []).includes('no_show');
}

/* ------------------------------------------------------------------ *
 * Windows — bounded instants with a MANDATORY explicit UTC offset
 * ------------------------------------------------------------------ */

/** `z.string().min(1).max(64)` on both route schemas. */
export const MAX_INSTANT_LENGTH = 64;

/**
 * Mirror of the module domain's offset rule (`domain/appointment.ts:119`).
 *
 * A timezone-less local timestamp would be resolved against the SERVER zone —
 * for a branch calendar in another country, a real booking on the wrong hour —
 * so the backend refuses it, and this mirror lets the form say so beside the
 * field instead of surfacing an opaque 422. The displacement is capped at
 * ±15:59 because that is PostgreSQL's own `timestamptz` limit: V8 happily
 * parses `+16:00`, so without the cap the value would sail past every client
 * and server guard and die in the database as an unmapped `22009`.
 */
const EXPLICIT_OFFSET = /(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/;

export function hasExplicitUtcOffset(value: string): boolean {
  return EXPLICIT_OFFSET.test(value);
}

/**
 * The refusals this layer can decide locally about one instant. Stable tokens,
 * not translation keys — a screen maps them to its own catalogue entries, and a
 * token that reached an operator raw would be a defect in the screen.
 */
export type InstantIssue = 'empty' | 'too_long' | 'missing_offset' | 'unparseable';

export function validateInstant(value: string): InstantIssue | 'ok' {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length > MAX_INSTANT_LENGTH) return 'too_long';
  if (!hasExplicitUtcOffset(trimmed)) return 'missing_offset';
  if (Number.isNaN(Date.parse(trimmed))) return 'unparseable';
  return 'ok';
}

export type WindowIssue = InstantIssue | 'not_after_start';

export interface WindowIssues {
  readonly from?: WindowIssue;
  readonly to?: WindowIssue;
}

/**
 * Mirrors `ck_appointments_requested_window` / `_confirmed_window` plus the
 * offset rule: both instants must validate and the end must be STRICTLY after
 * the start, compared as instants, never as strings — a lexical comparison of
 * offset-bearing ISO strings is wrong in both directions across mixed offsets.
 */
export function validateWindow(from: string, to: string): WindowIssues {
  const issues: { from?: WindowIssue; to?: WindowIssue } = {};
  const fromIssue = validateInstant(from);
  const toIssue = validateInstant(to);
  if (fromIssue !== 'ok') issues.from = fromIssue;
  if (toIssue !== 'ok') issues.to = toIssue;
  if (fromIssue === 'ok' && toIssue === 'ok' && Date.parse(to) <= Date.parse(from)) {
    issues.to = 'not_after_start';
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * Requests, exactly as the routes parse them
 * ------------------------------------------------------------------ */

/**
 * What `POST /appointments` accepts (`.strict()`). Creation books the
 * REQUESTED window only and always lands `requested`: a confirmed window on a
 * fresh row would sit outside the overlap EXCLUDE constraint's partial
 * predicate and reserve nothing. There is no notes field and no status field.
 *
 * `companyId`/`branchId` here are the scope the operation is AUTHORIZED
 * against — the body is the authorization target for a branch-scoped create
 * (`P1-18-A-01`) — which is why this input carries them while no read filter
 * ever may.
 */
export interface AppointmentCreateInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly requesterPartnerId: string;
  readonly appointmentTypeId: string;
  /** Optional and nullable; the route defaults absence to `null`. */
  readonly sourceChannelId?: string | null;
  readonly requestedFrom: string;
  readonly requestedTo: string;
}

/** What `POST .../reschedule` accepts: the CONFIRMED window, nothing else. */
export interface AppointmentRescheduleInput {
  readonly confirmedFrom: string;
  readonly confirmedTo: string;
}

/**
 * What `POST .../cancel` accepts. The reason is mandatory and CATALOGUED —
 * `ck_appointments_cancellation_pairing` demands reason and timestamp
 * together, so there is no free-text escape. An unknown id is 422
 * `unknown_reference`.
 */
export interface AppointmentCancelInput {
  readonly cancellationReasonId: string;
}

/**
 * The `.strict()` list query, minus the mandatory branch target (which travels
 * through `BranchTarget` — see the module note). `from`/`to` are inclusive
 * bounds the EFFECTIVE window must overlap; an inverted range is a 422, not an
 * empty page.
 */
export interface AppointmentListCriteria {
  readonly status?: AppointmentStatus;
  readonly vehicleId?: string;
  readonly from?: string;
  readonly to?: string;
}

/* ------------------------------------------------------------------ *
 * Responses, exactly as the services publish them
 * ------------------------------------------------------------------ */

/** What creation returns (201, plus `ETag: "1"`). */
export interface AppointmentCreated {
  readonly appointmentId: string;
  /** `null` when the tenant has not provisioned an appointment-number sequence. */
  readonly displayNumber: string | null;
  readonly lifecycleStatus: AppointmentStatus;
  readonly recordVersion: number;
}

/** What the three lifecycle commands return (200, plus a fresh ETag). */
export interface AppointmentChanged {
  readonly appointmentId: string;
  readonly changeKind: 'booked' | 'rescheduled' | 'cancelled' | 'no_show_recorded';
  readonly lifecycleStatus: AppointmentStatus;
  readonly recordVersion: number;
}

/**
 * One row of the branch calendar. `recordVersion` travels per row because the
 * guarded lifecycle commands are addressed from the list; the requester and
 * type names are resolved so no screen shows a uuid where a name belongs.
 */
export interface AppointmentListEntry {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly lifecycleStatus: AppointmentStatus;
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  readonly requesterPartnerId: string;
  readonly requesterDisplayName: string | null;
  readonly appointmentTypeId: string;
  readonly appointmentTypeName: string | null;
  /** What the customer asked for. Immutable forever. */
  readonly requestedFrom: string;
  readonly requestedTo: string;
  /** What the workshop promised. Set only by reschedule. */
  readonly confirmedFrom: string | null;
  readonly confirmedTo: string | null;
  readonly recordVersion: number;
}

/** The full detail row. The `recordVersion` is the `If-Match` the commands demand. */
export interface AppointmentDetail {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly lifecycleStatus: AppointmentStatus;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  readonly requesterPartnerId: string;
  readonly requesterDisplayName: string | null;
  readonly appointmentTypeId: string;
  readonly appointmentTypeName: string | null;
  readonly sourceChannelId: string | null;
  readonly sourceChannelName: string | null;
  readonly requestedFrom: string;
  readonly requestedTo: string;
  readonly confirmedFrom: string | null;
  readonly confirmedTo: string | null;
  readonly cancellationReasonId: string | null;
  readonly cancellationReasonName: string | null;
  readonly cancelledAt: string | null;
  readonly noShowRecordedAt: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}
