/**
 * Reception-visit repository (Phase 1-18, P1-18-BE-005…P1-18-BE-010,
 * P1-18-BE-018).
 *
 * The only place `rec` master and party SQL is written. Every statement carries
 * `tenant_id` from the request context in addition to RLS, and the actor comes
 * from the context, never from a caller.
 *
 * Check-in is delegated to the frozen `rec.accept_check_in()` primitive rather
 * than hand-rolled. That function inserts the visit, the mandatory
 * `service_requester` party role, the initial `accepted` custody event, and the
 * initial status-history row in one statement. Splitting those four apart here
 * would create a second authority over an invariant the database already owns,
 * and would leave a window in which a visit exists with no custody record. It is
 * SECURITY INVOKER and reads the actor and tenant from the transaction GUCs, so
 * it runs under exactly the caller's RLS.
 *
 * Two other frozen facts shape the rest:
 *
 *  - `record_version`, `updated_at`, and `updated_by` are set by
 *    `tg_reception_visits_touch_metadata` (and its party-role twin), so no UPDATE
 *    writes them by hand; the expected version is a WHERE predicate instead.
 *  - party-role identity columns are immutable, so a role change is a
 *    supersession — close the open interval, insert the replacement — and
 *    `rec.authorizations` is INSERT+SELECT only, so a decision is superseded by a
 *    later row and never edited.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type {
  AuthorizationChannel,
  AuthorizationDecision,
  AuthorizingRole,
  ReceptionPartyRole,
  ReceptionStatus,
} from '../domain/reception';

/** The state a reception command needs before it decides anything. */
export interface ReceptionVisitLockRow {
  readonly id: string;
  readonly receptionStatus: string;
  readonly recordVersion: number;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
}

/** Arguments of the frozen `rec.accept_check_in()` primitive, in its order. */
export interface AcceptCheckInArgs {
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  /** Exactly one origin is non-null (`ck_reception_visits_one_origin`). */
  readonly appointmentId: string | null;
  readonly walkInId: string | null;
  readonly receivingEmployeeId: string;
  readonly serviceRequesterPartnerId: string;
  readonly odometerReadingId: string | null;
  readonly fuelLevelId: string | null;
  readonly evSocPercent: number | null;
  readonly displayNumber: string | null;
}

export class ReceptionRepository extends Repository {
  protected readonly module = 'reception';

  /**
   * Records the walk-in arrival a visit will consume. A walk-in is a first-class
   * origin record, not an appointment with the calendar fields left empty, so it
   * carries no window and no lifecycle. Returns the id.
   */
  async insertWalkIn(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly vehicleId: string;
      readonly requesterPartnerId: string | null;
      readonly note: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.walk_in_references
         (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.vehicleId,
        input.requesterPartnerId,
        input.note,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Runs the atomic accepted-check-in primitive. Returns the new visit id.
   *
   * The primitive takes no tenant argument — it reads `iam.current_tenant_id()`
   * and `iam.current_user_id()` from the transaction GUCs — so the context guard
   * is asserted explicitly here rather than being implied by a tenant predicate.
   */
  async acceptCheckIn(db: DbHandle, args: AcceptCheckInArgs): Promise<string | null> {
    this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT rec.accept_check_in(
                $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
                $7::uuid, $8::uuid, $9::uuid, $10::numeric, $11::text
              ) AS id`,
      [
        args.companyId,
        args.branchId,
        args.vehicleId,
        args.appointmentId,
        args.walkInId,
        args.receivingEmployeeId,
        args.serviceRequesterPartnerId,
        args.odometerReadingId,
        args.fuelLevelId,
        args.evSocPercent,
        args.displayNumber,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Locks the live visit for the rest of the transaction. This lock is what makes
   * approval and conversion exactly-once: two concurrent attempts serialise here
   * and the second one reads the state the first one left. Returns null when the
   * visit is absent, deleted, or outside the caller's scope.
   */
  async lockVisit(db: DbHandle, receptionVisitId: string): Promise<ReceptionVisitLockRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      reception_status: string;
      record_version: number;
      company_id: string;
      branch_id: string;
      vehicle_id: string;
    }>(
      db,
      `SELECT id, reception_status, record_version, company_id, branch_id, vehicle_id
         FROM rec.reception_visits
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, receptionVisitId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          receptionStatus: row.reception_status,
          recordVersion: row.record_version,
          companyId: row.company_id,
          branchId: row.branch_id,
          vehicleId: row.vehicle_id,
        }
      : null;
  }

  /**
   * Moves the visit to `nextStatus`. Returns rows changed.
   *
   * A null `expectedVersion` omits the version predicate. Approval walks
   * `opened -> inspecting -> authorized` inside one transaction, and the touch
   * trigger advances `record_version` on the first hop, so re-asserting the
   * caller's version on the second would refuse a change nothing raced. The row
   * lock taken before the first hop is what keeps that safe: no other transaction
   * can slip between the two.
   */
  async setStatus(
    db: DbHandle,
    receptionVisitId: string,
    nextStatus: ReceptionStatus,
    expectedVersion: number | null
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE rec.reception_visits
          SET reception_status = $4
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
          AND ($3::integer IS NULL OR record_version = $3)`,
      [context.principal.tenantId, receptionVisitId, expectedVersion, nextStatus]
    );
    return result.rowCount ?? 0;
  }

  /** Assigns a dated party role on the visit. Returns the id. */
  async insertPartyRole(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly receptionVisitId: string;
      readonly partnerId: string;
      readonly relationshipRole: ReceptionPartyRole;
      readonly assignmentSource: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.reception_party_roles
         (tenant_id, company_id, branch_id, reception_visit_id, partner_id,
          relationship_role, assignment_source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.partnerId,
        input.relationshipRole,
        input.assignmentSource,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Closes the open interval of a role assignment. `valid_to IS NULL` in the
   * WHERE is the optimistic half: a concurrent close writes zero rows and is
   * reported as a conflict rather than silently moving an interval that was
   * already closed. Returns rows changed.
   */
  async closePartyRole(
    db: DbHandle,
    input: {
      readonly receptionVisitId: string;
      readonly partnerId: string;
      readonly relationshipRole: ReceptionPartyRole;
    }
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE rec.reception_party_roles
          SET valid_to = now()
        WHERE tenant_id = $1 AND reception_visit_id = $2 AND partner_id = $3
          AND relationship_role = $4 AND valid_to IS NULL AND deleted_at IS NULL`,
      [context.principal.tenantId, input.receptionVisitId, input.partnerId, input.relationshipRole]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Appends an authorization decision. `rec.guard_authorization_authority` is the
   * authority on whether the partner may decide at all — it requires an active
   * role in the authorizing set on this visit — so this statement asserts nothing
   * about authority itself. Returns the id.
   */
  async insertAuthorization(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly receptionVisitId: string;
      readonly authorizingRole: AuthorizingRole;
      readonly partnerId: string;
      readonly decision: AuthorizationDecision;
      readonly channel: AuthorizationChannel;
      readonly authorizedScope: Record<string, unknown> | null;
      readonly evidenceDocumentId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    // `ck_authorizations_scope_object` accepts a JSON object or NULL; a
    // serialised null would be the JSON value `null`, which is neither.
    const scope = input.authorizedScope === null ? null : JSON.stringify(input.authorizedScope);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.authorizations
         (tenant_id, company_id, branch_id, reception_visit_id, authorizing_role,
          partner_id, decision, channel, authorized_scope, evidence_document_id,
          correlation_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.authorizingRole,
        input.partnerId,
        input.decision,
        input.channel,
        scope,
        input.evidenceDocumentId,
        context.correlationId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }
}
