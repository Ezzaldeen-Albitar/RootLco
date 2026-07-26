/**
 * Reopen refusal and rework (Phase 1-19, P1-19-BE-018/019).
 *
 * ## A closed work order is never reopened, and the attempt is the record
 *
 * BR-WO-002 admits no reopen. `qms.attempt_reopen` records the attempt in
 * `qms.reopen_attempts` — whose `outcome` is CHECK-fixed to `'rejected'`, so the
 * vocabulary has exactly one value and there is no success to record — and never
 * touches the work order. This service therefore returns a REFUSAL on its success
 * path: the request succeeded in being recorded, and the thing it asked for is
 * refused. `ERR-QMS-001` carries the recorded attempt's id, so a caller can point at
 * the ledger row rather than being told only "no".
 *
 * ## Rework corrects the original by standing beside it, never by editing it
 *
 * A rework work order is a SECOND work order on the same reception visit with
 * `kind = 'rework'`, linked to the closed original by `qms.rework_links`. Creating it
 * is one transaction: the order and the link, or neither — a link without its order is
 * impossible by foreign key, and an order without its link would be an unattached
 * rework nobody could find.
 *
 * ## BR-QMS-001 is a CHECK here, and that is worth saying plainly
 *
 * `ck_rework_links_signoff_distinct` refuses `independent_sign_off_by` equal to
 * `lead_technician_id`, and `ck_rework_links_safety_lead` makes a lead technician
 * mandatory for safety-critical rework. So separation is the DATABASE's, unlike
 * diagnostic reviewer separation which had to be an application rule.
 * `assertIndependentSignOff` refuses first only so the caller gets a reason instead of
 * a bare `23514`, and `org.guard_immutable_columns` freezes `lead_technician_id` so
 * the lead cannot be swapped afterwards to make a signature legal.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { workOrderModule } from '@/modules/work-order';
import { technicianModule } from '@/modules/technician';
import { sharedServicesModule } from '@/modules/shared-services';
import type {
  QualityRepository,
  ReopenAttemptRow,
  ReworkCostRow,
  ReworkLinkRow,
} from '../data/quality-repository';
import { assertIndependentSignOff } from '../domain/quality';

/** A rework link as projected to a caller. */
export interface ReworkLinkView {
  readonly id: string;
  readonly originalWorkOrderId: string;
  readonly reworkWorkOrderId: string;
  readonly rootCause: string;
  readonly correctiveAction: string;
  readonly responsibility: string | null;
  readonly leadTechnicianId: string | null;
  readonly isSafetyCritical: boolean;
  readonly independentSignOffBy: string | null;
  readonly signOffAt: string | null;
  readonly recordVersion: number;
}

/** One recorded reopen attempt. Always rejected. */
export interface ReopenAttemptView {
  readonly id: string;
  readonly workOrderId: string;
  readonly reason: string;
  readonly outcome: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
}

/** What creating a rework case states. */
export interface CreateReworkInput {
  readonly rootCause: string;
  readonly correctiveAction: string;
  readonly responsibility?: string | undefined;
  readonly leadTechnicianId?: string | undefined;
  readonly isSafetyCritical?: boolean | undefined;
}

const toLinkView = (row: ReworkLinkRow): ReworkLinkView => ({
  id: row.id,
  originalWorkOrderId: row.originalWorkOrderId,
  reworkWorkOrderId: row.reworkWorkOrderId,
  rootCause: row.rootCause,
  correctiveAction: row.correctiveAction,
  responsibility: row.responsibility,
  leadTechnicianId: row.leadTechnicianId,
  isSafetyCritical: row.isSafetyCritical,
  independentSignOffBy: row.independentSignOffBy,
  signOffAt: row.signOffAt === null ? null : row.signOffAt.toISOString(),
  recordVersion: row.recordVersion,
});

const toAttemptView = (row: ReopenAttemptRow): ReopenAttemptView => ({
  id: row.id,
  workOrderId: row.workOrderId,
  reason: row.reason,
  outcome: row.outcome,
  requestedBy: row.requestedBy,
  requestedAt: row.requestedAt.toISOString(),
});

export class ReworkService extends ApplicationService {
  protected readonly module = 'quality';

  constructor(private readonly repository: QualityRepository) {
    super();
  }

