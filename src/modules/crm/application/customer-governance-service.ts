/**
 * CRM customer governance — application service (Phase 1-16, P1-16-BE-008…012).
 *
 * Notes, alerts, tags, lifecycle status, and restrictions.
 *
 * ## Blocking a customer is one decision, so it is one transaction
 *
 * A block writes three rows: the restriction, the lifecycle move on the partner,
 * and the append-only block-history entry. Splitting those across requests would
 * make a half-blocked customer reachable — restricted in the ledger but still
 * `active` at the counter, or blocked with no recorded reason. They commit
 * together, so the state a reader sees is always internally consistent.
 *
 * ## Concurrency is resolved by the database, not by re-reading
 *
 * The lifecycle update carries the `record_version` the caller's read observed.
 * Two operators blocking and re-activating at the same moment do not interleave:
 * one wins, the other is told its view was stale (`ERR-CON-001`) and can decide
 * again with the winner's outcome visible. Nothing is silently overwritten.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import type {
  AlertInsert,
  CustomerGovernanceRepository,
  NoteInsert,
  RestrictionInsert,
} from '../data/customer-governance-repository';
import {
  CustomerGovernanceError,
  assertLifecycleTransition,
  normalizeSegmentCode,
  requireReason,
  type SettableLifecycleState,
} from '../domain/customer-governance';

export interface GovernanceRecordCreated {
  readonly id: string;
  readonly customerId: string;
}

export interface TagAssigned {
  readonly segmentId: string;
  readonly customerId: string;
  /** `false` when the customer already carried the tag — a no-op, not an error. */
  readonly assigned: boolean;
}

export interface LifecycleChanged {
  readonly customerId: string;
  readonly previousStatus: string;
  readonly lifecycleStatus: SettableLifecycleState;
  readonly historyId: string;
}

export interface RestrictionImposed extends GovernanceRecordCreated {
  readonly restrictionType: string;
  /** Set when the restriction also moved the customer to `blocked`. */
  readonly lifecycleStatus: string | null;
}

export class CustomerGovernanceService extends ApplicationService {
  protected readonly module = 'crm';

  constructor(private readonly governance: CustomerGovernanceRepository) {
    super();
  }

