/**
 * Additional work and customer approvals (Phase 1-19, P1-19-BE-006…008).
 *
 * ## The approval must be stored BEFORE the request says it was approved
 *
 * `wo.guard_additional_work_state` fires BEFORE UPDATE OF state and refuses
 * `state = 'approved'` unless an `approved` row already exists in
 * `wo.customer_approvals` for that request. That is not an ordering preference; it is
 * the forgery-resistance control. A request cannot be marked approved by anyone who
 * has not first recorded a decision naming a real deciding party, a channel and the
 * exact scope that party was shown.
 *
 * It also forces the two writes into ONE transaction. Split across two requests they
 * would leave a window in which a decision exists and the request does not reflect
 * it — during which the closure gate would still see a pending required request while
 * the customer had already said yes — and a failure between them would leave that
 * window open permanently. So `decide()` does both, or neither.
 *
 * ## The customer-facing description is a SEPARATE, separately authorized surface
 *
 * `wo.additional_work_request_details` is 1:1 with the request, but all three of its
 * policies additionally require `iam.has_permission('iam.sensitive.view')`. For a
 * caller without that permission the row does not exist — not for reading and not for
 * writing. Folding it into the request projection would therefore make an ordinary
 * service advisor's read silently return nothing, so the detail has its own
 * operations, and those operations declare the sensitive permission alongside the
 * functional one. Permissions are a conjunction, so the declaration is the readable
 * refusal and the policy is the enforcement behind it.
 *
 * ## What this service deliberately does not do
 *
 * It calculates no price, creates no quotation and touches no stock.
 * `wo.customer_approvals.quotation_revision_ref` is left NULL: it is foreign-keyed to
 * `quo.quotation_revisions` (migration 20260723097000, after the Phase 1-9 comment
 * that still calls it a reference with no FK), and creating the revision it would
 * point at is Phase 1-20. Recording a decision about work is not pricing it.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { diagnosticsModule } from '@/modules/diagnostics';
import { sharedServicesModule } from '@/modules/shared-services';
import type {
  AdditionalWorkRequestRow,
  ApprovalEvidenceRow,
  CustomerApprovalRow,
  WorkOrderRepository,
  WorkOrderRow,
} from '../data/work-order-repository';
import type { WorkOrderCatalogService } from './work-order-catalog-service';
import {
  assertAdditionalWorkTransition,
  type AdditionalWorkState,
  type ApprovalChannel,
  type ApprovalDecision,
  type SettableFulfillmentState,
} from '../domain/work-order';

/**
 * An additional-work request as projected to any caller authorized to read the
 * work order.
 *
 * Carries the SAFE summary and never the restricted description — see the header.
 * `hasRestrictedDetail` is deliberately absent too: for a caller without
 * `iam.sensitive.view` the detail row is invisible, so the flag could only ever be
 * computed from what that caller may see, and a flag that reads `false` because of
 * the reader's permissions rather than the data would be worse than no flag.
 */
export interface AdditionalWorkRequestView {
  readonly id: string;
  readonly workOrderId: string;
  readonly originatingJobId: string | null;
  readonly originatingFindingId: string | null;
  readonly summary: string;
  readonly state: string;
  readonly fulfillmentState: string;
  readonly isRequired: boolean;
  readonly createdAt: string;
  readonly recordVersion: number;
}

/** The restricted customer-facing description of one request. */
export interface AdditionalWorkDetailView {
  readonly additionalWorkRequestId: string;
  readonly description: string;
  readonly classification: string;
  readonly recordVersion: number;
}

/** One immutable decision, with the evidence bound to it. */
export interface CustomerApprovalView {
  readonly id: string;
  readonly additionalWorkRequestId: string;
  readonly decidingPartyRoleId: string;
  readonly decision: string;
  readonly channel: string;
  readonly presentedScope: string;
  readonly quotationRevisionRef: string | null;
  readonly decidedAt: string;
  readonly recordVersion: number;
  readonly evidence: readonly ApprovalEvidenceView[];
}

export interface ApprovalEvidenceView {
  readonly id: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: string;
}

/**
 * What raising a request states.
 *
 * At least one origin is required, which is this layer's rule and not the schema's —
 * both columns are nullable. Additional work whose provenance is unrecorded cannot be
 * traced to what discovered it, and provenance is the whole reason those two columns
 * exist. Supplying BOTH is permitted rather than refused: a finding is discovered
 * while working a job, so naming the job and the finding is more informative than
 * either alone, and nothing in the schema treats them as alternatives.
 */
