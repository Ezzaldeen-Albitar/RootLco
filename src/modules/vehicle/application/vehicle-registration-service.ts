/**
 * Vehicle registration — plate history and ownership transfer application service
 * (Phase 1-17, P1-17-BE-006, P1-17-BE-007, P1-17-BE-016).
 *
 * Both mutations are one controlled transaction: resolve and lock the vehicle,
 * close the open interval, open the new one, write audit (and, for ownership, the
 * outbox event) — all or nothing. The frozen temporal EXCLUDE constraints are the
 * authority on overlap; a PostgreSQL exclusion violation (`23P01`) becomes a
 * stable 409 rather than a raw driver error, and a closed-interval race
 * (`closeX` writes zero rows) is reported as a conflict rather than double-closed.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, sqlState, SQLSTATE } from '@/server/db/repository';
import type {
  OwnershipHistoryHit,
  PlateHistoryHit,
  VehicleRegistrationRepository,
} from '../data/vehicle-registration-repository';
import {
  OWNERSHIP_HISTORY_ORDERING,
  PLATE_HISTORY_ORDERING,
  VehicleRegistrationError,
  toOwnershipTransferPlan,
  toPlateAssignPlan,
  type OwnershipTransferInput,
  type PlateAssignInput,
} from '../domain/vehicle-registration';

export interface PlateAssigned {
  readonly vehicleId: string;
  readonly plateId: string;
}
export interface OwnershipTransferred {
  readonly vehicleId: string;
  readonly ownershipId: string;
  readonly ownershipKind: string;
}

type PageInput = { cursor?: string | undefined; limit?: number | undefined };

export class VehicleRegistrationService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly registration: VehicleRegistrationRepository) {
    super();
  }

  async assignPlate(
    db: DbHandle,
    vehicleId: string,
    input: PlateAssignInput
  ): Promise<PlateAssigned> {
    const plan = this.planOrFail(() => toPlateAssignPlan(input));
    await this.requireWritableVehicle(db, vehicleId);

    const current = await this.registration.currentActivePlate(db, vehicleId);
    if (current) {
      const closed = await this.closeOrFail(() =>
        this.registration.closePlate(db, current.id, plan.effectiveDate)
      );
      if (closed === 0) {
        throw new AppFailure('ERR-CON-001', {
          message: 'The vehicle plate changed while this request was in flight; retry',
        });
      }
    }

    let plateId: string | null;
    try {
      plateId = await this.registration.insertPlate(db, { vehicleId, ...plan });
    } catch (error) {
      throw this.mapConflict(error, 'plate');
    }
    if (!plateId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Plate assignment was refused by policy' });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.plate_assigned',
      entityType: 'veh.plate_history',
      entityId: plateId,
      details: [
        { field: 'vehicle_id', classification: 'internal', value: vehicleId },
        { field: 'country_code', classification: 'public', value: plan.countryCode },
      ],
    });
    return { vehicleId, plateId };
  }

  listPlates(db: DbHandle, vehicleId: string, page: PageInput): Promise<Page<PlateHistoryHit>> {
    return this.registration.listPlates(db, vehicleId, pageRequest(PLATE_HISTORY_ORDERING, page));
  }

  async transferOwnership(
    db: DbHandle,
    vehicleId: string,
    input: OwnershipTransferInput
  ): Promise<OwnershipTransferred> {
    const plan = this.planOrFail(() => toOwnershipTransferPlan(input));
    await this.requireWritableVehicle(db, vehicleId);

    const current = await this.registration.currentOwner(db, vehicleId, plan.ownershipKind);
    if (current) {
      const closed = await this.closeOrFail(() =>
        this.registration.closeOwner(db, current.id, plan.effectiveDate)
      );
      if (closed === 0) {
        throw new AppFailure('ERR-CON-001', {
          message: 'The vehicle ownership changed while this request was in flight; retry',
        });
      }
    }

    let ownershipId: string | null;
    try {
      ownershipId = await this.registration.insertOwnership(db, { vehicleId, ...plan });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The customer was not found in this tenant',
          safeDetails: { violations: [{ path: 'body.partnerId', rule: 'unknown_reference' }] },
        });
      }
      throw this.mapConflict(error, 'ownership');
    }
    if (!ownershipId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Ownership transfer was refused by policy' });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.ownership_changed',
      entityType: 'veh.ownership_history',
      entityId: ownershipId,
      details: [
        { field: 'vehicle_id', classification: 'internal', value: vehicleId },
        { field: 'ownership_kind', classification: 'public', value: plan.ownershipKind },
        { field: 'transfer_reason', classification: 'internal', value: plan.transferReason },
      ],
    });

    await publishEvent(db, {
      eventType: 'vehicle.relationship.changed',
      aggregateId: vehicleId,
      aggregateVersion: 1,
      producer: 'veh.vehicle-registration-service',
      payload: {
        vehicleId,
        changeKind: 'ownership',
        ownershipKind: plan.ownershipKind,
        // No partner id, no plate: a consumer reads the aggregate under its own
        // authorization for the detail.
      },
      eventKey: `vehicle.relationship.changed:ownership:${ownershipId}`,
    });

    return { vehicleId, ownershipId, ownershipKind: plan.ownershipKind };
  }

  listOwnerships(
    db: DbHandle,
    vehicleId: string,
    page: PageInput
  ): Promise<Page<OwnershipHistoryHit>> {
    return this.registration.listOwnerships(
      db,
      vehicleId,
      pageRequest(OWNERSHIP_HISTORY_ORDERING, page)
    );
  }

  /** A plate or owner may only be attached to a live, non-terminal vehicle. */
  private async requireWritableVehicle(db: DbHandle, vehicleId: string): Promise<void> {
    const state = await this.registration.vehicleState(db, vehicleId);
    if (!state) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    if (state.lifecycleStatus === 'merged' || state.lifecycleStatus === 'scrapped') {
      throw new AppFailure('ERR-RES-002', {
        message: `Vehicle is ${state.lifecycleStatus} and cannot take a new plate or owner`,
      });
    }
  }

  /** Maps a temporal overlap (`23P01`) or an interval-range check to a stable
   * problem; re-throws anything else. */
  private mapConflict(error: unknown, subject: 'plate' | 'ownership'): AppFailure | unknown {
    if (sqlState(error) === '23P01') {
      return new AppFailure('ERR-RES-002', {
        message:
          subject === 'plate'
            ? 'That plate is already active on another vehicle, or overlaps this vehicle’s plate history'
            : 'An overlapping ownership already exists for this vehicle',
      });
    }
    return this.closeOrFailError(error);
  }

  /** Runs a close, mapping the `valid_to > valid_from` range check to a 422. */
  private async closeOrFail(run: () => Promise<number>): Promise<number> {
    try {
      return await run();
    } catch (error) {
      throw this.closeOrFailError(error);
    }
  }

  private closeOrFailError(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'The effective date must be after the current interval start',
        safeDetails: { violations: [{ path: 'body.effectiveDate', rule: 'out_of_range' }] },
      });
    }
    return error;
  }

  private planOrFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof VehicleRegistrationError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
