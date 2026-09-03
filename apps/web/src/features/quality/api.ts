'use server';

/**
 * Quality and closure adapters (P1-29 `W8`), one per operation the screens
 * consume. Path ids come from responses the screen was shown, authority from
 * the session; every version-guarded command carries the `If-Match` the screen
 * was rendered from, so a stale screen is refused with a conflict rather than
 * overwriting silently. The two restricted narratives are read only when the
 * page holds `iam.sensitive.view`; the backend refuses them regardless.
 */
import { authorizedClient } from '@/lib/api/server-client';
import {
  branchTargetQuery,
  query,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, type ActionState } from '@/lib/forms/action-result';
import type {
  QcCheckResultBody,
  QcRecordFinalizeBody,
  QcRecordOpenBody,
  ReopenAttemptBody,
  ReworkCostRecordBody,
  ReworkCreateBody,
  ReworkSignOffBody,
} from '@/lib/contracts/quality-contract';
import type {
  AdditionalWorkApprovalBody,
  AdditionalWorkDetailRecordBody,
  AdditionalWorkFulfillmentBody,
  AdditionalWorkRequestBody,
  AdditionalWorkWithdrawBody,
  JobBlockerRaiseBody,
  JobBlockerResolveBody,
  WorkOrderClosureBody,
} from '@/lib/contracts/work-order-contract';
import type {
  AdditionalWorkDetail,
  AdditionalWorkRequest,
  ClosureEligibility,
  CustomerApproval,
  JobBlocker,
  QcCheckVocabularyEntry,
  QcRecord,
  QcRecordDetail,
  ReopenAttempt,
  ReworkLink,
  WorkOrderTimelinePage,
} from './quality-contract';

const EXPIRED: ActionState = { status: 'expired', correlationId: null, attempt: 1 };

/*
 * Path helpers are FUNCTION declarations: `check-p1-28-access` resolves only
 * `function`-declared helpers when it derives an operation's path from a call
 * site, and an arrow would hide every route below from its least-privilege rule.
 */
