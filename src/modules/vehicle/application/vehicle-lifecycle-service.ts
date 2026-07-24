/**
 * Vehicle EV profile and lifecycle/workshop status — application service (Phase
 * 1-17, P1-17-BE-008, P1-17-BE-009).
 *
 * Each mutation is one controlled transaction: lock the vehicle, decide, write,
 * audit — all or nothing. The EV profile is set-or-replace (one active profile per
 * vehicle); its powertrain coupling is pre-checked here for a clean message and
 * enforced by the frozen `veh.guard_ev_profile_powertrain` as the backstop. A
 * status change edits the master, and the frozen AFTER-UPDATE trigger appends the
 * `veh.vehicle_status_history` row in the same transaction — the ledger is the
 * durable record, so a status change publishes no separate event.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type {
  EvProfileRow,
  VehicleLifecycleRepository,
} from '../data/vehicle-lifecycle-repository';
import {
  VehicleLifecycleError,
  toEvProfilePlan,
  toStatusChangePlan,
  type EvProfileInput,
  type StatusChangeInput,
  type VehicleStatusState,
} from '../domain/vehicle-lifecycle';
import type { VehicleLifecycleStatus, WorkshopStatus } from '../domain/vehicle-search';

export interface EvProfileSet {
  readonly vehicleId: string;
  readonly evProfileId: string;
  readonly created: boolean;
}
export interface EvProfileView {
  readonly vehicleId: string;
  readonly evKind: string;
  readonly usableCapacityKwh: number | null;
  readonly chargePortType: string | null;
  readonly highVoltageWarning: boolean;
}
export interface StatusChanged {
  readonly vehicleId: string;
  readonly changedAxes: readonly ('lifecycle' | 'workshop')[];
  readonly lifecycleStatus: VehicleLifecycleStatus;
  readonly workshopStatus: WorkshopStatus;
}

export class VehicleLifecycleService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly lifecycle: VehicleLifecycleRepository) {
    super();
  }

  async setEvProfile(
    db: DbHandle,
    vehicleId: string,
    input: EvProfileInput
  ): Promise<EvProfileSet> {
    const plan = this.planOrFail(() => toEvProfilePlan(input));
    const vehicle = await this.lifecycle.lockVehicle(db, vehicleId);
    if (!vehicle) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    if (vehicle.lifecycleStatus === 'merged' || vehicle.lifecycleStatus === 'scrapped') {
      // A terminal vehicle takes no new EV profile — the same rule the registration
      // and relations writers apply to plates, owners, and authorized parties.
      throw new AppFailure('ERR-RES-002', {
        message: `Vehicle is ${vehicle.lifecycleStatus} and cannot take an EV profile`,
      });
    }
    if (plan.requiredCategory !== vehicle.powertrainCategory) {
      // The frozen guard would reject this too; surfacing it here gives the caller
      // the actionable message instead of a raw constraint error.
      throw new AppFailure('ERR-VAL-001', {
        message: `ev_kind ${plan.evKind} requires powertrain category ${plan.requiredCategory}, but the vehicle is ${vehicle.powertrainCategory}`,
        safeDetails: { violations: [{ path: 'body.evKind', rule: 'powertrain_mismatch' }] },
      });
    }

    const existing = await this.lifecycle.findActiveEvProfile(db, vehicleId);
    let evProfileId: string | null;
    try {
      if (existing) {
        const changed = await this.lifecycle.updateEvProfile(db, existing.id, plan);
        evProfileId = changed > 0 ? existing.id : null;
      } else {
        evProfileId = await this.lifecycle.insertEvProfile(db, { vehicleId, ...plan });
      }
    } catch (error) {
      throw this.mapEvConflict(error);
    }
    if (!evProfileId) {
      throw new AppFailure('ERR-IAM-001', { message: 'EV profile write was refused by policy' });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.ev_profile_set',
      entityType: 'veh.vehicle_ev_profile',
      entityId: evProfileId,
      details: [
        { field: 'vehicle_id', classification: 'internal', value: vehicleId },
        { field: 'ev_kind', classification: 'public', value: plan.evKind },
        { field: 'created', classification: 'public', value: String(existing === null) },
      ],
    });

    return { vehicleId, evProfileId, created: existing === null };
  }

  async getEvProfile(db: DbHandle, vehicleId: string): Promise<EvProfileView> {
    const profile = await this.lifecycle.findActiveEvProfile(db, vehicleId);
    if (!profile) {
      throw new AppFailure('ERR-RES-001', { message: 'No EV profile was found for this vehicle' });
    }
    return this.toView(vehicleId, profile);
  }

  async changeStatus(
    db: DbHandle,
    vehicleId: string,
    input: StatusChangeInput
  ): Promise<StatusChanged> {
    const vehicle = await this.lifecycle.lockVehicle(db, vehicleId);
    if (!vehicle) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    if (vehicle.lifecycleStatus === 'merged') {
      throw new AppFailure('ERR-RES-002', {
        message: 'Vehicle has been merged and is read-only',
      });
    }

    const current: VehicleStatusState = {
      lifecycleStatus: vehicle.lifecycleStatus as VehicleLifecycleStatus,
      workshopStatus: vehicle.workshopStatus as WorkshopStatus,
    };
    const plan = this.planOrFail(() => toStatusChangePlan(current, input));

    let changed: number;
    try {
      changed = await this.lifecycle.updateStatus(db, vehicleId, plan.changes);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // guard_vehicle_activation (active needs a VIN/identifier) or the
        // terminal-workshop backstop. The domain pre-checks the latter, so this is
        // almost always the activation rule.
        throw new AppFailure('ERR-VAL-001', {
          message:
            'The vehicle cannot enter this state; an active vehicle needs a VIN or an active identifier',
          safeDetails: { violations: [{ path: 'body.lifecycleStatus', rule: 'invalid_state' }] },
        });
      }
      throw error;
    }
    if (changed === 0) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The vehicle changed while this request was in flight; retry',
      });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.status_changed',
      entityType: 'veh.vehicle',
      entityId: vehicleId,
      details: [
        { field: 'changed_axes', classification: 'public', value: plan.changedAxes.join(',') },
        { field: 'lifecycle_status', classification: 'public', value: plan.resultingLifecycle },
        { field: 'workshop_status', classification: 'public', value: plan.resultingWorkshop },
      ],
    });

    return {
      vehicleId,
      changedAxes: plan.changedAxes,
      lifecycleStatus: plan.resultingLifecycle,
      workshopStatus: plan.resultingWorkshop,
    };
  }

  private toView(vehicleId: string, profile: EvProfileRow): EvProfileView {
    return {
      vehicleId,
      evKind: profile.evKind,
      usableCapacityKwh:
        profile.usableCapacityKwh === null ? null : Number(profile.usableCapacityKwh),
      chargePortType: profile.chargePortType,
      highVoltageWarning: profile.highVoltageWarning,
    };
  }

  /** Maps the frozen EV-profile guard SQLSTATEs to stable problems. */
  private mapEvConflict(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'The EV kind is not compatible with the vehicle powertrain category',
        safeDetails: { violations: [{ path: 'body.evKind', rule: 'powertrain_mismatch' }] },
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      return new AppFailure('ERR-CON-001', {
        message: 'The EV profile changed while this request was in flight; retry',
      });
    }
    return error;
  }

  private planOrFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof VehicleLifecycleError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
