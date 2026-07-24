/**
 * Vehicle identity write repository (Phase 1-17, FR-VEH-003, P1-17-BE-004).
 *
 * The only place vehicle merge/duplicate SQL lives. Every statement runs through
 * a `DbHandle` and stamps `tenant_id` from the resolved context.
 *
 * ## The merge is one INSERT
 *
 * Recording the merge is a single `INSERT INTO veh.vehicle_merges`: the frozen
 * `tg_vehicle_merges_apply` trigger redirects the source vehicle to the survivor
 * and freezes it in the same statement, and `tg_vehicle_merges_stamp` sets
 * `merged_by` from the session actor. There is no second UPDATE to keep in step —
 * the database makes the redirect atomic with the evidence of it.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** The state a merge needs to decide its outcome before touching the database. */
export interface VehicleMergeState {
  readonly lifecycleStatus: string;
  readonly mergedIntoId: string | null;
}

export class VehicleIdentityRepository extends Repository {
  protected readonly module = 'vehicle';

  /** A live (non-deleted) vehicle's merge state, or null when it does not exist
   * in the caller's tenant. */
  async vehicleState(db: DbHandle, vehicleId: string): Promise<VehicleMergeState | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ lifecycle_status: string; merged_into_id: string | null }>(
      db,
      `SELECT lifecycle_status, merged_into_id
         FROM veh.vehicles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId]
    );
    const row = result.rows[0];
    return row ? { lifecycleStatus: row.lifecycle_status, mergedIntoId: row.merged_into_id } : null;
  }

  /**
   * Appends the permanent merge record. `merged_by`/`merged_at`/`seq` are
   * server-stamped by frozen triggers; the AFTER-INSERT trigger performs the
   * source redirect. Returns the merge id, or null on a policy refusal.
   */
  async insertMerge(
    db: DbHandle,
    input: {
      readonly sourceId: string;
      readonly survivorId: string;
      readonly approvalRef: string;
      readonly summary: Record<string, unknown>;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.vehicle_merges
         (tenant_id, source_vehicle_id, survivor_vehicle_id, merge_summary, approval_ref,
          correlation_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.sourceId,
        input.survivorId,
        JSON.stringify(input.summary),
        input.approvalRef,
        context.correlationId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }
}
