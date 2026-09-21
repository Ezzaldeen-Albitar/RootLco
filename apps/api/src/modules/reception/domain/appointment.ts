/**
 * Appointment domain rules (Phase 1-18, P1-18-BE-001…P1-18-BE-004).
 *
 * Pure: no database access, no I/O. Everything here is a rule the frozen Phase
 * 1-8 `apt` schema already enforces, restated so a bad request is refused with a
 * stable 422 before it ever reaches PostgreSQL — never a second, softer opinion
 * about what the database allows.
 *
 * Two facts drive the whole module and are worth stating once:
 *
 *  1. `requested_from` / `requested_to` are IMMUTABLE (the
 *     `tg_appointments_immutable` trigger lists them). They record what the
 *     customer asked for and are never rewritten. Rescheduling therefore moves
 *     the CONFIRMED window — which is also the window the same-vehicle overlap
 *     `EXCLUDE` constraint guards — and the request survives as history.
 *  2. `cancelled` and `no_show` are distinct terminal states with their own
 *     set-once evidence columns and their own coherence CHECKs. Neither is a
 *     flag, and one never substitutes for the other.
 */
import { AppFailure } from '@/server/errors/app-failure';

/** Frozen `ck_appointments_status` vocabulary, in lifecycle order. */
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
 * The frozen `apt.guard_appointment_transition` graph, restated. `checked_in`
 * has no outgoing edge and is reached only by reception creation, never by a
 * direct lifecycle command — which is why it is not a settable target below.
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

/** Terminal states: no transition out of them exists in the frozen graph. */
export const TERMINAL_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'checked_in',
  'cancelled',
  'no_show',
];

export const MAX_DISPLAY_NUMBER = 64;

/**
 * Why a window this layer decided was refused, as a rule token on the wire.
 *
 * Every member of this list used to be published as `invalid_value`, whose
 * sentence tells a receptionist to check the choices, the length and the range
 * of what they typed. None of the three is a length or a range problem, and the
 * middle one is not even visible in what they typed: an appointment time with no
 * time zone looks exactly like one with a time zone on a form. A sentence that
 * sends somebody to re-read a correct entry is worse than a vague one, so each
 * cause now names itself.
 */
export const APPOINTMENT_WINDOW_RULES = Object.freeze([
  'appointment_time_unreadable',
  'appointment_time_zone_missing',
  'appointment_window_backwards',
] as const);
export type AppointmentWindowRule = (typeof APPOINTMENT_WINDOW_RULES)[number];

/** Raised for a rule this layer can decide without the database. */
export class AppointmentRuleError extends Error {
  public override readonly name = 'AppointmentRuleError';

  public constructor(
    message: string,
    /** The token the publishing service puts on the wire for this cause. */
    public readonly rule: AppointmentWindowRule
  ) {
    super(message);
  }
}

export interface AppointmentCreateInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly requesterPartnerId: string;
  readonly appointmentTypeId: string;
  readonly sourceChannelId?: string | null;
  readonly requestedFrom: string;
  readonly requestedTo: string;
}

export interface AppointmentCreatePlan {
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly requesterPartnerId: string;
  readonly appointmentTypeId: string;
  readonly sourceChannelId: string | null;
  readonly requestedFrom: string;
  readonly requestedTo: string;
  readonly confirmedFrom: string | null;
  readonly confirmedTo: string | null;
  readonly lifecycleStatus: AppointmentStatus;
}

export interface RescheduleInput {
  readonly confirmedFrom: string;
  readonly confirmedTo: string;
}

export interface CancelInput {
  readonly cancellationReasonId: string;
}

function instant(value: string, field: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new AppointmentRuleError(
      `${field} is not a valid timestamp`,
      'appointment_time_unreadable'
    );
  }
  return ms;
}

/**
 * Both instants must carry an explicit offset. A timezone-less local timestamp
 * would be silently interpreted as the server's zone, which for a branch
 * calendar in another country is a real booking on the wrong hour. Refusing it
 * is the whole point — the alternative is a plausible wrong answer.
 *
 * The displacement is capped at ±15:59 because that is PostgreSQL's own limit on
 * a `timestamptz` offset, not a guess about which zones exist. V8 parses hours up
 * to 23 quite happily, so `…+16:00` satisfies `Date.parse` and every other guard
 * in this module and is refused only by the database, as `22009` — an unmapped
 * SQLSTATE, which surfaces as a 500 and an exception-monitor incident any caller
 * could manufacture at will. Refusing it here is the same rule this module states
 * above: decide it before PostgreSQL sees it. The real world stays inside the
 * bound with room to spare — the widest offset in use is +14:00 (Kiribati).
 */
