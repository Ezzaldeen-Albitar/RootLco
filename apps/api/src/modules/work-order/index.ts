/**
 * `work-order` module — public surface (Phase 1-19).
 *
 * The ONLY legal import path for this module (ADR-001): the boundary checker and
 * the ESLint rule both reject `@/modules/work-order/<anything>`. It exports
 * behaviour (composed services) and types/contract constants — never repositories,
 * pools, or SQL.
 *
 * ## What this module owns
 *
 * The `wo` schema: work orders, their state and transition catalogs, jobs, job
 * assignments, service lines, required parts, additional-work requests and
 * customer approvals. No other module reads or writes those tables.
 *
 * ## Why the state graph lives behind this surface
 *
 * `wo.work_order_transitions` and `wo.job_transitions` are catalog TABLES, not a
 * hardcoded matrix, and tenants may shadow the platform rows. Every consumer that
 * needs to know whether an edge exists asks `workOrderCatalog` rather than
 * consulting a constant, so there is exactly one resolution of the platform/tenant
 * override precedence in the codebase and it matches the guards.
 *
 * Phase 1-19 delivers this module across waves: Wave 3 establishes the boundary,
 * the domain vocabulary and the catalog reads; Waves 4–6 add the work-order,
 * technician-facing and approval services.
 */
import { composeModule } from '@/server/layering';
import { WorkOrderCatalogRepository } from './data/work-order-catalog-repository';
export type {
  JobRow,
  StatusHistoryRow,
  WorkOrderListFilter,
  WorkOrderRow,
} from './data/work-order-repository';
export type {
  ClosureBlocker,
  ClosureEligibility,
  JobHistoryView,
  JobView,
  PageInput,
  ReachableState,
  TransitionInput,
  TransitionResult,
  WorkOrderDetail,
  WorkOrderHistoryEntry,
  WorkOrderHistoryView,
  WorkOrderSummary,
} from './application/work-order-service';
import { WorkOrderRepository } from './data/work-order-repository';
import { WorkOrderCatalogService } from './application/work-order-catalog-service';
import { WorkOrderService } from './application/work-order-service';
import { JobAssignmentService } from './application/job-assignment-service';
import { AdditionalWorkService } from './application/additional-work-service';
import { JobBoardService } from './application/job-board-service';
import { JobBoardRepository } from './data/job-board-repository';

export type { AssignInput, AssignmentView, QueueEntry } from './application/job-assignment-service';
export type { AssignmentRow, LineRow, TechnicianQueueRow } from './data/work-order-repository';
export type {
  AdditionalWorkDetailView,
  AdditionalWorkRequestView,
  ApprovalEvidenceInput,
  ApprovalEvidenceView,
  CustomerApprovalView,
  DecideInput,
  RaiseRequestInput,
} from './application/additional-work-service';
export type {
  AdditionalWorkDetailRow,
  AdditionalWorkRequestRow,
  ApprovalEvidenceRow,
  CustomerApprovalRow,
} from './data/work-order-repository';

export type {
  JobStateRow,
  TransitionRow,
  WorkOrderStateRow,
} from './data/work-order-catalog-repository';

export {
  ADDITIONAL_WORK_STATES,
  ADDITIONAL_WORK_TRANSITIONS,
  APPROVAL_CHANNELS,
  APPROVAL_DECISIONS,
  ASSIGNMENT_ROLES,
  CLOSURE_BLOCKERS,
  CLOSURE_BLOCKER_REGISTRY,
  DEFERRED_CLOSURE_BLOCKERS,
  FULFILLMENT_STATES,
  MAX_APPROVAL_EVIDENCE,
  MAX_EVIDENCE_NOTE,
  MAX_EVIDENCE_TYPE,
  MAX_JOB_TITLE,
  MAX_LINE_DESCRIPTION,
  MAX_LINE_UNIT,
  MAX_JOB_TYPE,
  MAX_PRESENTED_SCOPE,
  MAX_REASON,
  MAX_REQUEST_SUMMARY,
  MAX_RESTRICTED_DESCRIPTION,
  PARTS_FORWARD_STATES,
  SETTABLE_FULFILLMENT_STATES,
  WORK_ORDER_KINDS,
  WorkOrderRuleError,
  assertAdditionalWorkTransition,
  assertTransitionReason,
  type AdditionalWorkState,
  type ApprovalChannel,
  type ApprovalDecision,
  type AssignmentRole,
  type ClosureBlockerCode,
  type ClosureBlockerDefinition,
  type FulfillmentState,
  type PartsForwardState,
  type SettableFulfillmentState,
  type WorkOrderKind,
} from './domain/work-order';

export type { JobBoardRow, QcRecordRow, WorkLogEntryRow } from './data/job-board-repository';
export {
  MAX_WORK_LOG_ENTRY,
  QC_OVERALL_RESULTS,
  STATE_CODE_PATTERN,
  type JobAssignmentView,
  type JobDetail,
  type QcOverallResult,
} from './application/job-board-service';

/** Composition root: constructs the module's services once per process. */
export const workOrderModule = composeModule({
  module: 'work-order',
  create: () => {
    const catalog = new WorkOrderCatalogService(new WorkOrderCatalogRepository());
    const repository = new WorkOrderRepository();
    return {
      workOrderCatalog: catalog,
      workOrders: new WorkOrderService(repository, catalog),
      jobAssignments: new JobAssignmentService(repository, catalog),
      additionalWork: new AdditionalWorkService(repository, catalog),
      // BR-06. Shares the catalogue service rather than constructing a second
      // one: `wo.job-detail` computes its reachable edges from the SAME tenant
      // graph `wo.work-order-detail` does, and two instances would be two caches
      // of one tenant's configuration.
      jobBoard: new JobBoardService(new JobBoardRepository(), catalog),
    };
  },
});
