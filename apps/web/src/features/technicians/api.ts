'use server';

import {
  captureDocument,
  createDocumentLink,
  listDocumentCategories,
} from '@/features/attachments/api';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ItemsOnly,
  type ReadFailureStatus,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, type ActionState } from '@/lib/forms/action-result';
import type {
  LaborSessionCorrectBody,
  LaborSessionStartBody,
} from '@/lib/contracts/technician-contract';
import type {
  JobEvidenceRecordBody,
  JobWorkLogRecordBody,
} from '@/lib/contracts/work-order-contract';
import {
  EVIDENCE_DOCUMENT_ENTITY_TYPE,
  type JobAssignmentRow,
  type JobEvidenceEntry,
  type LaborSession,
  type OwnAssignment,
  type TechnicianQueueEntry,
  type WorkLogEntry,
} from './technicians-contract';

/**
 * The technician workspace adapters (P1-29, `W4`).
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application. This file turns operations into view states, and —
 * the one thing that is new in this feature — it RESOLVES the caller's own
 * identity before every write, so that no screen ever holds a technician id it
 * could choose.
 *
 * ## The identity seam, and why every write takes an `assignmentId`
 *
 * `tech.labor-session-start` needs `technicianProfileId`; the queue withholds
 * it. So a write here is addressed by the caller's own ASSIGNMENT — the id the
 * queue row carries — and the adapter turns that into the profile id
 * server-side by reading the caller's own queue again (the backend resolves it
 * from the session, not from anything sent) and matching the assignment in the
 * job's assignment list. A screen that passed an assignment that is not in the
 * caller's own queue is refused before any write is attempted. There is no
 * parameter through which a technician id can enter.
 *
 * ## No write is retried, and a stale one is refused
 *
 * `tech.labor-session-stop` and `-correct` are `versionGuarded`, so they carry
 * the `recordVersion` the screen is showing as `If-Match`. A conflict is
 * returned as a conflict; nothing here re-reads and resubmits on the caller's
 * behalf.
 */

/*
 * Path helpers, as FUNCTION DECLARATIONS returning one template — the one
 * shape `check-p1-28-access.mjs` (via `pathHelpers`) can resolve into the
 * operation a call site reaches. An arrow helper builds the same string and is
 * invisible to the least-privilege rule, which then reports every permission
 * this page consults as surplus. The tail is always a literal at the call
 * site, and anything that varies is concatenated AFTER the helper, so the
 * resolved path is exactly the registered route.
 */
function jobPath(jobId: string, tail = ''): string {
  return `/api/v1/jobs/${encodeURIComponent(jobId)}${tail}`;
}

function sessionPath(sessionId: string, tail = ''): string {
  return `/api/v1/labor-sessions/${encodeURIComponent(sessionId)}${tail}`;
}

const EXPIRED: ActionState = { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * The caller's own assigned work (`tech.technician-me-queue`).
 *
 * The branch pair is a TARGET and is required: the operation is
 * `scope: 'branch'` and its query is `.strict()`. Nothing else is sent. In
 * particular NO `limit`: the backend parses one and discards it, so the read is
 * unpaged and the response is `{ items }` alone — which is why this returns
 * `ItemsOnly` and not a cursor page. A screen must not offer paging on it.
 *
 * `retries: 0`, as the work-order board takes: `expensive-read` on the backend,
 * and a queue a technician can refresh by hand should not be re-run for them
 * under a rate limit they cannot see.
 */
export async function readMyQueue(
  target: BranchTarget
): Promise<ReadState<ItemsOnly<TechnicianQueueEntry>>> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };
  const result = await client.get<ItemsOnly<TechnicianQueueEntry>>(
    '/api/v1/technicians/me/queue' + branchTargetQuery(target),
    { retries: 0 }
  );
  if (result.ok) return { status: 'ok', data: result.data, correlationId: result.correlationId };
  return { status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
}

/**
 * The caller's own assignment on one job, RESOLVED (`tech.technician-me-queue`
 * then `wo.job-assignment-list`).
 *
 * `not-found` is the answer when the assignment is not in the caller's own
 * queue, whoever it belongs to — the same posture the backend takes toward a
 * record it will not show. Both reads cost `tech.technician.read` and nothing
 * more, which the backend proof `W4-2c` holds.
 */
