/**
 * Appointment repository (Phase 1-18, P1-18-BE-001…P1-18-BE-004).
 *
 * The only place `apt.appointments` SQL is written. `tenant_id` and `created_by`
 * are stamped from the request context and never accepted from a caller. Four
 * frozen Phase 1-8 guarantees carry the statements below:
 *
 *  - `confirmed_range` is GENERATED from `confirmed_from`/`confirmed_to`, so a
 *    reschedule writes the two endpoints and the same-vehicle overlap EXCLUDE
 *    (`ex_appointments_vehicle_confirmed`) decides the outcome, arriving as 23P01.
 *  - `record_version`, `updated_at`, and `updated_by` are set by
 *    `tg_appointments_touch_metadata`, so no UPDATE writes them by hand. The
 *    caller's expected version appears in the WHERE clause instead: a stale value
 *    writes zero rows rather than overwriting a concurrent change.
 *  - `requested_from` / `requested_to` are immutable, so nothing here touches
 *    them. What the customer asked for survives every lifecycle command.
 *  - `apt.emit_appointment_status_history` appends the history row on every
 *    status UPDATE, which is why the lifecycle methods write the master only.
 *
 * `cancelled_by` and `no_show_recorded_by` are the exception to the trigger rule:
 * they are ordinary evidence columns with no trigger behind them, so the actor is
 * written explicitly and the coherence CHECKs are satisfied in the same statement
 * as the status change.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { AppointmentCreatePlan } from '../domain/appointment';

/** The state a lifecycle command needs before it decides anything. */
export interface AppointmentLockRow {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly recordVersion: number;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
}

export class AppointmentRepository extends Repository {
  protected readonly module = 'reception';

  /** Inserts an appointment at the head of the lifecycle. Returns the id. */
  async insert(
    db: DbHandle,
    input: { readonly plan: AppointmentCreatePlan; readonly displayNumber: string | null }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const { plan } = input;
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO apt.appointments
         (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id,
          appointment_type_id, source_channel_id, requested_from, requested_to,
          confirmed_from, confirmed_to, lifecycle_status, display_number, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        context.principal.tenantId,
        plan.companyId,
        plan.branchId,
        plan.vehicleId,
        plan.requesterPartnerId,
        plan.appointmentTypeId,
        plan.sourceChannelId,
        plan.requestedFrom,
        plan.requestedTo,
        plan.confirmedFrom,
        plan.confirmedTo,
        plan.lifecycleStatus,
        input.displayNumber,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Locks the live appointment for the rest of the transaction. Returns null when
   * the appointment does not exist, is deleted, or belongs to another tenant —
   * the three cases the caller reports identically, so possession of an id proves
   * nothing about the row behind it.
   */
  async lockForUpdate(db: DbHandle, appointmentId: string): Promise<AppointmentLockRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      lifecycle_status: string;
      record_version: number;
      company_id: string;
      branch_id: string;
      vehicle_id: string;
    }>(
      db,
      `SELECT id, lifecycle_status, record_version, company_id, branch_id, vehicle_id
         FROM apt.appointments
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, appointmentId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          lifecycleStatus: row.lifecycle_status,
          recordVersion: row.record_version,
          companyId: row.company_id,
          branchId: row.branch_id,
          vehicleId: row.vehicle_id,
        }
      : null;
  }

  /**
   * Moves the confirmed window. Returns rows changed: 0 means the caller's
   * `record_version` was stale, which the service reports as a conflict.
   */
  async setConfirmedWindow(
    db: DbHandle,
    appointmentId: string,
    confirmedFrom: string,
    confirmedTo: string,
    expectedVersion: number,
    nextStatus: string | null
  ): Promise<number> {
    const context = this.assertContext(db);
    // `nextStatus` is written in the SAME statement as the window, never in a
    // follow-up UPDATE. `ck_appointments_confirmed_required` demands that a
    // confirmed appointment already carry a confirmed window, so splitting the
    // two would make the intermediate row one PostgreSQL refuses to hold.
    const result = await this.run(
      db,
      `UPDATE apt.appointments
          SET confirmed_from = $4,
              confirmed_to = $5,
              lifecycle_status = COALESCE($6, lifecycle_status)
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        appointmentId,
        expectedVersion,
        confirmedFrom,
        confirmedTo,
        nextStatus,
      ]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Cancels the appointment. The reason and the timestamp are written in the same
   * statement as the status because `ck_appointments_cancel_coherent` makes them
   * one fact: a cancelled appointment without both is not a row PostgreSQL will
   * hold. Returns rows changed.
   */
  async cancel(
    db: DbHandle,
    appointmentId: string,
    cancellationReasonId: string,
    expectedVersion: number
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE apt.appointments
          SET lifecycle_status = 'cancelled', cancellation_reason_id = $4,
              cancelled_at = now(), cancelled_by = $5
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        appointmentId,
        expectedVersion,
        cancellationReasonId,
        context.principal.userId,
      ]
    );
    return result.rowCount ?? 0;
  }

  /** Records a no-show, with its own evidence columns. Returns rows changed. */
  async recordNoShow(
    db: DbHandle,
    appointmentId: string,
    expectedVersion: number
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE apt.appointments
          SET lifecycle_status = 'no_show', no_show_recorded_at = now(),
              no_show_recorded_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND deleted_at IS NULL`,
      [context.principal.tenantId, appointmentId, expectedVersion, context.principal.userId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Consumes the appointment as a check-in. No version predicate: this runs
   * inside the reception transaction that already holds the row lock, and the
   * caller is checking a vehicle in rather than editing an appointment, so there
   * is no client-held version to assert. Returns rows changed.
   */
  async markCheckedIn(db: DbHandle, appointmentId: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE apt.appointments
          SET lifecycle_status = 'checked_in'
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, appointmentId]
    );
    return result.rowCount ?? 0;
  }
}
