'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchScopeQuery,
  branchTargetQuery,
  readOperation,
  type BranchScope,
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
  WorkOrderCatalogue,
  WorkOrderDetail,
  WorkOrderListCriteria,
  WorkOrderListEntry,
  WorkOrderServiceLine,
} from './work-orders-contract';

/**
 * The one read the work-order board issues (P1-29, `W1`) — `wo.work-order-list`.
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application and it lives in `src/lib/api` because
 * `check-api-boundary.mjs` says so. This file turns operations into view states
 * and nothing else.
 *
 * ## The company is a selector, the branch is an optional target
 *
 * `wo.work-order-list` declares `scope: 'branch'`, and a NAMED branch is still
 * the authorization target: the pre-handler check reads the pair out of the
 * query and decides against the branch actually being read. What changed under
 * the Owner directive (`P1-32-PRE-OD-UX`) is that omitting the branch is now a
 * REQUEST rather than a gap — it asks for every branch of the named company the
 * caller may read, and the route resolves that set inside the transaction by
 * putting each candidate branch to this operation's own permission code and
 * refusing a caller that holds none. So the omission cannot widen what this
 * operator is entitled to see.
 *
 * Both shapes travel through `branchScopeQuery`, which demands the company and
 * refuses a blank branch: an omitted branch is the documented request, a blank
 * one is a malformed reference answered 422 far from the mistake.
 *
 * The board therefore reads on mount. There is nothing left to validate before
 * asking — the branch is the working context's own named selection — and the
 * first request is bounded rather than unbounded.
 *
 * ## A denial is not an empty page
 *
 * `STATUS_BY_KIND` maps a 403 to `denied` and the table renders that as a
 * refusal. Collapsing it to zero rows would tell an operator "there is nothing
 * here" when the truth is "you may not see it" — the failure mode
 * `read-operation.ts` exists to prevent, and one this board must not reintroduce.
 */
const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/**
 * A board flag on the wire, or nothing at all.
 *
 * Three states, not two: asked ON, asked OFF, and never asked. `undefined`
 * leaves the parameter out — which is the only way to say "no opinion" to a
 * `.strict()` schema — while `false` is sent as the literal `'false'`, because
 * the route reads the two words and a caller that meant to turn a flag off must
 * be able to say so.
 */
function flag(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? 'true' : 'false';
}

export async function listWorkOrders(
  scope: BranchScope,
  criteria: WorkOrderListCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<WorkOrderListEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/work-orders' +
    branchScopeQuery(scope, {
      state: criteria.state,
      // Never both: the route refuses the pair rather than intersecting it, and
      // the screen clears one when the other is chosen.
      stateGroup: criteria.stateGroup,
      kind: criteria.kind,
      openedFrom: criteria.openedFrom,
      openedTo: criteria.openedTo,
      completedFrom: criteria.completedFrom,
      completedTo: criteria.completedTo,
      customerId: criteria.customerId,
      q: criteria.q,
      // Written as the literal the route's `z.enum(['true','false'])` takes.
      // `String(false)` is `'false'`, which the route reads as OFF; leaving the
      // flag out entirely is what "did not ask" means, and `branchScopeQuery`
      // drops an undefined value rather than serialising it.
      assignedToMe: flag(criteria.assignedToMe),
      awaitingParts: flag(criteria.awaitingParts),
      awaitingApproval: flag(criteria.awaitingApproval),
      awaitingQuality: flag(criteria.awaitingQuality),
      readyForDelivery: flag(criteria.readyForDelivery),
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

/**
 * The tenant's work-order state graph (`wo.work-order-catalogue`).
 *
 * A board needs it to answer one question honestly: which states mean the car is
 * still here. `wo.work_order_states` is tenant-extensible, so the answer is DATA
 * and not a union in this repository — the route exists precisely so a screen
 * never has to hard-code a code.
 *
 * `scope: 'tenant'`, no parameters, and `.strict()` — so nothing is sent. Not
 * paginated: the catalogue is bounded by the tenant's own configuration.
 */
export async function readWorkOrderCatalogue(): Promise<ReadState<WorkOrderCatalogue>> {
  return readOperation<WorkOrderCatalogue>('/api/v1/work-order-catalogue');
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
 * The service lines of one work order (`wo.service-line-list`).
 *
 * `wo.work_order.read` — the same code the detail takes, and the same code the
 * parts screen already holds when it renders the work-order header. It is the
 * read that lets a material requirement be bound to a line by CHOOSING it
 * rather than by typing an identifier the product publishes nowhere else
 * (DEF-M-05).
 *
 * Not paginated: the operation publishes a bare `{ items }`.
 */
export async function listServiceLines(
  workOrderId: string
): Promise<ReadState<ItemsOnly<WorkOrderServiceLine>>> {
  return readOperation<ItemsOnly<WorkOrderServiceLine>>(
    workOrderPath(workOrderId, '/service-lines')
  );
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
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt };

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
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt };

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
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt };

  const result = await client.send<unknown>('POST', jobPath(jobId, '/assignments'), body);
  if (!result.ok) return fromFailure(result, attempt);
  return { status: 'success', correlationId: result.correlationId, attempt };
}
