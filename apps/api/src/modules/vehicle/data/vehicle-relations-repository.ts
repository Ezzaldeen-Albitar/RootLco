/**
 * Vehicle relations repository (Phase 1-17, P1-17-BE-008, P1-17-BE-009).
 *
 * Reads `veh.vehicle_relationships` (the single source of truth, vehicle-centric)
 * and writes exactly one distinct fact: an authorized party. `tenant_id`,
 * `created_by`, and `granted_by` are stamped from context; the overlap EXCLUDE and
 * the `authorization_scope` CHECK are the database authority.
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
  AUTHORIZATION_SCHEMA_VERSION,
  RELATIONSHIP_ORDERING,
  type AuthorizedAction,
} from '../domain/vehicle-relations';

export interface RelationsVehicleState {
  readonly lifecycleStatus: string;
}
/**
 * One relationship row as this repository reads it — with a partner *id* and no
 * partner *name*, because `veh` owns no CRM table.
 *
 * The name is added by the service through the CRM module's public surface
 * (`namePartners`, `P1-27-INT-025`), which returns `Named<RelationshipHit>`.
 * Declaring the name fields here as optional was the earlier shape and it was
 * unsound: an un-named row satisfied the published type, so a read that forgot
 * to resolve would compile and ship the uuid.
 */
export interface RelationshipHit {
  readonly id: string;
  readonly partnerId: string;
  readonly relationshipRole: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly active: boolean;
  readonly allowedActions: readonly string[] | null;
  readonly createdAt: string;
}

export class VehicleRelationsRepository extends Repository {
  protected readonly module = 'vehicle';

  async vehicleState(db: DbHandle, vehicleId: string): Promise<RelationsVehicleState | null> {
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

  async insertAuthorizedParty(
    db: DbHandle,
    input: {
      vehicleId: string;
      partnerId: string;
      allowedActions: readonly AuthorizedAction[];
      effectiveDate: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const scope = JSON.stringify({
      schema_version: AUTHORIZATION_SCHEMA_VERSION,
      allowed_actions: input.allowedActions,
    });
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.vehicle_relationships
         (tenant_id, vehicle_id, partner_id, relationship_role, valid_from,
          authorization_scope, granted_by, created_by)
       VALUES ($1, $2, $3, 'authorized_person', COALESCE($4::date, current_date),
               $5::jsonb, $6, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.vehicleId,
        input.partnerId,
        input.effectiveDate,
        scope,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** An open authorized-person relationship for this vehicle, or null. */
  async findOpenAuthorizedParty(
    db: DbHandle,
    vehicleId: string,
    relationshipId: string
  ): Promise<{ id: string } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT id FROM veh.vehicle_relationships
        WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3
          AND relationship_role = 'authorized_person' AND valid_to IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, vehicleId, relationshipId]
    );
    return result.rows[0] ? { id: result.rows[0].id } : null;
  }

  async closeRelationship(
    db: DbHandle,
    relationshipId: string,
    effectiveDate: string | null
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE veh.vehicle_relationships
          SET valid_to = COALESCE($3::date, current_date)
        WHERE tenant_id = $1 AND id = $2 AND valid_to IS NULL`,
      [context.principal.tenantId, relationshipId, effectiveDate]
    );
    return result.rowCount ?? 0;
  }

  async listRelationships(
    db: DbHandle,
    vehicleId: string,
    page: PageRequest
  ): Promise<Page<RelationshipHit>> {
    const context = this.assertContext(db);
    const keyset = keysetFragment(page, { sort: 'created_at', id: 'id' }, RELATIONSHIP_ORDERING, 3);
    const result = await this.run<{
      id: string;
      partner_id: string;
      relationship_role: string;
      valid_from: string;
      valid_to: string | null;
      allowed_actions: string[] | null;
      created_at: Date;
      created_at_cursor: string;
    }>(
      db,
      // `valid_from`/`valid_to` are `date` and are read `::text` so a day is
      // never shifted by a timezone. The cursor is a `timestamptz` and needs the
      // opposite treatment — full microsecond precision (`P1-27-INT-008`).
      `SELECT id, partner_id, relationship_role, valid_from::text AS valid_from,
              valid_to::text AS valid_to,
              CASE WHEN authorization_scope IS NULL THEN NULL
                   ELSE ARRAY(SELECT jsonb_array_elements_text(authorization_scope -> 'allowed_actions'))
              END AS allowed_actions,
              created_at,
              ${cursorTimestamp('created_at')} AS created_at_cursor
         FROM veh.vehicle_relationships
        WHERE tenant_id = $1 AND vehicle_id = $2 ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [context.principal.tenantId, vehicleId, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((r) => ({
        item: {
          id: r.id,
          partnerId: r.partner_id,
          relationshipRole: r.relationship_role,
          validFrom: r.valid_from,
          validTo: r.valid_to,
          active: r.valid_to === null,
          allowedActions: r.allowed_actions,
          createdAt: r.created_at.toISOString(),
        },
        sortValue: r.created_at_cursor,
        id: r.id,
      })),
      page,
      RELATIONSHIP_ORDERING
    );
  }
}
