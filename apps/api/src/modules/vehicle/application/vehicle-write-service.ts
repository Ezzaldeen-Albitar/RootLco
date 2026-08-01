/**
 * Vehicle master create / update — application service (Phase 1-17, FR-VEH-001,
 * P1-17-BE-003).
 *
 * Orchestrates the write inside the caller's transaction: plan → row → audit →
 * (on create) event. The row, its audit record, and its outbox event commit
 * together or not at all, so a created vehicle is never announced without being
 * recorded, and never recorded without being announceable.
 *
 * ## What the database decides, and how those refusals are surfaced
 *
 * The frozen `veh.vehicles` guards are the authority for coherence, and each is
 * mapped to a stable problem rather than a raw driver error:
 *
 *  - active-VIN collision (`23505`) → `ERR-RES-002` (409): the VIN already
 *    identifies a live vehicle in the tenant; retrying will not help.
 *  - unseen catalog reference (`23503`) → `ERR-VAL-001` (422): a make/model/trim/
 *    body/powertrain id the tenant cannot see is a bad input, not a server fault.
 *  - incoherent catalog reference or powertrain mismatch (`23514`) →
 *    `ERR-VAL-001` (422): e.g. a model that does not belong to the given make.
 *  - a merged vehicle (`ERR-RES-002`, decided here before the UPDATE) is frozen;
 *    a stale `record_version` (`ERR-CON-001`) is a retryable concurrency loss.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { VehicleWriteRepository } from '../data/vehicle-write-repository';
import {
  VehicleWriteError,
  toVehicleCreatePlan,
  toVehicleUpdatePlan,
  type VehicleCreateInput,
  type VehicleUpdateInput,
} from '../domain/vehicle-write';

export interface CreatedVehicle {
  readonly vehicleId: string;
  readonly lifecycleStatus: 'draft';
  readonly powertrainCategory: string;
  readonly hasVin: boolean;
}

export interface UpdatedVehicle {
  readonly vehicleId: string;
  /** The physical columns this request changed. Never the values (a VIN is data). */
  readonly changedColumns: readonly string[];
}

export class VehicleWriteService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly vehicles: VehicleWriteRepository) {
    super();
  }

  async create(db: DbHandle, input: VehicleCreateInput): Promise<CreatedVehicle> {
    const plan = this.planOrFail(() => toVehicleCreatePlan(input));
    const vehicleId = crypto.randomUUID();

    let inserted: string | null;
    try {
      inserted = await this.vehicles.insertVehicle(db, { id: vehicleId, plan });
    } catch (error) {
      throw this.mapWriteConflict(error);
    }
    if (!inserted) {
      throw new AppFailure('ERR-IAM-001', { message: 'Vehicle creation was refused by policy' });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.created',
      entityType: 'veh.vehicle',
      entityId: vehicleId,
      details: [
        { field: 'powertrain_category', classification: 'public', value: plan.powertrainCategory },
        { field: 'lifecycle_status', classification: 'public', value: 'draft' },
        // Presence, not the VIN: the VIN is `internal`-classified data and lives
        // in the row the record points at, not in the audit trail.
        { field: 'has_vin', classification: 'public', value: String(plan.vinRaw !== null) },
      ],
    });

    await publishEvent(db, {
      eventType: 'vehicle.created',
      aggregateId: vehicleId,
      aggregateVersion: 1,
      producer: 'veh.vehicle-write-service',
      payload: {
        vehicleId,
        powertrainCategory: plan.powertrainCategory,
        lifecycleStatus: 'draft',
        // No VIN, no plate, no owner: a consumer that needs them reads the
        // aggregate under its own authorization.
        hasVin: plan.vinRaw !== null,
      },
      eventKey: `vehicle.created:${vehicleId}`,
    });

    return {
      vehicleId,
      lifecycleStatus: 'draft',
      powertrainCategory: plan.powertrainCategory,
      hasVin: plan.vinRaw !== null,
    };
  }

  async update(
    db: DbHandle,
    vehicleId: string,
    input: VehicleUpdateInput
  ): Promise<UpdatedVehicle> {
    const current = await this.vehicles.currentState(db, vehicleId);
    if (!current) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    if (current.lifecycleStatus === 'merged') {
      // A merged vehicle is frozen at the database (guard_vehicle_merge). Refuse
      // here so the caller gets a clear 409 instead of a raw trigger error, and
      // resolve the survivor with the search/merge operations instead.
      throw new AppFailure('ERR-RES-002', {
        message: 'Vehicle has been merged and is read-only',
      });
    }

    const plan = this.planOrFail(() => toVehicleUpdatePlan(input));

    let changed: number;
    try {
      changed = await this.vehicles.updateMaster(
        db,
        vehicleId,
        current.recordVersion,
        plan.changes
      );
    } catch (error) {
      throw this.mapWriteConflict(error);
    }
    if (changed === 0) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The vehicle changed while this request was in flight; retry',
      });
    }

    const changedColumns = plan.changes.map((change) => change.column);
    await appendAudit(db, {
      action: 'veh.vehicle.updated',
      entityType: 'veh.vehicle',
      entityId: vehicleId,
      details: [
        // Which columns moved, never their values. A vehicle master edit can
        // touch `vin_raw`, which is `internal` data.
        { field: 'changed_columns', classification: 'public', value: changedColumns.join(',') },
      ],
    });

    return { vehicleId, changedColumns };
  }

  /** Maps the frozen-guard SQLSTATEs to stable problems. Re-throws anything else. */
  private mapWriteConflict(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      return new AppFailure('ERR-RES-002', {
        message: 'A live vehicle with this VIN already exists in the tenant',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'A referenced catalog record is not visible to this tenant',
        safeDetails: { violations: [{ path: 'body', rule: 'unknown_reference' }] },
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'The catalog references are not coherent (make/model/trim or powertrain)',
        safeDetails: { violations: [{ path: 'body', rule: 'incoherent_reference' }] },
      });
    }
    return error;
  }

  private planOrFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof VehicleWriteError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