  async addNote(
    db: DbHandle,
    customerId: string,
    input: NoteInsert
  ): Promise<GovernanceRecordCreated> {
    await this.requireCustomer(db, customerId);
    const id = await this.governance.insertNote(db, customerId, input);
    if (!id) {
      // The DBCR-P1-16-001 policies pin author and entity type; a refusal here
      // means one of those did not hold, which is a policy denial, not a bug in
      // the caller's data.
      throw new AppFailure('ERR-IAM-001', { message: 'Note creation was refused by policy' });
    }

    await appendAudit(db, {
      action: 'crm.customer.note_added',
      entityType: 'shared.note',
      entityId: id,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        // Classification and visibility are recorded; the note body is not. The
        // body may itself be restricted content, and copying it into the audit
        // trail would move it into a table with different access rules.
        { field: 'classification', classification: 'public', value: input.classification },
        { field: 'visibility', classification: 'public', value: input.visibility },
      ],
    });
    return { id, customerId };
  }

  async raiseAlert(
    db: DbHandle,
    customerId: string,
    input: AlertInsert
  ): Promise<GovernanceRecordCreated> {
    await this.requireCustomer(db, customerId);
    const id = await this.governance.insertAlert(db, customerId, input);
    if (!id) {
      throw new AppFailure('ERR-IAM-001', { message: 'Alert creation was refused by policy' });
    }

    await appendAudit(db, {
      action: 'crm.customer.alert_raised',
      entityType: 'crm.customer_alert',
      entityId: id,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        { field: 'alert_type', classification: 'public', value: input.alertType },
        { field: 'severity', classification: 'public', value: input.severity },
      ],
    });
    return { id, customerId };
  }

  async assignTag(
    db: DbHandle,
    customerId: string,
    input: { segmentCode: string; name?: string | null }
  ): Promise<TagAssigned> {
    await this.requireCustomer(db, customerId);
    const code = this.orFail(() => normalizeSegmentCode(input.segmentCode));
    const segmentId = await this.governance.ensureSegment(db, code, input.name?.trim() || code);

    const assignmentId = await this.governance.assignSegment(db, customerId, segmentId);
    if (assignmentId === null) {
      // Re-tagging an already-tagged customer is what the caller wanted to be
      // true, and it is. Reporting a conflict would make a harmless retry look
      // like a failure.
      return { segmentId, customerId, assigned: false };
    }

    await appendAudit(db, {
      action: 'crm.customer.tag_assigned',
      entityType: 'crm.partner_segment_assignment',
      entityId: assignmentId,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        { field: 'segment_code', classification: 'public', value: code },
      ],
    });
    return { segmentId, customerId, assigned: true };
  }

  async changeLifecycle(
    db: DbHandle,
    customerId: string,
    input: { lifecycleStatus: SettableLifecycleState; reason: string }
  ): Promise<LifecycleChanged> {
    const current = await this.requireCustomer(db, customerId);
    const reason = this.orFail(() => requireReason(input.reason, 'body.reason'));
    this.orFail(() => assertLifecycleTransition(current.lifecycleStatus, input.lifecycleStatus));

    // `crm.guard_partner_block_coherence()` is symmetric: entering `blocked`
    // requires the latest block-history row to be `blocked`, and leaving it
    // requires `unblocked`. The database therefore refuses a block or an
    // unblock that has no recorded justification — so the history row is
    // written first, and this crossing is one indivisible decision rather than
    // a state change somebody may or may not document afterwards.
    const entering = input.lifecycleStatus === 'blocked' && current.lifecycleStatus !== 'blocked';
    const leaving = current.lifecycleStatus === 'blocked' && input.lifecycleStatus !== 'blocked';
    if (entering || leaving) {
      await this.governance.appendBlockHistory(db, customerId, {
        action: entering ? 'blocked' : 'unblocked',
        reason,
        restrictionId: null,
        approvalRef: null,
      });
    }

    const changed = await this.governance.updateLifecycle(
      db,
      customerId,
      current.recordVersion,
      input.lifecycleStatus
    );
    if (changed === 0) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The customer changed while this request was in flight; retry',
      });
    }

    const historyId = await this.governance.appendStatusHistory(db, customerId, {
      from: current.lifecycleStatus,
      to: input.lifecycleStatus,
      reason,
    });
    if (!historyId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Status history was refused by policy' });
    }

    await appendAudit(db, {
      action: 'crm.customer.status_changed',
      entityType: 'crm.business_partner',
      entityId: customerId,
      details: [
        {
          field: 'lifecycle_status',
          classification: 'public',
          previousValue: current.lifecycleStatus,
          value: input.lifecycleStatus,
        },
        { field: 'reason', classification: 'internal', value: reason },
      ],
    });

    return {
      customerId,
      previousStatus: current.lifecycleStatus,
      lifecycleStatus: input.lifecycleStatus,
      historyId,
    };
  }

  /**
   * Imposes a restriction, and blocks the customer when the restriction is one
   * that stops service.
   *
   * `no_service` is the only type that necessarily contradicts an `active`
   * lifecycle: a customer we will not serve is not an active customer. The
   * others (`no_credit`, `prepay_only`, …) constrain *terms*, not service, so
   * they leave the lifecycle alone rather than over-reaching.
   */
  async imposeRestriction(
    db: DbHandle,
    customerId: string,
    input: RestrictionInsert
  ): Promise<RestrictionImposed> {
    const current = await this.requireCustomer(db, customerId);
    const reason = this.orFail(() => requireReason(input.reason, 'body.reason'));

    const id = await this.governance.insertRestriction(db, customerId, { ...input, reason });
    if (!id) {
      throw new AppFailure('ERR-IAM-001', { message: 'Restriction was refused by policy' });
    }

    let lifecycleStatus: string | null = null;
    if (input.restrictionType === 'no_service' && current.lifecycleStatus !== 'blocked') {
      // Order matters, and the database enforces it: a guard on
      // crm.business_partners refuses a move to `blocked` unless a matching
      // block-history row already exists. So the *justification* is recorded
      // before the state that needs justifying — a customer can never be found
      // blocked with no reason on file, even for the width of one transaction.
      //
      // The block trail is separate from the lifecycle trail on purpose: one
      // answers "when was this customer blocked and by whom", the other answers
      // "how has this customer's status moved over its life".
      await this.governance.appendBlockHistory(db, customerId, {
        action: 'blocked',
        reason,
        restrictionId: id,
        approvalRef: input.approvalRef,
      });

      const changed = await this.governance.updateLifecycle(
        db,
        customerId,
        current.recordVersion,
        'blocked'
      );
      if (changed === 0) {
        throw new AppFailure('ERR-CON-001', {
          message: 'The customer changed while this request was in flight; retry',
        });
      }
      lifecycleStatus = 'blocked';

      const historyId = await this.governance.appendStatusHistory(db, customerId, {
        from: current.lifecycleStatus,
        to: 'blocked',
        reason,
      });
      if (!historyId) {
        throw new AppFailure('ERR-IAM-001', { message: 'Status history was refused by policy' });
      }
    }

    await appendAudit(db, {
      action: 'crm.customer.restriction_imposed',
      entityType: 'crm.customer_restriction',
      entityId: id,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        { field: 'restriction_type', classification: 'public', value: input.restrictionType },
        { field: 'reason', classification: 'internal', value: reason },
        { field: 'approval_ref', classification: 'internal', value: input.approvalRef },
      ],
    });

    return { id, customerId, restrictionType: input.restrictionType, lifecycleStatus };
  }

  private async requireCustomer(
    db: DbHandle,
    customerId: string
  ): Promise<{ lifecycleStatus: string; recordVersion: number }> {
    const current = await this.governance.currentLifecycle(db, customerId);
    if (!current) {
      throw new AppFailure('ERR-RES-001', { message: 'Customer was not found' });
    }
    return current;
  }

  private orFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof CustomerGovernanceError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
