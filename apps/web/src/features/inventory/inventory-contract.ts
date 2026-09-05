/**
 * The inventory contract this phase consumes (P1-30, `W4`, FE-008 item search,
 * FE-009 stock balance, FE-010 reservations).
 *
 * | operation                          | method | path                                        | permission          |
 * | ---------------------------------- | ------ | ------------------------------------------- | ------------------- |
 * | `inv.item-search`                  | GET    | `/items`                                    | `inv.item.read`     |
 * | `inv.stock-availability-read`      | GET    | `/stock-availability`                       | `inv.stock.read`    |
 * | `inv.stock-reservation-list`       | GET    | `/stock-reservations`                       | `inv.stock.read`    |
 * | `inv.stock-location-list`          | GET    | `/stock-locations`                          | `inv.stock.read`    |
 * | `org.branch-list`                  | GET    | `/org/branches`                             | `org.branch.read`   |
 * | `inv.stock-reservation-create`     | POST   | `/stock-reservations`                       | `inv.stock.operate` |
 * | `inv.stock-reservation-release`    | POST   | `/stock-reservations/{reservationId}/release` | `inv.stock.operate` |
 *
 * Typed from the routes that own the shapes and from the views in
 * `apps/api/src/modules/inventory/application/*`. The published document
 * carries no field schema for any inventory response, so these interfaces are
 * the only field-level contract, and `tests/backend/p1-30-w4-inventory.test.ts`
 * PARSES them out of this file and holds them against rows that came out of
 * the database, in both directions.
 *
 * ## Every quantity is a decimal string, and none is computed here
 *
 * `onHand`, `reserved`, `available` and every `quantity` are `numeric(12,3)`
 * and travel as STRINGS. `available` is a column the database generates; a
 * screen renders it and never subtracts one figure from another. There is no
 * per-item total anywhere in the API — availability is one row per (item,
 * location) cell — and the screen does not invent one.
 *
 * ## No money crosses here
 *
 * No inventory read publishes a cost, a price or a valuation. The plan's
 * "`inv.cost.view` gates cost fields" has nothing to gate on these reads; the
 * screen shows no cost and says nothing about one.
 *
 * ## No record version guards any inventory write
 *
 * Nothing in the inventory surface is version-guarded. A reservation carries a
 * `recordVersion` the server never asks back. Concurrency is the database's:
 * balances are locked per cell, and a release of a reservation that is no
 * longer active is reported as `replayed`, not as a conflict.
 *
 * ## Reads the backend does not publish, said here rather than hidden
 *
 * - No item detail, no item-category list (`itemCategoryId` is an identifier
 *   with nothing to resolve it against), no unit-of-measure list.
 * - No reservation detail: a reservation is found through the list.
 * - No item or location WRITER exists at all: a workshop that has recorded no
 *   items and no locations sees an empty product here, and the screen says so.
 */

/** The permissions the W4 screen consults, as the backend registers them. */
export const INVENTORY_PERMISSIONS = {
  /** The item search — tenant-wide, and the page's own gate. */
  itemRead: 'inv.item.read',
  /** Availability, reservations and locations — all branch-targeted. */
  stockRead: 'inv.stock.read',
  /** Reserving and releasing. */
  operate: 'inv.stock.operate',
  /** The branch picker's own code. */
  branchRead: 'org.branch.read',
} as const;

/** `ck_item_master_type`, mirrored. */
export const ITEM_TYPES = ['part', 'material', 'consumable', 'fluid', 'kit'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** `ck_item_master_lifecycle`, mirrored. The search defaults to `active` on the server. */
export const ITEM_LIFECYCLE_STATES = ['active', 'archived'] as const;
export type ItemLifecycleState = (typeof ITEM_LIFECYCLE_STATES)[number];

/** `ck_stock_reservations_status`, mirrored. Every state but `active` is terminal. */
export const RESERVATION_STATES = ['active', 'released', 'consumed', 'expired'] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

/** `ck_stock_locations_type`, mirrored. Quarantine is excluded from availability unless asked for. */
export const LOCATION_TYPES = ['warehouse', 'storage', 'quarantine'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/** `ck_stock_locations_status`, mirrored. Inactive locations are listed, not hidden. */
export const ACTIVATION_STATES = ['active', 'inactive'] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];

/**
 * A quantity as every inventory write accepts it: up to nine integer digits
 * and three decimals, no sign, no exponent. Zero passes the pattern and is
 * refused by the server (`QUANTITY_MIN` is `0.001`).
 */
export const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/;
export const QUANTITY_MIN = '0.001';

/** Column widths, mirrored, so a form can refuse before the 422 does. */
export const MAX_NAME = 200;
export const MAX_REASON = 2000;

/** One row of `inv.item-search` — `ItemView`. No cost field exists on it. */
export interface InventoryItem {
  readonly id: string;
  readonly itemCategoryId: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly unitOfMeasure: UnitOfMeasure;
  readonly itemType: ItemType;
  readonly isStockTracked: boolean;
  readonly isSerialized: boolean;
  readonly lifecycleStatus: ItemLifecycleState;
  readonly recordVersion: number;
}

/** The unit an item is counted in, joined from the unit table; `code` is the only surface a unit has. */
export interface UnitOfMeasure {
  readonly id: string;
  readonly code: string;
}

/**
 * One (item, location) cell of `inv.stock-availability-read` — `AvailabilityView`.
 * Three decimal STRINGS; `available` is generated by the database.
 */
export interface StockAvailability {
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationType: LocationType;
  readonly companyId: string;
  readonly branchId: string;
  readonly onHand: string;
  readonly reserved: string;
  readonly available: string;
}

/** One row of `inv.stock-reservation-list` — `ReservationListView`. */
export interface StockReservation {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: ReservationState;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly recordVersion: number;
}

/**
 * The echo of `inv.stock-reservation-create` and `-release` — `ReservationView`.
 * A DIFFERENT shape from the list row: no `sku`, no `locationCode`, no
 * `createdAt`, and `replayed` — true when the create returned the reservation
 * that already existed for the same key, or when the release found the
 * reservation already past `active` and did nothing.
 */
export interface ReservationEcho {
  readonly id: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: ReservationState;
  readonly expiresAt: string | null;
  readonly recordVersion: number;
  readonly replayed: boolean;
}

/** One row of `inv.stock-location-list` — `StockLocationView`. */
export interface StockLocation {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationCode: string;
  readonly name: string;
  readonly locationType: LocationType;
  readonly parentLocationId: string | null;
  readonly status: ActivationState;
}

/** The branch pair every stock read is addressed to — the read's TARGET, re-authorized server-side. */
export interface StockTarget {
  readonly companyId: string;
  readonly branchId: string;
}

/** What the item search may narrow by; every key is one the route's strict query accepts. */
export interface ItemSearchCriteria {
  readonly categoryId?: string;
  readonly itemType?: ItemType;
  readonly lifecycleStatus?: ItemLifecycleState;
  /** The route takes the words, not a boolean. */
  readonly stockTrackedOnly?: 'true' | 'false';
  /** A case-insensitive PREFIX on the SKU or the name; the backend escapes it. */
  readonly search?: string;
}

/** Selectors on availability: an item, a location (pinned to the target), and whether quarantine is included. */
export interface AvailabilityCriteria {
  readonly itemId?: string;
  readonly locationId?: string;
  readonly includeQuarantine?: 'true' | 'false';
}

/** Selectors on the reservation list. */
export interface ReservationCriteria {
  readonly itemId?: string;
  readonly locationId?: string;
  readonly workOrderId?: string;
  readonly status?: ReservationState;
}
