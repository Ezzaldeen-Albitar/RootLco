'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, type ActionState } from '@/lib/forms/action-result';
import type {
  JobAssignmentCreateBody,
  JobUpdateBody,
  WorkOrderTransitionBody,
} from '@/lib/contracts/work-order-contract';
import type {
  DepartmentOption,
  JobAssignment,
  WorkOrderDetail,
  WorkOrderListCriteria,
  WorkOrderListEntry,
} from './work-orders-contract';

/**
 * The one read the work-order board issues (P1-29, `W1`) — `wo.work-order-list`.
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application and it lives in `src/lib/api` because
 * `check-api-boundary.mjs` says so. This file turns operations into view states
 * and nothing else.
 *
 * ## The branch pair is a TARGET, not a filter, and it is not optional
 *
 * `wo.work-order-list` declares `scope: 'branch'`, and a branch scope is inert
 * without a target: the pre-handler check reads the pair out of the query and,
 * with no pair, degrades to a scope-BLIND permission test. An operator holding
 * `wo.work_order.read` in one branch and any grant at all in another would then
 * see the second branch's board. So the pair travels through
 * `branchTargetQuery`, which refuses a half-built target rather than serialising
 * `undefined` into a URL.
 *
 * That is also why the screen mounts its results only once an operator has named
 * a branch: there is no request to make before then, and no default that would
 * be a guess about which board they meant.
 *
 * ## A denial is not an empty page
 *
 * `STATUS_BY_KIND` maps a 403 to `denied` and the table renders that as a
 * refusal. Collapsing it to zero rows would tell an operator "there is nothing
 * here" when the truth is "you may not see it" — the failure mode
 * `read-operation.ts` exists to prevent, and one this board must not reintroduce.
 */
const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function listWorkOrders(
  target: BranchTarget,
  criteria: WorkOrderListCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<WorkOrderListEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/work-orders' +
    branchTargetQuery(target, {
      state: criteria.state,
      kind: criteria.kind,
      openedFrom: criteria.openedFrom,
      openedTo: criteria.openedTo,
      customerId: criteria.customerId,
      cursor,
      limit: request.pageSize,
    });

  // `retries: 0` for the same reason the reception queue takes none: this is an
  // `expensive-read` policy on the backend, and a board an operator can re-run
  // by pressing the button again should not be re-run for them under a rate
  // limit they cannot see.
  const result = await client.get<CursorPage<WorkOrderListEntry>>(path, { retries: 0 });
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
  };
}

/* ------------------------------------------------------------------ *
 * W3 — the work-order detail: reads
 * ------------------------------------------------------------------ */

const workOrderPath = (workOrderId: string, tail = ''): string =>
  `/api/v1/work-orders/${encodeURIComponent(workOrderId)}${tail}`;

const jobPath = (jobId: string, tail = ''): string =>
  `/api/v1/jobs/${encodeURIComponent(jobId)}${tail}`;

/**
 * One work order with its jobs and its reachable states (`wo.work-order-detail`).
 *
 * The response carries an ETag holding `workOrder.recordVersion`, and that
 * version is the `If-Match` every guarded write below needs — so this read is
 * what makes a transition possible without a second round trip. The version
 * travels in the BODY as well, which is what the screen actually uses; the
 * header exists for callers that do not parse the body.
 */
export async function readWorkOrderDetail(
  workOrderId: string
): Promise<ReadState<WorkOrderDetail>> {
  return readOperation<WorkOrderDetail>(workOrderPath(workOrderId));
}

/**
 * The technicians assigned to one job (`wo.job-assignment-list`).
 *
 * A SEPARATE read from the detail, and separately permissioned: the list needs
 * `tech.technician.read` because an assignment names a member of staff, while
 * the work order itself needs only `wo.work_order.read`. An operator may
 * legitimately hold the second and not the first, so the screen must be able to
 * render the job graph with the assignment panel refused — which is why this is
 * not folded into the detail call.
 *
 * Not paginated: the operation publishes a bare `{ items }`.
 */
