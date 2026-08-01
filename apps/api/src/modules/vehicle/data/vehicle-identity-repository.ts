/**
 * Vehicle identity write repository (Phase 1-17, FR-VEH-003, P1-17-BE-004).
 *
 * The only place vehicle merge/duplicate SQL lives. Every statement runs through
 * a `DbHandle` and stamps `tenant_id` from the resolved context.
 *
 * ## The merge is one INSERT
 *
 * Recording the merge is a single `INSERT INTO veh.vehicle_merges`: the frozen
 * `tg_vehicle_merges_apply` trigger redirects the source vehicle to the survivor
 * and freezes it in the same statement, and `tg_vehicle_merges_stamp` sets
 * `merged_by` from the session actor. There is no second UPDATE to keep in step —
 * the database makes the redirect atomic with the evidence of it.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { MatchBasisElement } from '../domain/vehicle-identity';

/** The state a merge needs to decide its outcome before touching the database. */
export interface VehicleMergeState {
  readonly lifecycleStatus: string;
  readonly mergedIntoId: string | null;
}

/** A target vehicle's scoring attributes, resolved once per scan. */
export interface VehicleScanProfile {
  readonly vinNormalized: string | null;
  readonly makeId: string | null;
  readonly modelId: string | null;
  readonly modelYear: number | null;
  readonly activePlates: readonly string[];
  readonly historicalPlates: readonly string[];
}

/** A candidate vehicle to compare the target against. */
export interface ComparableVehicle {
  readonly id: string;
  readonly vinNormalized: string | null;
  readonly makeId: string | null;
  readonly modelId: string | null;
  readonly modelYear: number | null;
}

/** A duplicate-candidate row's identity and review state. */
export interface DuplicateCandidateRow {
  readonly id: string;
  readonly status: string;
}

export class VehicleIdentityRepository extends Repository {
  protected readonly module = 'vehicle';

