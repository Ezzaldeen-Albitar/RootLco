/**
 * Vehicle history and document reachability — domain contract (Phase 1-17,
 * P1-17-BE-011, P1-17-BE-012).
 *
 * Pure decision-making: the ordering of the vehicle change history and the entity
 * token used to resolve linked documents. No database, no request.
 *
 * ## Documents: link/list only, and reachability is the boundary
 *
 * The vehicle module does NOT own document storage. A document is *reachable* from a
 * vehicle only through a live link in the shared document-link table, resolved by
 * the sanctioned `shared.document_ids_for_entity('veh.vehicle', id)` primitive —
 * never by knowing a document id or a storage key. Linking a document is the shared
 * attachments operation (`POST /attachments/documents/{documentId}/links` with
 * entityType `veh.vehicle`); this module only *lists* the reachable set. This phase
 * deliberately provides no production object store, no scanner-acceptance workflow,
 * and no byte download — those are shared-services concerns, not the vehicle
 * backend's, and the list returns document ids only (no storage key, no bytes).
 */

/** The entity-type token a vehicle uses in the shared document-link contract. */
export const VEHICLE_DOCUMENT_ENTITY_TYPE = 'veh.vehicle' as const;

/**
 * Deterministic newest-first ordering for the attribute-change history, bound to a
 * stable contract key so a cursor issued here can never be replayed against a
 * different ordering. `occurred_at` is the sort key; the row id is the unique
 * tie-breaker so two changes in the same instant cannot straddle a page edge.
 */
export const VEHICLE_HISTORY_ORDERING = {
  key: 'veh.vehicle_attribute_history:occurred_desc',
  direction: 'desc',
} as const;

/** A safe projection of one attribute-change history row. */
export interface VehicleHistoryHit {
  readonly id: string;
  /** The master column that changed (e.g. `color`, `lifecycle_status`). */
  readonly fieldCode: string;
  /** Text rendering of the prior value, or null. Internal master attributes only —
   * no restricted identifier can appear (they are not master columns). */
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly occurredAt: string;
  readonly actorId: string;
}
