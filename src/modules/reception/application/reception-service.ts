/**
 * Reception visit — application service (Phase 1-18, P1-18-BE-005…P1-18-BE-010,
 * P1-18-BE-018).
 *
 * Check-in, party roles, authorization decisions, and approval. All four run
 * inside the transaction the route already opened, so the visit, the custody
 * acceptance, the status ledger, the audit record, and the outbox envelope commit
 * together or not at all.
 *
 * ## Check-in is delegated, not re-implemented
 *
 * `rec.accept_check_in()` inserts the visit, the mandatory `service_requester`
 * party role, the initial `accepted` custody event, and the initial status-history
 * row in one statement. Consuming the origin around it is this service's job:
 * a walk-in origin is recorded first, and an appointment origin is locked,
 * checked for eligibility, and then marked `checked_in`. Splitting the primitive
 * apart would create a second authority over an invariant the database owns and
 * would leave a window in which a visit exists with no custody record.
 *
 * ## The origin and the body must agree on scope
 *
 * For an appointment origin the appointment's own company, branch, and vehicle are
 * authoritative, AND the body must name the same company and branch. The equality
 * requirement is the security boundary, not a convenience: `authorizationTarget`
 * is derived from the body before the transaction opens, so a divergent body meant
 * authorizing one branch and writing in another. The composite foreign key does
 * NOT catch that — it only binds the visit to its appointment, which a wrong-branch
 * row satisfies coherently. See `resolveOrigin` for the full account.
 *
 * ## Approval walks the frozen graph
 *
 * `authorized` is reachable only from `inspecting`, so approving a visit that is
 * still `opened` applies both legal edges in order inside one transaction. The
 * row lock taken first is what makes that safe and makes approval exactly-once.
 * The activation preconditions — an active service requester AND an approved
 * authorization — belong to `rec.guard_reception_transition` and are not
 * duplicated here; its refusal arrives as `23514` and becomes `ERR-TRN-001`.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { AppointmentRepository } from '../data/appointment-repository';
import type { ReceptionRepository, ReceptionVisitLockRow } from '../data/reception-repository';
import { assertCheckInEligible } from '../domain/appointment';
import {
  ReceptionRuleError,
  approvalPath,
  assertApprovable,
  assertAuthorizingRoleHeld,
  assertEvidenceRecordable,
  assertStandingAuthorization,
  toReceptionCreatePlan,
  type AuthorizationChannel,
  type AuthorizationDecision,
  type AuthorizingRole,
  type ReceptionCreateInput,
  type ReceptionCreatePlan,
  type ReceptionPartyRole,
  type ReceptionStatus,
} from '../domain/reception';
import type { DisplayNumberAllocator } from './appointment-service';

/** Sequence that renders a reception number. Registered in the shared registry. */
const RECEPTION_SEQUENCE = 'reception_visit';

export interface PartyRoleInput {
  readonly partnerId: string;
  readonly relationshipRole: ReceptionPartyRole;
  readonly assignmentSource?: string | null | undefined;
  /**
   * Close the party's currently open interval in this role before inserting the
   * replacement. Role identity columns are immutable, so a change is a
   * supersession rather than an edit; without this flag a repeat assignment is
   * refused as a duplicate instead of silently re-dating history.
   */
  readonly supersede?: boolean | undefined;
}

export interface AuthorizationInput {
  readonly authorizingRole: AuthorizingRole;
  readonly partnerId: string;
  readonly decision: AuthorizationDecision;
  readonly channel?: AuthorizationChannel | undefined;
  readonly authorizedScope?: Record<string, unknown> | null | undefined;
  readonly evidenceDocumentId?: string | null | undefined;
}

export interface ReceptionCreated {
  readonly receptionVisitId: string;
  /** `null` when the tenant has not provisioned a reception-number sequence. */
  readonly displayNumber: string | null;
  readonly receptionStatus: ReceptionStatus;
  readonly origin: 'appointment' | 'walk_in';
  readonly recordVersion: number;
}