  /**
   * Records a reopen attempt and returns it — with its refusal.
   *
   * ## Why this RETURNS instead of throwing, which is not a softening
   *
   * The record of the attempt is the whole point: an auditor asking "did anyone try to
   * reopen this vehicle's order after it was released" must get a ledger rather than
   * silence. An earlier draft recorded the attempt and then threw `ERR-QMS-001`, which
   * looked more emphatic and was strictly worse — the throw aborts the request's
   * transaction, so the row it had just written rolled back with it and the ledger
   * stayed empty. The refusal was real and the record was not, which is exactly
   * backwards.
   *
   * So the REQUEST succeeds — the caller asked to record an attempt and one was
   * recorded — and the RESPONSE says the reopen was refused, in `outcome` (CHECK-fixed
   * to `'rejected'`, the only value the vocabulary has) and in a message naming the
   * alternative. Nothing about the work order changes: `qms.attempt_reopen` never
   * touches it, which is BR-WO-002 in the database rather than in this code.
   *
   * `requested_by` and `requested_at` are stamped by `qms.stamp_reopen_attempt()` from
   * the session, so an attempt cannot be attributed to someone else.
   */
  async attemptReopen(
    db: DbHandle,
    workOrderId: string,
    reason: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<{ readonly attempt: ReopenAttemptView; readonly refusal: string }> {
    const workOrder = await workOrderModule().workOrders.requireWorkOrder(
      db,
      workOrderId,
      authorizeScope
    );

    let attemptId: string;
    try {
      attemptId = await this.repository.attemptReopen(db, workOrderId, reason);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // The order is not closed, so there is nothing to reopen — a different fact
        // from "you may not reopen it", and told apart because the guard says so.
        throw new AppFailure('ERR-TRN-001', {
          message: `Work order ${workOrderId} is not closed; there is nothing to reopen`,
          cause: error,
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'qms.work_order.reopen_refused',
      entityType: 'wo.work_order',
      entityId: workOrderId,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      details: [
        { field: 'reopen_attempt_id', classification: 'internal', value: attemptId },
        { field: 'outcome', classification: 'public', value: 'rejected' },
        { field: 'reason', classification: 'internal', value: reason },
      ],
    });

    const recorded = (await this.repository.reopenAttemptsFor(db, workOrderId)).find(
      (row) => row.id === attemptId
    );
    if (recorded === undefined) {
      // Unreachable: the row was written in this transaction and is read back through
      // the same handle. Kept because a silent fallback here would return a refusal
      // with no attempt behind it, which is the one shape this endpoint must not have.
      throw new AppFailure('ERR-SYS-001', {
        message: 'The recorded reopen attempt could not be read back',
      });
    }
    return {
      attempt: toAttemptView(recorded),
      // The message names the alternative, because a refusal that names none reads as
      // a broken feature rather than a rule.
      refusal:
        `Work order ${workOrderId} is closed and cannot be reopened (BR-WO-002); ` +
        'create a linked rework work order instead',
    };
  }

  /** Every recorded reopen attempt on a work order, newest first. */
  async reopenAttempts(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly ReopenAttemptView[]> {
    await workOrderModule().workOrders.requireWorkOrder(db, workOrderId, authorizeScope);
    return (await this.repository.reopenAttemptsFor(db, workOrderId)).map(toAttemptView);
  }

  /**
   * Opens a rework work order against a closed original and links the two.
   *
   * ONE transaction. The order comes from the `work-order` module's public surface —
   * `wo.work_orders` is its table — and the link is written here, so a rework order
   * can never exist without the link that explains it.
   *
   * The lead technician is resolved through the `technician` module before the write,
   * because the composite foreign key would refuse an out-of-branch profile with a
   * bare `23503` and the caller deserves to know which of the two things was wrong.
   */
  async create(
    db: DbHandle,
    originalWorkOrderId: string,
    input: CreateReworkInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<{ readonly reworkWorkOrderId: string; readonly link: ReworkLinkView }> {
    const original = await workOrderModule().workOrders.requireWorkOrder(
      db,
      originalWorkOrderId,
      authorizeScope
    );

    // Safety-critical rework needs a lead technician — `ck_rework_links_safety_lead`
    // — and the pre-check makes that a readable 422 rather than a `23514`.
    const isSafetyCritical = input.isSafetyCritical ?? false;
    if (isSafetyCritical && input.leadTechnicianId === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Safety-critical rework requires a lead technician',
        safeDetails: { violations: [{ path: 'body.leadTechnicianId', rule: 'required' }] },
      });
    }
    if (input.leadTechnicianId !== undefined) {
      const profile = await technicianModule().eligibility.profile(db, input.leadTechnicianId);
      if (
        profile === null ||
        profile.companyId !== original.companyId ||
        profile.branchId !== original.branchId
      ) {
        throw new AppFailure('ERR-RES-001', {
          message: `Technician ${input.leadTechnicianId} is not visible in this scope`,
        });
      }
    }

    // The same sequence reception's conversion allocates from, borrowed through the
    // shared surface exactly as reception does — never a second allocator, and never
    // scoped, because the work-order sequence is provisioned per tenant.
    const allocated = await sharedServicesModule().numbers.allocate(db, {
      sequenceCode: 'work_order',
    });

    // Refuses a non-CLOSED original — `is_closed`, not `is_terminal`, because
    // `cancelled` is terminal and not closed and abandoned work is not corrected by
    // rework. `qms.guard_rework_link_coherence` re-checks it on the link insert below.
    const reworkOrder = await workOrderModule().workOrders.openRework(
      db,
      originalWorkOrderId,
      allocated.displayNumber,
      authorizeScope
    );

    let link: ReworkLinkRow;
    try {
      link = await this.repository.createReworkLink(db, {
        companyId: original.companyId,
        branchId: original.branchId,
        originalWorkOrderId,
        reworkWorkOrderId: reworkOrder.id,
        rootCause: input.rootCause,
        correctiveAction: input.correctiveAction,
        responsibility: input.responsibility ?? null,
        leadTechnicianId: input.leadTechnicianId ?? null,
        isSafetyCritical,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // `qms.guard_rework_link_coherence` refused it. Reachable if the original
        // moved between the pre-check and here, and mapped rather than surfaced as a
        // 500 — the whole rework order rolls back with it.
        throw new AppFailure('ERR-TRN-001', {
          message: 'The original work order no longer permits a linked rework',
          cause: error,
        });
      }
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        // `uq_rework_links_rework_wo`: one link per rework order. Unreachable while
        // this method creates the order it links, and mapped because the index is the
        // authority rather than that reasoning.
        throw new AppFailure('ERR-RES-002', {
          message: 'That rework work order is already linked',
          cause: error,
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'qms.rework.created',
      entityType: 'qms.rework_link',
      entityId: link.id,
      companyId: original.companyId,
      branchId: original.branchId,
      details: [
        {
          field: 'original_work_order_id',
          classification: 'internal',
          value: originalWorkOrderId,
        },
        { field: 'rework_work_order_id', classification: 'internal', value: reworkOrder.id },
        // Root cause and corrective action are the quality record itself — the fact an
        // auditor is looking for — so they are recorded rather than summarised. They
        // are `internal`: they describe a fault on a customer's vehicle.
        { field: 'root_cause', classification: 'internal', value: link.rootCause },
        { field: 'corrective_action', classification: 'internal', value: link.correctiveAction },
        {
          field: 'is_safety_critical',
          classification: 'public',
          value: String(link.isSafetyCritical),
        },
      ],
    });

    await publishEvent(db, {
      eventType: 'rework.linked',
      aggregateId: link.id,
      aggregateVersion: link.recordVersion,
      producer: 'qms.rework-service',
      companyId: original.companyId,
      branchId: original.branchId,
      payload: {
        reworkLinkId: link.id,
        originalWorkOrderId,
        reworkWorkOrderId: reworkOrder.id,
        isSafetyCritical: link.isSafetyCritical,
      },
      // `uq_rework_links_rework_wo` allows one live link per rework order, so this
      // fact happens at most once per rework order.
      eventKey: `rework.linked:${reworkOrder.id}`,
    });

    return { reworkWorkOrderId: reworkOrder.id, link: toLinkView(link) };
  }

  /** One rework link. */
  async detail(
    db: DbHandle,
    linkId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<ReworkLinkView> {
    return toLinkView(await this.requireLink(db, linkId, authorizeScope));
  }

  /** Every rework link whose ORIGINAL is this work order. */
  async forOriginal(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly ReworkLinkView[]> {
    await workOrderModule().workOrders.requireWorkOrder(db, workOrderId, authorizeScope);
    return (await this.repository.reworkLinksForOriginal(db, workOrderId)).map(toLinkView);
  }

  /**
   * Records the independent sign-off that BR-QMS-001 requires.
   *
   * The signer is a TECHNICIAN PROFILE, not a user: both
   * `independent_sign_off_by` and `lead_technician_id` foreign-key
   * `tech.technician_profiles` with the full branch scope key. So the sign-off names
   * the person who checked the work in the workshop's own roster, which is what makes
   * "someone other than the technician who did it" a meaningful statement.
   *
   * `sign_off_at` is stamped by `qms.guard_rework_signoff`, which also makes the
   * signature write-once.
   */
  async signOff(
    db: DbHandle,
    linkId: string,
    input: { readonly signOffBy: string; readonly expectedVersion: number },
    authorizeScope?: ScopeAuthorizer
  ): Promise<ReworkLinkView> {
    const link = await this.repository.lockReworkLink(db, linkId);
    if (link === null) {
      throw new AppFailure('ERR-RES-001', { message: `Rework link ${linkId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: link.companyId, branchId: link.branchId });
    }
    if (link.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Rework link ${linkId} was modified by another request`,
      });
    }
    if (link.independentSignOffBy !== null) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Rework link ${linkId} is already signed off`,
      });
    }

    const profile = await technicianModule().eligibility.profile(db, input.signOffBy);
    if (
      profile === null ||
      profile.companyId !== link.companyId ||
      profile.branchId !== link.branchId
    ) {
      throw new AppFailure('ERR-RES-001', {
        message: `Technician ${input.signOffBy} is not visible in this scope`,
      });
    }
    // The readable refusal in front of `ck_rework_links_signoff_distinct`, which is
    // the actual enforcement and a CHECK rather than a trigger.
    assertIndependentSignOff(link.isSafetyCritical, link.leadTechnicianId, input.signOffBy);

    let applied: boolean;
    try {
      applied = await this.repository.signOffRework(
        db,
        linkId,
        input.signOffBy,
        input.expectedVersion
      );
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // Reached when the pre-check let something through — a non-safety-critical
        // link signed by its own lead, which `assertIndependentSignOff` deliberately
        // does not police but the CHECK does.
        throw new AppFailure('ERR-QMS-001', {
          message: 'Rework cannot be signed off by the technician who performed it',
          cause: error,
          safeDetails: { violations: [{ path: 'body.signOffBy', rule: 'not_independent' }] },
        });
      }
      throw error;
    }
    if (!applied) {
      throw new AppFailure('ERR-CON-001', {
        message: `Rework link ${linkId} was modified by another request`,
      });
    }

    await appendAudit(db, {
      action: 'qms.rework.signed_off',
      entityType: 'qms.rework_link',
      entityId: linkId,
      companyId: link.companyId,
      branchId: link.branchId,
      details: [
        { field: 'independent_sign_off_by', classification: 'internal', value: input.signOffBy },
        {
          field: 'is_safety_critical',
          classification: 'public',
          value: String(link.isSafetyCritical),
        },
      ],
    });

    // Read back: `sign_off_at` was stamped by the database.
    const after = await this.repository.findReworkLink(db, linkId);
    return toLinkView(
      after ?? {
        ...link,
        independentSignOffBy: input.signOffBy,
        signOffAt: new Date(),
        recordVersion: input.expectedVersion + 1,
      }
    );
  }

  /**
   * Writes the RESTRICTED cost-of-quality figure.
   *
   * `qms.rework_link_details` is gated on `iam.sensitive.view` by all three of its
   * policies, exactly as `wo.additional_work_request_details` is, so it is a separate
   * authorized surface with its own operations rather than a field on the link. It is
   * an internal quality KPI and explicitly NOT a billing artifact — nothing here
   * invoices anything, and Phase 1-20 owns pricing.
   */
  async writeCost(
    db: DbHandle,
    linkId: string,
    input: { readonly reworkCost: string; readonly costCurrency: string },
    authorizeScope?: ScopeAuthorizer
  ): Promise<ReworkCostRow> {
    const link = await this.requireLink(db, linkId, authorizeScope);
    let cost: ReworkCostRow;
    try {
      cost = await this.repository.writeReworkCost(db, {
        linkId,
        companyId: link.companyId,
        branchId: link.branchId,
        reworkCost: input.reworkCost,
        costCurrency: input.costCurrency,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
        throw new AppFailure('ERR-IAM-001', {
          message: 'Recording the rework cost was refused by policy',
          cause: error,
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'qms.rework.cost_recorded',
      entityType: 'qms.rework_link',
      entityId: linkId,
      companyId: link.companyId,
      branchId: link.branchId,
      // The FACT and the currency, never the figure. `iam.audit_records` is NOT gated
      // by `iam.sensitive.view`, so copying a restricted cost here would publish it to
      // every auditor — the same reasoning the additional-work description follows.
      details: [
        { field: 'classification', classification: 'public', value: cost.classification },
        { field: 'cost_currency', classification: 'public', value: cost.costCurrency },
        { field: 'cost_recorded', classification: 'internal', value: 'true' },
      ],
    });
    return cost;
  }

  /** The restricted cost of one rework case. */
  async cost(
    db: DbHandle,
    linkId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<ReworkCostRow> {
    const link = await this.requireLink(db, linkId, authorizeScope);
    const cost = await this.repository.reworkCostFor(db, linkId);
    if (cost === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Rework link ${linkId} has no recorded cost`,
      });
    }
    // Recorded only on a read that SUCCEEDED: a refusal is already recorded by the
    // authorization pipeline, and a second record of it would double-count.
    await appendAudit(db, {
      action: 'qms.rework.cost_read',
      entityType: 'qms.rework_link',
      entityId: linkId,
      companyId: link.companyId,
      branchId: link.branchId,
      details: [{ field: 'classification', classification: 'public', value: cost.classification }],
    });
    return cost;
  }

  /** The link, scoped against its own company and branch. */
  private async requireLink(
    db: DbHandle,
    linkId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<ReworkLinkRow> {
    const link = await this.repository.findReworkLink(db, linkId);
    if (link === null) {
      throw new AppFailure('ERR-RES-001', { message: `Rework link ${linkId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: link.companyId, branchId: link.branchId });
    }
    return link;
  }
}
