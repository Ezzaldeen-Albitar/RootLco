/**
 * Vehicle history and document-reachability repository (Phase 1-17, P1-17-BE-011,
 * P1-17-BE-012).
 *
 * The only place vehicle-history SQL is written. The attribute history is
 * append-only (SELECT only); document reachability is resolved through the
 * sanctioned `shared.document_ids_for_entity` primitive — the vehicle module never
 * reads the shared document-link table directly, so the link-derived access
 * contract (a document is reachable only through a live link) stays the shared
 * module's to enforce.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { buildPage, keysetFragment, type Page, type PageRequest } from '@/server/db/pagination';
import { VEHICLE_HISTORY_ORDERING, type VehicleHistoryHit } from '../domain/vehicle-history';

export class VehicleHistoryRepository extends Repository {
  protected readonly module = 'vehicle';

  /** True when the vehicle is live and visible in the caller's tenant. */
  async vehicleExists(db: DbHandle, vehicleId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run<{ one: number }>(
      db,
      `SELECT 1 AS one FROM veh.vehicles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId]
    );
    return result.rows.length > 0;
  }

  async listHistory(
    db: DbHandle,
    vehicleId: string,
    page: PageRequest
  ): Promise<Page<VehicleHistoryHit>> {
    const context = this.assertContext(db);
    const keyset = keysetFragment(
      page,
      { sort: 'occurred_at', id: 'id' },
      VEHICLE_HISTORY_ORDERING,
      3
    );
    const result = await this.run<{
      id: string;
      field_code: string;
      old_value: string | null;
      new_value: string | null;
      occurred_at: Date;
      actor_id: string;
    }>(
      db,
      `SELECT id, field_code, old_value, new_value, occurred_at, actor_id
         FROM veh.vehicle_attribute_history
        WHERE tenant_id = $1 AND vehicle_id = $2 ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [context.principal.tenantId, vehicleId, ...keyset.values]
    );
    return buildPage(
      result.rows.map((r) => ({
        id: r.id,
        fieldCode: r.field_code,
        oldValue: r.old_value,
        newValue: r.new_value,
        occurredAt: r.occurred_at.toISOString(),
        actorId: r.actor_id,
      })),
      page,
      VEHICLE_HISTORY_ORDERING,
      (hit) => ({ sortValue: hit.occurredAt, id: hit.id })
    );
  }

  /**
   * The ids of the documents reachable from this vehicle, via the sanctioned
   * RLS-scoped resolver. Returns ids only — no storage key, no bytes.
   */
  async linkedDocumentIds(db: DbHandle, vehicleId: string, entityType: string): Promise<string[]> {
    this.assertContext(db);
    const result = await this.run<{ document_id: string }>(
      db,
      `SELECT document_id
         FROM shared.document_ids_for_entity($1, $2) AS document_id
        ORDER BY document_id`,
      [entityType, vehicleId]
    );
    return result.rows.map((r) => r.document_id);
  }
}
