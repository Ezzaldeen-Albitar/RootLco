/**
 * The work-order contract this phase consumes (P1-29, `W1`).
 *
 * | operation             | method | path           | permission           |
 * | --------------------- | ------ | -------------- | -------------------- |
 * | `wo.work-order-list`  | GET    | `/work-orders` | `wo.work_order.read` |
 *
 * Typed from the route that owns the shape —
 * `apps/api/src/app/api/v1/work-orders/route.ts` — and from `WorkOrderSummary`
 * in `apps/api/src/modules/work-order/application/work-order-service.ts`, which
 * is what that route returns. Nothing here is invented; every field below exists
 * on the published response.
 *
 * ## Why this module exists now and did not exist before
 *
 * P1-28 needed one work-order read and deliberately kept it beside the
 * conversion that produced it, recording why in
 * `features/receptions/work-order-contract.ts`: a `features/work-orders` module
 * would have been "a home for a surface P1-29 owns, built one wave early and
 * half-shaped, which the next phase would then have to argue with". This is that
 * phase, so this is that module — and the P1-28 file stays exactly where it is.
 * A feature never imports another feature, so the two do not reach across.
 *
 * ## `state` is an OPAQUE catalogue code and `kind` is not
 *
 * `wo.work_order_states` is tenant-extensible: a tenant may define a state this
 * repository has never seen, so `state` is `string` and the screen renders the
 * code rather than translating it. Inventing a translation table would be a
 * second, rotting copy of a tenant's own configuration, and an unknown code
 * would render as its own key.
 *
 * `kind` IS closed — `ck_work_orders_kind` allows exactly two values — so it is
 * a union here and the filter offers exactly those two.
 */

/** The permission `wo.work-order-list` registers. */
export const WORK_ORDER_PERMISSIONS = {
  read: 'wo.work_order.read',
} as const;

/**
 * `ck_work_orders_kind`, mirrored. Two values, closed.
 *
 * Mirrored rather than imported: `apps/web` may not import from `apps/api`, and
 * `tests/work-orders-contract.test.ts` holds this array against the route source
 * so a third kind added in the Backend fails a test rather than a reviewer.
 */
export const WORK_ORDER_KINDS = ['ordinary', 'rework'] as const;
export type WorkOrderKind = (typeof WORK_ORDER_KINDS)[number];

/**
 * The party who brought the car for THIS work order, as at its `opened_at`.
 *
 * **Nullable, and the null case is real** — a reception visit can legitimately
 * exist without a `service_requester`, so the screen renders the absence rather
 * than treating it as a fault.
 *
 * `relationshipRole` travels with the name because `vehicle_owner` is a
 * different question and may be a different person: a name rendered without its
 * role is a claim the data does not support.
 */
export interface WorkOrderCustomer {
  readonly partnerId: string;
  readonly displayName: string;
  readonly relationshipRole: string;
  /** More than one party held that role at the reference instant. */
  readonly hasAdditionalParties: boolean;
}

/** The vehicle, rendered rather than referenced. */
export interface WorkOrderVehicle {
  readonly vehicleId: string;
  readonly registrationPlate: string | null;
  readonly makeModel: string | null;
}

/**
 * One row of the branch work-order board — the published `WorkOrderSummary`.
 *
 * `createdBy` is absent here because it is absent there: it answers "which
 * member of staff opened this", which a board has no need for.
 */
export interface WorkOrderListEntry {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly receptionVisitId: string;
  readonly vehicleId: string;
  readonly kind: string;
  readonly state: string;
  readonly partsForwardState: string;
  readonly displayNumber: string | null;
  readonly openedAt: string;
  readonly recordVersion: number;
  readonly customer: WorkOrderCustomer | null;
  readonly vehicle: WorkOrderVehicle;
}

/**
 * What the board may narrow by.
 *
 * `companyId` and `branchId` are NOT here: they are the authorization TARGET,
 * not a filter, and they travel as `BranchTarget`. Keeping them out of this type
 * is what stops a screen treating a scope as something an operator chose.
 *
 * There is deliberately no `asOf`. The reference instant for the customer
 * projection is derived by the server from the work order's own `opened_at`; a
 * client-supplied one would be an oracle for reading a party role out of its
 * window, and the query is `.strict()`, so sending one is a 422 rather than a
 * silent ignore.
 */
export interface WorkOrderListCriteria {
  /** An opaque catalogue code. An unknown one returns an empty page, not a 422. */
  readonly state?: string;
  readonly kind?: WorkOrderKind;
  readonly openedFrom?: string;
  readonly openedTo?: string;
  readonly customerId?: string;
}

/* ------------------------------------------------------------------ *
 * W3 — the work-order detail
 * ------------------------------------------------------------------ */

/**
 * The permissions the detail screen consults.
 *
 * Five codes, and they are deliberately not one. Reading the work order,
 * moving it, editing a job, seeing who is assigned and assigning somebody are
 * five different authorities in the platform, and a screen that collapsed them
 * would either hide a panel an operator may see or offer an action the backend
 * will refuse. `read` gates the page; the rest gate individual affordances.
 */
export const WORK_ORDER_DETAIL_PERMISSIONS = {
  read: 'wo.work_order.read',
  transition: 'wo.work_order.transition',
  jobManage: 'wo.job.manage',
  technicianRead: 'tech.technician.read',
  assignmentManage: 'tech.assignment.manage',
  departmentRead: 'org.department.read',
} as const;

/**
 * One job of the work order — the published `JobView`.
 *
 * `departmentId` is the routing BR-02 added. It is nullable and the null case
 * is ordinary: a job that has not been routed yet.
 */
export interface WorkOrderJob {
  readonly id: string;
  readonly workOrderId: string;
  readonly title: string;
  readonly jobType: string | null;
  readonly departmentId: string | null;
  readonly state: string;
  readonly requiresDiagnostic: boolean;
  readonly recordVersion: number;
}

/**
 * A state the work order may move to next, as the tenant's own graph allows.
 *
 * The graph is DATA, not a TypeScript union: the screen offers exactly what the
 * backend returned and nothing else. `requiresReason` decides whether the
 * transition form demands a reason — asking the operator for one the graph does
 * not want, or omitting one it does, are both refusals the backend would have
 * to explain after the fact.
 */
export interface WorkOrderReachableState {
  readonly code: string;
  readonly requiresReason: boolean;
  readonly isTerminal: boolean;
  readonly isCancellation: boolean;
}

/** `wo.work-order-detail` — the work order, its jobs, and where it may go. */
export interface WorkOrderDetail {
  readonly workOrder: WorkOrderListEntry;
  readonly jobs: readonly WorkOrderJob[];
  readonly nextStates: readonly WorkOrderReachableState[];
}

/**
 * One technician assignment on a job — the published `AssignmentView`.
 *
 * `validTo === null` is the OPEN assignment: the technician currently holds the
 * job. A closed one is history and is rendered as such.
 */
export interface JobAssignment {
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
 * One department a job may be routed to — the published `DepartmentView`.
 *
 * Read through `org.department-list`, which Wave C published, rather than
 * through anything this feature invents. `dependencies.md` `DEP-B1` forbade a
 * department picker on an operational screen while its stated basis held —
 * "no operational table references a department" — and BR-02 retired that basis
 * by adding `wo.jobs.department_id`. The picker is the consumer that work was
 * done for; it is not a second source of departments.
 */
export interface DepartmentOption {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly departmentCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}
