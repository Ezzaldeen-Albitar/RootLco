/**
 * Appointment READ repository (P1-27 remediation, executed by P1-18:
 * `P1-27-INT-019`).
 *
 * All four `apt.` operations were writes; there was no appointment read and no
 * branch calendar of any kind, so the confirmed window an operator was about to
 * move could not even be displayed, and the `If-Match` value the three guarded
 * lifecycle commands demand existed only in a prior write's response.
 *
 * ## The effective window
 *
 * The list's date filter and its ordering both run over the CONFIRMED window
 * falling back to the requested one —
 * `COALESCE(confirmed_from, requested_from)` — because that is the instant the
 * branch actually expects the vehicle: `requested_*` is immutable history of
 * what the customer asked for, and `confirmed_*` is what the workshop promised.
 * A calendar ordered by the requested window would show a rescheduled
 * appointment on the wrong day.
 *
 * Same read conventions as the reception read repository: labels joined for
 * every id, timestamps as millisecond ISO, cursors minted by
 * `cursorTimestamp()` (`P1-27-INT-006`), explicit tenant predicate on every
 * statement.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import type { AppointmentStatus } from '../domain/appointment';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Soonest expected arrival first: a calendar reads forward. The sort key is the
 * effective window's start, with the uuid tie-break that makes the order total.
 */
export const APPOINTMENT_LIST_ORDERING: OrderingContract = {
  key: 'apt.appointments:effective_from_asc',
  direction: 'asc',
};

/** The code-controlled sort expression the ordering contract names. */
const EFFECTIVE_FROM = 'COALESCE(a.confirmed_from, a.requested_from)';

export interface AppointmentDetailRow {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly lifecycleStatus: AppointmentStatus;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  readonly requesterPartnerId: string;
  readonly requesterDisplayName: string | null;
  readonly appointmentTypeId: string;
  readonly appointmentTypeName: string | null;
  readonly sourceChannelId: string | null;
  readonly sourceChannelName: string | null;
  /** What the customer asked for. Immutable forever. */
  readonly requestedFrom: string;
  readonly requestedTo: string;
  /** What the workshop promised. Set only by reschedule. */
  readonly confirmedFrom: string | null;
  readonly confirmedTo: string | null;
  readonly cancellationReasonId: string | null;
  readonly cancellationReasonName: string | null;
  readonly cancelledAt: string | null;
  readonly noShowRecordedAt: string | null;
  /** The ETag, and the `If-Match` the three guarded lifecycle commands demand. */
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export interface AppointmentListEntry {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly lifecycleStatus: AppointmentStatus;
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  readonly requesterPartnerId: string;
  readonly requesterDisplayName: string | null;
  readonly appointmentTypeId: string;
  readonly appointmentTypeName: string | null;
  readonly requestedFrom: string;
  readonly requestedTo: string;
  readonly confirmedFrom: string | null;
  readonly confirmedTo: string | null;
  /** Per row, because the guarded lifecycle commands are addressed from the list. */
  readonly recordVersion: number;
}

export interface AppointmentListFilter {
  readonly companyId: string;
  readonly branchId: string;
  readonly status?: string | undefined;
  readonly vehicleId?: string | undefined;
  /** Inclusive lower bound: the effective window must END at or after this. */
  readonly from?: string | undefined;
  /** Inclusive upper bound: the effective window must START at or before this. */
  readonly to?: string | undefined;
}

export class AppointmentReadRepository extends Repository {
  protected readonly module = 'reception';

  /** The full detail row, or null for absent / deleted / another tenant's. */
  async findAppointmentDetail(
    db: DbHandle,
    appointmentId: string
  ): Promise<AppointmentDetailRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      display_number: string | null;
      lifecycle_status: AppointmentStatus;
      company_id: string;
      branch_id: string;
      vehicle_id: string;
      vehicle_display_number: string | null;
      requester_partner_id: string;
      requester_display_name: string | null;
      appointment_type_id: string;
      appointment_type_name: string | null;
      source_channel_id: string | null;
      source_channel_name: string | null;
      requested_from: Date;
      requested_to: Date;
      confirmed_from: Date | null;
      confirmed_to: Date | null;
      cancellation_reason_id: string | null;
      cancellation_reason_name: string | null;
      cancelled_at: Date | null;
      no_show_recorded_at: Date | null;
      record_version: number;
      created_at: Date;
      updated_at: Date | null;
    }>(
      db,
      `SELECT a.id, a.display_number, a.lifecycle_status, a.company_id, a.branch_id,
              a.vehicle_id, v.display_number AS vehicle_display_number,
              a.requester_partner_id, bp.display_name AS requester_display_name,
              a.appointment_type_id, t.name AS appointment_type_name,
              a.source_channel_id, sc.name AS source_channel_name,
              a.requested_from, a.requested_to, a.confirmed_from, a.confirmed_to,
              a.cancellation_reason_id, cr.name AS cancellation_reason_name,
              a.cancelled_at, a.no_show_recorded_at,
              a.record_version, a.created_at, a.updated_at
         FROM apt.appointments a
         LEFT JOIN veh.vehicles v ON v.tenant_id = a.tenant_id AND v.id = a.vehicle_id
         LEFT JOIN crm.business_partners bp
           ON bp.tenant_id = a.tenant_id AND bp.id = a.requester_partner_id
         LEFT JOIN apt.appointment_types t ON t.id = a.appointment_type_id
         LEFT JOIN apt.source_channels sc ON sc.id = a.source_channel_id
         LEFT JOIN apt.cancellation_reasons cr ON cr.id = a.cancellation_reason_id
        WHERE a.tenant_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`,
      [context.principal.tenantId, appointmentId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      displayNumber: row.display_number,
      lifecycleStatus: row.lifecycle_status,
      companyId: row.company_id,
      branchId: row.branch_id,
      vehicleId: row.vehicle_id,
      vehicleDisplayNumber: row.vehicle_display_number,
      requesterPartnerId: row.requester_partner_id,
      requesterDisplayName: row.requester_display_name,
      appointmentTypeId: row.appointment_type_id,
      appointmentTypeName: row.appointment_type_name,
      sourceChannelId: row.source_channel_id,
      sourceChannelName: row.source_channel_name,
      requestedFrom: row.requested_from.toISOString(),
      requestedTo: row.requested_to.toISOString(),
      confirmedFrom: iso(row.confirmed_from),
      confirmedTo: iso(row.confirmed_to),
      cancellationReasonId: row.cancellation_reason_id,
      cancellationReasonName: row.cancellation_reason_name,
      cancelledAt: iso(row.cancelled_at),
      noShowRecordedAt: iso(row.no_show_recorded_at),
      recordVersion: row.record_version,
      createdAt: row.created_at.toISOString(),
      updatedAt: iso(row.updated_at),
    };
  }

