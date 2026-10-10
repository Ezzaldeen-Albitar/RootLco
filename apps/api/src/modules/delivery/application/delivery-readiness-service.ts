/**
 * The delivery-readiness queue (Phase 1-31, Owner decision **D-3** of 2026-09-09).
 *
 * ## The question this answers, and the one it does not
 *
 * `GET /api/v1/deliveries` lists delivery RECORDS: rows that exist because somebody
 * already started a handover. That is a different set from the one a service advisor
 * needs at the counter, and the difference is the whole point of D-3 — **a work order
 * that is finished and owes nothing has no delivery record at all**, so it is invisible
 * to the record list precisely while it is the thing most worth showing. This queue is
 * the operational one: the work orders that satisfy the authoritative server-side
 * delivery-eligibility rules, whether or not a delivery has been opened for them.
 *
 * It introduces **no new work-order status**. "Ready" is not a state anybody sets; it
 * is a fact composed on every read from the same fact readers the eligibility
 * composition uses, so a row can stop being ready the moment a part is reserved or an
 * invoice is raised, with nothing to keep in step.
 *
 * ## Four facts, not eight, and the four are named
 *
 * `BLOCKER_CODES` has eight members and `DeliveryReadService.composeFor` composes all
 * eight — but four of them (`delivery_state_invalid`, `checklist_incomplete`,
 * `receiver_not_verified`, `signature_missing`) are counted against a DELIVERY ROW's
 * id. For a work order with no delivery they are not "clear"; they are unaskable. A
 * queue that reported them would report `receiver_not_verified` for every eligible
 * work order in the branch, which is noise that means nothing an operator can act on.
 *
 * So this surface carries exactly the four keyed on `workOrderId` alone —
 * `work_order_not_complete`, `quality_control_not_passed`,
 * `financial_balance_outstanding`, `part_obligation_outstanding` — through
 * `composeWorkOrderFacts`, which calls those readers and does not restate one of them.
 * `readyToStartDelivery` therefore means "the four preconditions that exist before a
 * handover begins are satisfied", and the delivery-bound four are still enforced where
 * they always were: by `composeFor` at `GET .../eligibility` and inside
 * `completeDelivery`. **This read weakens no gate**, because it gates nothing — it is
 * a read, and `sal.complete_delivery` and the composition above it are untouched.
 *
 * ## Eligibility is never computed in a browser
 *
 * The row carries the composed verdict, the blocker codes and the provenance of every
 * fact. A client renders them. Nothing here reads an eligibility claim from a request,
 * and there is no query parameter through which one could be asserted — the same rule
 * the eligibility route states, for the same reason.
 *
 * ## The cost, stated rather than discovered
 *
 * None of the four fact sources has a batch variant: `qualityModule().gate.evaluate`,
 * billing's `openReceivableForWorkOrder`, inventory's `reads.openCommitmentsFor` and
 * this module's `findLiveDeliveryForWorkOrder` each answer for ONE work order. A page
 * of N rows therefore costs on the order of 5N round trips plus the candidate page
 * itself. That is why the default page is 20 and the ceiling is 50 rather than the
 * platform's 50/100, why the operation is declared `expensive-read`, and why batch
 * fact ports in `quality`, `billing` and `inventory` are recorded as a named
 * prerequisite of any larger page — not fixed here, because three modules' public
 * surfaces are not this slice's to change.
 */
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { workOrderModule, type WorkOrderSummary } from '@/modules/work-order';
import type { Page } from '@/server/db/pagination';
import type { BlockerCode } from '../domain/delivery';
import type { DeliveryRepository, DeliveryScope } from '../data/delivery-repository';
import {
  toDeliveryView,
  type DeliveryReadService,
  type DeliveryRecordView,
  type EligibilityFact,
} from './delivery-read-service';

/**
 * Page sizes for this queue, deliberately BELOW the platform's 50 / 100.
 *
 * `resolveLimit` defaults to 50 and clamps at 100, which is right for a list whose
 * page costs one indexed seek. This one costs about five round trips per ROW, so the
 * platform numbers would turn a single request into five hundred. The route refuses
 * anything above the maximum at the boundary rather than clamping it, so a caller
 * asking for more is told so instead of silently receiving less.
 */
export const DEFAULT_READINESS_PAGE_SIZE = 20;
export const MAX_READINESS_PAGE_SIZE = 50;

