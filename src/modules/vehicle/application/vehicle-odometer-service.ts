/**
 * Vehicle odometer — entry and anomaly application service (Phase 1-17,
 * P1-17-BE-010, P1-17-BE-011).
 *
 * Records a reading and its audit as one atomic fact; the append-only history and
 * the effective-odometer rule are the database's. A normal reading below the
 * current effective value is refused with a structured anomaly indicator
 * (`below_current_odometer`) rather than a raw trigger error — the original is
 * preserved and the caller is told to submit a correction. A correction records the
 * disposition, may lower the value, and is always flagged.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type {
  OdometerReadingHit,
  VehicleOdometerRepository,
} from '../data/vehicle-odometer-repository';
import {
  ODOMETER_ORDERING,
  VehicleOdometerError,
  toOdometerReadingPlan,
  type OdometerReadingInput,
} from '../domain/vehicle-odometer';

export interface OdometerRecorded {
  readonly readingId: string;
  readonly captureMethod: string;
  readonly anomalyFlag: boolean;
}

type PageInput = { cursor?: string | undefined; limit?: number | undefined };

export class VehicleOdometerService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly odometer: VehicleOdometerRepository) {
    super();
  }

  async recordReading(
    db: DbHandle,
    vehicleId: string,
    input: OdometerReadingInput
  ): Promise<OdometerRecorded> {
    const plan = this.planOrFail(() => toOdometerReadingPlan(input));

    if (!(await this.odometer.vehicleExists(db, vehicleId))) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }

    let readingId: string | null;
    try {
      readingId = await this.odometer.insertReading(db, { vehicleId, plan });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        if (plan.captureMethod === 'correction') {
          throw new AppFailure('ERR-VAL-001', {
            message: 'A correction must reference an earlier-or-equal reading',
            safeDetails: { violations: [{ path: 'body.correctionOf', rule: 'not_earlier' }] },
          });
        }
        // The forward-only rule fired: this is the anomaly. The reading is not
        // stored; the caller resubmits it as a correction with a reason.
        throw new AppFailure('ERR-VAL-001', {
          message:
            'The value is below the current effective odometer; submit it as a correction with a reason',
          safeDetails: { violations: [{ path: 'body.value', rule: 'below_current_odometer' }] },
        });
      }
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The corrected reading was not found for this vehicle',
          safeDetails: { violations: [{ path: 'body.correctionOf', rule: 'unknown_reference' }] },
        });
      }
      throw error;
    }
    if (!readingId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Odometer reading was refused by policy' });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.odometer_recorded',
      entityType: 'veh.odometer_reading',
      entityId: readingId,
      details: [
        { field: 'vehicle_id', classification: 'internal', value: vehicleId },
        { field: 'capture_method', classification: 'public', value: plan.captureMethod },
        { field: 'anomaly_flag', classification: 'public', value: String(plan.anomalyFlag) },
        { field: 'correction_reason', classification: 'public', value: plan.correctionReason },
      ],
    });

    return { readingId, captureMethod: plan.captureMethod, anomalyFlag: plan.anomalyFlag };
  }

  listReadings(
    db: DbHandle,
    vehicleId: string,
    page: PageInput
  ): Promise<Page<OdometerReadingHit>> {
    return this.odometer.listReadings(db, vehicleId, pageRequest(ODOMETER_ORDERING, page));
  }

  private planOrFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof VehicleOdometerError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