export interface PartyRoleAssigned {
  readonly receptionVisitId: string;
  readonly partyRoleId: string;
  readonly relationshipRole: ReceptionPartyRole;
  /** True when a prior open interval in the same role was closed first. */
  readonly superseded: boolean;
}

export interface AuthorizationRecorded {
  readonly receptionVisitId: string;
  readonly authorizationId: string;
  readonly decision: AuthorizationDecision;
}

export interface ReceptionApproved {
  readonly receptionVisitId: string;
  readonly receptionStatus: 'authorized';
  /** The legal edges this request applied, in order. */
  readonly appliedTransitions: readonly ReceptionStatus[];
  readonly recordVersion: number;
}

/** The origin a check-in consumes, resolved to the scope the visit inherits. */
interface ResolvedOrigin {
  readonly kind: 'appointment' | 'walk_in';
  readonly appointmentId: string | null;
  readonly walkInId: string | null;
  readonly companyId: string;
  readonly branchId: string;
}

export class ReceptionService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(
    private readonly receptions: ReceptionRepository,
    private readonly appointments: AppointmentRepository,
    private readonly numbers: DisplayNumberAllocator
  ) {
    super();
  }

  async create(db: DbHandle, input: ReceptionCreateInput): Promise<ReceptionCreated> {
    const plan = this.planOrFail(() => toReceptionCreatePlan(input), 'body');
    const origin = await this.resolveOrigin(db, plan);

    // Same contract as the appointment number: allocated in the caller's
    // transaction so a rollback does not burn one, and an unprovisioned tenant
    // gets a visit with no human-facing number rather than a failed check-in.
    const displayNumber = (await this.numbers.isProvisioned(db, {
      sequenceCode: RECEPTION_SEQUENCE,
    }))
      ? (await this.numbers.allocate(db, { sequenceCode: RECEPTION_SEQUENCE })).displayNumber
      : null;

    let receptionVisitId: string | null;
    try {
      receptionVisitId = await this.receptions.acceptCheckIn(db, {
        companyId: origin.companyId,
        branchId: origin.branchId,
        vehicleId: plan.vehicleId,
        appointmentId: origin.appointmentId,
        walkInId: origin.walkInId,
        receivingEmployeeId: plan.receivingEmployeeId,
        serviceRequesterPartnerId: plan.serviceRequesterPartnerId,
        odometerReadingId: plan.odometerReadingId,
        fuelLevelId: plan.fuelLevelId,
        evSocPercent: plan.evSocPercent,
        displayNumber,
      });
    } catch (error) {
      throw this.mapCheckInFailure(error);
    }
    if (!receptionVisitId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Check-in was refused by policy' });
    }

    if (origin.appointmentId !== null) {
      // The appointment is consumed only once the visit exists, so a failure
      // leaves neither the visit nor a `checked_in` appointment behind. No
      // version predicate: the appointment row is already locked by this
      // transaction, so zero rows can only mean the UPDATE policy refused it.
      const marked = await this.appointments.markCheckedIn(db, origin.appointmentId);
      if (marked === 0) {
        throw new AppFailure('ERR-IAM-001', {
          message: 'Consuming the appointment as a check-in was refused by policy',
        });
      }
    }

    await appendAudit(db, {
      action: 'rec.reception.created',
      entityType: 'rec.reception_visit',
      entityId: receptionVisitId,
      companyId: origin.companyId,
      branchId: origin.branchId,
      details: [
        { field: 'origin', classification: 'public', value: origin.kind },
        { field: 'vehicle_id', classification: 'internal', value: plan.vehicleId },
        { field: 'display_number', classification: 'public', value: displayNumber },
      ],
    });

    await publishEvent(db, {
      eventType: 'vehicle.checked-in',
      aggregateId: receptionVisitId,
      // `record_version` starts at 1 on insert (column default).
      aggregateVersion: 1,
      producer: 'rec.reception-service',
      payload: {
        receptionVisitId,
        vehicleId: plan.vehicleId,
        originKind: origin.kind,
        receptionStatus: 'opened',
        // No requester, no odometer, no contents: a consumer that needs them
        // reads the visit under its own authorization.
      },
      eventKey: `vehicle.checked-in:${receptionVisitId}`,
    });

    return {
      receptionVisitId,
      displayNumber,
      receptionStatus: 'opened',
      origin: origin.kind,
      recordVersion: 1,
    };
  }

  async assignPartyRole(
    db: DbHandle,
    receptionVisitId: string,
    input: PartyRoleInput
  ): Promise<PartyRoleAssigned> {
    const visit = await this.requireVisit(db, receptionVisitId);
    assertEvidenceRecordable(visit.receptionStatus);
    // `assignment_source` carries only a non-blank CHECK, so a blank value is
    // normalised to absent rather than refused: a blank string and no value at all
    // mean the same thing here, and storing the former would satisfy no reader.
    const trimmedSource = input.assignmentSource?.trim() ?? '';
    const assignmentSource = trimmedSource.length === 0 ? null : trimmedSource;

    let superseded = false;
    if (input.supersede === true) {
      const closed = await this.closeOrFail(() =>
        this.receptions.closePartyRole(db, {
          receptionVisitId,
          partnerId: input.partnerId,
          relationshipRole: input.relationshipRole,
        })
      );
      // Zero rows is not an error: there was simply no open interval to close, so
      // this is a first assignment that happened to ask for supersession.
      superseded = closed > 0;
    }

    let partyRoleId: string | null;
    try {
      partyRoleId = await this.receptions.insertPartyRole(db, {
        companyId: visit.companyId,
        branchId: visit.branchId,
        receptionVisitId,
        partnerId: input.partnerId,
        relationshipRole: input.relationshipRole,
        assignmentSource,
      });
    } catch (error) {
      throw this.mapPartyRoleFailure(error);
    }
    if (!partyRoleId) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Party-role assignment was refused by policy',
      });
    }

    await appendAudit(db, {
      action: 'rec.reception.party_role_assigned',
      entityType: 'rec.reception_party_role',
      entityId: partyRoleId,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        { field: 'reception_visit_id', classification: 'internal', value: receptionVisitId },
        { field: 'partner_id', classification: 'internal', value: input.partnerId },
        { field: 'relationship_role', classification: 'public', value: input.relationshipRole },
        { field: 'superseded', classification: 'public', value: String(superseded) },
      ],
    });

    return {
      receptionVisitId,
      partyRoleId,
      relationshipRole: input.relationshipRole,
      superseded,
    };
  }

  async recordAuthorization(
    db: DbHandle,
    receptionVisitId: string,
    input: AuthorizationInput
  ): Promise<AuthorizationRecorded> {
    const visit = await this.requireVisit(db, receptionVisitId);
    assertEvidenceRecordable(visit.receptionStatus);

    // The database proves the partner MAY decide; it never checks that the role
    // they claim is one they hold. `authorizing_role` is immutable on an
    // append-only row, so an unchecked label is permanent.
    assertAuthorizingRoleHeld(
      input.authorizingRole,
      await this.receptions.activePartyRoles(db, receptionVisitId, input.partnerId)
    );

    let authorizationId: string | null;
    try {
      authorizationId = await this.receptions.insertAuthorization(db, {
        companyId: visit.companyId,
        branchId: visit.branchId,
        receptionVisitId,
        authorizingRole: input.authorizingRole,
        partnerId: input.partnerId,
        decision: input.decision,
        channel: input.channel ?? 'in_person',
        authorizedScope: input.authorizedScope ?? null,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
      });
    } catch (error) {
      throw this.mapAuthorizationFailure(error);
    }
    if (!authorizationId) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Recording the authorization was refused by policy',
      });
    }

    await appendAudit(db, {
      action: 'rec.reception.authorization_recorded',
      entityType: 'rec.authorization',
      entityId: authorizationId,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        { field: 'reception_visit_id', classification: 'internal', value: receptionVisitId },
        { field: 'partner_id', classification: 'internal', value: input.partnerId },
        { field: 'authorizing_role', classification: 'public', value: input.authorizingRole },
        { field: 'decision', classification: 'public', value: input.decision },
        { field: 'channel', classification: 'public', value: input.channel ?? 'in_person' },
      ],
    });

    return { receptionVisitId, authorizationId, decision: input.decision };
  }

  async approve(
    db: DbHandle,
    receptionVisitId: string,
    expectedVersion: number
  ): Promise<ReceptionApproved> {
    const visit = await this.requireVisit(db, receptionVisitId);
    assertApprovable(visit.receptionStatus);

    // `rec.guard_reception_transition` asks only whether SOME approved row has
    // ever existed, so it cannot see a withdrawal. The standing decision can.
    assertStandingAuthorization(await this.receptions.standingAuthorizations(db, receptionVisitId));

    // The caller's `If-Match` is asserted once, against the version the FOR UPDATE
    // read observed, rather than as a predicate on each hop. `opened -> authorized`
    // is two legal edges and the touch trigger advances `record_version` on the
    // first, so only one hop could ever carry the caller's value and the two would
    // then disagree about what "stale" means. Holding the row lock makes the single
    // comparison exactly as authoritative as a predicate would be: nothing can move
    // the row between this read and the last hop.
    if (visit.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The reception changed while this request was in flight; retry',
      });
    }

    const path = approvalPath(visit.receptionStatus as 'opened' | 'inspecting');
    for (const next of path) {
      let changed: number;
      try {
        changed = await this.receptions.setStatus(db, receptionVisitId, next, null);
      } catch (error) {
        throw this.mapTransitionFailure(error);
      }
      if (changed === 0) {
        throw new AppFailure('ERR-IAM-001', {
          message: `Advancing the reception to ${next} was refused by policy`,
        });
      }
    }
    const recordVersion = visit.recordVersion + path.length;

    await appendAudit(db, {
      action: 'rec.reception.approved',
      entityType: 'rec.reception_visit',
      entityId: receptionVisitId,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        {
          field: 'reception_status',
          classification: 'public',
          previousValue: visit.receptionStatus,
          value: 'authorized',
        },
        { field: 'applied_transitions', classification: 'public', value: path.join(',') },
      ],
    });

    await publishEvent(db, {
      eventType: 'reception.approved',
      aggregateId: receptionVisitId,
      aggregateVersion: recordVersion,
      producer: 'rec.reception-service',
      payload: {
        receptionVisitId,
        vehicleId: visit.vehicleId,
        receptionStatus: 'authorized',
        // No authorizing party and no scope: who approved what is recorded in
        // `rec.authorizations`, which a consumer reads under its own
        // authorization.
      },
      // `authorized` is entered exactly once — the graph has no edge back into it
      // — so the visit id alone makes the key unique.
      eventKey: `reception.approved:${receptionVisitId}`,
    });

    return {
      receptionVisitId,
      receptionStatus: 'authorized',
      appliedTransitions: path,
      recordVersion,
    };
  }

  /**
   * Resolves the single origin the visit will consume.
   *
   * A walk-in becomes a real `rec.walk_in_references` row first, because a
   * walk-in is a first-class origin and not an appointment with the calendar
   * fields left empty. An appointment origin is locked for the rest of the
   * transaction, so the eligibility check and the later `checked_in` write see
   * the same row and no second check-in can interleave.
   */
  private async resolveOrigin(db: DbHandle, plan: ReceptionCreatePlan): Promise<ResolvedOrigin> {
    if (plan.origin.kind === 'appointment') {
      const appointment = await this.appointments.lockForUpdate(db, plan.origin.appointmentId);
      if (!appointment) {
        throw new AppFailure('ERR-RES-001', { message: 'Appointment was not found' });
      }
      assertCheckInEligible(appointment.lifecycleStatus);
      if (appointment.vehicleId !== plan.vehicleId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The vehicle being received is not the vehicle the appointment was booked for',
          safeDetails: { violations: [{ path: 'body.vehicleId', rule: 'incoherent_reference' }] },
        });
      }
      // The body's company and branch MUST equal the appointment's.
      //
      // This is the security boundary of the whole operation, and the previous
      // comment here was wrong about it. The visit is written in the
      // APPOINTMENT's scope, but `authorizationTarget` is derived from the BODY
      // before the transaction opens, so accepting a divergent body meant
      // authorizing branch X and writing in branch Y. `lockForUpdate` filters on
      // tenant and id only, and `app.branch_ids` is the union of every grant the
      // caller holds, so any appointment the caller can see was usable: send a
      // branch you legitimately hold plus an appointment in another branch, and
      // the visit, its mandatory party role, the accepted custody event and the
      // appointment's move to `checked_in` all landed where you hold nothing.
      //
      // Nothing downstream caught it. The composite foreign key only ties the
      // visit to the appointment — which it did, coherently, in the wrong branch;
      // `uq_reception_visits_open_vehicle` is per vehicle, not per branch; and
      // `guard_immutable_columns` pins the scope after the insert, not at it.
      //
      // Requiring equality makes the authorized target provably the written
      // target, with no second database read and no reliance on the order the
      // pipeline happens to run in. The refusal is a validation failure naming
      // only the fields the caller sent: it discloses nothing about the
      // appointment it could not already see.
      if (appointment.companyId !== plan.companyId || appointment.branchId !== plan.branchId) {
        throw new AppFailure('ERR-VAL-001', {
          message:
            "companyId and branchId must be the appointment's own company and branch; " +
            'a reception cannot be opened in a different scope from its appointment',
          safeDetails: {
            violations: [{ path: 'body.branchId', rule: 'incoherent_reference' }],
          },
        });
      }

      return {
        kind: 'appointment',
        appointmentId: appointment.id,
        walkInId: null,
        // Equal to the body's by the check above, and taken from the appointment
        // so the row that anchors the composite foreign key is the source.
        companyId: appointment.companyId,
        branchId: appointment.branchId,
      };
    }

    let walkInId: string | null;
    try {
      walkInId = await this.receptions.insertWalkIn(db, {
        companyId: plan.companyId,
        branchId: plan.branchId,
        vehicleId: plan.vehicleId,
        requesterPartnerId: plan.origin.requesterPartnerId ?? null,
        note: plan.origin.note ?? null,
      });
    } catch (error) {
      throw this.mapCheckInFailure(error);
    }
    if (!walkInId) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Recording the walk-in arrival was refused by policy',
      });
    }
    return {
      kind: 'walk_in',
      appointmentId: null,
      walkInId,
      companyId: plan.companyId,
      branchId: plan.branchId,
    };
  }

  /** Locks the live visit for the rest of the transaction, or reports a 404. */
  private async requireVisit(
    db: DbHandle,
    receptionVisitId: string
  ): Promise<ReceptionVisitLockRow> {
    const visit = await this.receptions.lockVisit(db, receptionVisitId);
    if (!visit) {
      throw new AppFailure('ERR-RES-001', { message: 'Reception was not found' });
    }
    return visit;
  }

  /**
   * A row-level policy refusal is an authorization outcome and must leave as
   * one. Shared by every mapper below: without it a caller writing outside the
   * branch their grant reaches would receive ERR-SYS-001, and route-handler
   * forwards every 5xx to the exception monitor, so an authenticated caller
   * could manufacture unlimited incidents at will.
   */
  private scopeDenial(error: unknown, subject: string): AppFailure | null {
    return isSqlState(error, SQLSTATE.insufficientPrivilege)
      ? new AppFailure('ERR-IAM-001', {
          message: `This ${subject} is outside the scope your access grants`,
        })
      : null;
  }

  /** Maps the frozen check-in SQLSTATEs; re-throws anything else. */
  private mapCheckInFailure(error: unknown): AppFailure | unknown {
    const denied = this.scopeDenial(error, 'reception');
    if (denied) return denied;
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // Either `uq_reception_visits_open_vehicle` (custody cannot be in two
      // places) or one of the origin uniques (an origin is consumed once). Both
      // arrive as 23505 and neither is distinguishable from the SQLSTATE alone, so
      // the message names both possibilities rather than guessing one.
      return new AppFailure('ERR-RES-002', {
        message:
          'This vehicle already has an open reception, or this appointment or walk-in has already been checked in',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'A referenced record is not visible to this tenant',
        safeDetails: { violations: [{ path: 'body', rule: 'unknown_reference' }] },
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // `rec.guard_reception_visit_refs` origin/vehicle coherence, the XOR origin
      // CHECK, or the state-of-charge range. The first two are pre-checked above,
      // so this is the honest catch-all rather than a claim about which one fired.
      return new AppFailure('ERR-VAL-001', {
        message: 'The check-in details are not coherent with the origin or the vehicle',
        safeDetails: { violations: [{ path: 'body', rule: 'incoherent_reference' }] },
      });
    }
    return error;
  }

  private mapPartyRoleFailure(error: unknown): AppFailure | unknown {
    const denied = this.scopeDenial(error, 'reception');
    if (denied) return denied;
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // uq_reception_party_roles_active.
      return new AppFailure('ERR-RES-002', {
        message:
          'That party already holds this role on the reception; supersede the assignment to re-date it',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'The party was not found in this tenant',
        safeDetails: { violations: [{ path: 'body.partnerId', rule: 'unknown_reference' }] },
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'The relationship role is not one the reception contract recognises',
        safeDetails: { violations: [{ path: 'body.relationshipRole', rule: 'invalid_value' }] },
      });
    }
    return error;
  }

  private mapAuthorizationFailure(error: unknown): AppFailure | unknown {
    const denied = this.scopeDenial(error, 'reception');
    if (denied) return denied;
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // `rec.guard_authorization_authority` refuses a party with no active
      // authorizing role on this visit, and the vocabulary CHECKs refuse an
      // unrecognised role, decision, channel, or scope shape. The message names
      // neither the roles the party does hold nor the ones it would need: that is
      // an enumeration of another party's relationships to this vehicle, and a
      // caller who is guessing must not be told how close the guess was.
      return new AppFailure('ERR-TRN-001', {
        message:
          'That party may not authorize work on this reception, or the decision details are not recognised',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'A referenced party or document is not visible to this tenant',
        safeDetails: { violations: [{ path: 'body', rule: 'unknown_reference' }] },
      });
    }
    return error;
  }

  private mapTransitionFailure(error: unknown): AppFailure | unknown {
    const denied = this.scopeDenial(error, 'reception');
    if (denied) return denied;
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // `rec.guard_reception_transition`. The domain already refused an illegal
      // edge, so what reaches here is the activation contract: an active service
      // requester AND an approved authorization. Both raise the same SQLSTATE, so
      // the message names the two prerequisite categories and nothing about which
      // parties or decisions exist on the visit.
      return new AppFailure('ERR-TRN-001', {
        message:
          'The reception is incomplete: approval needs an active service requester and an approved authorization',
      });
    }
    return error;
  }

  /**
   * Runs the supersession close, mapping the `valid_to > valid_from` range CHECK.
   *
   * `now()` is the transaction timestamp, so closing an interval that was opened
   * in the same transaction would make the two equal and violate the CHECK. That
   * is a 422 about the request, not a fault.
   */
  private async closeOrFail(run: () => Promise<number>): Promise<number> {
    try {
      return await run();
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The role assignment being superseded started in this same transaction',
          safeDetails: { violations: [{ path: 'body.supersede', rule: 'out_of_range' }] },
        });
      }
      throw error;
    }
  }

  private planOrFail<T>(build: () => T, path: string): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof ReceptionRuleError) {
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