/**
 * One row of the readiness queue (P1-31 D-3).
 *
 * `workOrder` is the work-order module's own `WorkOrderSummary` rather than a
 * projection invented here, so the queue and the work-order board spell a work order
 * one way. `delivery` is this module's `DeliveryRecordView`, spelled exactly as
 * `sal.delivery-read` and `sal.work-order-delivery-read` spell it, and it is `null`
 * both when no delivery exists and when the only one is in `exception` — the partial
 * unique index `uq_delivery_records_work_order_active` treats an exception as absent,
 * so a new delivery is permitted and "the live delivery" is genuinely none.
 */
export interface DeliveryReadinessRowView {
  readonly workOrder: WorkOrderSummary;
  readonly delivery: DeliveryRecordView | null;
  /** The four work-order-level facts, each with its provenance and whether it holds. */
  readonly facts: readonly EligibilityFact[];
  /** The subset of those four that are blocking. Never the delivery-bound four. */
  readonly blockers: readonly BlockerCode[];
  /**
   * Server-derived, always.
   *
   * TRUE when all four facts are established and clear AND the work order is not
   * already handed over — `delivery === null || delivery.status !== 'delivered'`.
   * That is the whole rule and it is stated exhaustively on purpose: a `delivered`
   * delivery raises **no blocker here**, because `delivery_state_invalid` is
   * delivery-bound and outside this surface's four, so `blockers` can be empty while
   * this is `false`. A reader that inferred readiness from an empty blocker list
   * would offer a vehicle that has already left.
   */
  readonly readyToStartDelivery: boolean;
}

export class DeliveryReadinessService {
  public constructor(
    private readonly repository: DeliveryRepository,
    private readonly reads: DeliveryReadService
  ) {}

  /**
   * One keyset page of a branch's ready-for-delivery queue.
   *
   * ## Scope is authorized BEFORE any row is read
   *
   * `companyId` and `branchId` are required and `authorizeScope` runs first, on the
   * `listWarranties` precedent and for its two reasons. `scope: 'branch'` is inert
   * without a target — `requiresScopedEvaluation` returns false on an empty one
   * whatever the declaration says — and RLS cannot compensate, because
   * `app.branch_ids` is the permission-blind union of every active grant
   * (P1-18-A-01). And authorizing first stops the empty/non-empty difference from
   * reporting whether a branch has finished work at all: a caller with no grant in
   * the named scope is REFUSED, never handed an empty page.
   *
   * ## Candidates, then facts
   *
   * The candidate set is the branch's CLOSED, non-cancellation work orders, paged by
   * the work-order module's own port on its own ordering contract
   * (`wo.work_orders:opened_at_desc`) — so the cursor a caller carries is that
   * module's, the page is complete before any fact is composed, and `hasMore` cannot
   * lie. Filtering after composition would produce short pages, which is the P1-28
   * round-two defect exactly.
   *
   * The facts are composed row by row rather than by fanning the whole page out at
   * once. `db` is ONE connection: a page-wide `Promise.all` would queue a hundred
   * statements on it for no parallelism, and bounding the fan-out to one row's five
   * reads keeps a slow row slow instead of making the whole page unpredictable.
   */
  public async listReadiness(
    db: DbHandle,
    filter: { readonly companyId: string; readonly branchId: string },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<DeliveryReadinessRowView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });

    const candidates = await workOrderModule().workOrders.listClosedNonCancelled(db, filter, {
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      limit: page.limit ?? DEFAULT_READINESS_PAGE_SIZE,
    });

    const items: DeliveryReadinessRowView[] = [];
    for (const workOrder of candidates.items) {
      items.push(await this.composeRow(db, workOrder));
    }
    return { ...candidates, items };
  }

  /**
   * One candidate work order, with its four facts and its live delivery.
   *
   * The delivery is read with the WORK ORDER's own company and branch, not the
   * caller's claim: `fk_delivery_records_work_order` is the composite key
   * `(tenant, company, branch, work_order_id)`, so those are the delivery's scope by
   * construction — and the caller's pair has already been authorized, so the two
   * agree for every row this page can contain.
   */
  private async composeRow(
    db: DbHandle,
    workOrder: WorkOrderSummary
  ): Promise<DeliveryReadinessRowView> {
    const scope: DeliveryScope = {
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
    };
    const [composed, deliveryRow] = await Promise.all([
      this.reads.composeWorkOrderFacts(db, workOrder.id),
      this.repository.findLiveDeliveryForWorkOrder(db, scope, workOrder.id),
    ]);
    const delivery = deliveryRow === null ? null : toDeliveryView(deliveryRow);
    return {
      workOrder,
      delivery,
      facts: composed.facts,
      blockers: composed.blockers,
      readyToStartDelivery:
        composed.clear && (delivery === null || delivery.status !== 'delivered'),
    };
  }
}