export async function resolveOwnAssignment(
  target: BranchTarget,
  jobId: string,
  assignmentId: string
): Promise<ReadState<OwnAssignment>> {
  const queue = await readMyQueue(target);
  if (queue.status !== 'ok') return queue;
  const own = queue.data.items.find(
    (entry) => entry.assignmentId === assignmentId && entry.jobId === jobId
  );
  if (own === undefined) return { status: 'not-found', correlationId: queue.correlationId };

  const listed = await readOperation<ItemsOnly<JobAssignmentRow>>(jobPath(jobId, '/assignments'));
  if (listed.status !== 'ok') return listed;
  const row = listed.data.items.find((entry) => entry.id === own.assignmentId);
  if (row === undefined) return { status: 'not-found', correlationId: listed.correlationId };

  return {
    status: 'ok',
    correlationId: listed.correlationId,
    data: {
      assignmentId: own.assignmentId,
      jobId: own.jobId,
      workOrderId: own.workOrderId,
      technicianProfileId: row.technicianProfileId,
    },
  };
}

/**
 * The labour log of one job, newest start first (`tech.labor-session-list`).
 *
 * A REAL cursor page, unlike the queue: the operation publishes `nextCursor`
 * and `hasMore`, so "show older" is honest here.
 */
export async function listLaborSessions(
  jobId: string,
  cursor: string | null = null
): Promise<ReadState<CursorPage<LaborSession>>> {
  const suffix = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return readOperation<CursorPage<LaborSession>>(jobPath(jobId, '/labor-sessions') + suffix);
}

/** The work log of one job, newest entry first (`wo.job-work-log-list`). */
export async function listWorkLog(
  jobId: string,
  cursor: string | null = null
): Promise<ReadState<CursorPage<WorkLogEntry>>> {
  const suffix = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return readOperation<CursorPage<WorkLogEntry>>(jobPath(jobId, '/work-logs') + suffix);
}

/** The evidence bound to one job, oldest first (`wo.job-evidence-list`). Unpaged. */
export async function listJobEvidence(
  jobId: string
): Promise<ReadState<ItemsOnly<JobEvidenceEntry>>> {
  return readOperation<ItemsOnly<JobEvidenceEntry>>(jobPath(jobId, '/evidence'));
}

/* ------------------------------------------------------------------ *
 * Writes, each addressed by the caller's own assignment
 * ------------------------------------------------------------------ */

/** A failed identity resolution, as the write that needed it reports it. */
function refusedIdentity(status: ReadFailureStatus, correlationId: string | null): ActionState {
  if (status === 'not-found') {
    return {
      status: 'denied',
      messageKey: 'technicians.workspace.notOwnAssignment',
      correlationId,
      attempt: 1,
    };
  }
  return { status, correlationId, attempt: 1 };
}

/**
 * Start the caller's own clock on one of their own jobs
 * (`tech.labor-session-start`).
 *
 * The body's `technicianProfileId` is the RESOLVED one. It is not a parameter
 * of this function and cannot be: the signature names the assignment, and the
 * profile is whatever the backend says that assignment belongs to. Idempotent,
 * so the transport's key makes a retried submission one session, not two.
 */
export async function startLaborSession(
  target: BranchTarget,
  jobId: string,
  assignmentId: string
): Promise<ActionState> {
  const own = await resolveOwnAssignment(target, jobId, assignmentId);
  if (own.status !== 'ok') return refusedIdentity(own.status, own.correlationId);

  const client = await authorizedClient();
  if (!client) return EXPIRED;

  const body: LaborSessionStartBody = { technicianProfileId: own.data.technicianProfileId };
  const result = await client.send<unknown>('POST', jobPath(jobId, '/labor-sessions'), body);
  if (!result.ok) return fromFailure(result, 1);
  return { status: 'success', correlationId: result.correlationId, attempt: 1 };
}

/**
 * The caller's own session on their own job, or a refusal.
 *
 * The job's labour log is read and the session must be found there AND carry
 * the caller's resolved profile. A session that is not in the first page is
 * refused rather than acted on unverified; the open session a technician is
 * looking at is the newest start on the job in every ordinary case.
 */