  /** A live (non-deleted) vehicle's merge state, or null when it does not exist
   * in the caller's tenant. */
  async vehicleState(db: DbHandle, vehicleId: string): Promise<VehicleMergeState | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ lifecycle_status: string; merged_into_id: string | null }>(
      db,
      `SELECT lifecycle_status, merged_into_id
         FROM veh.vehicles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId]
    );
    const row = result.rows[0];
    return row ? { lifecycleStatus: row.lifecycle_status, mergedIntoId: row.merged_into_id } : null;
  }

  /**
   * Appends the permanent merge record. `merged_by`/`merged_at`/`seq` are
   * server-stamped by frozen triggers; the AFTER-INSERT trigger performs the
   * source redirect. Returns the merge id, or null on a policy refusal.
   */
  async insertMerge(
    db: DbHandle,
    input: {
      readonly sourceId: string;
      readonly survivorId: string;
      readonly approvalRef: string;
      readonly summary: Record<string, unknown>;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.vehicle_merges
         (tenant_id, source_vehicle_id, survivor_vehicle_id, merge_summary, approval_ref,
          correlation_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.sourceId,
        input.survivorId,
        JSON.stringify(input.summary),
        input.approvalRef,
        context.correlationId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** The target vehicle's scoring attributes, or null when it does not exist in
   * the caller's tenant. Plates come from the full plate history so an
   * active-versus-historical cross-match can be computed. */
  async loadScanProfile(db: DbHandle, vehicleId: string): Promise<VehicleScanProfile | null> {
    const context = this.assertContext(db);
    const vehicle = await this.run<{
      vin_normalized: string | null;
      make_id: string | null;
      model_id: string | null;
      model_year: number | null;
    }>(
      db,
      `SELECT vin_normalized, make_id, model_id, model_year
         FROM veh.vehicles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId]
    );
    const row = vehicle.rows[0];
    if (!row) return null;
    const plates = await this.loadPlates(db, vehicleId);
    return {
      vinNormalized: row.vin_normalized,
      makeId: row.make_id,
      modelId: row.model_id,
      modelYear: row.model_year,
      activePlates: plates.active,
      historicalPlates: plates.historical,
    };
  }

  /** A vehicle's normalized plates split by whether they are still held (active). */
  async loadPlates(
    db: DbHandle,
    vehicleId: string
  ): Promise<{ active: string[]; historical: string[] }> {
    const context = this.assertContext(db);
    const result = await this.run<{ plate_normalized: string; active: boolean }>(
      db,
      `SELECT plate_normalized, (valid_to IS NULL) AS active
         FROM veh.plate_history
        WHERE tenant_id = $1 AND vehicle_id = $2`,
      [context.principal.tenantId, vehicleId]
    );
    const active: string[] = [];
    const historical: string[] = [];
    for (const r of result.rows) (r.active ? active : historical).push(r.plate_normalized);
    return { active, historical };
  }

  /**
   * Bounded set of same-tenant, non-merged, non-deleted vehicles worth comparing:
   * a same-length VIN (a near-VIN prerequisite), an exact make/model/year, or any
   * plate the target has ever held. The precise signals are computed in the domain;
   * this only narrows the field.
   */
  async findComparableVehicles(
    db: DbHandle,
    vehicleId: string,
    profile: VehicleScanProfile,
    limit: number
  ): Promise<readonly ComparableVehicle[]> {
    const context = this.assertContext(db);
    const allPlates = [...profile.activePlates, ...profile.historicalPlates];
    const mmy =
      profile.makeId !== null && profile.modelId !== null && profile.modelYear !== null
        ? profile.makeId
        : null;
    const result = await this.run<{
      id: string;
      vin_normalized: string | null;
      make_id: string | null;
      model_id: string | null;
      model_year: number | null;
    }>(
      db,
      `SELECT id, vin_normalized, make_id, model_id, model_year
         FROM veh.vehicles v
        WHERE v.tenant_id = $1 AND v.id <> $2 AND v.deleted_at IS NULL
          AND v.lifecycle_status <> 'merged'
          AND (
            ($3::text IS NOT NULL AND v.vin_normalized IS NOT NULL
               AND char_length(v.vin_normalized) = $4)
            OR ($5::uuid IS NOT NULL AND v.make_id = $5 AND v.model_id = $6 AND v.model_year = $7)
            OR (cardinality($8::text[]) > 0 AND EXISTS (
                  SELECT 1 FROM veh.plate_history ph
                   WHERE ph.tenant_id = $1 AND ph.vehicle_id = v.id
                     AND ph.plate_normalized = ANY($8)))
          )
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT $9`,
      [
        context.principal.tenantId,
        vehicleId,
        profile.vinNormalized,
        profile.vinNormalized === null ? null : profile.vinNormalized.length,
        mmy,
        profile.modelId,
        profile.modelYear,
        allPlates,
        limit,
      ]
    );
    return result.rows.map((r) => ({
      id: r.id,
      vinNormalized: r.vin_normalized,
      makeId: r.make_id,
      modelId: r.model_id,
      modelYear: r.model_year,
    }));
  }

  /**
   * Records a candidate for an ordered pair, unless one already exists (open or
   * reviewed). The frozen score stands; a re-scan neither reopens a dismissal nor
   * rewrites the immutable `match_score`/`match_basis` — which is why this SELECTs
   * before it INSERTs rather than upserting into an immutable row.
   */
  async upsertCandidate(
    db: DbHandle,
    pair: { a: string; b: string },
    score: number,
    basis: readonly MatchBasisElement[]
  ): Promise<{ id: string; created: boolean }> {
    const context = this.assertContext(db);
    const existing = await this.run<{ id: string }>(
      db,
      `SELECT id FROM veh.duplicate_candidates
        WHERE tenant_id = $1 AND vehicle_id_a = $2 AND vehicle_id_b = $3
        ORDER BY detected_at DESC LIMIT 1`,
      [context.principal.tenantId, pair.a, pair.b]
    );
    const found = existing.rows[0];
    if (found) return { id: found.id, created: false };

    const inserted = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.duplicate_candidates
         (tenant_id, vehicle_id_a, vehicle_id_b, match_score, match_basis, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        pair.a,
        pair.b,
        score.toFixed(4),
        JSON.stringify(basis),
        context.principal.userId,
      ]
    );
    return { id: inserted.rows[0]?.id ?? '', created: true };
  }

  async findCandidate(db: DbHandle, candidateId: string): Promise<DuplicateCandidateRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string; status: string }>(
      db,
      `SELECT id, status FROM veh.duplicate_candidates WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, candidateId]
    );
    const row = result.rows[0];
    return row ? { id: row.id, status: row.status } : null;
  }

  /** Records the review decision; only moves a candidate out of `open`. Returns
   * the number of rows changed (0 when someone else reviewed it first). */
  async reviewCandidate(db: DbHandle, candidateId: string, status: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE veh.duplicate_candidates
          SET status = $3, reviewed_by = $4, reviewed_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'open'`,
      [context.principal.tenantId, candidateId, status, context.principal.userId]
    );
    return result.rowCount ?? 0;
  }
}
