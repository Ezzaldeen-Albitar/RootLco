/**
 * The quality and closure contract (P1-29, `W8`).
 *
 * | operation                              | method | path                                         | permission                                    |
 * | -------------------------------------- | ------ | -------------------------------------------- | --------------------------------------------- |
 * | `qms.qc-record-branch-list`            | GET    | `/quality-controls`                          | `qms.quality_control.read`                    |
 * | `qms.qc-check-list`                    | GET    | `/qc-checks`                                 | `qms.quality_control.read`                    |
 * | `qms.qc-record-list`                   | GET    | `/work-orders/{id}/quality-controls`         | `qms.quality_control.read`                    |
 * | `qms.qc-record-open`                   | POST   | `/work-orders/{id}/quality-controls`         | `qms.quality_control.record`                  |
 * | `qms.qc-record-detail`                 | GET    | `/quality-controls/{recordId}`               | `qms.quality_control.read`                    |
 * | `qms.qc-check-result`                  | PUT    | `/quality-controls/{recordId}/checks/{check}` | `qms.quality_control.record`                 |
 * | `qms.qc-record-finalize`               | POST   | `/quality-controls/{recordId}/finalization`  | `qms.quality_control.finalize` (If-Match)     |
 * | `qms.rework-list` / `-create`          | GET/POST | `/work-orders/{id}/rework`                 | `qms.quality_control.read` / `qms.rework.manage` |
 * | `qms.rework-detail`                    | GET    | `/rework-links/{id}`                         | `qms.quality_control.read`                    |
 * | `qms.rework-sign-off`                  | POST   | `/rework-links/{id}/sign-off`                | `qms.rework.sign_off` (If-Match)              |
 * | `qms.rework-cost-read` / `-record`     | GET/PUT | `/rework-links/{id}/cost`                   | read/manage + `iam.sensitive.view`            |
 * | `qms.reopen-attempt-list` / `-attempt` | GET/POST | `/work-orders/{id}/reopen-attempts`        | `qms.quality_control.read` / `wo.work_order.transition` |
 * | `wo.work-order-closure-eligibility`    | GET    | `/work-orders/{id}/closure-eligibility`      | `wo.work_order.read`                          |
 * | `wo.work-order-closure`                | POST   | `/work-orders/{id}/closure`                  | `wo.work_order.transition` + `.close` (If-Match) |
 * | `wo.additional-work-list` / `-request` | GET/POST | `/work-orders/{id}/additional-work`        | `wo.work_order.read` / `wo.additional_work.request` |
 * | `wo.additional-work-approval-read` / `-approval` | GET/POST | `/additional-work/{id}/approval`   | `wo.work_order.read` / `wo.additional_work.approve` (If-Match) |
 * | `wo.additional-work-detail-read` / `-record` | GET/PUT | `/additional-work/{id}/detail`        | read/request + `iam.sensitive.view`           |
 * | `wo.additional-work-fulfillment` / `-withdraw` | POST | `/additional-work/{id}/fulfillment|withdrawal` | `wo.additional_work.request`        |
 * | `wo.work-order-timeline`               | GET    | `/work-orders/{id}/timeline`                 | `wo.work_order.read`                          |
 * | `wo.job-blocker-list` / `-raise`       | GET/POST | `/jobs/{jobId}/blockers`                   | `wo.work_order.read` / `tech.labor.record`    |
 * | `wo.job-blocker-resolve`               | POST   | `/blockers/{blockerId}/resolution`           | `tech.labor.record`                           |
 *
 * Typed from the views the routes return — `QcRecordRow`, `QcCheckRow`,
 * `QcCheckVocabularyRow`, `QcCheckResultRow`, `QcRecordDetail` (quality module),
 * `ClosureEligibility` / `ClosureBlocker` (work-order service), `ReworkLinkView`,
 * `ReopenAttemptView` and the `ReopenAttemptResult` envelope its POST answers with
 * (rework service), `AdditionalWorkRequestView`,
 * `AdditionalWorkDetailView`, `CustomerApprovalView` (additional-work service),
 * `WorkOrderTimelinePage` and `JobBlockerView` (job-board service, W6). Every
 * interface is held field-for-field against the row that came back in
 * `tests/backend/p1-29-w8-quality-and-closure`.
 *
 * ## Restricted narratives — the contract's own rule
 *
 * The rework COST and the additional-work DESCRIPTION render only with
 * `iam.sensitive.view`; their metadata parents render in scope. The page gates
 * the read; the backend refuses it regardless.
 *
 * ## What this module deliberately does NOT model
 *
 * - **A submit-for-QA operation.** None exists: moving a work order into its
 *   QC state is `wo.work-order-transition` on the detail (W3), to whichever
 *   state the catalogue permits from the current one.
 * - **Editing a QC result, a rework link's narrative, or an attempt.** No such
 *   operation exists; the reopen-attempt log is append-only by design.
 * - **A blocker vocabulary.** A blocker is a note; its status is derived.
 */

export const QUALITY_PERMISSIONS = {
  qcRead: 'qms.quality_control.read',
  qcRecord: 'qms.quality_control.record',
  qcFinalize: 'qms.quality_control.finalize',
  reworkManage: 'qms.rework.manage',
  reworkSignOff: 'qms.rework.sign_off',
  workRead: 'wo.work_order.read',
  transition: 'wo.work_order.transition',
  close: 'wo.work_order.close',
  additionalWorkRequest: 'wo.additional_work.request',
  additionalWorkApprove: 'wo.additional_work.approve',
  laborRecord: 'tech.labor.record',
  sensitiveView: 'iam.sensitive.view',
} as const;