async function ownSession(
  target: BranchTarget,
  jobId: string,
  assignmentId: string,
  sessionId: string
): Promise<{ readonly ok: true } | { readonly ok: false; readonly state: ActionState }> {
  const own = await resolveOwnAssignment(target, jobId, assignmentId);
  if (own.status !== 'ok') {
    return { ok: false, state: refusedIdentity(own.status, own.correlationId) };
  }
  const page = await readOperation<CursorPage<LaborSession>>(
    jobPath(jobId, '/labor-sessions') + '?limit=100'
  );
  if (page.status !== 'ok') {
    return { ok: false, state: refusedIdentity(page.status, page.correlationId) };
  }
  const session = page.data.items.find((entry) => entry.id === sessionId);
  if (session === undefined || session.technicianProfileId !== own.data.technicianProfileId) {
    return {
      ok: false,
      state: {
        status: 'denied',
        messageKey: 'technicians.workspace.notOwnSession',
        correlationId: page.correlationId,
        attempt: 1,
      },
    };
  }
  return { ok: true };
}

/**
 * Stop the caller's own open session (`tech.labor-session-stop`).
 *
 * `ifMatch` is REQUIRED and not defaulted: the operation is `versionGuarded`
 * and answers 428 without the header. The version is the one the screen is
 * showing; a stale one is a conflict, reported as such. No body — the stop
 * instant is the server clock.
 */
export async function stopLaborSession(
  target: BranchTarget,
  jobId: string,
  assignmentId: string,
  sessionId: string,
  ifMatch: number
): Promise<ActionState> {
  const verified = await ownSession(target, jobId, assignmentId, sessionId);
  if (!verified.ok) return verified.state;

  const client = await authorizedClient();
  if (!client) return EXPIRED;

  const result = await client.send<unknown>('POST', sessionPath(sessionId, '/stop'), undefined, {
    ifMatch,
  });
  if (!result.ok) return fromFailure(result, 1);
  return { status: 'success', correlationId: result.correlationId, attempt: 1 };
}

/**
 * Correct the window of one of the caller's own sessions
 * (`tech.labor-session-correct`).
 *
 * A HIGHER authority than recording — `tech.labor.correct` — because it
 * rewrites what a technician was paid for, and the one path that accepts
 * caller-supplied instants. The original is not edited; the backend inserts a
 * linked replacement. `ifMatch` is required for the same reason as the stop.
 */
export async function correctLaborSession(
  target: BranchTarget,
  jobId: string,
  assignmentId: string,
  sessionId: string,
  body: LaborSessionCorrectBody,
  ifMatch: number
): Promise<ActionState> {
  const verified = await ownSession(target, jobId, assignmentId, sessionId);
  if (!verified.ok) return verified.state;

  const client = await authorizedClient();
  if (!client) return EXPIRED;

  const result = await client.send<unknown>('POST', sessionPath(sessionId, '/corrections'), body, {
    ifMatch,
  });
  if (!result.ok) return fromFailure(result, 1);
  return { status: 'success', correlationId: result.correlationId, attempt: 1 };
}

/**
 * Append one free-text entry to the work log of one of the caller's own jobs
 * (`wo.job-work-log-record`).
 *
 * The body is `entry` and, when the technician says the work happened earlier,
 * `loggedAt`. Nothing else exists to send: no action code, no category, no
 * version. The backend scopes the write to the branch; the identity resolution
 * is what confines this adapter to jobs in the caller's own queue.
 */
export async function recordWorkLog(
  target: BranchTarget,
  jobId: string,
  assignmentId: string,
  body: JobWorkLogRecordBody
): Promise<ActionState> {
  const own = await resolveOwnAssignment(target, jobId, assignmentId);
  if (own.status !== 'ok') return refusedIdentity(own.status, own.correlationId);

  const client = await authorizedClient();
  if (!client) return EXPIRED;

  const result = await client.send<unknown>('POST', jobPath(jobId, '/work-logs'), body);
  if (!result.ok) return fromFailure(result, 1);
  return { status: 'success', correlationId: result.correlationId, attempt: 1 };
}

/** What the evidence capture reached, as far as it got. */
export interface EvidenceCaptureOutcome extends ActionState {
  readonly stage?: 'captured' | 'linked' | 'bound';
  readonly versionId?: string;
  readonly versionStatus?: string;
  readonly scannerAvailable?: boolean;
}

const FILE_FIELD = 'evidenceFile';

