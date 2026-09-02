/**
 * The technician workspace contract (P1-29, `W4`).
 *
 * | operation                    | method | path                                  | permission             |
 * | ---------------------------- | ------ | ------------------------------------- | ---------------------- |
 * | `tech.technician-me-queue`   | GET    | `/technicians/me/queue`               | `tech.technician.read` |
 * | `wo.job-assignment-list`     | GET    | `/jobs/{jobId}/assignments`           | `tech.technician.read` |
 * | `tech.labor-session-list`    | GET    | `/jobs/{jobId}/labor-sessions`        | `tech.technician.read` |
 * | `tech.labor-session-start`   | POST   | `/jobs/{jobId}/labor-sessions`        | `tech.labor.record`    |
 * | `tech.labor-session-stop`    | POST   | `/labor-sessions/{sessionId}/stop`    | `tech.labor.record`    |
 * | `tech.labor-session-correct` | POST   | `/labor-sessions/{sessionId}/corrections` | `tech.labor.correct` |
 * | `wo.job-work-log-list`       | GET    | `/jobs/{jobId}/work-logs`             | `wo.work_order.read`   |
 * | `wo.job-work-log-record`     | POST   | `/jobs/{jobId}/work-logs`             | `tech.labor.record`    |
 * | `wo.job-evidence-list`       | GET    | `/jobs/{jobId}/evidence`              | `wo.work_order.read`   |
 * | `wo.job-evidence-record`     | POST   | `/jobs/{jobId}/evidence`              | `tech.labor.record`    |
 *
 * Typed from the routes that own the shapes and from the views they return —
 * `QueueEntry` in `job-assignment-service.ts`, `LaborSessionView` in
 * `labor-session-service.ts`, `WorkLogEntryRow` and `JobEvidenceRow` in
 * `job-board-repository.ts`. Nothing here is invented; every field below exists
 * on the published response, and `tests/backend/p1-29-w4-technician-workspace`
 * holds each interface against the row that actually came back.
 *
 * ## The caller's own identity is COMPOSED, never asserted
 *
 * `tech.technician-me-queue` resolves the technician profile from the session
 * and deliberately does not return it — handing the client the id would tempt
 * the next screen to send it back, which is the client-asserted-identity shape
 * the operation exists to end. But `tech.labor-session-start` REQUIRES
 * `technicianProfileId` in its body and has no `me` variant.
 *
 * The seam closes without new backend because the queue row carries the
 * `assignmentId` of the caller's own assignment, and `wo.job-assignment-list`
 * — on the same `tech.technician.read` the queue needs — carries the
 * `technicianProfileId` of every assignment on the job. Matching the one row
 * whose `id` equals the caller's `assignmentId` yields the caller's own profile
 * with no ambiguity, even on a job two technicians share: the correlation key
 * is the assignment, not the person. `OwnAssignment` below is that resolution,
 * and the adapters perform it server-side on every write. No screen ever holds
 * a technician id it could choose.
 *
 * ## What this module deliberately does NOT model
 *
 * - **Paging of the queue.** The operation parses `limit` and DISCARDS it; the
 *   read is unpaged. There is no cursor type here because there is none there,
 *   and a screen that offered "next page" would be offering a control that does
 *   nothing.
 * - **Editing or deleting a work-log entry.** `wo.job_work_logs` is granted
 *   `SELECT, INSERT` and nothing else, and the row carries no `recordVersion`.
 *   An entry is a fact; a correction is a NEW entry.
 * - **A work-log action vocabulary.** The entry is free text. No column holds
 *   an action code, so no select offers one.
 * - **A pause.** The platform has no pause operation: stopping the clock is
 *   `tech.labor-session-stop`, and moving the job is `wo.job-transition`, which
 *   is a separate authority this slice does not consume.
 */

/**
 * The permissions the workspace consults.
 *
 * Five codes, deliberately not one. Seeing one's own queue, recording labour,
 * correcting recorded labour, reading a job's log and evidence, and capturing a
 * document are five authorities in the platform. `queue` gates the page; the
 * rest gate individual affordances, and every one is decided again by the
 * backend against the actual record.
 */
