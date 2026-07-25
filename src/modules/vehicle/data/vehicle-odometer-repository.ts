/**
 * Vehicle odometer repository (Phase 1-17, P1-17-BE-010, P1-17-BE-011).
 *
 * The only place odometer SQL is written. Readings are append-only: there is no
 * update or delete path. `recorded_by` is stamped by the frozen trigger from the
 * session actor, `value_km` is a generated column, and `guard_odometer_reading`
 * (which locks the vehicle) is the authority on the forward-only rule and on the
 * correction reference. `seq`/`observed_at` order the history.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { buildPage, keysetFragment, type Page, type PageRequest } from '@/server/db/pagination';
import { ODOMETER_ORDERING, type OdometerReadingPlan } from '../domain/vehicle-odometer';

export interface OdometerReadingHit {
  readonly id: string;
  readonly value: string;
  readonly unit: string;
  readonly valueKm: string | null;
  readonly observedAt: string;
  readonly captureMethod: string;
  readonly anomalyFlag: boolean;
  readonly correctionOf: string | null;
  readonly correctionReason: string | null;
}

export class VehicleOdometerRepository extends Repository {
  protected readonly module = 'vehicle';

  /** True when the vehicle exists (non-deleted) in the caller's tenant. Lets the
   * service answer a clean 404 rather than surfacing the guard's FK violation,
   * which it reserves for a bad correction reference. */
  async vehicleExists(db: DbHandle, vehicleId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `SELECT 1 FROM veh.vehicles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Appends a reading. Returns the id, or null on a policy refusal. The
   * forward-only rule and the correction reference are enforced by the frozen
   * `guard_odometer_reading` trigger, surfaced as check/foreign-key violations. */
  async insertReading(
    db: DbHandle,
    input: { vehicleId: string; plan: OdometerReadingPlan }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const { plan } = input;
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.odometer_readings
         (tenant_id, vehicle_id, value, unit, observed_at, capture_method,
          correction_of, correction_reason, anomaly_flag, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.vehicleId,
        plan.value,
        plan.unit,
        plan.observedAt,
        plan.captureMethod,
        plan.correctionOf,
        plan.correctionReason,
        plan.anomalyFlag,
        context.correlationId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  async listReadings(
    db: DbHandle,
    vehicleId: string,
    page: PageRequest
  ): Promise<Page<OdometerReadingHit>> {
    const context = this.assertContext(db);
    const keyset = keysetFragment(page, { sort: 'observed_at', id: 'id' }, ODOMETER_ORDERING, 3);
    const result = await this.run<{
      id: string;
      value: string;
      unit: string;
      value_km: string | null;
      observed_at: Date;
      capture_method: string;
      anomaly_flag: boolean;
      correction_of: string | null;
      correction_reason: string | null;
    }>(
      db,
      `SELECT id, value::text AS value, unit, value_km::text AS value_km, observed_at,
              capture_method, anomaly_flag, correction_of, correction_reason
         FROM veh.odometer_readings
        WHERE tenant_id = $1 AND vehicle_id = $2 ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [context.principal.tenantId, vehicleId, ...keyset.values]
    );
    return buildPage(
      result.rows.map((r) => ({
        id: r.id,
        value: r.value,
        unit: r.unit,
        valueKm: r.value_km,
        observedAt: r.observed_at.toISOString(),
        captureMethod: r.capture_method,
        anomalyFlag: r.anomaly_flag,
        correctionOf: r.correction_of,
        correctionReason: r.correction_reason,
      })),
      page,
      ODOMETER_ORDERING,
      (hit) => ({ sortValue: hit.observedAt, id: hit.id })
    );
  }
}
