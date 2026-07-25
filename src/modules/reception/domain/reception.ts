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

/** Evidence may only be appended while the visit is still open for evidence. */
export function assertEvidenceRecordable(current: string): void {
  if (TERMINAL_RECEPTION_STATUSES.includes(current as ReceptionStatus)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `A reception in state "${current}" is terminal; no further evidence may be recorded`,
    });
  }
}
