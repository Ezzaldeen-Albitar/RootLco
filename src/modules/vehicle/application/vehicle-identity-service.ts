/**
 * Vehicle identity — merge (and, later, duplicate scan/review) application service
 * (Phase 1-17, FR-VEH-003, P1-17-BE-004).
 *
 * ## The merged vehicle is redirected, never deleted
 *
 * `veh.vehicles.merged_into_id` points at the survivor and the source row stays.
 * A work order raised against the duplicate still resolves to a real vehicle, and
 * the `veh.vehicle_merges` record is INSERT-only evidence of who decided and under
 * what approval. The order is dictated by the database: `veh.guard_vehicle_merge`
 * validates that the survivor is live and not itself merged and freezes any
 * already-merged vehicle, so the checks here are a courtesy that turns those
 * refusals into clean 404/409s instead of raw trigger errors.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { VehicleIdentityRepository } from '../data/vehicle-identity-repository';
import { VehicleIdentityError, assertMergeable } from '../domain/vehicle-identity';

export interface MergeResult {
  readonly mergeId: string;
  readonly sourceId: string;
  readonly survivorId: string;
}

export class VehicleIdentityService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly identity: VehicleIdentityRepository) {
    super();
  }

  /**
   * Merges `sourceId` into `survivorId` in one transaction. The single INSERT into
   * `veh.vehicle_merges` both records the merge and (via the frozen apply trigger)
   * redirects the source.
   */
  async mergeVehicle(
    db: DbHandle,
    sourceId: string,
    input: { survivorId: string; approvalRef: string }
  ): Promise<MergeResult> {
    this.orFail(() => assertMergeable(sourceId, input.survivorId));

    const source = await this.identity.vehicleState(db, sourceId);
    if (!source) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    if (source.mergedIntoId !== null) {
      // Replay-safe: a second merge attempt on an already-merged vehicle is a
      // stable refusal, not a partial second merge.
      throw new AppFailure('ERR-RES-002', { message: 'Vehicle has already been merged' });
    }

    const survivor = await this.identity.vehicleState(db, input.survivorId);
    if (!survivor) {
      // Same 404 as an unknown id: a cross-tenant survivor must not be
      // distinguishable from one that does not exist.
      throw new AppFailure('ERR-RES-001', { message: 'Survivor vehicle was not found' });
    }
    if (survivor.mergedIntoId !== null) {
      throw new AppFailure('ERR-RES-002', {
        message: 'The survivor is itself merged; merge into the surviving vehicle instead',
      });
    }

    let mergeId: string | null;
    try {
      mergeId = await this.identity.insertMerge(db, {
        sourceId,
        survivorId: input.survivorId,
        approvalRef: input.approvalRef,
        summary: { sourceLifecycle: source.lifecycleStatus },
      });
    } catch (error) {
      // uq_vehicle_merges_source (already merged) and the apply/merge-guard
      // check_violations (survivor merged/deleted, source raced into merged) are
      // all conflicts, not server faults; a missing survivor surfaces as an FK
      // violation from the guard.
      if (
        isSqlState(error, SQLSTATE.uniqueViolation) ||
        isSqlState(error, SQLSTATE.checkViolation)
      ) {
        throw new AppFailure('ERR-RES-002', {
          message: 'The vehicles changed while this merge was in flight; re-read and retry',
        });
      }
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-RES-001', { message: 'Survivor vehicle was not found' });
      }
      throw error;
    }
    if (!mergeId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Merge record was refused by policy' });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.merged',
      entityType: 'veh.vehicle',
      entityId: sourceId,
      details: [
        { field: 'survivor_vehicle_id', classification: 'internal', value: input.survivorId },
        { field: 'approval_ref', classification: 'internal', value: input.approvalRef },
        {
          field: 'lifecycle_status',
          classification: 'public',
          previousValue: source.lifecycleStatus,
          value: 'merged',
        },
      ],
    });

    await publishEvent(db, {
      eventType: 'vehicle.merged',
      // The survivor is the aggregate: it is the vehicle that continues to exist
      // and that a consumer must re-read.
      aggregateId: input.survivorId,
      aggregateVersion: 1,
      producer: 'veh.vehicle-identity-service',
      payload: { survivorId: input.survivorId, sourceId, mergeId },
      eventKey: `vehicle.merged:${mergeId}`,
    });

    return { mergeId, sourceId, survivorId: input.survivorId };
  }

  private orFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof VehicleIdentityError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
