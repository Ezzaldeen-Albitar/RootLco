/**
 * Reception-visit domain rules (Phase 1-18, P1-18-BE-005…P1-18-BE-010,
 * P1-18-BE-018, P1-18-BE-019).
 *
 * Pure. Restates the frozen Phase 1-8 `rec` contract so a bad request fails
 * closed with a stable code before reaching PostgreSQL. The database remains the
 * authority on every one of these rules; nothing here relaxes one.
 *
 * The origin contract is the load-bearing rule: a visit has EXACTLY ONE origin —
 * an appointment XOR a walk-in (`ck_reception_visits_one_origin`). A walk-in is
 * therefore a real, first-class origin record, not a fabricated appointment.
 */
import { AppFailure } from '@/server/errors/app-failure';

/** Frozen `ck_reception_visits_status` vocabulary, in lifecycle order. */
export const RECEPTION_STATUSES = [
  'opened',
  'inspecting',
  'authorized',
  'converted',
  'closed_without_work',
  'refused',
] as const;
export type ReceptionStatus = (typeof RECEPTION_STATUSES)[number];

/** The frozen `rec.guard_reception_transition` graph, restated. */
export const RECEPTION_TRANSITIONS: Readonly<Record<string, readonly ReceptionStatus[]>> =
  Object.freeze({
    opened: ['inspecting', 'closed_without_work', 'refused'],
    inspecting: ['authorized', 'closed_without_work', 'refused'],
    authorized: ['converted', 'closed_without_work', 'refused'],
    converted: [],
    closed_without_work: [],
    refused: [],
  });

export const TERMINAL_RECEPTION_STATUSES: readonly ReceptionStatus[] = [
  'converted',
  'closed_without_work',
  'refused',
];

/** Frozen `ck_reception_party_roles_role` vocabulary (7 roles). */
export const RECEPTION_PARTY_ROLES = [
  'service_requester',
  'vehicle_owner',
  'vehicle_user',
  'payer',
  'billing_party',
  'approving_party',
  'authorized_receiver',
] as const;
export type ReceptionPartyRole = (typeof RECEPTION_PARTY_ROLES)[number];

/**
 * Frozen `ck_authorizations_role`: the subset of party roles that may authorize
 * work. `vehicle_user` and `payer` are deliberately absent — driving a vehicle
 * or paying for it is not authority to approve work on it, and the database
 * enforces that distinction through `rec.guard_authorization_authority`.
 */
export const AUTHORIZING_ROLES = [
  'approving_party',
  'service_requester',
  'vehicle_owner',
  'authorized_receiver',
] as const;
export type AuthorizingRole = (typeof AUTHORIZING_ROLES)[number];

/** Frozen `ck_authorizations_decision` and `ck_authorizations_channel`. */
export const AUTHORIZATION_DECISIONS = ['approved', 'declined'] as const;
export type AuthorizationDecision = (typeof AUTHORIZATION_DECISIONS)[number];
export const AUTHORIZATION_CHANNELS = ['in_person', 'phone', 'email', 'portal', 'other'] as const;
export type AuthorizationChannel = (typeof AUTHORIZATION_CHANNELS)[number];

export const MAX_SOC_PERCENT = 100;
export const MIN_SOC_PERCENT = 0;
export const MAX_WALK_IN_NOTE = 500;
export const MAX_DISPLAY_NUMBER = 64;
/**
 * The mandatory closure/refusal reason. Bounded text, the same ceiling as the
 * walk-in note: `rec.reception_status_history.reason` carries only a non-blank
 * CHECK, so the boundary is where the bound lives. Text rather than a catalogue
 * id, deliberately — `rec.refusal_reasons` ships zero rows and has no
 * management operation (the no-fake-data policy governs population), so a
 * mandatory catalogue reference would make both commands dead on arrival.
 */
export const MAX_CLOSURE_REASON = 500;

/** The two terminal outcomes a visit can be closed into without work. */
export const CLOSE_OUTCOMES = ['closed_without_work', 'refused'] as const;
export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];

export class ReceptionRuleError extends Error {
  public override readonly name = 'ReceptionRuleError';
}

/** Exactly one of these two origins, mirroring the XOR CHECK. */
export interface AppointmentOrigin {
  readonly kind: 'appointment';
  readonly appointmentId: string;
}
export interface WalkInOrigin {
  readonly kind: 'walk_in';
  readonly requesterPartnerId?: string | null;
  readonly note?: string | null;
}
export type ReceptionOrigin = AppointmentOrigin | WalkInOrigin;

