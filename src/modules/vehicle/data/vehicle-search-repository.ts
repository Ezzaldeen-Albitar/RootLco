/**
 * Vehicle search — repository (Phase 1-17, FR-VEH-001, P1-13-BE-003).
 *
 * The only place vehicle-search SQL is written. Runs through a `DbHandle`, so it
 * cannot execute without a resolved context, and every predicate is a bound
 * parameter. On top of RLS default-deny it carries an explicit `tenant_id`
 * predicate (defence in depth) and excludes soft-deleted vehicles.
 *
 * Bounded by construction: VIN matches the generated `vin_normalized` column
 * exactly (never a wildcard scan); a plate matches the vehicle's active plate via
 * a tenant-scoped subquery over `veh.plate_history`, normalised on the SQL side
 * with `veh.normalize_plate` so the query fragment and the stored value are
 * compared under the same frozen rule. The result is keyset-ordered by
 * `(created_at DESC, id DESC)` with a fetch of `limit + 1` — one indexed page,
 * never an offset walk. The projection is the safe master view only; no restricted
 * identifier column is selected.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { buildPage, keysetFragment, type Page, type PageRequest } from '@/server/db/pagination';
import {
  VEHICLE_SEARCH_ORDERING,
  type PowertrainCategory,
  type VehicleLifecycleStatus,
  type VehicleSearchFilter,
  type VehicleSearchHit,
  type WorkshopStatus,
} from '../domain/vehicle-search';

interface VehicleRow {
  readonly id: string;
  readonly display_number: string | null;
  readonly vin_normalized: string | null;
  readonly make_id: string | null;
  readonly model_id: string | null;
  readonly model_year: number | null;
  readonly powertrain_category: PowertrainCategory;
  readonly lifecycle_status: VehicleLifecycleStatus;
  readonly workshop_status: WorkshopStatus;
  readonly created_at: Date;
}

function toHit(row: VehicleRow): VehicleSearchHit {
  return {
    id: row.id,
    displayNumber: row.display_number,
    vin: row.vin_normalized,
    makeId: row.make_id,
    modelId: row.model_id,
    modelYear: row.model_year,
    powertrainCategory: row.powertrain_category,
    lifecycleStatus: row.lifecycle_status,
    workshopStatus: row.workshop_status,
    createdAt: row.created_at.toISOString(),
  };
}

export class VehicleSearchRepository extends Repository {
  protected readonly module = 'vehicle';

  async search(
    db: DbHandle,
    page: PageRequest,
    filter: VehicleSearchFilter
  ): Promise<Page<VehicleSearchHit>> {
    const context = this.assertContext(db);
    const where: string[] = ['v.tenant_id = $1', 'v.deleted_at IS NULL'];
    const values: unknown[] = [context.principal.tenantId];
    let param = 2;

    if (filter.hasVin) {
      // Exact match on the generated, normalised VIN. A supplied VIN that
      // normalised to null (implausible input) matches nothing, which is the
      // correct answer — not a dropped filter.
      where.push(`v.vin_normalized = $${param}`);
      values.push(filter.vinNormalized);
      param += 1;
    }
    if (filter.plateRaw !== null) {
      // The vehicle's *active* plate, normalised on the column side with the same
      // frozen function the stored value was generated from. Tenant-scoped inside
      // the subquery as well as by the outer predicate + RLS.
      where.push(
        `EXISTS (
           SELECT 1 FROM veh.plate_history ph
            WHERE ph.tenant_id = $1
              AND ph.vehicle_id = v.id
              AND ph.valid_to IS NULL
              AND ph.plate_normalized = veh.normalize_plate($${param}))`
      );
      values.push(filter.plateRaw);
      param += 1;
    }
    if (filter.vehicleNumber !== null) {
      where.push(`v.display_number = $${param}`);
      values.push(filter.vehicleNumber);
      param += 1;
    }
    if (filter.lifecycleStatus !== null) {
      where.push(`v.lifecycle_status = $${param}`);
      values.push(filter.lifecycleStatus);
      param += 1;
    }
    if (filter.powertrainCategory !== null) {
      where.push(`v.powertrain_category = $${param}`);
      values.push(filter.powertrainCategory);
      param += 1;
    }

    const keyset = keysetFragment(
      page,
      { sort: 'v.created_at', id: 'v.id' },
      VEHICLE_SEARCH_ORDERING,
      param
    );
    values.push(...keyset.values);

    const sql = `
      SELECT v.id, v.display_number, v.vin_normalized, v.make_id, v.model_id, v.model_year,
             v.powertrain_category, v.lifecycle_status, v.workshop_status, v.created_at
        FROM veh.vehicles v
       WHERE ${where.join(' AND ')} ${keyset.predicate}
       ${keyset.order}
       ${keyset.limitClause}`;

    const result = await this.run<VehicleRow>(db, sql, values);
    return buildPage(result.rows.map(toHit), page, VEHICLE_SEARCH_ORDERING, (hit) => ({
      sortValue: hit.createdAt,
      id: hit.id,
    }));
  }
}