export const TECHNICIAN_WORKSPACE_PERMISSIONS = {
  queue: 'tech.technician.read',
  labor: 'tech.labor.record',
  laborCorrect: 'tech.labor.correct',
  workRead: 'wo.work_order.read',
  documentManage: 'shared.document.manage',
} as const;

/**
 * One row of the caller's own queue — the published `QueueEntry`.
 *
 * There is NO `technicianProfileId` here and there must never be one: the
 * route withholds it by design. `assignmentId` is the correlation key that
 * makes the identity seam resolvable without it.
 */
export interface TechnicianQueueEntry {
  readonly assignmentId: string;
  readonly jobId: string;
  readonly workOrderId: string;
  readonly assignmentRole: string;
  readonly validFrom: string;
  readonly jobTitle: string;
  readonly jobState: string;
  readonly workOrderState: string;
  readonly displayNumber: string | null;
}

/**
 * One technician assignment on a job — the published `AssignmentView`.
 *
 * The same shape `features/work-orders` mirrors for W3. It is restated here
 * rather than imported because a feature does not import another feature; the
 * backend proof holds BOTH copies against the same response, so they cannot
 * drift apart unnoticed.
 */
export interface JobAssignmentRow {
  readonly id: string;
  readonly jobId: string;
  readonly technicianProfileId: string;
  readonly assignmentRole: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly reason: string | null;
  readonly recordVersion: number;
}

/**
 * The caller's own assignment, RESOLVED — the output of the identity seam.
 *
 * Produced only by the adapter, from the caller's own queue and the job's
 * assignment list, and never from anything a screen typed. `workOrderId` rides
 * along because evidence is captured against the work order, which is the
 * linkable entity, and the queue row is where the server said which one.
 */
export interface OwnAssignment {
  readonly assignmentId: string;
  readonly jobId: string;
  readonly workOrderId: string;
  readonly technicianProfileId: string;
}

/**
 * One labour session — the published `LaborSessionView`.
 *
 * `endedAt === null` is the OPEN session. `startedAt` and `endedAt` are the
 * server's clock; a screen may render elapsed time from them and must not keep
 * a clock of its own as though it were the record. `correctionOfId` names the
 * session this row replaced, when it is a correction.
 */
export interface LaborSession {
  readonly id: string;
  readonly technicianProfileId: string;
  readonly jobId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly source: string;
  readonly correctionOfId: string | null;
  readonly recordVersion: number;
}

/**
 * One work-log entry — the published `WorkLogEntryRow`.
 *
 * No `recordVersion`, because the row cannot be updated: the grant is
 * `SELECT, INSERT`. `loggedAt` is when the technician says the work happened;
 * `createdAt` is when the entry was written. They differ legitimately.
 */
export interface WorkLogEntry {
  readonly id: string;
  readonly jobId: string;
  readonly entry: string;
  readonly loggedAt: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

/**
 * One piece of work evidence — the published `JobEvidenceRow`.
 *
 * `documentVersionId` is a REFERENCE and the only one the response carries: no
 * storage key, no URL, no bytes. Evidence is resolved through the linked
 * document under the attachments module's own authorization, never by object
 * id (`p1-29-frontend-contract.md`). Binding is permanent — the table admits no
 * UPDATE and no DELETE — so a screen must say so before submitting.
 */
export interface JobEvidenceEntry {
  readonly id: string;
  readonly jobId: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

/**
 * The entity a captured document is authorised and linked against.
 *
 * `wo.jobs` is NOT a linkable entity type in the attachments policy —
 * `LINKABLE_ENTITY_TYPES` names `wo.work_orders` and not the job — so the
 * document belongs to the work order, and `wo.job-evidence-record` is what
 * binds its version to the job. Two facts, two records, and the second is the
 * one this workspace writes.
 */
export const EVIDENCE_DOCUMENT_ENTITY_TYPE = 'wo.work_orders';
