/**
 * The customer→vehicle read contract — `crm.customer-vehicle-list` (P1-28,
 * Wave A; backend R4, `P1-27-INT-012`).
 *
 * | operation                  | method | path                              | permission          |
 * | -------------------------- | ------ | --------------------------------- | ------------------- |
 * | `crm.customer-vehicle-list`| GET    | `/customers/{customerId}/vehicles`| `crm.customer.read` |
 *
 * Read out of `apps/api/src/app/api/v1/customers/[customerId]/vehicles/route.ts`
 * and `modules/crm/data/customer-read-repository.ts` (`CustomerVehicleEntry`).
 *
 * ## Why this lives in `lib/customers` and not in a feature
 *
 * The same D1 reasoning as `directory-contract.ts` beside it: the CRM customer
 * profile's vehicles tab needs this read, and so does the P1-28 intake flow —
 * an operator receiving a customer picks which of THAT customer's vehicles is
 * on the ramp. A feature may never import another feature, so the read either
 * gets copied (the duplicate authority the ownership gate exists to prevent)
 * or lives here, once.
 *
 * ## History rows travel; they are not filtered
 *
 * Who was linked to which vehicle is a dated business fact. Rows arrive with
 * `active: false` when the interval is closed, and the OPEN interval
 * (`validTo === null`) is what a screen leads with — filtering server-side
 * would erase history this platform deliberately keeps.
 *
 * ## The vehicle identity may be nulls, honestly
 *
 * The vehicle fields are nullable AS A GROUP: a relationship row outlives a
 * soft-deleted vehicle, and when the join finds no live vehicle the answer is
 * the bare `vehicleId` beside nulls — never a resurrected identity.
 * `makeId`/`modelId` are BARE ids on purpose; their names live in the vehicle
 * reference catalogues, which have their own published reads. Plates are not
 * here at all (`veh.plate_history` has its own read).
 *
 * The query is `.strict()` with only `cursor` and `limit`; ordering is fixed,
 * newest link first. No filter, no sort, no total.
 */

export const CUSTOMER_VEHICLE_LIST_OPERATION = {
  operationId: 'crm.customer-vehicle-list',
  method: 'GET',
  /** Path template WITHOUT the `/api/v1` prefix, exactly as published. */
  template: '/customers/{customerId}/vehicles',
  idempotent: false,
  versionGuarded: false,
  permission: 'crm.customer.read',
  auditClass: 'none',
} as const;

/** One customer→vehicle relationship, with the identity `veh.vehicles` holds. */
export interface CustomerVehicleEntry {
  readonly id: string;
  readonly vehicleId: string;
  readonly relationshipRole: string;
  /** `date` columns read `::text`, so a day is never shifted by a timezone. */
  readonly validFrom: string;
  readonly validTo: string | null;
  /** `validTo === null` — the open interval is the live relationship. */
  readonly active: boolean;
  readonly createdAt: string;
  readonly vehicleDisplayNumber: string | null;
  /** The generated, normalised VIN — never `vin_raw`. */
  readonly vin: string | null;
  readonly makeId: string | null;
  readonly modelId: string | null;
  readonly modelYear: number | null;
  readonly color: string | null;
  readonly vehicleLifecycleStatus: string | null;
}