export async function listJobAssignments(
  jobId: string
): Promise<ReadState<ItemsOnly<JobAssignment>>> {
  return readOperation<ItemsOnly<JobAssignment>>(jobPath(jobId, '/assignments'));
}

/**
 * The departments of one branch (`org.department-list`), for the routing picker.
 *
 * Wave C published this and BR-02 gave the job a `department_id` to hold. The
 * pair is a TARGET here exactly as it is on the board — the operation is
 * `scope: 'branch'` and its query is `.strict()`, so both halves are required
 * and nothing else may be sent. Not paginated: no cursor, no limit.
 *
 * The backend remains the authority on which departments are routable: it
 * re-checks the chosen one against the JOB's own company and branch before the
 * write and refuses with `ERR-VAL-001`. This list is an affordance, never a
 * permission.
 */
export async function listDepartments(
  target: BranchTarget
): Promise<ReadState<ItemsOnly<DepartmentOption>>> {
  return readOperation<ItemsOnly<DepartmentOption>>(
    `/api/v1/org/departments${branchTargetQuery(target)}`
  );
}

/* ------------------------------------------------------------------ *
 * W3 — the work-order detail: guarded writes
 * ------------------------------------------------------------------ */

/**
 * Move the work order to another state in its own graph
 * (`wo.work-order-transition`).
 *
 * `ifMatch` is REQUIRED and is not defaulted: the operation is
 * `versionGuarded: true` and its handler throws `ERR-CON-002` when the header is
 * absent, so a caller that forgot it would get a 428 rather than a write. The
 * version comes from the detail read the screen is already showing, which is
 * what makes a stale one a genuine conflict rather than an accident.
 *
 * `toState` is an opaque catalogue code. The screen sends one of the codes the
 * backend just offered in `nextStates`; it does not decide reachability, and it
 * carries no copy of the graph.
 */
export async function transitionWorkOrder(
  workOrderId: string,
  body: WorkOrderTransitionBody,
  ifMatch: number,
  attempt = 1
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<unknown>(
    'POST',
    workOrderPath(workOrderId, '/transition'),
    body,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);
  return { status: 'success', correlationId: result.correlationId, attempt };
}

/**
 * Route a job to a department, or clear its routing (`wo.job-update`).
 *
 * ## Why the title is sent when only the department is changing
 *
 * `wo.job-update` is a PATCH whose `title` is REQUIRED — the body replaces it
 * rather than merging — so routing a job means sending the title it already
 * has. That looks like a lost update waiting to happen and is not one, because
 * the operation is `versionGuarded: true`: if anyone renamed the job since this
 * screen read it, the version moved and this write is refused with a conflict
 * instead of quietly reverting their rename. The guard is what makes sending the
 * old title safe, so the two must never be separated.
 *
 * ## `departmentId` is three-way and `undefined` is not `null`
 *
 * Omitted leaves the routing alone, `null` clears it, and a uuid sets it. The
 * value is therefore passed through UNCHANGED — no `?? undefined`, which would
 * collapse "clear this" into "leave it".
 */
export async function updateJob(
  jobId: string,
  body: JobUpdateBody,
  ifMatch: number,
  attempt = 1
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<unknown>('PATCH', jobPath(jobId), body, { ifMatch });
  if (!result.ok) return fromFailure(result, attempt);
  return { status: 'success', correlationId: result.correlationId, attempt };
}

/**
 * Assign a technician to a job (`wo.job-assignment-create`).
 *
 * NOT version-guarded — an assignment is an append to a history, not an edit of
 * the job — but it IS idempotent, so the transport's key makes a retried
 * submission one assignment rather than two. No caller invents a key.
 *
 * `window` is required by the contract and both bounds are instants. The screen
 * sends the interval the operator chose; the platform decides eligibility
 * against the technician's own profile, skills and certifications, and refuses
 * what does not qualify. The caller never asserts a technician's authority.
 */
export async function assignTechnician(
  jobId: string,
  body: JobAssignmentCreateBody,
  attempt = 1
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<unknown>('POST', jobPath(jobId, '/assignments'), body);
  if (!result.ok) return fromFailure(result, attempt);
  return { status: 'success', correlationId: result.correlationId, attempt };
}