/** `QcRecordRow` — the queue row and the per-order list row. */
export interface QcRecord {
  readonly id: string;
  readonly workOrderId: string;
  readonly overallResult: string;
  readonly checkerId: string | null;
  readonly finalizedAt: string | null;
  readonly recordVersion: number;
}

/** `QcCheckRow` — a check as the record detail names it. */
export interface QcCheck {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isMandatory: boolean;
  readonly isSafetyCritical: boolean;
}

/** `QcCheckVocabularyRow` — the vocabulary read, each row saying its scope and status. */
export interface QcCheckVocabularyEntry extends QcCheck {
  readonly scope: 'platform' | 'tenant';
  readonly status: string;
  readonly recordVersion: number;
}

/** `QcCheckResultRow`. */
export interface QcCheckResult {
  readonly id: string;
  readonly qcCheckId: string;
  readonly checkCode: string;
  readonly result: string;
  readonly note: string | null;
  readonly recordVersion: number;
}

/** `QcRecordDetail`. */
export interface QcRecordDetail {
  readonly record: QcRecord;
  readonly results: readonly QcCheckResult[];
  readonly unresolvedMandatory: readonly QcCheck[];
}

/** `ClosureBlocker` — code B1..B6, the backend's own message, and who enforces it. */
export interface ClosureBlocker {
  readonly code: string;
  readonly message: string;
  readonly enforcedBy: string;
}

/** `ClosureEligibility`. */
export interface ClosureEligibility {
  readonly workOrderId: string;
  readonly state: string;
  readonly eligible: boolean;
  readonly blockers: readonly ClosureBlocker[];
  readonly alreadyTerminal: boolean;
  readonly deferred: {
    readonly owner: string;
    readonly conditions: readonly string[];
    readonly reason: string;
  };
  /**
   * The two deferred conditions, evaluated: stock this work order still holds.
   * `blocking` is folded into `eligible`, and `close` refuses for the same reason.
   */
  readonly inventoryCommitments: {
    readonly activeReservations: number;
    readonly openIssues: number;
    readonly blocking: boolean;
  };
}

/** `ReworkLinkView`. */
export interface ReworkLink {
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

/** `ReopenAttemptView` — the append-only log. */
export interface ReopenAttempt {
  readonly id: string;
  readonly workOrderId: string;
  readonly reason: string;
  readonly outcome: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
}

/**
 * `ReopenAttemptResult` — what `qms.reopen-attempt` answers: the attempt it kept,
 * paired with the refusal that is DATA rather than an error. The refusal is
 * server prose, and an action outcome carries translation keys only, so the
 * view renders the translated outcome from the reloaded log and the note that
 * names the alternative; the envelope is mirrored so the pairing is not lost.
 */
export interface ReopenAttemptResult {
  readonly attempt: ReopenAttempt;
  readonly refusal: string;
}

/** `AdditionalWorkRequestView`. */
export interface AdditionalWorkRequest {
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

/** `AdditionalWorkDetailView` — restricted: only with `iam.sensitive.view`. */
export interface AdditionalWorkDetail {
  readonly additionalWorkRequestId: string;
  readonly description: string;
  readonly classification: string;
  readonly recordVersion: number;
}

export interface ApprovalEvidence {
  readonly id: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: string;
}

/** `CustomerApprovalView`. */
export interface CustomerApproval {
  readonly id: string;
  readonly additionalWorkRequestId: string;
  readonly decidingPartyRoleId: string;
  readonly decision: string;
  readonly channel: string;
  readonly presentedScope: string;
  readonly quotationRevisionRef: string | null;
  readonly decidedAt: string;
  readonly recordVersion: number;
  readonly evidence: readonly ApprovalEvidence[];
}

/** `JobBlockerResolutionView` (W6). */
export interface JobBlockerResolution {
  readonly id: string;
  readonly note: string;
  readonly resolvedAt: string;
  readonly resolvedBy: string;
}

/** `JobBlockerView` (W6) — status is derived: raised until a resolution references it. */
export interface JobBlocker {
  readonly id: string;
  readonly jobId: string;
  readonly note: string;
  readonly raisedAt: string;
  readonly raisedBy: string;
  readonly status: 'raised' | 'resolved';
  readonly resolution: JobBlockerResolution | null;
}

/** `WorkOrderTimelineEntry` (W6) — the kind is rendered as the code it is. */
export interface WorkOrderTimelineEntry {
  readonly kind: string;
  readonly id: string;
  readonly jobId: string | null;
  readonly actorId: string | null;
  readonly occurredAt: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly note: string | null;
  readonly reference: string | null;
  readonly detail: string | null;
}

/** `OmittedTimelineKind` (W6) — withheld from THIS caller, named with the code that would show it. */
export interface OmittedTimelineKind {
  readonly kind: string;
  readonly requires: string;
}

/** `WorkOrderTimelinePage` (W6) — a real keyset page plus the declared omissions. */
export interface WorkOrderTimelinePage {
  readonly workOrderId: string;
  readonly items: readonly WorkOrderTimelineEntry[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly omittedKinds: readonly OmittedTimelineKind[];
}
