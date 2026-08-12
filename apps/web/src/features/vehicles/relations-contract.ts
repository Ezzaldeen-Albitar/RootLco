/**
 * EV/hybrid profile (`FE-024`) and vehicle-customer relationships (`FE-025`).
 *
 * | operation                            | method | path                                                       | permission                        |
 * | ------------------------------------ | ------ | ---------------------------------------------------------- | --------------------------------- |
 * | `veh.vehicle-ev-profile-read`        | GET    | `/vehicles/{id}/ev-profile`                                | `veh.vehicle.read`                |
 * | `veh.vehicle-ev-profile-set`         | POST   | `/vehicles/{id}/ev-profile`                                | `veh.vehicle.manage`              |
 * | `veh.vehicle-relationship-list`      | GET    | `/vehicles/{id}/relationships`                             | `veh.vehicle.read`                |
 * | `veh.vehicle-authorized-party-add`   | POST   | `/vehicles/{id}/authorized-parties`                        | `veh.vehicle.relationship.manage` |
 * | `veh.vehicle-authorized-party-retire`| POST   | `/vehicles/{id}/authorized-parties/{relationshipId}/retirement` | `veh.vehicle.relationship.manage` |
 * | `crm.vehicle-link`                   | POST   | `/customers/{customerId}/vehicles`                         | `crm.customer.vehicle.manage`     |
 *
 * All four writes are `idempotent: true` and `auditClass: privileged`.
 *
 * ## `crm.vehicle-link` is a CRM operation on a vehicle screen
 *
 * Its path is customer-centric and its permission is CRM's, but it is offered
 * from the vehicle profile because `POST /customers/{id}/vehicles` publishes no
 * `GET`: there is no "this customer's vehicles" read anywhere on the platform
 * (`P1-27-INT-012`, owned by P1-16 and carried to P1-28). A link made from the
 * customer profile would be invisible the moment it was made. The CRM writer
 * inserts into `veh.vehicle_relationships` — the table
 * `veh.vehicle-relationship-list` reads — so on the vehicle screen the new
 * relationship appears in the list directly above the form.
 *
 * ## A 404 on the EV profile is usually NOT an error
 *
 * `GET /vehicles/{id}/ev-profile` answers 404 for **two different things**: the
 * vehicle does not exist, and the vehicle has no EV profile. Every ICE vehicle
 * in the tenant therefore produces a 404 that means "this is a petrol car" — an
 * ordinary, expected state, not a failure.
 *
 * The screen renders that as "no electric-drive profile recorded". It can do so
 * safely because the profile is only ever reached from a vehicle the page has
 * already read: the "does the vehicle exist" half of the ambiguity was decided
 * upstream, so the remaining meaning is the only one left.
 *
 * ## Authorized parties have two writes and NO list of their own
 *
 * There is no `GET /vehicles/{id}/authorized-parties`. The only way to see them
 * is `veh.vehicle-relationship-list`, which returns **every** relationship and
 * sits behind a different permission (`veh.vehicle.read` rather than
 * `veh.vehicle.relationship.manage`). So a caller may be able to add an
 * authorized party without being able to see the ones that exist, and the screen
 * says so rather than showing an empty list that looks like "there are none".
 */

import type { PartyIdentity } from '@/components/party/PartyLabel';

/** `veh.vehicle_ev_profiles.ev_kind`. Note: no `ice`. */
export const EV_KINDS = ['bev', 'hybrid', 'phev'] as const;
export type EvKind = (typeof EV_KINDS)[number];

/**
 * The charge-port length ceiling, mirroring the route schema.
 *
 * Restated so a form can bound its input — not a second authority. The server
 * enforces it, and a client bound that disagreed would refuse a value the server
 * would have accepted, with no error the operator could act on.
 */
export const MAX_CHARGE_PORT = 40;

/**
 * `veh.ev_profiles.usable_capacity_kwh` upper bound, mirroring
 * `MAX_USABLE_CAPACITY_KWH` in `apps/api/src/modules/vehicle/domain/vehicle-lifecycle.ts`.
 *
 * Stated once here so the client bound cannot drift tighter than the server's —
 * which it had (`P1-27-FE-024`): the client demanded a POSITIVE capacity while
 * the route accepts zero, so it refused a value the platform stores.
 */
export const MAX_USABLE_CAPACITY_KWH = 99_999.99;

/** `ck_vehicle_relationships_role`. */
export const VEHICLE_RELATIONSHIP_ROLES = [
  'owner',
  'user',
  'driver',
  'fleet_operator',
  'payer',
  'authorized_person',
  'service_requester',
] as const;
export type VehicleRelationshipRole = (typeof VEHICLE_RELATIONSHIP_ROLES)[number];

/**
 * The complete set of actions an authorized party may be granted, from
 * `veh.valid_authorization_scope`.
 *
 * **Nothing here grants ownership or any escalated authority.** A scope must be
 * a non-empty, duplicate-free subset of exactly these six, so a UI that offered
 * a seventh would send a value the constraint rejects.
 */
export const AUTHORIZED_ACTIONS = [
  'approve_quotation',
  'approve_additional_work',
  'receive_vehicle',
  'receive_reports',
  'receive_invoices',
  'communicate_about_service',
] as const;
export type AuthorizedAction = (typeof AUTHORIZED_ACTIONS)[number];

