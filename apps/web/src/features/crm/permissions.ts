/**
 * The CRM and Vehicle permission codes P1-27's screens reference.
 *
 * Named constants rather than string literals scattered through thirty files, so
 * a typo is a compile error instead of a control that silently never appears.
 * That failure mode is not hypothetical: the P1-25 Settings entry was gated on
 * `org.settings.read`, a code in no catalogue and no operation, and "unknown
 * means denied" hid it from every actor who has ever existed (`P1-26-F-011`).
 *
 * Every code below is seeded in `supabase/seeds/04_iam_permission_catalog.sql`
 * and declared by an operation this phase calls. `apps/web/tests/crm.test.ts`
 * asserts catalogue membership, so a code that drifts out of the platform
 * catalogue fails the build rather than hiding a screen.
 *
 * **These gate VISIBILITY, never access.** The server checks every request and
 * its denial is the only one that means anything. Hiding a control the actor
 * cannot use is courtesy; it is not a security boundary and nothing here should
 * ever be mistaken for one.
 */
export const CRM_PERMISSIONS = {
  /** `crm.customer-search`, `crm.customer-read` and every component list. */
  customerRead: 'crm.customer.read',
  customerCreate: 'crm.customer.create',
  /** Contacts, addresses and communication preferences. */
  profileWrite: 'crm.customer.profile.write',
  /** Separate and higher: a consent decision changes what the platform may do. */
  consentWrite: 'crm.customer.consent.write',
  noteWrite: 'crm.customer.note.write',
  /** Alerts, tags and lifecycle status. */
  governanceManage: 'crm.customer.governance.manage',
  /** Its own code: raising an alert and refusing to serve are not one authority. */
  restrictionManage: 'crm.customer.restriction.manage',
  duplicateReview: 'crm.customer.duplicate.review',
  /** Irreversible in practice, and governed by `P1-OD-017`. */
  merge: 'crm.customer.merge',
  vehicleManage: 'crm.customer.vehicle.manage',
} as const;

export const VEHICLE_PERMISSIONS = {
  vehicleRead: 'veh.vehicle.read',
  vehicleManage: 'veh.vehicle.manage',
  vehicleMerge: 'veh.vehicle.merge',
  duplicateReview: 'veh.vehicle.duplicate.review',
  relationshipManage: 'veh.vehicle.relationship.manage',
  odometerRecord: 'veh.vehicle.odometer.record',
  statusManage: 'veh.vehicle.status.manage',
} as const;

/**
 * True when the session carries the code.
 *
 * Exact membership, never a prefix. A prefix test would let
 * `crm.customer.read` satisfy a control that needs `crm.customer.read.sensitive`
 * — and the direction of that mistake is always toward showing more.
 */
export function holds(permissions: readonly string[], code: string): boolean {
  return permissions.includes(code);
}