export interface ReceptionCreateInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly receivingEmployeeId: string;
  readonly serviceRequesterPartnerId: string;
  readonly origin: ReceptionOrigin;
  readonly odometerReadingId?: string | null;
  readonly fuelLevelId?: string | null;
  readonly evSocPercent?: number | null;
}

export interface ReceptionCreatePlan extends Omit<ReceptionCreateInput, 'evSocPercent'> {
  readonly evSocPercent: number | null;
  readonly odometerReadingId: string | null;
  readonly fuelLevelId: string | null;
}

export function toReceptionCreatePlan(input: ReceptionCreateInput): ReceptionCreatePlan {
  const soc = input.evSocPercent;
  if (soc !== undefined && soc !== null) {
    // Mirrors ck_reception_visits_soc.
    if (!Number.isFinite(soc) || soc < MIN_SOC_PERCENT || soc > MAX_SOC_PERCENT) {
      throw new ReceptionRuleError(
        `evSocPercent must be between ${MIN_SOC_PERCENT} and ${MAX_SOC_PERCENT}`
      );
    }
  }
  if (input.origin.kind === 'walk_in') {
    const note = input.origin.note;
    if (note !== undefined && note !== null && note.trim().length === 0) {
      throw new ReceptionRuleError('A walk-in note, when supplied, must not be blank');
    }
  }
  return {
    ...input,
    odometerReadingId: input.odometerReadingId ?? null,
    fuelLevelId: input.fuelLevelId ?? null,
    evSocPercent: soc ?? null,
  };
}

/**
 * Reception approval means advancing to `authorized`. The frozen activation
 * contract (an active service requester AND an approved authorization) is
 * enforced by `rec.guard_reception_transition` and is NOT re-implemented here —
 * this only decides whether the current state can reach `authorized` at all.
 *
 * `opened` is accepted as well as `inspecting` because the only legal route from
 * `opened` to `authorized` runs through `inspecting`, and the service walks that
 * path inside one transaction. Both edges are in the frozen graph; no state is
 * invented and no guard is bypassed.
 */
export function assertApprovable(current: string): void {
  if (current === 'authorized') {
    throw new AppFailure('ERR-TRN-001', {
      message: 'This reception is already authorized',
    });
  }
  if (current !== 'opened' && current !== 'inspecting') {
    throw new AppFailure('ERR-TRN-001', {
      message: `A reception in state "${current}" cannot be approved`,
    });
  }
}

/** The legal path from the current state to `authorized`, in order. */
export function approvalPath(current: 'opened' | 'inspecting'): readonly ReceptionStatus[] {
  return current === 'opened' ? ['inspecting', 'authorized'] : ['authorized'];
}

/**
 * Only an authorized reception converts. `converted` is terminal, which is
 * precisely what makes conversion exactly-once: a second attempt finds a
 * terminal state and is refused, and the row lock the service takes first makes
 * two concurrent attempts serial rather than simultaneous.
 */
export function assertConvertible(current: string): void {
  if (current === 'converted') {
    throw new AppFailure('ERR-TRN-001', {
      message: 'This reception has already been converted to a work order',
    });
  }
  if (current !== 'authorized') {
    throw new AppFailure('ERR-TRN-001', {
      message:
        `A reception in state "${current}" cannot be converted; ` +
        'it must be approved (authorized) first',
    });
  }
}

/** One party's current decision, as `standingAuthorizations` returns it. */
export interface StandingDecision {
  readonly partnerId: string;
  readonly decision: AuthorizationDecision;
}

/**
 * A reception may only be approved or converted while the STANDING decisions
 * permit it.
 *
 * `rec.authorizations` is append-only and superseded by later rows, so a party
 * who approved and then withdrew has a standing decision of `declined`. The
 * frozen guards cannot see that: `rec.guard_reception_transition` and
 * `wo.guard_work_order_refs` both ask only whether SOME approved row exists, so
 * an approval that has been withdrawn still satisfies them permanently. Without
 * this check a recorded withdrawal of consent is inert and work proceeds against
 * a customer's last recorded word.
 *
 * Two conditions, and the second is the strict one on purpose:
 *
 *  - at least one authorizing party's standing decision is `approved`; and
 *  - no authorizing party's standing decision is `declined`.
 *
 * Every partner reaching this function has been proven to hold an active
 * authorizing role — by `rec.guard_authorization_authority` for a decision in
 * `rec.authorizations`, and by `assertMayAuthorize` for an `authorization`-type
 * refusal — so a standing `declined` is a refusal from someone entitled to
 * refuse. Proceeding
 * over it would be exactly the "a refusal read as consent" outcome this module
 * is built to prevent. Where a business rule should let one authority outrank
 * another, that rule has to be stated and approved before it is coded — refusing
 * is the boundary that cannot silently do the wrong thing.
 */
