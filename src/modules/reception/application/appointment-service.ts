/**
 * Appointment lifecycle — application service (Phase 1-18, P1-18-BE-001…
 * P1-18-BE-004).
 *
 * Four commands over one master row. Each is one controlled transaction:
 * allocate (creation only), lock, decide, write, audit, publish. The row, the
 * `apt.appointment_status_history` entry its trigger appends when the status
 * actually moves, the audit record, and the outbox envelope commit together or
 * not at all — so an announced appointment always exists, and an existing one is
 * always announceable.
 *
 * ## What the frozen `apt` schema decides, and how each refusal surfaces
 *
 *  - `requested_from` / `requested_to` are immutable, so a reschedule moves the
 *    CONFIRMED window. It deliberately leaves `lifecycle_status` alone: changing
 *    it here would be a lifecycle transition wearing a reschedule's clothes, and
 *    the status ledger would record a confirmation nobody requested.
 *  - `ex_appointments_vehicle_confirmed` is the only authority on same-vehicle
 *    overlap. It is a PARTIAL exclusion covering `confirmed` and `checked_in`
 *    rows, so it bites when an already-confirmed appointment is moved onto a
 *    window another confirmed appointment for the same vehicle holds. It arrives
 *    as `23P01` and becomes `ERR-RES-002` (409), never a driver error.
 *  - the caller's `record_version` is a WHERE predicate, so a stale view writes
 *    zero rows instead of overwriting a concurrent change (`ERR-CON-001`).
 *  - a missing, deleted, or out-of-scope appointment is `ERR-RES-001` —
 *    indistinguishable from the cross-tenant case by design, because possession
 *    of an id proves nothing about the row behind it.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, sqlState, SQLSTATE } from '@/server/db/repository';
import type { AppointmentRepository } from '../data/appointment-repository';
import {
  APPOINTMENT_TRANSITIONS,
  AppointmentRuleError,
  assertCancellable,
  assertNoShowRecordable,
  assertReschedulable,
  toAppointmentCreatePlan,
  toReschedulePlan,
  type AppointmentCreateInput,
  type AppointmentStatus,
  type CancelInput,
  type RescheduleInput,
} from '../domain/appointment';

/**
 * The slice of shared numbering this module needs.
 *
 * Declared structurally rather than by importing the concrete service, so the
 * reception application layer depends on a capability instead of on another
 * module's class. The reception and conversion services take this same port, so
 * the module has one allocator contract; the composition root supplies the real
 * implementation from `@/modules/shared-services`.
 */
export interface DisplayNumberAllocator {
  isProvisioned(db: DbHandle, input: { readonly sequenceCode: string }): Promise<boolean>;
  allocate(
    db: DbHandle,
    input: { readonly sequenceCode: string }
  ): Promise<{ readonly displayNumber: string }>;
}

/** Sequence that renders an appointment number. Registered in the shared registry. */
const APPOINTMENT_SEQUENCE = 'appointment';

/** The four facts one `appointment.changed` envelope carries. */
export type AppointmentChangeKind = 'booked' | 'rescheduled' | 'cancelled' | 'no_show_recorded';

export interface AppointmentCreated {
  readonly appointmentId: string;
  /** `null` when the tenant has not provisioned an appointment-number sequence. */
  readonly displayNumber: string | null;
  readonly lifecycleStatus: AppointmentStatus;
  readonly recordVersion: number;
}

export interface AppointmentChanged {
  readonly appointmentId: string;
  readonly changeKind: AppointmentChangeKind;
  readonly lifecycleStatus: AppointmentStatus;
  readonly recordVersion: number;
}

