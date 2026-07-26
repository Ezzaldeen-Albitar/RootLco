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

export type {
  JobStateRow,
  TransitionRow,
  WorkOrderStateRow,
} from './data/work-order-catalog-repository';

export {
  ADDITIONAL_WORK_STATES,
  CLOSURE_BLOCKERS,
  CLOSURE_BLOCKER_REGISTRY,
  DEFERRED_CLOSURE_BLOCKERS,
  FULFILLMENT_STATES,
  MAX_JOB_TITLE,
  MAX_JOB_TYPE,
  MAX_REASON,
  PARTS_FORWARD_STATES,
  WORK_ORDER_KINDS,
  WorkOrderRuleError,
  assertTransitionReason,
  type AdditionalWorkState,
  type ClosureBlockerCode,
  type ClosureBlockerDefinition,
  type FulfillmentState,
  type PartsForwardState,
  type WorkOrderKind,
} from './domain/work-order';

/** Composition root: constructs the module's services once per process. */
export const workOrderModule = composeModule({
  module: 'work-order',
  create: () => {
    const catalog = new WorkOrderCatalogService(new WorkOrderCatalogRepository());
    return {
      workOrderCatalog: catalog,
      workOrders: new WorkOrderService(new WorkOrderRepository(), catalog),
    };
  },
});