  /**
   * One branch's appointments over a date range, soonest effective start first.
   *
   * The range is an OVERLAP test against the effective window — an appointment
   * belongs to every day it touches — and either bound may be absent. Company
   * and branch are REQUIRED for the same authorization reason as every branch
   * list (P1-18-A-01). Filters are bound as `($n::type IS NULL OR …)` so the
   * keyset parameter index is fixed and no predicate is assembled from input.
   */
  async listAppointments(
    db: DbHandle,
    filter: AppointmentListFilter,
    page: PageRequest
  ): Promise<Page<AppointmentListEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
      filter.vehicleId ?? null,
      filter.from ?? null,
      filter.to ?? null,
    ];
    const keyset = keysetFragment(
      page,
      { sort: EFFECTIVE_FROM, id: 'a.id' },
      APPOINTMENT_LIST_ORDERING,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      display_number: string | null;
      lifecycle_status: AppointmentStatus;
      vehicle_id: string;
      vehicle_display_number: string | null;
      requester_partner_id: string;
      requester_display_name: string | null;
      appointment_type_id: string;
      appointment_type_name: string | null;
      requested_from: Date;
      requested_to: Date;
      confirmed_from: Date | null;
      confirmed_to: Date | null;
      record_version: number;
      effective_from_cursor: string;
    }>(
      db,
      `SELECT a.id, a.display_number, a.lifecycle_status, a.vehicle_id,
              v.display_number AS vehicle_display_number,
              a.requester_partner_id, bp.display_name AS requester_display_name,
              a.appointment_type_id, t.name AS appointment_type_name,
              a.requested_from, a.requested_to, a.confirmed_from, a.confirmed_to,
              a.record_version,
              ${cursorTimestamp(EFFECTIVE_FROM)} AS effective_from_cursor
         FROM apt.appointments a
         LEFT JOIN veh.vehicles v ON v.tenant_id = a.tenant_id AND v.id = a.vehicle_id
         LEFT JOIN crm.business_partners bp
           ON bp.tenant_id = a.tenant_id AND bp.id = a.requester_partner_id
         LEFT JOIN apt.appointment_types t ON t.id = a.appointment_type_id
        WHERE a.tenant_id = $1 AND a.company_id = $2 AND a.branch_id = $3
          AND a.deleted_at IS NULL
          AND ($4::text IS NULL OR a.lifecycle_status = $4)
          AND ($5::uuid IS NULL OR a.vehicle_id = $5)
          AND ($6::timestamptz IS NULL OR COALESCE(a.confirmed_to, a.requested_to) >= $6)
          AND ($7::timestamptz IS NULL OR COALESCE(a.confirmed_from, a.requested_from) <= $7)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          id: row.id,
          displayNumber: row.display_number,
          lifecycleStatus: row.lifecycle_status,
          vehicleId: row.vehicle_id,
          vehicleDisplayNumber: row.vehicle_display_number,
          requesterPartnerId: row.requester_partner_id,
          requesterDisplayName: row.requester_display_name,
          appointmentTypeId: row.appointment_type_id,
          appointmentTypeName: row.appointment_type_name,
          requestedFrom: row.requested_from.toISOString(),
          requestedTo: row.requested_to.toISOString(),
          confirmedFrom: iso(row.confirmed_from),
          confirmedTo: iso(row.confirmed_to),
          recordVersion: row.record_version,
        },
        sortValue: row.effective_from_cursor,
        id: row.id,
      })),
      page,
      APPOINTMENT_LIST_ORDERING
    );
  }
}
