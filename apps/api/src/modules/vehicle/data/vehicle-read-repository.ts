/**
 * Vehicle detail READ repository (P1-17 remediation, `P1-27-INT-002`).
 *
 * `vehicles/[vehicleId]/route.ts` exported PATCH and nothing else. Search
 * returned a page of hits, seven sub-resources returned their own lists, and no
 * operation anywhere returned one vehicle — so a profile screen could reach a
 * vehicle's plates and never learn its make.
 *
 * ## The projection is the safe master view, and that is a contract not a habit
 *
 * `domain/vehicle-search.ts` states it under NFR-PRV-001: restricted identifiers
 * — chassis and engine number, which live in `veh.vehicle_identifiers` and are
 * classified `restricted` — "are never projected by this contract; a caller that
 * needs them uses a separate operation gated by `iam.sensitive.view`". This read
 * touches `veh.vehicles` only and honours that boundary. The separate operation
 * is still unbuilt (`P1-17-A-01`).
 *
 * `vin_normalized` is published, not `vin_raw`, matching what search returns. The
 * normalised form is the authoritative one — the raw column is what somebody
 * typed, and two operations disagreeing about which is "the VIN" is exactly how a
 * screen and a search end up showing different vehicles the same name.
 *
 * ## A merged vehicle is returned, not hidden
 *
 * Deliberately unlike the CRM customer read, which 404s a merged customer. The
 * difference is not an oversight: each read follows the module it belongs to.
 * `CustomerProfileRepository.findLiveCustomer` treats a merged customer as gone,
 * and the vehicle update route treats a merged vehicle as **existing but frozen**
 * — it answers 409, not 404. So the read returns the row with `mergedIntoId` set,
 * and a screen can say "merged into X" and link, rather than reporting a vehicle
 * that a work order still references as missing.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type {
  PowertrainCategory,
  VehicleLifecycleStatus,
  WorkshopStatus,
} from '../domain/vehicle-search';

/** A vehicle, as much of one as a profile screen needs. */
export interface VehicleDetailRow {
  readonly id: string;
  readonly displayNumber: string | null;
  /** The generated, normalised VIN — never `vin_raw`. */
  readonly vin: string | null;
  readonly makeId: string | null;
  readonly makeName: string | null;
  readonly modelId: string | null;
  readonly modelName: string | null;
  readonly trimId: string | null;
  readonly trimName: string | null;
  readonly bodyTypeId: string | null;
  readonly bodyTypeName: string | null;
  readonly powertrainTypeId: string | null;
  readonly powertrainTypeName: string | null;
  readonly modelYear: number | null;
  readonly powertrainCategory: PowertrainCategory;
  readonly color: string | null;
  readonly lifecycleStatus: VehicleLifecycleStatus;
  readonly workshopStatus: WorkshopStatus;
  /** Non-null when this vehicle was merged away. The survivor's id. */
  readonly mergedIntoId: string | null;
  /**
   * The optimistic-concurrency token.
   *
   * `veh.vehicles.record_version` has always existed and has never been
   * published. The PATCH above demands `If-Match`, and no operation returned the
   * value to put in it — so every vehicle edit was a last-writer-wins race a
   * client could not detect.
   */
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

interface DetailQueryRow {
  id: string;
  display_number: string | null;
  vin_normalized: string | null;
  make_id: string | null;
  make_name: string | null;
  model_id: string | null;
  model_name: string | null;
  trim_id: string | null;
  trim_name: string | null;
  body_type_id: string | null;
  body_type_name: string | null;
  powertrain_type_id: string | null;
  powertrain_type_name: string | null;
  model_year: number | null;
  powertrain_category: PowertrainCategory;
  color: string | null;
  lifecycle_status: VehicleLifecycleStatus;
  workshop_status: WorkshopStatus;
  merged_into_id: string | null;
  record_version: number;
  created_at: Date;
  updated_at: Date | null;
}

export class VehicleReadRepository extends Repository {
  protected readonly module = 'vehicle';

  /**
   * One vehicle with its catalog labels, or null.
   *
   * Five LEFT JOINs rather than five follow-up lookups, because a screen showing
   * "Make: (loading)" five times is worse than one statement, and because a
   * catalog row can disappear from view between two queries but not within one.
   *
   * Each join carries `(scope = 'platform' OR tenant_id = $1)` explicitly even
   * though `sel_makes_visible` and its four siblings already say exactly that.
   * Same rule as every other statement in this codebase: RLS is the guarantee,
   * the predicate is the intent, and a defence that exists once exists nowhere.
   * A catalog row the caller cannot see yields a null NAME beside a non-null ID,
   * which is the honest answer — the vehicle does reference something, and this
   * caller may not read it.
   */
  async findVehicleDetail(db: DbHandle, vehicleId: string): Promise<VehicleDetailRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<DetailQueryRow>(
      db,
      `SELECT v.id, v.display_number, v.vin_normalized,
              v.make_id,            mk.name AS make_name,
              v.model_id,           md.name AS model_name,
              v.trim_id,            tr.name AS trim_name,
              v.body_type_id,       bt.name AS body_type_name,
              v.powertrain_type_id, pt.name AS powertrain_type_name,
              v.model_year, v.powertrain_category, v.color,
              v.lifecycle_status, v.workshop_status, v.merged_into_id,
              v.record_version, v.created_at, v.updated_at
         FROM veh.vehicles v
         LEFT JOIN veh.makes mk
                ON mk.id = v.make_id
               AND (mk.scope = 'platform' OR mk.tenant_id = $1)
         LEFT JOIN veh.models md
                ON md.id = v.model_id
               AND (md.scope = 'platform' OR md.tenant_id = $1)
         LEFT JOIN veh.trims tr
                ON tr.id = v.trim_id
               AND (tr.scope = 'platform' OR tr.tenant_id = $1)
         LEFT JOIN veh.body_types bt
                ON bt.id = v.body_type_id
               AND (bt.scope = 'platform' OR bt.tenant_id = $1)
         LEFT JOIN veh.powertrain_types pt
                ON pt.id = v.powertrain_type_id
               AND (pt.scope = 'platform' OR pt.tenant_id = $1)
        WHERE v.tenant_id = $1 AND v.id = $2
          AND v.deleted_at IS NULL
        LIMIT 1`,
      [context.principal.tenantId, vehicleId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      displayNumber: row.display_number,
      vin: row.vin_normalized,
      makeId: row.make_id,
      makeName: row.make_name,
      modelId: row.model_id,
      modelName: row.model_name,
      trimId: row.trim_id,
      trimName: row.trim_name,
      bodyTypeId: row.body_type_id,
      bodyTypeName: row.body_type_name,
      powertrainTypeId: row.powertrain_type_id,
      powertrainTypeName: row.powertrain_type_name,
      modelYear: row.model_year,
      powertrainCategory: row.powertrain_category,
      color: row.color,
      lifecycleStatus: row.lifecycle_status,
      workshopStatus: row.workshop_status,
      mergedIntoId: row.merged_into_id,
      recordVersion: row.record_version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at === null ? null : row.updated_at.toISOString(),
    };
  }
}
