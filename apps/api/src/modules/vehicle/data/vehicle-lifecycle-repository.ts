/**
 * Vehicle EV-profile and status repository (Phase 1-17, P1-17-BE-008, P1-17-BE-009).
 *
 * The only place EV-profile and vehicle-status SQL is written. The vehicle row is
 * taken `FOR UPDATE` before any status change or EV-profile write, so a concurrent
 * status change or profile write on the same vehicle serialises behind us (the
 * frozen `veh.guard_ev_profile_powertrain` and `veh.guard_vehicle_ev_powertrain`
 * take their own locks, and this stronger lock is compatible). Status changes are
 * applied to the master; the frozen AFTER-UPDATE trigger writes the append-only
 * `veh.vehicle_status_history` row in the same transaction.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { StatusColumnChange } from '../domain/vehicle-lifecycle';

export interface VehicleLifecycleRow {
  readonly lifecycleStatus: string;
  readonly workshopStatus: string;
  readonly powertrainCategory: string;
}

export interface EvProfileRow {
  readonly id: string;
  readonly evKind: string;
  readonly usableCapacityKwh: string | null;
  readonly chargePortType: string | null;
  readonly highVoltageWarning: boolean;
}

export class VehicleLifecycleRepository extends Repository {
  protected readonly module = 'vehicle';

  /** Locks the live vehicle and returns its status axes + powertrain, or null. */
  async lockVehicle(db: DbHandle, vehicleId: string): Promise<VehicleLifecycleRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      lifecycle_status: string;
      workshop_status: string;
      powertrain_category: string;
    }>(
      db,
      `SELECT lifecycle_status, workshop_status, powertrain_category
         FROM veh.vehicles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, vehicleId]
    );
    const row = result.rows[0];
    return row
      ? {
          lifecycleStatus: row.lifecycle_status,
          workshopStatus: row.workshop_status,
          powertrainCategory: row.powertrain_category,
        }
      : null;
  }

  /**
   * Applies the requested status columns under the vehicle lock. Column names come
   * only from the frozen domain plan (`lifecycle_status` / `workshop_status`), never
   * from caller input, so the interpolation is closed. Returns rows changed.
   */
  async updateStatus(
    db: DbHandle,
    vehicleId: string,
    changes: readonly StatusColumnChange[]
  ): Promise<number> {
    const context = this.assertContext(db);
    const sets = changes.map((change, i) => `${change.column} = $${i + 3}`);
    const values = changes.map((change) => change.value);
    const result = await this.run(
      db,
      `UPDATE veh.vehicles
          SET ${sets.join(', ')}
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId, ...values]
    );
    return result.rowCount ?? 0;
  }

  // ---- EV profile ---------------------------------------------------------

  /** The vehicle's single active EV profile, or null. */
  async findActiveEvProfile(db: DbHandle, vehicleId: string): Promise<EvProfileRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      ev_kind: string;
      usable_capacity_kwh: string | null;
      charge_port_type: string | null;
      high_voltage_warning: boolean;
    }>(
      db,
      `SELECT id, ev_kind, usable_capacity_kwh::text AS usable_capacity_kwh,
              charge_port_type, high_voltage_warning
         FROM veh.vehicle_ev_profiles
        WHERE tenant_id = $1 AND vehicle_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          evKind: row.ev_kind,
          usableCapacityKwh: row.usable_capacity_kwh,
          chargePortType: row.charge_port_type,
          highVoltageWarning: row.high_voltage_warning,
        }
      : null;
  }

  async insertEvProfile(
    db: DbHandle,
    input: {
      vehicleId: string;
      evKind: string;
      usableCapacityKwh: number | null;
      chargePortType: string | null;
      highVoltageWarning: boolean;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.vehicle_ev_profiles
         (tenant_id, vehicle_id, ev_kind, usable_capacity_kwh, charge_port_type,
          high_voltage_warning, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.vehicleId,
        input.evKind,
        input.usableCapacityKwh,
        input.chargePortType,
        input.highVoltageWarning,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Re-sets an existing EV profile's mutable fields. Returns rows changed. */
  async updateEvProfile(
    db: DbHandle,
    profileId: string,
    input: {
      evKind: string;
      usableCapacityKwh: number | null;
      chargePortType: string | null;
      highVoltageWarning: boolean;
    }
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE veh.vehicle_ev_profiles
          SET ev_kind = $3, usable_capacity_kwh = $4, charge_port_type = $5,
              high_voltage_warning = $6
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        profileId,
        input.evKind,
        input.usableCapacityKwh,
        input.chargePortType,
        input.highVoltageWarning,
      ]
    );
    return result.rowCount ?? 0;
  }
}