export interface RaiseRequestInput {
  readonly originatingJobId?: string | undefined;
  readonly originatingFindingId?: string | undefined;
  readonly summary: string;
  readonly isRequired?: boolean | undefined;
}

/** One piece of evidence for a decision, named by document VERSION, never by key. */
export interface ApprovalEvidenceInput {
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note?: string | undefined;
}

/**
 * What recording a decision states.
 *
 * `expectedVersion` is the stale-scope control. `presentedScope` is a verbatim record
 * of what the customer was actually shown, and nothing in the schema ties it to the
 * request's content — so the only way to detect that the request changed between
 * presentation and decision is to bind the decision to the request version the
 * advisor was looking at. A decision recorded against a moved request is refused as a
 * conflict rather than silently attached to different work.
 *
 * `decidedAt` is deliberately NOT accepted. It is server-stamped and then frozen by
 * `tg_customer_approvals_immutable`, so a caller-supplied time could be placed before
 * the request existed and could never afterwards be corrected.
 */
export interface DecideInput {
  readonly decision: ApprovalDecision;
  readonly channel: ApprovalChannel;
  readonly decidingPartyRoleId: string;
  readonly presentedScope: string;
  readonly expectedVersion: number;
  readonly evidence?: readonly ApprovalEvidenceInput[] | undefined;
}

/** Version states a document may be in and still be bound as evidence. */
const EVIDENCE_REFUSED_STATES: readonly string[] = Object.freeze(['rejected', 'quarantined']);

const toRequestView = (row: AdditionalWorkRequestRow): AdditionalWorkRequestView => ({
  id: row.id,
  workOrderId: row.workOrderId,
  originatingJobId: row.originatingJobId,
  originatingFindingId: row.originatingFindingId,
  summary: row.summary,
  state: row.state,
  fulfillmentState: row.fulfillmentState,
  isRequired: row.isRequired,
  createdAt: row.createdAt.toISOString(),
  recordVersion: row.recordVersion,
});