export class AppointmentService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly numbers: DisplayNumberAllocator
  ) {
    super();
  }

  async create(db: DbHandle, input: AppointmentCreateInput): Promise<AppointmentCreated> {
    const plan = this.planOrFail(() => toAppointmentCreatePlan(input), 'body');

    // Allocated inside the caller's transaction, so a rolled-back creation does
    // not burn an appointment number. Provisioning is an operator action
    // (`app_runtime` holds no INSERT on `shared.number_sequences`), so an
    // unprovisioned tenant is a supported state rather than a failure: the
    // appointment exists, it simply carries no human-facing number yet. The
    // tenant-wide sequence is requested — narrowing to the company or branch
    // would silently yield no number unless one is provisioned at that exact
    // scope, which is a decision for an operator, not for this request.
    const displayNumber = (await this.numbers.isProvisioned(db, {
      sequenceCode: APPOINTMENT_SEQUENCE,
    }))
      ? (await this.numbers.allocate(db, { sequenceCode: APPOINTMENT_SEQUENCE })).displayNumber
      : null;

    let appointmentId: string | null;
    try {
      appointmentId = await this.appointments.insert(db, { plan, displayNumber });
    } catch (error) {
      throw this.mapWriteFailure(error);
    }
    if (!appointmentId) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Appointment creation was refused by policy',
      });
    }

    await appendAudit(db, {
      action: 'apt.appointment.created',
      entityType: 'apt.appointment',
      entityId: appointmentId,
      details: [
        { field: 'vehicle_id', classification: 'internal', value: plan.vehicleId },
        { field: 'lifecycle_status', classification: 'public', value: plan.lifecycleStatus },
        { field: 'display_number', classification: 'public', value: displayNumber },
      ],
    });

    // `record_version` starts at 1 on insert (column default), so the first
    // envelope for an appointment always names version 1.
    await this.announce(db, appointmentId, 'booked', plan.lifecycleStatus, 1);

    return {
      appointmentId,
      displayNumber,
      lifecycleStatus: plan.lifecycleStatus,
      recordVersion: 1,
    };
  }

  async reschedule(
    db: DbHandle,
    appointmentId: string,
    expectedVersion: number,
    input: RescheduleInput
  ): Promise<AppointmentChanged> {
    const current = await this.requireAppointment(db, appointmentId);
    const window = this.planOrFail(() => toReschedulePlan(input), 'body.confirmedFrom');
    assertReschedulable(current.lifecycleStatus);

    // Setting a firm window IS confirming. Canonical UC-APT-001 is a single use
    // case, "Confirm or reschedule appointment", and the frozen lifecycle has no
    // separate confirm step - `confirmed` is simply the state in which a window
    // has been agreed. So an appointment still at `requested` or
    // `pending_confirmation` moves to `confirmed` here, and one already
    // `confirmed` keeps its status while the window moves.
    //
    // This is load-bearing rather than cosmetic. `confirmed` is the state that
    // reserves constrained capacity (BR-APT-001): the same-vehicle overlap
    // EXCLUDE is PARTIAL on `lifecycle_status IN ('confirmed','checked_in')`, and
    // both no-show and appointment-originated check-in are reachable only from
    // `confirmed`. Without this transition the conflict detection FR-APT-002
    // requires could never fire, and two of the phase's own operations would be
    // unreachable through the API.
    const status: AppointmentStatus =
      current.lifecycleStatus === 'confirmed'
        ? 'confirmed'
        : (APPOINTMENT_TRANSITIONS[current.lifecycleStatus] ?? []).includes('confirmed')
          ? 'confirmed'
          : (current.lifecycleStatus as AppointmentStatus);
    const nextStatus = status === current.lifecycleStatus ? null : status;

    const recordVersion = await this.applyOrFail(expectedVersion, () =>
      this.appointments.setConfirmedWindow(
        db,
        appointmentId,
        window.confirmedFrom,
        window.confirmedTo,
        expectedVersion,
        nextStatus
      )
    );

    await appendAudit(db, {
      action: 'apt.appointment.rescheduled',
      entityType: 'apt.appointment',
      entityId: appointmentId,
      details: [
        { field: 'confirmed_from', classification: 'internal', value: window.confirmedFrom },
        { field: 'confirmed_to', classification: 'internal', value: window.confirmedTo },
        { field: 'lifecycle_status', classification: 'public', value: status },
      ],
    });
    await this.announce(db, appointmentId, 'rescheduled', status, recordVersion);

    return { appointmentId, changeKind: 'rescheduled', lifecycleStatus: status, recordVersion };
  }

  async cancel(
    db: DbHandle,
    appointmentId: string,
    expectedVersion: number,
    input: CancelInput
  ): Promise<AppointmentChanged> {
    const current = await this.requireAppointment(db, appointmentId);
    assertCancellable(current.lifecycleStatus);

    const recordVersion = await this.applyOrFail(expectedVersion, () =>
      this.appointments.cancel(db, appointmentId, input.cancellationReasonId, expectedVersion)
    );

    await appendAudit(db, {
      action: 'apt.appointment.cancelled',
      entityType: 'apt.appointment',
      entityId: appointmentId,
      details: [
        {
          field: 'lifecycle_status',
          classification: 'public',
          previousValue: current.lifecycleStatus,
          value: 'cancelled',
        },
        {
          field: 'cancellation_reason_id',
          classification: 'internal',
          value: input.cancellationReasonId,
        },
      ],
    });
    await this.announce(db, appointmentId, 'cancelled', 'cancelled', recordVersion);

    return {
      appointmentId,
      changeKind: 'cancelled',
      lifecycleStatus: 'cancelled',
      recordVersion,
    };
  }

  async recordNoShow(
    db: DbHandle,
    appointmentId: string,
    expectedVersion: number
  ): Promise<AppointmentChanged> {
    const current = await this.requireAppointment(db, appointmentId);
    assertNoShowRecordable(current.lifecycleStatus);

    const recordVersion = await this.applyOrFail(expectedVersion, () =>
      this.appointments.recordNoShow(db, appointmentId, expectedVersion)
    );

    await appendAudit(db, {
      action: 'apt.appointment.no_show_recorded',
      entityType: 'apt.appointment',
      entityId: appointmentId,
      details: [
        {
          field: 'lifecycle_status',
          classification: 'public',
          previousValue: current.lifecycleStatus,
          value: 'no_show',
        },
      ],
    });
    await this.announce(db, appointmentId, 'no_show_recorded', 'no_show', recordVersion);

    return {
      appointmentId,
      changeKind: 'no_show_recorded',
      lifecycleStatus: 'no_show',
      recordVersion,
    };
  }

  /** Locks the appointment for the rest of the transaction, or reports a 404. */
  private async requireAppointment(
    db: DbHandle,
    appointmentId: string
  ): Promise<{ readonly lifecycleStatus: string }> {
    const row = await this.appointments.lockForUpdate(db, appointmentId);
    if (!row) {
      throw new AppFailure('ERR-RES-001', { message: 'Appointment was not found' });
    }
    return row;
  }

  /**
   * Publishes the one `appointment.changed` envelope every command emits.
   *
   * A single event type covers booking, rescheduling, cancellation, and no-show
   * because a consumer's reaction is the same in all four: re-read the
   * appointment. The key carries the RESULTING `record_version` rather than the
   * change kind — `shared.touch_row_metadata` advances the version by exactly
   * one per UPDATE, so the version identifies this specific change, whereas a
   * kind-based key would make a second legitimate reschedule collide with the
   * first.
   */
  private async announce(
    db: DbHandle,
    appointmentId: string,
    changeKind: AppointmentChangeKind,
    lifecycleStatus: AppointmentStatus,
    recordVersion: number
  ): Promise<void> {
    await publishEvent(db, {
      eventType: 'appointment.changed',
      aggregateId: appointmentId,
      aggregateVersion: recordVersion,
      producer: 'apt.appointment-service',
      payload: {
        appointmentId,
        changeKind,
        lifecycleStatus,
        // No vehicle, no requester, no window: a consumer that needs any of them
        // reads the appointment under its own authorization.
      },
      eventKey: `appointment.changed:${appointmentId}:${recordVersion}`,
    });
  }

  /**
   * Runs a versioned UPDATE, refuses a stale caller, and returns the version the
   * row now carries.
   *
   * Zero rows changed means the `record_version` predicate did not match, which
   * is the concurrency loss `ERR-CON-001` exists for: the caller re-reads and
   * decides again with the winner's outcome visible, and nothing is overwritten.
   * On success the resulting version is `expectedVersion + 1` — the touch trigger
   * advances it by exactly one per UPDATE — so the envelope can name it without a
   * second read.
   */
  private async applyOrFail(expectedVersion: number, run: () => Promise<number>): Promise<number> {
    let changed: number;
    try {
      changed = await run();
    } catch (error) {
      throw this.mapWriteFailure(error);
    }
    if (changed === 0) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The appointment changed while this request was in flight; retry',
      });
    }
    return expectedVersion + 1;
  }

  /** Maps the frozen `apt` guard SQLSTATEs to stable problems; re-throws the rest. */
  private mapWriteFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
      // A row-level policy refused the write - the caller's grant does not reach
      // this company/branch. That is an authorization outcome, so it must leave
      // as one. Letting 42501 fall through would report a denial as ERR-SYS-001,
      // and route-handler sends every 5xx to the exception monitor, so any
      // authenticated caller could manufacture unlimited incidents by writing
      // outside their own branch.
      return new AppFailure('ERR-IAM-001', {
        message: 'This appointment is outside the scope your access grants',
      });
    }
    if (sqlState(error) === '23P01') {
      // ex_appointments_vehicle_confirmed. Named plainly: the caller can move the
      // window, and no other appointment's identifiers are disclosed.
      return new AppFailure('ERR-RES-002', {
        message: 'A confirmed appointment already overlaps this window for this vehicle',
      });
    }
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // uq_appointments_active_display_number: the allocated number is already on
      // a live appointment, which a retry resolves because the next allocation
      // moves the counter on.
      return new AppFailure('ERR-CON-001', {
        message: 'The allocated appointment number is already in use; retry the request',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'A referenced record is not visible to this tenant',
        safeDetails: { violations: [{ path: 'body', rule: 'unknown_reference' }] },
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // apt.guard_appointment_catalog_refs (an appointment type or source channel
      // that does not belong to this branch), the window CHECKs, or the
      // transition guard the domain assertions already pre-checked.
      return new AppFailure('ERR-VAL-001', {
        message: 'The appointment references or window are not coherent',
        safeDetails: { violations: [{ path: 'body', rule: 'incoherent_reference' }] },
      });
    }
    return error;
  }

  /**
   * Turns a domain rule violation into the platform's validation problem.
   *
   * The reception domain errors carry a message but no field path — unlike the
   * vehicle module's, they are plain `Error` subclasses — so the path is supplied
   * by the call site, which is the layer that knows which request field it was
   * validating. Inventing a path inside the domain would be worse than passing
   * one in: it would be a guess presented as a contract.
   */
  private planOrFail<T>(build: () => T, path: string): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof AppointmentRuleError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path, rule: 'invalid_value' }] },
          cause: error,
        });
      }
      throw error;
    }
  }
}