const OFFSET = /(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/;

function requireOffset(value: string, field: string): void {
  if (!OFFSET.test(value)) {
    throw new AppointmentRuleError(
      `${field} must carry an explicit UTC offset (…Z or …±HH:MM, no wider than ` +
        '±15:59); a timezone-less timestamp would be resolved against the server ' +
        'zone rather than the branch zone',
      'appointment_time_zone_missing'
    );
  }
}

function window(from: string, to: string, label: string): void {
  requireOffset(from, `${label}From`);
  requireOffset(to, `${label}To`);
  const start = instant(from, `${label}From`);
  const end = instant(to, `${label}To`);
  // Mirrors ck_appointments_requested_window / ck_appointments_confirmed_window.
  if (end <= start) {
    throw new AppointmentRuleError(
      `${label}To must be strictly after ${label}From`,
      'appointment_window_backwards'
    );
  }
}

/**
 * Creation books the REQUESTED window only.
 *
 * A confirmed window used to be accepted here and stored, which was worse than
 * refusing it: `ex_appointments_vehicle_confirmed` — the exclusion constraint
 * that makes two appointments for one vehicle impossible — is PARTIAL on
 * `lifecycle_status IN ('confirmed','checked_in')`, and creation always starts
 * at `requested`. So the window was written, was indexed by the branch calendar,
 * and was checked against nothing: two callers could book the identical
 * "confirmed" slot for the same vehicle and both receive 201. A field that reads
 * as a firm booking and reserves nothing is a promise the API cannot keep.
 *
 * The confirmed window is therefore set only by `apt.appointment-reschedule`,
 * which moves the appointment to `confirmed` in the same statement and so lands
 * inside the exclusion constraint's predicate, where a clash is refused.
 */
export function toAppointmentCreatePlan(input: AppointmentCreateInput): AppointmentCreatePlan {
  window(input.requestedFrom, input.requestedTo, 'requested');

  return {
    companyId: input.companyId,
    branchId: input.branchId,
    vehicleId: input.vehicleId,
    requesterPartnerId: input.requesterPartnerId,
    appointmentTypeId: input.appointmentTypeId,
    sourceChannelId: input.sourceChannelId ?? null,
    requestedFrom: input.requestedFrom,
    requestedTo: input.requestedTo,
    confirmedFrom: null,
    confirmedTo: null,
    // Creation always starts at the head of the graph. A caller cannot post an
    // appointment that is already confirmed, cancelled or checked in: that would
    // be a lifecycle transition wearing a creation's clothes, and it would
    // bypass both the transition guard and the status-history ledger.
    lifecycleStatus: 'requested',
  };
}

/**
 * ## Why each lifecycle refusal below carries a rule token
 *
 * Every one of them is `ERR-TRN-001`, and the interface never renders
 * server-authored prose — so without a token a booking clerk meets one sentence,
 * "the state does not allow this", for four unrelated refusals with four
 * different cures. The token names the PRECONDITION the command needed and
 * nothing else: not the current state, not the customer, not the vehicle. That
 * keeps it safe to publish to a caller who is already reading the appointment it
 * names, and it is what lets the catalogue sentence say what to do next.
 *
 * The token is per COMMAND rather than per current state. The cure depends on
 * the command — confirm a time, book again, cancel instead — and never on which
 * of the closed states the appointment happens to be sitting in; a token per
 * state would multiply the catalogue without telling the clerk anything more.
 */

/**
 * Rescheduling sets the confirmed window. Permitted only while the appointment
 * can still be honoured — a cancelled, no-show, or already checked-in
 * appointment has nothing left to move.
 */
export function assertReschedulable(current: string): void {
  if (TERMINAL_APPOINTMENT_STATUSES.includes(current as AppointmentStatus)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `An appointment in state "${current}" is terminal and cannot be rescheduled`,
      safeDetails: {
        violations: [{ path: 'path.appointmentId', rule: 'appointment_not_reschedulable' }],
      },
    });
  }
}

export function toReschedulePlan(input: RescheduleInput): RescheduleInput {
  window(input.confirmedFrom, input.confirmedTo, 'confirmed');
  return { confirmedFrom: input.confirmedFrom, confirmedTo: input.confirmedTo };
}

/** Cancellation is legal from any non-terminal state (frozen graph). */
export function assertCancellable(current: string): void {
  if (!(APPOINTMENT_TRANSITIONS[current] ?? []).includes('cancelled')) {
    throw new AppFailure('ERR-TRN-001', {
      message: `An appointment in state "${current}" cannot be cancelled`,
      safeDetails: {
        violations: [{ path: 'path.appointmentId', rule: 'appointment_not_cancellable' }],
      },
    });
  }
}

/**
 * No-show is reachable from `confirmed` ONLY. That is a deliberate business
 * rule, not an accident of the graph: you cannot fail to show up for an
 * appointment nobody confirmed.
 */
export function assertNoShowRecordable(current: string): void {
  if (!(APPOINTMENT_TRANSITIONS[current] ?? []).includes('no_show')) {
    throw new AppFailure('ERR-TRN-001', {
      message:
        `An appointment in state "${current}" cannot be recorded as a no-show; ` +
        'only a confirmed appointment can be',
      safeDetails: {
        violations: [{ path: 'path.appointmentId', rule: 'appointment_not_confirmed_for_no_show' }],
      },
    });
  }
}

/** The appointment must be confirmed before it can be consumed by a check-in. */
export function assertCheckInEligible(current: string): void {
  if (!(APPOINTMENT_TRANSITIONS[current] ?? []).includes('checked_in')) {
    throw new AppFailure('ERR-TRN-001', {
      message:
        `An appointment in state "${current}" cannot be checked in; ` +
        'only a confirmed appointment can be',
      // Twice, deliberately, and the second entry is the one an operator sees.
      // Check-in is the only command here that names its appointment in the BODY
      // rather than in the address, and the screen that sends it — the check-in
      // start screen — renders the request-level banner and no per-control error
      // at all, because the appointment is chosen from a list rather than typed.
      // A violation filed only under the control would therefore be written to a
      // map nothing reads, which on screen is indistinguishable from having
      // dropped it. The bare `body` entry states the same rule about the request
      // as a whole, which is what `violationKeysOf` routes to the banner.
      safeDetails: {
        violations: [
          {
            path: 'body.origin.appointmentId',
            rule: 'appointment_not_confirmed_for_check_in',
          },
          { path: 'body', rule: 'appointment_not_confirmed_for_check_in' },
        ],
      },
    });
  }
}
