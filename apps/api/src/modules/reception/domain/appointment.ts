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
 * of what they typed. None of them is a length or a choice problem, and the zone
 * ones are not even visible in what they typed: an appointment time with no time
 * zone looks exactly like one with a time zone on a form. A sentence that sends
 * somebody to re-read a correct entry is worse than a vague one, so each cause
 * now names itself.
 *
 * The three zone members are separate for the same reason the family was split
 * off `invalid_value` at all. They used to be one token, and the three remedies
 * are different: an ABSENT offset is added, an UNREADABLE one is rewritten in
 * the shape the field expects, and an OUT-OF-RANGE one is a displacement no
 * place on earth keeps, so the sentence has to name the bounds. One token could
 * only ever carry one of those three instructions, and carried the first — which
 * told a caller whose entry already ended in an offset to supply the offset.
 */
export const APPOINTMENT_WINDOW_RULES = Object.freeze([
  'appointment_time_unreadable',
  'appointment_time_zone_missing',
  'appointment_time_zone_unreadable',
  'appointment_time_zone_out_of_range',
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
 * The displacement is bounded because an unbounded one reaches PostgreSQL. V8
 * parses an offset hour anywhere in 00–23 quite happily, so `…+16:00` satisfies
 * `Date.parse` and every other guard in this module and is refused only by the
 * database, as `22009` — an unmapped SQLSTATE, which surfaces as a 500 and an
 * exception-monitor incident any caller could manufacture at will. Refusing it
 * here is the same rule this module states above: decide it before PostgreSQL
 * sees it.
 *
 * The published bound is -12:00…+14:00, the range of civil offsets actually in
 * use (+14:00 is Kiribati, -12:00 the far side of the date line). PostgreSQL's
 * own `timestamptz` limit is wider, ±15:59, but a bound a sentence cannot name
 * is a bound nobody can act on: "no wider than ±15:59" tells a receptionist
 * nothing about which value to write, whereas the civil range is the set their
 * branch's offset is drawn from. Everything PostgreSQL would refuse is still
 * refused here, earlier, and by name.
 *
 * ## Three causes, not one
 *
 * `requireOffset` used to ask one question — does this end in a recognisable
 * offset — and publish one token for every No. So a missing offset, a mistyped
 * one (`…+9`, `…+09`) and an impossible one (`…+16:00`) all told the caller to
 * supply an offset, which is wrong advice for the two entries that already
 * carried one. The three are decided separately below and each carries its own
 * token, because each has a different next step.
 *
 * The three expressions are duplicated verbatim in
 * `apps/web/src/components/forms/instant.ts`, which is the browser-side
 * pre-check for the same rule, and must be changed with it: a client that
 * classifies differently from the server sends the operator to fix a value the
 * server would have accepted, or vice versa.
 */
const ZULU = /Z$/;
const OFFSET = /([+-])(\d{2}):(\d{2})$/;
/**
 * A tail that is an offset ATTEMPT rather than an offset. The sign must follow a
 * clock time, which is what keeps the hyphens inside the date (`2026-09-01`)
 * from reading as the start of a displacement.
 */
const OFFSET_ATTEMPT = /\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?[+-][^+-]*$/;

const MIN_OFFSET_MINUTES = -12 * 60;
const MAX_OFFSET_MINUTES = 14 * 60;

function requireOffset(value: string, field: string): void {
  if (ZULU.test(value)) return;

  const parts = OFFSET.exec(value);
  if (!parts) {
    if (OFFSET_ATTEMPT.test(value)) {
      throw new AppointmentRuleError(
        `${field} ends in something that is not a readable UTC offset; write it as ` +
          '…Z or …±HH:MM',
        'appointment_time_zone_unreadable'
      );
    }
    throw new AppointmentRuleError(
      `${field} must carry an explicit UTC offset (…Z or …±HH:MM); a timezone-less ` +
        'timestamp would be resolved against the server zone rather than the branch zone',
      'appointment_time_zone_missing'
    );
  }

  const magnitude = Number.parseInt(parts[2] ?? '', 10) * 60 + Number.parseInt(parts[3] ?? '', 10);
  const displacement = parts[1] === '-' ? -magnitude : magnitude;
  // Stated as "inside the bound" rather than "outside it" so that a displacement
  // that somehow failed to read as a number is refused rather than admitted.
  if (!(displacement >= MIN_OFFSET_MINUTES && displacement <= MAX_OFFSET_MINUTES)) {
    throw new AppointmentRuleError(
      `${field} carries a UTC offset outside the range in civil use, which runs from ` +
        '-12:00 to +14:00',
      'appointment_time_zone_out_of_range'
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