/**
 * Capture a file and bind it to one of the caller's own jobs as work evidence
 * (`shared.attachment-*` then `wo.job-evidence-record`).
 *
 * Four operations in one Server Action, in the order the platform requires —
 * authorize and store, register, link, bind — so the ORDER never lives in a
 * browser and a partial result is reported as the stage it reached. The FILE
 * crosses the origin once, here; the browser never talks to the object store.
 *
 * ## The document belongs to the work order; the evidence belongs to the job
 *
 * `wo.jobs` is not a linkable entity type, so the document is authorised and
 * linked against the WORK ORDER — the id the caller's own queue row named, not
 * one the screen typed — and `wo.job-evidence-record` binds its version to the
 * job. Binding is PERMANENT; the screen says so before submitting.
 *
 * ## The category is the tenant's, chosen from the list the server published
 *
 * No platform category exists for work evidence, so the form offers the
 * categories the tenant actually has and this reads the chosen one back for
 * its `businessLinkPurpose` and its content-type list. A category the server
 * does not publish is reported, not guessed past.
 */
export async function captureJobEvidence(
  target: BranchTarget,
  jobId: string,
  assignmentId: string,
  formData: FormData
): Promise<EvidenceCaptureOutcome> {
  const own = await resolveOwnAssignment(target, jobId, assignmentId);
  if (own.status !== 'ok') return refusedIdentity(own.status, own.correlationId);

  const file = formData.get(FILE_FIELD);
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: 'invalid',
      fieldErrors: { [FILE_FIELD]: 'attachments.capture.empty' },
      attempt: 1,
    };
  }
  const categoryCode = String(formData.get('categoryCode') ?? '').trim();
  const evidenceType = String(formData.get('evidenceType') ?? '').trim();
  const noteText = String(formData.get('note') ?? '').trim();
  const fieldErrors: Record<string, string> = {};
  if (categoryCode.length === 0) fieldErrors['categoryCode'] = 'field.required';
  if (evidenceType.length === 0) fieldErrors['evidenceType'] = 'field.required';
  if (Object.keys(fieldErrors).length > 0) return { status: 'invalid', fieldErrors, attempt: 1 };

  const categories = await listDocumentCategories();
  if (categories.status !== 'ok') {
    return {
      status: categories.status === 'denied' ? 'denied' : 'error',
      messageKey: 'attachments.capture.categoriesUnavailable',
      correlationId: categories.correlationId,
      attempt: 1,
    };
  }
  const category = categories.data.items.find((entry) => entry.categoryCode === categoryCode);
  if (category === undefined) {
    return {
      status: 'invalid',
      fieldErrors: { categoryCode: 'attachments.capture.categoryMissing' },
      attempt: 1,
    };
  }

  const captured = await captureDocument({
    categoryCode,
    entityType: EVIDENCE_DOCUMENT_ENTITY_TYPE,
    entityId: own.data.workOrderId,
    fileName: file.name,
    contentType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    capturedAt: Number.isFinite(file.lastModified)
      ? new Date(file.lastModified).toISOString()
      : null,
  });
  if (captured.status !== 'success' || !captured.registered) return captured;
  const { documentId, versionId, status: versionStatus, scannerAvailable } = captured.registered;

  const linked = await createDocumentLink(documentId, {
    entityType: EVIDENCE_DOCUMENT_ENTITY_TYPE,
    entityId: own.data.workOrderId,
    linkPurpose: category.businessLinkPurpose,
  });
  if (linked.status !== 'success') {
    return { ...linked, stage: 'captured', versionId, versionStatus, scannerAvailable };
  }

  const client = await authorizedClient();
  if (!client) return { ...EXPIRED, stage: 'linked', versionId, versionStatus, scannerAvailable };

  const body: JobEvidenceRecordBody = {
    documentVersionId: versionId,
    evidenceType,
    ...(noteText.length > 0 ? { note: noteText } : {}),
  };
  const bound = await client.send<unknown>('POST', jobPath(jobId, '/evidence'), body);
  if (!bound.ok) {
    return {
      ...fromFailure(bound, 1),
      stage: 'linked',
      versionId,
      versionStatus,
      scannerAvailable,
    };
  }
  return {
    status: 'success',
    correlationId: bound.correlationId,
    attempt: 1,
    stage: 'bound',
    versionId,
    versionStatus,
    scannerAvailable,
  };
}