const toEvidenceView = (row: ApprovalEvidenceRow): ApprovalEvidenceView => ({
  id: row.id,
  documentVersionId: row.documentVersionId,
  evidenceType: row.evidenceType,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

const toApprovalView = (
  row: CustomerApprovalRow,
  evidence: readonly ApprovalEvidenceRow[]
): CustomerApprovalView => ({
  id: row.id,
  additionalWorkRequestId: row.additionalWorkRequestId,
  decidingPartyRoleId: row.decidingPartyRoleId,
  decision: row.decision,
  channel: row.channel,
  presentedScope: row.presentedScope,
  quotationRevisionRef: row.quotationRevisionRef,
  decidedAt: row.decidedAt.toISOString(),
  recordVersion: row.recordVersion,
  evidence: evidence.map(toEvidenceView),
});

export class AdditionalWorkService extends ApplicationService {
  protected readonly module = 'work-order';

  constructor(
    private readonly repository: WorkOrderRepository,
    private readonly catalog: WorkOrderCatalogService
  ) {
    super();
  }

  /**
   * Raises additional work against a work order.
   *
   * The work order is LOCKED rather than merely read, so a concurrent closure
   * serialises behind this insert instead of racing it — a required request landing
   * after `wo.guard_work_order_closure` had already evaluated B3 would block nothing
   * and would sit on a closed order for ever.
   */
  async raise(
    db: DbHandle,
    workOrderId: string,
    input: RaiseRequestInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<AdditionalWorkRequestView> {
    const workOrder = await this.lockOpenWorkOrder(db, workOrderId, authorizeScope);

    if (input.originatingJobId === undefined && input.originatingFindingId === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Additional work must name the job or the diagnostic finding it came from',
        safeDetails: {
          violations: [{ path: 'body.originatingJobId', rule: 'origin_required' }],
        },
      });
    }

    if (input.originatingJobId !== undefined) {
      // The composite foreign key pins the job to the same BRANCH, not to the same
      // work order — a job under a different order in this branch satisfies it — so
      // this check is the difference between provenance and a dangling claim.
      const job = await this.repository.findJob(db, input.originatingJobId);
      if (job === null || job.workOrderId !== workOrderId) {
        throw new AppFailure('ERR-RES-001', {
          message: `Job ${input.originatingJobId} does not belong to work order ${workOrderId}`,
        });
      }
    }

    // The job the work was actually discovered on. Named by the caller, or — when
    // only a finding is named — DERIVED from that finding's report.
    let originatingJobId = input.originatingJobId ?? null;

    if (input.originatingFindingId !== undefined) {
      // `originating_finding_id` has NO foreign key, so nothing in the database will
      // refuse a finding from another work order — or one that does not exist. The
      // check is a read through the `diagnostics` module's public surface, because
      // `dia.findings` belongs to that module.
      const origin = await diagnosticsModule().completion.findingOrigin(
        db,
        input.originatingFindingId
      );
      if (origin === null || origin.workOrderId !== workOrderId) {
        throw new AppFailure('ERR-RES-001', {
          message: `Finding ${input.originatingFindingId} does not belong to work order ${workOrderId}`,
        });
      }
      // Derived, not defaulted, and this closes a real gap: the execution gate keys
      // on `originating_job_id`, so a request naming ONLY a finding would have gated
      // no job at all — extra work discovered by a diagnostic would let the very job
      // that discovered it carry on unapproved, while the same work discovered by
      // hand stopped it. The finding's report carries a NOT NULL `job_id`, so this is
      // the exact job the finding was recorded against and not an approximation.
      // A caller-supplied job wins, and disagreeing with the finding's job is
      // refused rather than silently reconciled: two different answers to "where did
      // this come from" mean one of them is wrong.
      if (originatingJobId === null) {
        originatingJobId = origin.jobId;
      } else if (originatingJobId !== origin.jobId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The named job is not the job the named finding was recorded on',
          safeDetails: {
            violations: [{ path: 'body.originatingJobId', rule: 'origin_conflict' }],
          },
        });
      }
    }

    const created = await this.repository.createRequest(db, {
      workOrderId,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      originatingJobId,
      originatingFindingId: input.originatingFindingId ?? null,
      summary: input.summary,
      // Defaults to the column default's meaning: extra work discovered mid-repair
      // is required unless the caller says otherwise, because the safe reading of
      // silence is that the vehicle should not leave with it undone.
      isRequired: input.isRequired ?? true,
    });

    await appendAudit(db, {
      action: 'wo.additional_work.requested',
      entityType: 'wo.additional_work_request',
      entityId: created.id,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      details: [
        { field: 'work_order_id', classification: 'internal', value: workOrderId },
        // The SAFE summary, never the restricted description: that lives in a
        // permission-gated table and putting it here would route it around the gate.
        { field: 'summary', classification: 'internal', value: created.summary },
        { field: 'is_required', classification: 'public', value: String(created.isRequired) },
        ...(created.originatingJobId === null
          ? []
          : [
              {
                field: 'originating_job_id',
                classification: 'internal' as const,
                value: created.originatingJobId,
              },
            ]),
        ...(created.originatingFindingId === null
          ? []
          : [
              {
                field: 'originating_finding_id',
                classification: 'internal' as const,
                value: created.originatingFindingId,
              },
            ]),
      ],
    });

    await publishEvent(db, {
      eventType: 'additional-work.requested',
      aggregateId: created.id,
      aggregateVersion: created.recordVersion,
      producer: 'wo.additional-work-service',
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      // Metadata only. A consumer needing the customer-facing description reads it
      // under its own authorization, behind `iam.sensitive.view` — an event is a
      // notification that something happened, never a way around a read gate.
      payload: {
        additionalWorkRequestId: created.id,
        workOrderId,
        isRequired: created.isRequired,
        state: created.state,
      },
      eventKey: `additional-work.requested:${created.id}`,
    });

    return toRequestView(created);
  }

  /** Every live additional-work request on a work order, oldest first. */
  async list(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly AdditionalWorkRequestView[]> {
    await this.requireWorkOrderInScope(db, workOrderId, authorizeScope);
    return (await this.repository.requestsFor(db, workOrderId)).map(toRequestView);
  }

  /**
   * Records or replaces the RESTRICTED customer-facing description.
   *
   * Replaceable rather than write-once because the schema says so: the migration
   * grants UPDATE and `tg_additional_work_request_details_immutable` freezes the
   * scope columns, the request link and the classification — but not the description.
   * A customer-facing text that could never be corrected would be the worse contract.
   *
   * The write is refused twice over for a caller without `iam.sensitive.view`: by the
   * operation's declared permissions before the handler runs, and by
   * `ins_additional_work_request_details_gated` if it ever got past that. The second
   * one arrives as `42501` and is mapped rather than surfaced as a 500.
   */
  async writeDetail(
    db: DbHandle,
    requestId: string,
    input: { readonly description: string },
    authorizeScope?: ScopeAuthorizer
  ): Promise<AdditionalWorkDetailView> {
    const request = await this.lockDecidableRequest(db, requestId, authorizeScope);

    let detail;
    try {
      detail = await this.repository.writeDetail(db, {
        requestId,
        companyId: request.companyId,
        branchId: request.branchId,
        description: input.description,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
        throw new AppFailure('ERR-IAM-001', {
          message: 'Recording the restricted description was refused by policy',
          cause: error,
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'wo.additional_work.detail_recorded',
      entityType: 'wo.additional_work_request',
      entityId: requestId,
      companyId: request.companyId,
      branchId: request.branchId,
      // The FACT and its classification, never the text. The description is
      // `restricted` data living behind `iam.sensitive.view`, and `iam.audit_records`
      // is not gated by that permission — copying the content here would publish it
      // to every auditor, which is precisely the leak the gate exists to prevent.
      details: [
        { field: 'classification', classification: 'public', value: detail.classification },
        { field: 'description_recorded', classification: 'internal', value: 'true' },
        {
          field: 'description_length',
          classification: 'internal',
          value: String(input.description.length),
        },
      ],
    });

    return {
      additionalWorkRequestId: detail.additionalWorkRequestId,
      description: detail.description,
      classification: detail.classification,
      recordVersion: detail.recordVersion,
    };
  }

  /**
   * The restricted description.
   *
   * A missing detail and an unauthorized reader are the same answer at the data
   * layer, because `sel_additional_work_request_details_gated` hides the row rather
   * than erroring — but they can never be confused HERE, because the operation
   * declaring this method already requires `iam.sensitive.view`, so a caller who
   * reaches it holds the permission and a null genuinely means no detail was written.
   */
  async detail(
    db: DbHandle,
    requestId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<AdditionalWorkDetailView> {
    const request = await this.requireRequestInScope(db, requestId, authorizeScope);
    const detail = await this.repository.detailFor(db, request.id);
    if (detail === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Additional-work request ${requestId} has no recorded description`,
      });
    }
    // A read of `restricted` data is itself a fact worth keeping. Written only on a
    // read that SUCCEEDED, because a refusal is already recorded by the authorization
    // pipeline and a second record of it would double-count.
    await appendAudit(db, {
      action: 'wo.additional_work.detail_read',
      entityType: 'wo.additional_work_request',
      entityId: request.id,
      companyId: request.companyId,
      branchId: request.branchId,
      details: [
        { field: 'classification', classification: 'public', value: detail.classification },
      ],
    });
    return {
      additionalWorkRequestId: detail.additionalWorkRequestId,
      description: detail.description,
      classification: detail.classification,
      recordVersion: detail.recordVersion,
    };
  }

  /** Retracts the workshop's own request, so it stops gating work and closure. */
  async withdraw(
    db: DbHandle,
    requestId: string,
    input: { readonly reason: string; readonly expectedVersion: number },
    authorizeScope?: ScopeAuthorizer
  ): Promise<AdditionalWorkRequestView> {
    const request = await this.lockDecidableRequest(db, requestId, authorizeScope);
    if (request.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Additional-work request ${requestId} was modified by another request`,
      });
    }
    assertAdditionalWorkTransition(request.state, 'withdrawn');

    const moved = await this.repository.applyRequestState(
      db,
      requestId,
      'withdrawn',
      input.expectedVersion
    );
    if (!moved) {
      throw new AppFailure('ERR-CON-001', {
        message: `Additional-work request ${requestId} was modified by another request`,
      });
    }
    await this.auditStateChange(db, request, 'withdrawn', input.reason);
    return toRequestView({
      ...request,
      state: 'withdrawn',
      recordVersion: input.expectedVersion + 1,
    });
  }

  /**
   * Records the customer's decision AND moves the request, in one transaction.
   *
   * The order is fixed by `wo.guard_additional_work_state`, which refuses
   * `state = 'approved'` unless the approval row is already there — see the header.
   * Every step below is inside the caller's transaction, so a failure at any point
   * leaves no approval, no evidence, no state change, no audit record and no outbox
   * row: the decision is recorded whole or not at all.
   */
  async decide(
    db: DbHandle,
    requestId: string,
    input: DecideInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<{
    readonly request: AdditionalWorkRequestView;
    readonly approval: CustomerApprovalView;
  }> {
    const request = await this.lockDecidableRequest(db, requestId, authorizeScope);
    if (request.recordVersion !== input.expectedVersion) {
      // The stale-scope refusal. What the customer was shown belonged to the request
      // as it stood; a request that has moved since is not the thing they decided on.
      throw new AppFailure('ERR-CON-001', {
        message: `Additional-work request ${requestId} changed after the scope was presented`,
      });
    }
    const toState: AdditionalWorkState = input.decision === 'approved' ? 'approved' : 'rejected';
    assertAdditionalWorkTransition(request.state, toState);

    // Evidence is validated BEFORE the approval is written, so an unusable document
    // version cannot leave a decision recorded with evidence missing from it.
    for (const item of input.evidence ?? []) {
      await this.assertBindableVersion(db, item.documentVersionId);
    }

    let approval: CustomerApprovalRow;
    try {
      approval = await this.repository.recordApproval(db, {
        requestId,
        companyId: request.companyId,
        branchId: request.branchId,
        decidingPartyRoleId: input.decidingPartyRoleId,
        decision: input.decision,
        channel: input.channel,
        presentedScope: input.presentedScope,
      });
    } catch (error) {
      throw this.mapApprovalFailure(error, requestId, input.decidingPartyRoleId);
    }

    const evidence: ApprovalEvidenceRow[] = [];
    for (const item of input.evidence ?? []) {
      try {
        evidence.push(
          await this.repository.recordApprovalEvidence(db, {
            approvalId: approval.id,
            companyId: request.companyId,
            branchId: request.branchId,
            documentVersionId: item.documentVersionId,
            evidenceType: item.evidenceType,
            note: item.note ?? null,
          })
        );
      } catch (error) {
        if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
          // `fk_customer_approval_evidence_version` is `(tenant_id, document_version_id)`,
          // so a version in another tenant cannot be named at all. The pre-check above
          // already refuses what a caller can see; this is the database backstop.
          throw new AppFailure('ERR-RES-001', {
            message: `Document version ${item.documentVersionId} is not visible in this scope`,
            cause: error,
          });
        }
        throw error;
      }
    }

    let moved: boolean;
    try {
      moved = await this.repository.applyRequestState(
        db,
        requestId,
        toState,
        input.expectedVersion
      );
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // `wo.guard_additional_work_state` refused the move. Unreachable while the
        // approval above committed in this same transaction, and mapped anyway: the
        // alternative is a 500 on the one control the whole surface rests on.
        throw new AppFailure('ERR-TRN-001', {
          message: `Additional-work request ${requestId} may not become "${toState}"`,
          cause: error,
        });
      }
      throw error;
    }
    if (!moved) {
      throw new AppFailure('ERR-CON-001', {
        message: `Additional-work request ${requestId} was modified by another request`,
      });
    }

    await appendAudit(db, {
      action: 'wo.customer_approval.recorded',
      entityType: 'wo.customer_approval',
      entityId: approval.id,
      companyId: request.companyId,
      branchId: request.branchId,
      details: [
        {
          field: 'additional_work_request_id',
          classification: 'internal',
          value: requestId,
        },
        { field: 'decision', classification: 'public', value: approval.decision },
        { field: 'channel', classification: 'public', value: approval.channel },
        // The deciding party identifies a customer contact, so it is `internal`.
        {
          field: 'deciding_party_role_id',
          classification: 'internal',
          value: approval.decidingPartyRoleId,
        },
        // The presented scope is what a customer was told about their own vehicle,
        // so its LENGTH and the fact it was recorded go here and the text does not.
        // The length is not decoration: it is what lets an auditor see that a
        // differently sized scope was presented from the one a dispute is about,
        // without the audit trail itself carrying customer-facing text.
        { field: 'presented_scope_recorded', classification: 'internal', value: 'true' },
        {
          field: 'presented_scope_length',
          classification: 'internal',
          value: String(approval.presentedScope.length),
        },
        {
          field: 'evidence_count',
          classification: 'public',
          value: String(evidence.length),
        },
      ],
    });

    // Two audit records, deliberately: capturing a decision and moving the request
    // are separate facts with separate consequences, and an auditor asking "when did
    // the customer agree" must not have to infer it from a state change.
    await this.auditStateChange(db, request, toState, null);

    await publishEvent(db, {
      eventType: 'customer-approval.recorded',
      // The aggregate is the APPROVAL: the catalog declares
      // `aggregateType: 'wo.customer_approval'`, and the row is immutable, so its
      // version is and stays 1.
      aggregateId: approval.id,
      aggregateVersion: approval.recordVersion,
      producer: 'wo.additional-work-service',
      companyId: request.companyId,
      branchId: request.branchId,
      payload: {
        customerApprovalId: approval.id,
        additionalWorkRequestId: requestId,
        workOrderId: request.workOrderId,
        decision: approval.decision,
        channel: approval.channel,
      },
      // Keyed by the REQUEST, not by the approval row, and no version.
      // `uq_customer_approvals_active` allows exactly one live decision per request,
      // so "the customer decided about this request" happens at most once — and the
      // request id is what a consumer already correlates on, since it is the id in
      // `additional-work.requested`. Keying by the approval would be keying by an id
      // no consumer has seen before this message.
      //
      // It also makes atomicity PROVABLE: a test can pre-insert this exact key and
      // watch the whole transaction — approval row, evidence rows, state change and
      // both audit records — roll back behind the collision. Keyed by an id the
      // database generates mid-transaction, nothing could reach that failure
      // deterministically, and the rollback claim would rest on an argument instead
      // of an observation.
      eventKey: `customer-approval.recorded:${requestId}`,
    });

    return {
      request: toRequestView({
        ...request,
        state: toState,
        recordVersion: input.expectedVersion + 1,
      }),
      approval: toApprovalView(approval, evidence),
    };
  }

  /** The decision on one request, with its evidence. */
  async approval(
    db: DbHandle,
    requestId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<CustomerApprovalView> {
    const request = await this.requireRequestInScope(db, requestId, authorizeScope);
    const approval = await this.repository.approvalFor(db, request.id);
    if (approval === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Additional-work request ${requestId} has no recorded decision`,
      });
    }
    return toApprovalView(approval, await this.repository.evidenceFor(db, approval.id));
  }

  /**
   * Records that approved additional work was carried out, or waived.
   *
   * This is the only way B3's second limb can ever be cleared. B3 blocks closure while
   * a required request is `approved` and `unfulfilled`, and nothing else in the phase
   * writes `fulfillment_state` — without this operation an approved required request
   * would block its work order's closure permanently, which is a deadlock rather than
   * a control.
   *
   * Only an APPROVED request may be fulfilled or waived. Fulfilling a pending request
   * would record that work was done which the customer has not authorised, and
   * fulfilling a rejected or withdrawn one would record work that was cancelled.
   */
  async setFulfillment(
    db: DbHandle,
    requestId: string,
    input: {
      readonly fulfillmentState: SettableFulfillmentState;
      readonly reason?: string | undefined;
      readonly expectedVersion: number;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<AdditionalWorkRequestView> {
    // `lockDecidableRequest`, not `lockRequestInScope`: the parent's terminality
    // matters here for the same reason it matters everywhere else on this aggregate,
    // and nothing in the schema enforces it. `fulfillment_state` is not frozen by
    // `tg_additional_work_requests_immutable`, `upd_additional_work_requests_scope`
    // carries no state predicate, and `tg_additional_work_requests_state` fires only
    // on `UPDATE OF state` — so a fulfilment-only update never reaches a guard at
    // all. An earlier draft used the non-checking helper, leaving a closed order's
    // record writable after the vehicle was released: an approved OPTIONAL request
    // (which B3 ignores, so it never blocked closure) could be marked fulfilled
    // afterwards, and a fulfilled one flipped to `waived`, rewriting the fact the
    // closure was granted on.
    const request = await this.lockDecidableRequest(db, requestId, authorizeScope);
    if (request.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Additional-work request ${requestId} was modified by another request`,
      });
    }
    if (request.state !== 'approved') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Only an approved additional-work request may be fulfilled or waived; this one is "${request.state}"`,
      });
    }
    if (request.fulfillmentState === input.fulfillmentState) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Additional-work request ${requestId} is already "${input.fulfillmentState}"`,
      });
    }
    if (input.fulfillmentState === 'waived' && (input.reason ?? '').trim().length === 0) {
      // Waiving is declining to do work the customer already agreed to, so it is
      // accountable. The schema has no reason column for it, so the reason lives in
      // the audit record — which is stated rather than left to be discovered.
      throw new AppFailure('ERR-VAL-001', {
        message: 'Waiving approved additional work requires a reason',
        safeDetails: { violations: [{ path: 'body.reason', rule: 'required' }] },
      });
    }

    const applied = await this.repository.applyRequestFulfillment(
      db,
      requestId,
      input.fulfillmentState,
      input.expectedVersion
    );
    if (!applied) {
      throw new AppFailure('ERR-CON-001', {
        message: `Additional-work request ${requestId} was modified by another request`,
      });
    }

    await appendAudit(db, {
      action: 'wo.additional_work.fulfillment_changed',
      entityType: 'wo.additional_work_request',
      entityId: requestId,
      companyId: request.companyId,
      branchId: request.branchId,
      details: [
        {
          field: 'fulfillment_state',
          classification: 'public',
          previousValue: request.fulfillmentState,
          value: input.fulfillmentState,
        },
        ...(input.reason === undefined
          ? []
          : [{ field: 'reason', classification: 'internal' as const, value: input.reason }]),
      ],
    });

    return toRequestView({
      ...request,
      fulfillmentState: input.fulfillmentState,
      recordVersion: input.expectedVersion + 1,
    });
  }

  // -------------------------------------------------------------------------

  /** One audit record for a request state change, whatever moved it. */
  private async auditStateChange(
    db: DbHandle,
    request: AdditionalWorkRequestRow,
    toState: string,
    reason: string | null
  ): Promise<void> {
    await appendAudit(db, {
      action: 'wo.additional_work.state_changed',
      entityType: 'wo.additional_work_request',
      entityId: request.id,
      companyId: request.companyId,
      branchId: request.branchId,
      details: [
        {
          field: 'state',
          classification: 'public',
          previousValue: request.state,
          value: toState,
        },
        ...(reason === null
          ? []
          : [{ field: 'reason', classification: 'internal' as const, value: reason }]),
      ],
    });
  }

  /**
   * Confirms a document version may be bound as evidence.
   *
   * Reached through the `shared-services` attachment service, which is the only way a
   * document version exists at all — the route never accepts a storage key, and the
   * evidence table has no column for one. `scanState` reads the version under RLS, so
   * a version in another tenant is a uniform 404 rather than a disclosure.
   *
   * `accepted` is deliberately NOT required, and that is not laxity: P1-15 documented
   * that acceptance is unreachable because `shared.guard_document_version_transition`
   * needs a `clean` row in `shared.file_scan_results` and no application role may
   * write that table. Requiring `accepted` would make approval evidence impossible
   * for every caller. What CAN be refused is a version somebody rejected or
   * quarantined, and that is what is refused.
   */
  private async assertBindableVersion(db: DbHandle, documentVersionId: string): Promise<void> {
    // The caller's handle, so the read runs inside this transaction: a version
    // registered earlier in the same request must be visible, and the visibility
    // decision must be the one that holds when the evidence row is written.
    const state = await sharedServicesModule().attachments.scanState(db, documentVersionId);
    if (EVIDENCE_REFUSED_STATES.includes(state.status)) {
      throw new AppFailure('ERR-DOC-001', {
        message: `Document version is "${state.status}" and may not be used as approval evidence`,
      });
    }
  }

  /** Locks a work order and refuses one that may not receive additional work. */
  private async lockOpenWorkOrder(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<WorkOrderRow> {
    const locked = await this.repository.lockWorkOrder(db, workOrderId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Work order ${workOrderId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    const states = await this.catalog.workOrderStates(db);
    const state = states.find((candidate) => candidate.code === locked.state);
    // `allows_additional_work` is the catalog's OWN answer to this question, and it
    // is not the same as "not terminal": on the seeded platform graph `draft`,
    // `qc_pending` and `ready_to_close` are all non-terminal and all `false`. An
    // earlier draft of this method gated on terminality alone, which would have let
    // a technician raise extra work on an order already presented for quality
    // control — after the point at which its scope was supposed to be fixed. The
    // flag is tenant-overridable, which is exactly why it is read rather than
    // mirrored.
    if (state === undefined || state.isTerminal || !state.allowsAdditionalWork) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order state "${locked.state}" does not accept additional work`,
      });
    }
    return locked;
  }

  /** The work order, scoped, for a read path. */
  private async requireWorkOrderInScope(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<WorkOrderRow> {
    const row = await this.repository.findWorkOrder(db, workOrderId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', { message: `Work order ${workOrderId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: row.companyId, branchId: row.branchId });
    }
    return row;
  }

  /**
   * The request, scoped against ITS OWN company and branch.
   *
   * `/additional-work/{requestId}` names no branch, so the pre-handler check has
   * nothing to narrow by and `scope: 'branch'` would be inert (P1-18-A-01). The row's
   * own scope is the authority, and it is read before any decision is taken.
   */
  private async requireRequestInScope(
    db: DbHandle,
    requestId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<AdditionalWorkRequestRow> {
    const row = await this.repository.findRequest(db, requestId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Additional-work request ${requestId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: row.companyId, branchId: row.branchId });
    }
    return row;
  }

  /** The locked request, scoped against its own company and branch. */
  private async lockRequestInScope(
    db: DbHandle,
    requestId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<AdditionalWorkRequestRow> {
    const row = await this.repository.lockRequest(db, requestId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Additional-work request ${requestId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: row.companyId, branchId: row.branchId });
    }
    return row;
  }

  /**
   * The locked request, refused when its parent work order is already terminal.
   *
   * A decision recorded against a closed work order would be a decision about work
   * nobody can do, and the schema would allow it: `wo.customer_approvals` has no
   * predicate on the order's state, and `wo.guard_work_order_closure` runs at closure
   * time only.
   */
  private async lockDecidableRequest(
    db: DbHandle,
    requestId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<AdditionalWorkRequestRow> {
    // PARENT FIRST, then the child. An earlier version locked the request and then read
    // the order UNLOCKED, so a closure could commit between the parent check and the
    // child write and a decision would land on an order that had already been released.
    //
    // The order of the two locks is the part that needed thinking about, and it is why
    // the parent is not simply locked where it was read. Every other path in this module
    // — transition, closure, line writes — takes `wo.work_orders` first and its children
    // after. Locking the request first and the order second would have inverted that and
    // opened a deadlock against a concurrent closure. So the request's `work_order_id` is
    // read unlocked to learn WHICH order to lock, which is safe because
    // `tg_additional_work_requests_immutable` freezes that column, and then the two locks
    // are taken in the platform's own order.
    const unlocked = await this.repository.findRequest(db, requestId);
    if (unlocked === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Additional-work request ${requestId} is not visible`,
      });
    }
    const workOrder = await this.repository.lockWorkOrder(db, unlocked.workOrderId);
    const states = await this.catalog.workOrderStates(db);
    const parent = states.find((candidate) => candidate.code === workOrder?.state);
    if (parent === undefined || parent.isTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order state "${workOrder?.state ?? 'unknown'}" is closed to additional-work changes`,
      });
    }
    // Re-read under its own lock. The unlocked read above is used ONLY for the frozen
    // `work_order_id`; every field the caller acts on comes from the locked row.
    return this.lockRequestInScope(db, requestId, authorizeScope);
  }

  /**
   * Turns the approval insert's database refusals into the right catalog codes.
   *
   * Three arrive here and they mean three different things, which is why the
   * constraint name is inspected rather than the SQLSTATE alone:
   *
   *  - `23505` on `uq_customer_approvals_active` — a second live decision on one
   *    request. The index is the authority; the state check above is the readable
   *    refusal in front of it, and this is what a lost race lands on.
   *  - `23514` from `wo.guard_customer_approval_coherence` — the deciding party role
   *    exists but belongs to a different reception visit or tenant.
   *  - `23503` from the same guard, or from `fk_customer_approvals_party_role` — the
   *    role is not resolvable at all.
   *
   * No constraint name and no SQL text reaches the caller. The names are used for
   * deterministic mapping and stay on this side of the boundary.
   */
  private mapApprovalFailure(error: unknown, requestId: string, partyRoleId: string): unknown {
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      return new AppFailure('ERR-RES-002', {
        message: `Additional-work request ${requestId} already carries a customer decision`,
        cause: error,
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'The deciding party is not on the reception visit this work order came from',
        cause: error,
        safeDetails: {
          violations: [{ path: 'body.decidingPartyRoleId', rule: 'not_on_reception_visit' }],
        },
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-RES-001', {
        message: `Deciding party role ${partyRoleId} is not visible in this scope`,
        cause: error,
      });
    }
    return error;
  }
}