function workOrderPath(workOrderId: string, tail = ''): string {
  return `/api/v1/work-orders/${workOrderId}${tail}`;
}
function qcRecordPath(recordId: string, tail = ''): string {
  return `/api/v1/quality-controls/${recordId}${tail}`;
}
function reworkPath(reworkLinkId: string, tail = ''): string {
  return `/api/v1/rework-links/${reworkLinkId}${tail}`;
}
function additionalWorkPath(requestId: string, tail = ''): string {
  return `/api/v1/additional-work/${requestId}${tail}`;
}
function jobPath(jobId: string, tail = ''): string {
  return `/api/v1/jobs/${jobId}${tail}`;
}
function blockerPath(blockerId: string, tail = ''): string {
  return `/api/v1/blockers/${blockerId}${tail}`;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** `qms.qc-record-branch-list` — the branch QC queue, a real cursor page. */
export async function listQcQueue(
  target: BranchTarget,
  filter: { readonly overallResult?: string },
  cursor: string | null
): Promise<ReadState<CursorPage<QcRecord>>> {
  const scope = branchTargetQuery(target);
  const rest = query({ overallResult: filter.overallResult, cursor, limit: 50 });
  const joined = scope + (rest ? (scope ? '&' : '?') + rest.slice(1) : '');
  return readOperation<CursorPage<QcRecord>>('/api/v1/quality-controls' + joined);
}

/** `qms.qc-check-list` — the vocabulary, unpaged, both statuses. */
export async function listQcChecks(): Promise<ReadState<ItemsOnly<QcCheckVocabularyEntry>>> {
  return readOperation<ItemsOnly<QcCheckVocabularyEntry>>('/api/v1/qc-checks');
}

/** `qms.qc-record-list` — the order's QC records, unpaged. */
export async function listQcRecords(workOrderId: string): Promise<ReadState<ItemsOnly<QcRecord>>> {
  return readOperation<ItemsOnly<QcRecord>>(workOrderPath(workOrderId, '/quality-controls'));
}

/** `qms.qc-record-detail`. */
export async function readQcRecord(recordId: string): Promise<ReadState<QcRecordDetail>> {
  return readOperation<QcRecordDetail>(qcRecordPath(recordId));
}

/** `wo.work-order-closure-eligibility` — the B1..B6 gate, as the backend states it. */
export async function readClosureEligibility(
  workOrderId: string
): Promise<ReadState<ClosureEligibility>> {
  return readOperation<ClosureEligibility>(workOrderPath(workOrderId, '/closure-eligibility'));
}

/** `qms.rework-list`. */
export async function listReworkLinks(
  workOrderId: string
): Promise<ReadState<ItemsOnly<ReworkLink>>> {
  return readOperation<ItemsOnly<ReworkLink>>(workOrderPath(workOrderId, '/rework'));
}

/** `qms.rework-cost-read` — restricted: the page reads it only with `iam.sensitive.view`. */
export async function readReworkCost(
  reworkLinkId: string
): Promise<ReadState<{ readonly reworkCost: string; readonly costCurrency: string }>> {
  return readOperation(reworkPath(reworkLinkId, '/cost'));
}

/** `qms.reopen-attempt-list` — the append-only log. */
export async function listReopenAttempts(
  workOrderId: string
): Promise<ReadState<ItemsOnly<ReopenAttempt>>> {
  return readOperation<ItemsOnly<ReopenAttempt>>(workOrderPath(workOrderId, '/reopen-attempts'));
}

/** `wo.additional-work-list`. */
export async function listAdditionalWork(
  workOrderId: string
): Promise<ReadState<ItemsOnly<AdditionalWorkRequest>>> {
  return readOperation<ItemsOnly<AdditionalWorkRequest>>(
    workOrderPath(workOrderId, '/additional-work')
  );
}

/** `wo.additional-work-detail-read` — restricted: only with `iam.sensitive.view`. */
export async function readAdditionalWorkDetail(
  requestId: string
): Promise<ReadState<AdditionalWorkDetail>> {
  return readOperation<AdditionalWorkDetail>(additionalWorkPath(requestId, '/detail'));
}

/** `wo.additional-work-approval-read`. */
export async function readAdditionalWorkApproval(
  requestId: string
): Promise<ReadState<CustomerApproval>> {
  return readOperation<CustomerApproval>(additionalWorkPath(requestId, '/approval'));
}

/** `wo.work-order-timeline` (W6) — one keyset page, newest first, omissions named. */
export async function readWorkOrderTimeline(
  workOrderId: string,
  cursor: string | null
): Promise<ReadState<WorkOrderTimelinePage>> {
  return readOperation<WorkOrderTimelinePage>(
    workOrderPath(workOrderId, '/timeline') + query({ cursor, limit: 50 })
  );
}

/** `wo.job-blocker-list` (W6). */
export async function listJobBlockers(jobId: string): Promise<ReadState<ItemsOnly<JobBlocker>>> {
  return readOperation<ItemsOnly<JobBlocker>>(jobPath(jobId, '/blockers'));
}

/* ------------------------------------------------------------------ *
 * Writes — one shape, so the request each screen builds is the one proved
 * ------------------------------------------------------------------ */

async function send(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  ifMatch?: number
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<unknown>(
    method,
    path,
    body,
    ifMatch === undefined ? {} : { ifMatch }
  );
  if (!result.ok) return fromFailure(result, 1);
  return { status: 'success', correlationId: result.correlationId, attempt: 1 };
}

/** `qms.qc-record-open`. */
export async function openQcRecord(
  workOrderId: string,
  body: QcRecordOpenBody
): Promise<ActionState> {
  return send('POST', workOrderPath(workOrderId, '/quality-controls'), body);
}

/** `qms.qc-check-result` — PUT, keyed by the check the vocabulary named. */
export async function writeQcCheckResult(
  recordId: string,
  qcCheckId: string,
  body: QcCheckResultBody
): Promise<ActionState> {
  return send('PUT', qcRecordPath(recordId, `/checks/${qcCheckId}`), body);
}

/** `qms.qc-record-finalize` — version-guarded on the record's `recordVersion`. */
export async function finalizeQcRecord(
  recordId: string,
  body: QcRecordFinalizeBody,
  ifMatch: number
): Promise<ActionState> {
  return send('POST', qcRecordPath(recordId, '/finalization'), body, ifMatch);
}

/** `qms.rework-create`. */
export async function createRework(
  workOrderId: string,
  body: ReworkCreateBody
): Promise<ActionState> {
  return send('POST', workOrderPath(workOrderId, '/rework'), body);
}

/** `qms.rework-sign-off` — version-guarded on the link's `recordVersion`. */
export async function signOffRework(
  reworkLinkId: string,
  body: ReworkSignOffBody,
  ifMatch: number
): Promise<ActionState> {
  return send('POST', reworkPath(reworkLinkId, '/sign-off'), body, ifMatch);
}

/** `qms.rework-cost-record` — restricted narrative; PUT. */
export async function recordReworkCost(
  reworkLinkId: string,
  body: ReworkCostRecordBody
): Promise<ActionState> {
  return send('PUT', reworkPath(reworkLinkId, '/cost'), body);
}

/** `qms.reopen-attempt` — appends to the log; the outcome is the backend's. */
export async function raiseReopenAttempt(
  workOrderId: string,
  body: ReopenAttemptBody
): Promise<ActionState> {
  return send('POST', workOrderPath(workOrderId, '/reopen-attempts'), body);
}

/** `wo.additional-work-request`. */
export async function requestAdditionalWork(
  workOrderId: string,
  body: AdditionalWorkRequestBody
): Promise<ActionState> {
  return send('POST', workOrderPath(workOrderId, '/additional-work'), body);
}

/** `wo.additional-work-detail-record` — restricted narrative; PUT. */
export async function recordAdditionalWorkDetail(
  requestId: string,
  body: AdditionalWorkDetailRecordBody
): Promise<ActionState> {
  return send('PUT', additionalWorkPath(requestId, '/detail'), body);
}

/** `wo.additional-work-approval` — version-guarded on the request's `recordVersion`. */
export async function recordAdditionalWorkApproval(
  requestId: string,
  body: AdditionalWorkApprovalBody,
  ifMatch: number
): Promise<ActionState> {
  return send('POST', additionalWorkPath(requestId, '/approval'), body, ifMatch);
}

/** `wo.additional-work-fulfillment`. */
export async function fulfillAdditionalWork(
  requestId: string,
  body: AdditionalWorkFulfillmentBody
): Promise<ActionState> {
  return send('POST', additionalWorkPath(requestId, '/fulfillment'), body);
}

/** `wo.additional-work-withdraw`. */
export async function withdrawAdditionalWork(
  requestId: string,
  body: AdditionalWorkWithdrawBody
): Promise<ActionState> {
  return send('POST', additionalWorkPath(requestId, '/withdrawal'), body);
}

/** `wo.work-order-closure` — version-guarded on the order's `recordVersion`. */
export async function closeWorkOrder(
  workOrderId: string,
  body: WorkOrderClosureBody,
  ifMatch: number
): Promise<ActionState> {
  return send('POST', workOrderPath(workOrderId, '/closure'), body, ifMatch);
}

/** `wo.job-blocker-raise` (W6). */
export async function raiseJobBlocker(
  jobId: string,
  body: JobBlockerRaiseBody
): Promise<ActionState> {
  return send('POST', jobPath(jobId, '/blockers'), body);
}

/** `wo.job-blocker-resolve` (W6). */
export async function resolveJobBlocker(
  blockerId: string,
  body: JobBlockerResolveBody
): Promise<ActionState> {
  return send('POST', blockerPath(blockerId, '/resolution'), body);
}
