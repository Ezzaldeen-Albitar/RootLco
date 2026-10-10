/**
 * Vehicle search — repository (Phase 1-17, FR-VEH-001, P1-13-BE-003; widened
 * P1-32).
 *
 * The only place vehicle-search SQL is written. Runs through a `DbHandle`, so it
 * cannot execute without a resolved context, and every predicate is a bound
 * parameter. On top of RLS default-deny it carries an explicit `tenant_id`
 * predicate (defence in depth) and excludes soft-deleted vehicles.
 *
 * Bounded by construction: VIN matches the generated `vin_normalized` column
 * exactly; make, model and free-text fragments are folded CONTAINS matches served
 * by the trigram indexes added with this slice; a plate matches any row of
 * `veh.plate_history`, normalised on the SQL side with `veh.normalize_plate` so
 * the query fragment and the stored value are compared under the same frozen
 * rule. The result is keyset-ordered by `(created_at DESC, id DESC)` with a fetch
 * of `limit + 1` — one page, never an offset walk. The projection is the safe
 * master view only; no restricted identifier column is selected.
 *
 * ## Three lateral joins, and why each is a lateral
 *
 * `activePlate`, `plateMatch` and the owner's name are all "at most one row
 * related to this vehicle". A plain join would multiply the page by the number of
 * plate-history or ownership rows and then need a DISTINCT to undo it, which is
 * how a paged read starts returning short pages. `LEFT JOIN LATERAL … LIMIT 1`
 * says exactly what is meant and runs once per row of the page, never once per
 * row of the table.
 *
 * ## The owner's name is asked for only when the caller may have it
 *
 * `docs/database/veh-ownership-visibility-matrix.md` gives a holder of vehicle
 * read the ownership partner's uuid and withholds the CRM columns beside it. So
 * the lateral that resolves the name is APPENDED ONLY when the caller also holds
 * `crm.customer.read` — a caller who does not gets a null, and the query does not
 * touch `crm.business_partners` at all. That mirrors
 * `CustomerReadRepository.mayReadCustomers`, which closed `P1-27-INT-025`.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
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
  readonly merged_into_id: string | null;
  readonly make_name: string | null;
  readonly model_name: string | null;
  readonly active_plate: string | null;
  readonly matched_plate: string | null;
  readonly matched_plate_active: boolean | null;
  readonly matched_plate_valid_from: string | null;
  readonly matched_plate_valid_to: string | null;
  readonly customer_display_name: string | null;
  /** The same instant at microsecond precision, for the cursor only. */
  readonly created_at_cursor: string;
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
    // Milliseconds, for DISPLAY. Never fed back as a cursor — that is the
    // defect `P1-27-INT-008` closes.
    createdAt: row.created_at.toISOString(),
    // Published because search RETURNS merged vehicles (`lifecycle_status`
    // `'merged'`) and, unlike the detail read, gave a caller no way to know what
    // a merged row was merged into. Selecting one from a result list made every
    // subsequent write answer 409 with nothing on screen explaining why.
    mergedIntoId: row.merged_into_id,
    makeName: row.make_name,
    modelName: row.model_name,
    activePlate: row.active_plate,
    plateMatch:
      row.matched_plate === null ||
      row.matched_plate_active === null ||
      row.matched_plate_valid_from === null
        ? null
        : {
            plate: row.matched_plate,
            active: row.matched_plate_active,
            validFrom: row.matched_plate_valid_from,
            validTo: row.matched_plate_valid_to,
          },
    customerDisplayName: row.customer_display_name,
  };
}

export class VehicleSearchRepository extends Repository {
  protected readonly module = 'vehicle';

  /**
   * Whether this caller may be told a customer's name.
   *
   * Asked of the database rather than recomputed here, because the database is
   * what actually decides; a second implementation of "does this caller hold it"
   * could disagree with the policy that matters.
   */
  async mayReadCustomers(db: DbHandle): Promise<boolean> {
    const result = await this.run<{ allowed: boolean }>(
      db,
      `SELECT iam.has_permission('crm.customer.read') AS allowed`
    );
    return result.rows[0]?.allowed === true;
  }

