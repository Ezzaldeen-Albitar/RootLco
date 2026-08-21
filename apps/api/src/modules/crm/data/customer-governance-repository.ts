/**
 * CRM customer governance repository (Phase 1-16, P1-16-BE-008…012).
 *
 * Notes, alerts, tags, lifecycle status, and restrictions.
 *
 * Three tables here are **append-only** by grant, not by convention:
 * `crm.partner_status_history`, `crm.customer_block_history`, and
 * `crm.consent_history` carry `SELECT, INSERT` for `app_runtime` and no UPDATE
 * at all. So the history cannot be rewritten even by a defect in this file — the
 * database will not permit the statement. That is the property the whole
 * accountability story rests on, and it is worth stating where the SQL lives.
 *
 * Notes live in `shared.notes` under the capability DBCR-P1-16-001 granted:
 * INSERT on a closed column list, UPDATE on body/classification/visibility/
 * deleted_at only, and **no DELETE**. The policies additionally pin
 * `author_id = iam.current_user_id()` and
 * `entity_type = 'crm.business_partners'`, so this repository cannot forge an
 * author or attach a note to a non-CRM entity even if it tried.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  CUSTOMER_NOTE_ENTITY_TYPE,
  type AlertSeverity,
  type AlertType,
  type NoteClassification,
  type NoteVisibility,
  type RestrictionType,
  type SettableLifecycleState,
} from '../domain/customer-governance';

export interface NoteInsert {
  readonly body: string;
  readonly classification: NoteClassification;
  readonly visibility: NoteVisibility;
}

export interface AlertInsert {
  readonly alertType: AlertType;
  readonly severity: AlertSeverity;
  readonly message: string;
}

export interface RestrictionInsert {
  readonly restrictionType: RestrictionType;
  readonly reason: string;
  readonly approvalRef: string | null;
}

export class CustomerGovernanceRepository extends Repository {
  protected readonly module = 'crm';

  /** Current lifecycle state, or `null` when the customer is not reachable. */
  async currentLifecycle(
    db: DbHandle,
    customerId: string
  ): Promise<{ lifecycleStatus: string; recordVersion: number } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ lifecycle_status: string; record_version: number }>(
      db,
      `SELECT lifecycle_status, record_version FROM crm.business_partners
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND merged_into_id IS NULL`,
      [context.principal.tenantId, customerId]
    );
    const row = result.rows[0];
    return row
      ? { lifecycleStatus: row.lifecycle_status, recordVersion: row.record_version }
      : null;
  }

  // -- Notes ---------------------------------------------------------------

  /**
   * Inserts a note with a **client-generated** id and no `RETURNING`.
   *
   * `sel_notes_tenant` only exposes `public`/`internal` notes to a caller
   * without `iam.sensitive.view`. Under `FORCE ROW LEVEL SECURITY` a
   * `RETURNING` clause is evaluated against that SELECT policy, so writing a
   * `restricted` note and reading its id back in one statement is refused — the
   * author could not see the row they just wrote. Supplying the id (which
   * DBCR-P1-16-001 grants for exactly this reason) keeps the write legal
   * without widening read access to sensitive notes by one row.
   */
  async insertNote(db: DbHandle, customerId: string, input: NoteInsert): Promise<string | null> {
    const context = this.assertContext(db);
    const id = crypto.randomUUID();
    const result = await this.run(
      db,
      `INSERT INTO shared.notes
         (id, tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5)`,
      [
        id,
        context.principal.tenantId,
        CUSTOMER_NOTE_ENTITY_TYPE,
        customerId,
        context.principal.userId,
        input.body,
        input.classification,
        input.visibility,
      ]
    );
    return (result.rowCount ?? 0) === 1 ? id : null;
  }

  // -- Alerts --------------------------------------------------------------

  async insertAlert(db: DbHandle, customerId: string, input: AlertInsert): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      // `effective_from` is NOT NULL and server-set: an alert is in force from
      // the moment it is raised, not from a date the caller nominates.
      `INSERT INTO crm.customer_alerts
         (tenant_id, partner_id, alert_type, severity, message, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, current_date, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        customerId,
        input.alertType,
        input.severity,
        input.message,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // -- Tags (segments) -----------------------------------------------------

  /**
   * Finds or creates the tenant's segment for `code`, then assigns it.
   *
   * A tag is modelled as a *segment* plus an *assignment* because that is what
   * the schema provides, and it is the better model anyway: the segment carries
   * the tenant's definition of what the tag means, so two staff members typing
   * the same label get the same concept rather than two look-alike strings.
   */
  async ensureSegment(db: DbHandle, code: string, name: string): Promise<string> {
    const context = this.assertContext(db);
    const existing = await this.run<{ id: string }>(
      db,
      `SELECT id FROM crm.customer_segments
        WHERE tenant_id = $1 AND segment_code = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, code]
    );
    const found = existing.rows[0]?.id;
    if (found) return found;

    const created = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.customer_segments (tenant_id, segment_code, name, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [context.principal.tenantId, code, name, context.principal.userId]
    );
    return created.rows[0]?.id ?? '';
  }

  /** Returns `null` when the customer already carries the tag. */
  async assignSegment(db: DbHandle, customerId: string, segmentId: string): Promise<string | null> {
    const context = this.assertContext(db);
    const existing = await this.run<{ id: string }>(
      db,
      `SELECT id FROM crm.partner_segment_assignments
        WHERE tenant_id = $1 AND partner_id = $2 AND segment_id = $3`,
      [context.principal.tenantId, customerId, segmentId]
    );
    if (existing.rows[0]) return null;

    const result = await this.run<{ id: string }>(
      db,
      // `valid_from` is NOT NULL: a tag applies from when it was assigned.
      `INSERT INTO crm.partner_segment_assignments
         (tenant_id, partner_id, segment_id, assigned_by, valid_from, created_by)
       VALUES ($1, $2, $3, $4, current_date, $4)
       RETURNING id`,
      [context.principal.tenantId, customerId, segmentId, context.principal.userId]
    );
    return result.rows[0]?.id ?? null;
  }

  // -- Lifecycle status ----------------------------------------------------

  /**
   * Moves the lifecycle state under optimistic concurrency.
   *
   * The `record_version` predicate is what makes two simultaneous status changes
   * safe: the loser updates zero rows and is told so, rather than silently
   * overwriting a decision it never saw.
   */
  async updateLifecycle(
    db: DbHandle,
    customerId: string,
    expectedVersion: number,
    to: SettableLifecycleState
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE crm.business_partners
          SET lifecycle_status = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3
          AND deleted_at IS NULL AND merged_into_id IS NULL`,
      [context.principal.tenantId, customerId, expectedVersion, to]
    );
    return result.rowCount ?? 0;
  }

  /** Appends the status transition. INSERT-only by grant; never rewritten. */
  async appendStatusHistory(
    db: DbHandle,
    customerId: string,
    input: { from: string; to: string; reason: string }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.partner_status_history
         (tenant_id, partner_id, status_kind, from_state, to_state, reason, actor_id, correlation_id)
       VALUES ($1, $2, 'lifecycle', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        context.principal.tenantId,
        customerId,
        input.from,
        input.to,
        input.reason,
        context.principal.userId,
        context.correlationId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // -- Restrictions --------------------------------------------------------

  async insertRestriction(
    db: DbHandle,
    customerId: string,
    input: RestrictionInsert
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.customer_restrictions
         (tenant_id, partner_id, restriction_type, reason, imposed_by, approval_ref,
          effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, current_date, $5)
       RETURNING id`,
      [
        context.principal.tenantId,
        customerId,
        input.restrictionType,
        input.reason,
        context.principal.userId,
        input.approvalRef,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Appends the block-history entry. INSERT-only by grant. */
  async appendBlockHistory(
    db: DbHandle,
    customerId: string,
    input: {
      action: 'blocked' | 'unblocked';
      reason: string;
      restrictionId: string | null;
      approvalRef: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.customer_block_history
         (tenant_id, partner_id, action, reason, restriction_id, approval_ref, actor_id, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        customerId,
        input.action,
        input.reason,
        input.restrictionId,
        input.approvalRef,
        context.principal.userId,
        context.correlationId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }
}