/**
 * The **only** role that may carry an authorization scope.
 *
 * The schema forbids `authorization_scope` on every other role, so
 * `allowedActions` is `null` for most rows — not a few. A screen that rendered a
 * null scope as "no permissions granted" would be describing an owner, a driver
 * and a payer as restricted when the field simply does not apply to them.
 */
export const SCOPED_ROLE: VehicleRelationshipRole = 'authorized_person';

/**
 * The roles `crm.vehicle-link` may create.
 *
 * Every role except `authorized_person`. `ck_vehicle_relationships_scope_role`
 * makes that the only role allowed to carry an `authorization_scope`, and
 * `crm.vehicle-link` sets none — so a link made in that role would produce a row
 * `scopeState` classifies as `none-granted`, which this file documents as "the
 * data is unexpected". The dedicated authorise operation exists for that role
 * and sets the scope; offering it here would create the bad row instead.
 *
 * Not in `relations-api.ts` because that is a `'use server'` module and a Server
 * Action file may export only async functions.
 */
export const LINKABLE_ROLES: readonly VehicleRelationshipRole[] = VEHICLE_RELATIONSHIP_ROLES.filter(
  (role) => role !== SCOPED_ROLE
);

/**
 * One relationship row.
 *
 * `partnerId` is carried because a retirement needs it; it is **never
 * rendered**. The operation resolves the party through the CRM module and
 * publishes the three `partner*` display fields alongside it (`P1-27-INT-025`),
 * all of them required and nullable — `null` meaning "this caller cannot see
 * that party", which `PartyLabel` states in words.
 */
export interface VehicleRelationship extends PartyIdentity {
  readonly id: string;
  readonly partnerId: string;
  readonly relationshipRole: string;
  /** A `date`, as `"YYYY-MM-DD"`. Never parsed. */
  readonly validFrom: string;
  readonly validTo: string | null;
  /** `valid_to IS NULL` — "not closed", not "in force today". */
  readonly active: boolean;
  /** Null for every role but `authorized_person`. */
  readonly allowedActions: readonly string[] | null;
  readonly createdAt: string;
}

/**
 * What a null `allowedActions` means for this row.
 *
 * Three answers, because "null" alone is ambiguous and two of the three readings
 * would be wrong:
 *
 * - `not-applicable` — the role cannot carry a scope. The overwhelming majority.
 * - `none-granted`   — an `authorized_person` with an empty scope, which the
 *                      constraint forbids, so it means the data is unexpected.
 * - `granted`        — an actual list.
 */
export type ScopeState =
  | { readonly kind: 'granted'; readonly actions: readonly string[] }
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'none-granted' };

export function scopeState(relationship: VehicleRelationship): ScopeState {
  if (relationship.relationshipRole !== SCOPED_ROLE) return { kind: 'not-applicable' };
  const actions = relationship.allowedActions;
  if (actions === null || actions.length === 0) return { kind: 'none-granted' };
  return { kind: 'granted', actions };
}

/**
 * Whether a set of chosen actions is a scope the constraint will accept.
 *
 * `veh.valid_authorization_scope` requires non-empty, duplicate-free, and a
 * subset of `AUTHORIZED_ACTIONS`. All three are checked here so the operator
 * sees the complaint beside the control rather than as a 422 they cannot read.
 */
export function validateScope(
  actions: readonly string[]
): 'ok' | 'empty' | 'duplicate' | 'unknown' {
  if (actions.length === 0) return 'empty';
  if (new Set(actions).size !== actions.length) return 'duplicate';
  if (actions.some((a) => !AUTHORIZED_ACTIONS.includes(a as AuthorizedAction))) return 'unknown';
  return 'ok';
}

/**
 * An EV profile.
 *
 * `usableCapacityKwh` is `numeric` and is **nullable** — a vehicle may be known
 * to be electric without anyone having recorded its battery size.
 */
export interface EvProfile {
  readonly evKind: string;
  /** `numeric` on the wire as a STRING. Never arithmetic. */
  readonly usableCapacityKwh: string | null;
  readonly chargePortType: string | null;
  readonly highVoltageWarning: boolean;
}

/**
 * Which `powertrainCategory` values can carry an EV profile at all.
 *
 * `toEvProfilePlan` derives a `requiredCategory` from `evKind` and the write
 * fails if the vehicle's category disagrees. Offering the form for an `ice`
 * vehicle would therefore produce a rejection the operator could not act on
 * without first changing the vehicle itself.
 */
export function canHaveEvProfile(powertrainCategory: string): boolean {
  return (
    powertrainCategory === 'ev' || powertrainCategory === 'hybrid' || powertrainCategory === 'phev'
  );
}

/**
 * The `evKind` implied by a vehicle's `powertrainCategory`.
 *
 * `ev` maps to `bev` — the two vocabularies use different words for the same
 * thing, and a form that sent `'ev'` as an `evKind` would be rejected by an enum
 * that has never contained it.
 */
export function suggestedEvKind(powertrainCategory: string): EvKind | null {
  if (powertrainCategory === 'ev') return 'bev';
  if (powertrainCategory === 'hybrid') return 'hybrid';
  if (powertrainCategory === 'phev') return 'phev';
  return null;
}
