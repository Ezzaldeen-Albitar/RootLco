/**
 * Vehicle relations — authorized-party domain (Phase 1-17, P1-17-BE-008,
 * P1-17-BE-009). Pure decisions only; no database, no request.
 *
 * ## Boundary with CRM
 *
 * `veh.vehicle_relationships` is the single source of truth for who is associated
 * with a vehicle. The CRM `crm.customer.vehicle_linked` operation is the approved
 * *customer-centric* writer for plain roles (owner, driver, …). This module adds
 * the *vehicle-centric* read of that table, and one distinct writer CRM does not
 * provide: an **authorized party** — an `authorized_person` relationship carrying a
 * bounded `authorization_scope` and the id of who granted it. An authorized party
 * is never the legal owner; ownership lives in `veh.ownership_history`.
 */

/** Roles `veh.vehicle_relationships.ck_vehicle_relationships_role` permits. */
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
 * The only actions an authorized party may be granted, from
 * `veh.valid_authorization_scope`. A scope must be a non-empty, duplicate-free
 * subset of these — nothing here grants ownership or any escalated authority.
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

/** The schema version stamped into every `authorization_scope` this module writes. */
export const AUTHORIZATION_SCHEMA_VERSION = 1;

export const RELATIONSHIP_ORDERING = {
  key: 'veh.vehicle_relationships:created_at_desc',
  direction: 'desc',
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AuthorizedPartyInput {
  readonly partnerId: string;
  readonly allowedActions: readonly string[];
  readonly effectiveDate?: string | null | undefined;
}

export interface AuthorizedPartyPlan {
  readonly partnerId: string;
  readonly allowedActions: readonly AuthorizedAction[];
  readonly effectiveDate: string | null;
}

export class VehicleRelationsError extends Error {
  public override readonly name = 'VehicleRelationsError';
  constructor(
    message: string,
    readonly path: string,
    readonly rule: string
  ) {
    super(message);
  }
}

export function normalizeEffectiveDate(
  value: string | null | undefined,
  path = 'body.effectiveDate'
): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))) {
    throw new VehicleRelationsError(`${path} must be an ISO date (YYYY-MM-DD)`, path, 'bad_date');
  }
  return trimmed;
}

export function toAuthorizedPartyPlan(input: AuthorizedPartyInput): AuthorizedPartyPlan {
  const actions = Array.isArray(input.allowedActions) ? input.allowedActions : [];
  if (actions.length === 0) {
    throw new VehicleRelationsError(
      'body.allowedActions must list at least one action',
      'body.allowedActions',
      'empty'
    );
  }
  const seen = new Set<string>();
  for (const action of actions) {
    if (!(AUTHORIZED_ACTIONS as readonly string[]).includes(action)) {
      throw new VehicleRelationsError(
        `body.allowedActions contains an unknown action "${action}"`,
        'body.allowedActions',
        'unknown_action'
      );
    }
    if (seen.has(action)) {
      throw new VehicleRelationsError(
        'body.allowedActions must not repeat an action',
        'body.allowedActions',
        'duplicate'
      );
    }
    seen.add(action);
  }
  return {
    partnerId: input.partnerId,
    allowedActions: actions as readonly AuthorizedAction[],
    effectiveDate: normalizeEffectiveDate(input.effectiveDate),
  };
}