  async search(
    db: DbHandle,
    page: PageRequest,
    filter: VehicleSearchFilter,
    mayReadCustomers: boolean
  ): Promise<Page<VehicleSearchHit>> {
    const context = this.assertContext(db);
    const where: string[] = ['v.tenant_id = $1', 'v.deleted_at IS NULL'];
    const values: unknown[] = [context.principal.tenantId];
    let param = 2;

    /** Where the plate fragments land, so the `plateMatch` lateral can reuse them. */
    let platePlaceholder: number | null = null;
    let freeTextPlatePlaceholder: number | null = null;

    if (filter.hasVin) {
      // Exact match on the generated, normalised VIN. A supplied VIN that
      // normalised to null (implausible input) matches nothing, which is the
      // correct answer — not a dropped filter.
      where.push(`v.vin_normalized = $${param}`);
      values.push(filter.vinNormalized);
      param += 1;
    }
    if (filter.plateRaw !== null) {
      // EVERY plate the vehicle has ever carried, not just the active one
      // (P1-32). Normalised on the column side with the same frozen function the
      // stored value was generated from. Tenant-scoped inside the subquery as
      // well as by the outer predicate and RLS.
      platePlaceholder = param;
      where.push(
        `EXISTS (
           SELECT 1 FROM veh.plate_history ph
            WHERE ph.tenant_id = v.tenant_id
              AND ph.vehicle_id = v.id
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
    if (filter.makeFragment !== null) {
      where.push(`shared.fold_search_text(mk.name) LIKE '%' || $${param} || '%' ESCAPE '\\'`);
      values.push(filter.makeFragment);
      param += 1;
    }
    if (filter.modelFragment !== null) {
      where.push(`shared.fold_search_text(md.name) LIKE '%' || $${param} || '%' ESCAPE '\\'`);
      values.push(filter.modelFragment);
      param += 1;
    }
    if (filter.freeText !== null) {
      // One box, five arms: the two catalogue names, the vehicle's own number,
      // the VIN and any plate it has carried. Each arm is the same predicate its
      // dedicated parameter would produce, so `q` can never find something a
      // named parameter could not.
      const arms = [
        `shared.fold_search_text(mk.name) LIKE '%' || $${param} || '%' ESCAPE '\\'`,
        `shared.fold_search_text(md.name) LIKE '%' || $${param} || '%' ESCAPE '\\'`,
        `shared.fold_search_text(v.display_number) LIKE '%' || $${param} || '%' ESCAPE '\\'`,
      ];
      values.push(filter.freeText);
      param += 1;
      // The identifier arms, and their parameters, exist only when the box reduced
      // to something under that identifier's rule. Binding a value no placeholder
      // references is not harmless: PostgreSQL cannot infer the type of an
      // unreferenced parameter and refuses the whole statement.
      if (filter.freeTextVin !== '') {
        arms.push(`v.vin_normalized LIKE '%' || $${param} || '%'`);
        values.push(filter.freeTextVin);
        param += 1;
      }
      if (filter.freeTextPlate !== '') {
        freeTextPlatePlaceholder = param;
        arms.push(
          `EXISTS (
             SELECT 1 FROM veh.plate_history ph
              WHERE ph.tenant_id = v.tenant_id
                AND ph.vehicle_id = v.id
                AND ph.plate_normalized LIKE '%' || $${param} || '%')`
        );
        values.push(filter.freeTextPlate);
        param += 1;
      }
      where.push(`(${arms.join(' OR ')})`);
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

    // Which plate row to report as the match. The exact `plate` arm wins over the
    // free-text one when both were supplied, because that is the question the
    // caller asked most precisely. When neither was supplied there is nothing to
    // report and the lateral is omitted entirely rather than left to return an
    // arbitrary plate.
    const plateMatchArms: string[] = [];
    if (platePlaceholder !== null) {
      plateMatchArms.push(`ph.plate_normalized = veh.normalize_plate($${platePlaceholder})`);
    }
    if (freeTextPlatePlaceholder !== null) {
      plateMatchArms.push(`ph.plate_normalized LIKE '%' || $${freeTextPlatePlaceholder} || '%'`);
    }
    const plateMatchJoin =
      plateMatchArms.length === 0
        ? `LEFT JOIN LATERAL (SELECT NULL::text AS plate_raw, NULL::boolean AS active,
                                    NULL::text AS valid_from, NULL::text AS valid_to) pm ON true`
        : `LEFT JOIN LATERAL (
             SELECT ph.plate_raw,
                    ph.valid_to IS NULL AS active,
                    ph.valid_from::text AS valid_from,
                    ph.valid_to::text AS valid_to
               FROM veh.plate_history ph
              WHERE ph.tenant_id = v.tenant_id
                AND ph.vehicle_id = v.id
                AND (${plateMatchArms.join(' OR ')})
              ORDER BY (ph.valid_to IS NULL) DESC, ph.valid_from DESC, ph.id DESC
              LIMIT 1) pm ON true`;

    // The owner's name, only for a caller who may have it. The withheld shape is
    // a typed NULL rather than an omitted column, so the row shape published to
    // the wire is the same either way and no consumer has to branch on it.
    const ownerJoin = mayReadCustomers
      ? `LEFT JOIN LATERAL (
           SELECT bp.display_name
             FROM veh.ownership_history oh
             JOIN crm.business_partners bp
               ON bp.tenant_id = oh.tenant_id AND bp.id = oh.partner_id
              AND bp.deleted_at IS NULL
            WHERE oh.tenant_id = v.tenant_id
              AND oh.vehicle_id = v.id
              AND oh.valid_to IS NULL
            ORDER BY oh.valid_from DESC, oh.id DESC
            LIMIT 1) own ON true`
      : `LEFT JOIN LATERAL (SELECT NULL::text AS display_name) own ON true`;

    const keyset = keysetFragment(
      page,
      { sort: 'v.created_at', id: 'v.id' },
      VEHICLE_SEARCH_ORDERING,
      param
    );
    values.push(...keyset.values);

    // `created_at_cursor` is the SAME instant as `created_at`, rendered with
    // microsecond precision by PostgreSQL rather than by a JS `Date`. See
    // `cursorTimestamp` and `P1-27-INT-008`: the published `createdAt` stays a
    // millisecond ISO string for display, and the CURSOR is minted from this
    // column instead. Vehicles created in one transaction share `created_at` to
    // the microsecond, so paging with a truncated cursor lost rows every time,
    // not occasionally.
    //
    // The two catalogue joins are LEFT joins on purpose: a make or model that is
    // soft-deleted, or belongs to another tenant's catalogue, must leave the
    // vehicle in the result with a null name rather than drop it from the page.
    const sql = `
      SELECT v.id, v.display_number, v.vin_normalized, v.make_id, v.model_id, v.model_year,
             v.powertrain_category, v.lifecycle_status, v.workshop_status, v.created_at,
             v.merged_into_id,
             mk.name AS make_name,
             md.name AS model_name,
             act.plate_raw AS active_plate,
             pm.plate_raw AS matched_plate,
             pm.active AS matched_plate_active,
             pm.valid_from AS matched_plate_valid_from,
             pm.valid_to AS matched_plate_valid_to,
             own.display_name AS customer_display_name,
             ${cursorTimestamp('v.created_at')} AS created_at_cursor
        FROM veh.vehicles v
        LEFT JOIN veh.makes mk ON mk.id = v.make_id AND mk.deleted_at IS NULL
        LEFT JOIN veh.models md ON md.id = v.model_id AND md.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT ph.plate_raw
            FROM veh.plate_history ph
           WHERE ph.tenant_id = v.tenant_id
             AND ph.vehicle_id = v.id
             AND ph.valid_to IS NULL
           ORDER BY ph.valid_from DESC, ph.id DESC
           LIMIT 1) act ON true
        ${plateMatchJoin}
        ${ownerJoin}
       WHERE ${where.join(' AND ')} ${keyset.predicate}
       ${keyset.order}
       ${keyset.limitClause}`;

    const result = await this.run<VehicleRow>(db, sql, values);
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toHit(row),
        sortValue: row.created_at_cursor,
        id: row.id,
      })),
      page,
      VEHICLE_SEARCH_ORDERING
    );
  }
}
