/**
 * Vehicle registration repository (Phase 1-17, P1-17-BE-006, P1-17-BE-007).
 *
 * The only place plate-history and ownership-history SQL is written. `tenant_id`
 * and the actor are stamped from context; `plate_normalized`, `record_version`,
 * and metadata are set by frozen generated columns / triggers. A transfer closes
 * the open interval optimistically (`WHERE valid_to IS NULL`) so a concurrent
 * transfer that already closed it writes zero rows and is reported as a conflict
 * rather than silently double-closed. The temporal EXCLUDE constraints on both
 * tables are the final arbiter of overlap (surfaced as 23P01).
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { buildPage, keysetFragment, type Page, type PageRequest } from '@/server/db/pagination';
import {
  OWNERSHIP_HISTORY_ORDERING,
  PLATE_HISTORY_ORDERING,
  type OwnershipKind,
} from '../domain/vehicle-registration';

export interface VehicleRegState {
  readonly lifecycleStatus: string;
}
export interface IntervalRow {
  readonly id: string;
}

export interface PlateHistoryHit {
  readonly id: string;
  readonly countryCode: string;
  readonly plate: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly active: boolean;
  readonly createdAt: string;
}
export interface OwnershipHistoryHit {
  readonly id: string;
  readonly partnerId: string;
  readonly ownershipKind: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly active: boolean;
  readonly createdAt: string;
}

export class VehicleRegistrationRepository extends Repository {
  protected readonly module = 'vehicle';

  /** The live vehicle's lifecycle, or null when absent in the caller's tenant. */
  async vehicleState(db: DbHandle, vehicleId: string): Promise<VehicleRegState | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ lifecycle_status: string }>(
      db,
      `SELECT lifecycle_status FROM veh.vehicles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, vehicleId]
    );
    return result.rows[0] ? { lifecycleStatus: result.rows[0].lifecycle_status } : null;
  }

  // ---- Plate history ------------------------------------------------------

  async currentActivePlate(db: DbHandle, vehicleId: string): Promise<IntervalRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT id FROM veh.plate_history
        WHERE tenant_id = $1 AND vehicle_id = $2 AND valid_to IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, vehicleId]
    );
    return result.rows[0] ? { id: result.rows[0].id } : null;
  }

  /** Closes an open plate interval at the effective date. Returns rows changed. */
  async closePlate(db: DbHandle, plateId: string, effectiveDate: string | null): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE veh.plate_history
          SET valid_to = COALESCE($3::date, current_date)
        WHERE tenant_id = $1 AND id = $2 AND valid_to IS NULL`,
      [context.principal.tenantId, plateId, effectiveDate]
    );
    return result.rowCount ?? 0;
  }

  async insertPlate(
    db: DbHandle,
    input: {
      vehicleId: string;
      countryCode: string;
      plateRaw: string;
      effectiveDate: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.plate_history
         (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, current_date), $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.vehicleId,
        input.countryCode,
        input.plateRaw,
        input.effectiveDate,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  async listPlates(
    db: DbHandle,
    vehicleId: string,
    page: PageRequest
  ): Promise<Page<PlateHistoryHit>> {
    const context = this.assertContext(db);
    const keyset = keysetFragment(
      page,
      { sort: 'created_at', id: 'id' },
      PLATE_HISTORY_ORDERING,
      3
    );
    const result = await this.run<{
      id: string;
      country_code: string;
      plate_normalized: string;
      valid_from: string;
      valid_to: string | null;
      created_at: Date;
    }>(
      db,
      `SELECT id, country_code, plate_normalized, valid_from::text AS valid_from,
              valid_to::text AS valid_to, created_at
         FROM veh.plate_history
        WHERE tenant_id = $1 AND vehicle_id = $2 ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [context.principal.tenantId, vehicleId, ...keyset.values]
    );
    return buildPage(
      result.rows.map((r) => ({
        id: r.id,
        countryCode: r.country_code,
        plate: r.plate_normalized,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        active: r.valid_to === null,
        createdAt: r.created_at.toISOString(),
      })),
      page,
      PLATE_HISTORY_ORDERING,
      (hit) => ({ sortValue: hit.createdAt, id: hit.id })
    );
  }

  // ---- Ownership history --------------------------------------------------

  async currentOwner(
    db: DbHandle,
    vehicleId: string,
    ownershipKind: OwnershipKind
  ): Promise<IntervalRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT id FROM veh.ownership_history
        WHERE tenant_id = $1 AND vehicle_id = $2 AND ownership_kind = $3 AND valid_to IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, vehicleId, ownershipKind]
    );
    return result.rows[0] ? { id: result.rows[0].id } : null;
  }

  async closeOwner(db: DbHandle, ownerId: string, effectiveDate: string | null): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE veh.ownership_history
          SET valid_to = COALESCE($3::date, current_date)
        WHERE tenant_id = $1 AND id = $2 AND valid_to IS NULL`,
      [context.principal.tenantId, ownerId, effectiveDate]
    );
    return result.rowCount ?? 0;
  }

  async insertOwnership(
    db: DbHandle,
    input: {
      vehicleId: string;
      partnerId: string;
      ownershipKind: OwnershipKind;
      effectiveDate: string | null;
      transferReason: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.ownership_history
         (tenant_id, vehicle_id, partner_id, ownership_kind, valid_from, transfer_reason, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, current_date), $6, $7)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.vehicleId,
        input.partnerId,
        input.ownershipKind,
        input.effectiveDate,
        input.transferReason,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  async listOwnerships(
    db: DbHandle,
    vehicleId: string,
    page: PageRequest
  ): Promise<Page<OwnershipHistoryHit>> {
    const context = this.assertContext(db);
    const keyset = keysetFragment(
      page,
      { sort: 'created_at', id: 'id' },
      OWNERSHIP_HISTORY_ORDERING,
      3
    );
    const result = await this.run<{
      id: string;
      partner_id: string;
      ownership_kind: string;
      valid_from: string;
      valid_to: string | null;
      created_at: Date;
    }>(
      db,
      `SELECT id, partner_id, ownership_kind, valid_from::text AS valid_from,
              valid_to::text AS valid_to, created_at
         FROM veh.ownership_history
        WHERE tenant_id = $1 AND vehicle_id = $2 ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [context.principal.tenantId, vehicleId, ...keyset.values]
    );
    return buildPage(
      result.rows.map((r) => ({
        id: r.id,
        partnerId: r.partner_id,
        ownershipKind: r.ownership_kind,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        active: r.valid_to === null,
        createdAt: r.created_at.toISOString(),
      })),
      page,
      OWNERSHIP_HISTORY_ORDERING,
      (hit) => ({ sortValue: hit.createdAt, id: hit.id })
    );
  }
}
