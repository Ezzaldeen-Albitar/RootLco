/**
 * Vehicle master write repository (Phase 1-17, FR-VEH-001, P1-17-BE-003).
 *
 * The only place vehicle master *write* SQL lives. Every statement runs through a
 * `DbHandle`, so it inherits the caller's transaction and resolved context;
 * `tenant_id` and `created_by` are stamped from that context and never accepted
 * from a caller. `record_version`, `updated_at`, and `updated_by` are set by the
 * frozen `tg_vehicles_touch_metadata` trigger, so no UPDATE writes them by hand.
 *
 * ## Why the partial UPDATE is safe to build by string
 *
 * `updateMaster` composes its `SET` list from `VehicleColumnChange.column`, but
 * every such column originates from `VEHICLE_WRITABLE_COLUMNS` in the domain and is
 * re-checked here against `VEHICLE_WRITABLE_PHYSICAL_COLUMNS`. A column name can
 * therefore only ever be one of a frozen handful of literals; the *values* are
 * always bound parameters. An unrecognised column is a programming error and
 * throws before any SQL is assembled.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  VEHICLE_WRITABLE_PHYSICAL_COLUMNS,
  type VehicleColumnChange,
  type VehicleCreatePlan,
} from '../domain/vehicle-write';

/** The current mutable state a master update needs to decide its outcome. */
export interface VehicleCurrentState {
  readonly lifecycleStatus: string;
  readonly recordVersion: number;
}

export class VehicleWriteRepository extends Repository {
  protected readonly module = 'vehicle';

  /** Inserts a draft vehicle master. Returns the id, or null on a policy refusal. */
  async insertVehicle(
    db: DbHandle,
    input: { readonly id: string; readonly plan: VehicleCreatePlan }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const { plan } = input;
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.vehicles
         (id, tenant_id, vin_raw, make_id, model_id, trim_id, model_year, body_type_id,
          powertrain_type_id, powertrain_category, color, display_number, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        input.id,
        context.principal.tenantId,
        plan.vinRaw,
        plan.makeId,
        plan.modelId,
        plan.trimId,
        plan.modelYear,
        plan.bodyTypeId,
        plan.powertrainTypeId,
        plan.powertrainCategory,
        plan.color,
        plan.displayNumber,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** The live vehicle's freeze/version state, or null when it does not exist. */
  async currentState(db: DbHandle, vehicleId: string): Promise<VehicleCurrentState | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ lifecycle_status: string; record_version: number }>(
      db,
      `SELECT lifecycle_status, record_version
         FROM veh.vehicles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId]
    );
    const row = result.rows[0];
    return row
      ? { lifecycleStatus: row.lifecycle_status, recordVersion: row.record_version }
      : null;
  }

  /**
   * Applies the change set under optimistic concurrency. Returns the number of
   * rows written: 0 means the caller's `record_version` was stale (or the row was
   * concurrently merged/deleted), which the service reports as a conflict rather
   * than silently overwriting.
   */
  async updateMaster(
    db: DbHandle,
    vehicleId: string,
    expectedVersion: number,
    changes: readonly VehicleColumnChange[]
  ): Promise<number> {
    const context = this.assertContext(db);
    const assignments: string[] = [];
    const params: (string | number | null)[] = [
      context.principal.tenantId,
      vehicleId,
      expectedVersion,
    ];
    for (const change of changes) {
      if (!VEHICLE_WRITABLE_PHYSICAL_COLUMNS.has(change.column)) {
        throw new Error(`Refusing to update non-writable column "${change.column}"`);
      }
      params.push(change.value);
      assignments.push(`${change.column} = $${params.length}`);
    }
    const result = await this.run(
      db,
      `UPDATE veh.vehicles
          SET ${assignments.join(', ')}
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3
          AND deleted_at IS NULL AND lifecycle_status <> 'merged'`,
      params
    );
    return result.rowCount ?? 0;
  }
}