export function assertStandingAuthorization(decisions: readonly StandingDecision[]): void {
  if (decisions.some((entry) => entry.decision === 'declined')) {
    throw new AppFailure('ERR-TRN-001', {
      message:
        'An authorizing party has withdrawn or refused authorization for this reception; ' +
        'record a new approval before proceeding',
    });
  }
  if (!decisions.some((entry) => entry.decision === 'approved')) {
    throw new AppFailure('ERR-TRN-001', {
      message: 'This reception has no standing approved authorization',
    });
  }
}

/**
 * The party must hold SOME active authorizing role.
 *
 * Used where a party's word governs the authorization gate but no specific role
 * is claimed — an `authorization`-type refusal, which `standingAuthorizations`
 * now reads as that party's standing decision. Without this, the cheap
 * `rec.reception.signature.manage` permission would block a reception
 * permanently and attribute the refusal to an uninvolved partner:
 * `fk_refusals_partner` is tenant-wide, so any partner in the tenant is a valid
 * target.
 *
 * Same non-disclosing refusal as the role-specific check below, so neither
 * becomes a channel for probing which roles a party holds.
 */
export function assertMayAuthorize(activeRoles: readonly string[]): void {
  if (!activeRoles.some((role) => (AUTHORIZING_ROLES as readonly string[]).includes(role))) {
    throw new AppFailure('ERR-TRN-001', {
      message: 'That party may not authorize work on this reception',
    });
  }
}

/**
 * The role an authorization claims must be one the partner actually holds.
 *
 * `rec.guard_authorization_authority` proves the partner may decide — it
 * requires an active role in the authorizing set — but it never compares the
 * claimed `authorizing_role` with that role. So a partner holding only
 * `service_requester` could record a decision labelled `vehicle_owner`. The
 * column is immutable and the table append-only, which makes an unchecked label
 * a permanent, dispute-facing misstatement of who authorized the work.
 *
 * The refusal is deliberately the SAME 409 the authority guard raises, with the
 * same non-disclosing wording. Answering 422 "you do not hold that role" would
 * close the defect while opening an information channel: a caller could probe
 * the four authorizing roles one at a time and learn which a partner holds on
 * this visit. One uniform refusal keeps the contract the module already
 * documents — a refusal never says which roles a party has.
 */
export function assertAuthorizingRoleHeld(claimed: string, activeRoles: readonly string[]): void {
  if (!activeRoles.includes(claimed)) {
    throw new AppFailure('ERR-TRN-001', {
      message: 'That party may not authorize work on this reception in the role claimed',
    });
  }
}

/**
 * A visit may be closed without work, or refused, from ANY non-terminal state.
 *
 * That is the frozen graph verbatim: `rec.guard_reception_transition` gives
 * `opened`, `inspecting` AND `authorized` an edge into both terminal outcomes,
 * and this restates it rather than narrowing it — an authorized visit whose
 * customer walks away must still have an exit. The terminal states are frozen,
 * so closing a closed visit is refused with the state named: re-running the
 * SAME request replays idempotently, and a NEW attempt is a real conflict.
 *
 * This is the exit that ends the `P1-27-INT-014` trap: with no route into
 * `closed_without_work` or `refused`, an abandoned visit held its vehicle
 * forever through `uq_reception_visits_open_vehicle` — the INT-013 sibling.
 */
export function assertClosable(current: string): void {
  if (TERMINAL_RECEPTION_STATUSES.includes(current as ReceptionStatus)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `A reception in state "${current}" is terminal and cannot be closed or refused`,
    });
  }
}

/** Evidence may only be appended while the visit is still open for evidence. */
export function assertEvidenceRecordable(current: string): void {
  if (TERMINAL_RECEPTION_STATUSES.includes(current as ReceptionStatus)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `A reception in state "${current}" is terminal; no further evidence may be recorded`,
    });
  }
}
