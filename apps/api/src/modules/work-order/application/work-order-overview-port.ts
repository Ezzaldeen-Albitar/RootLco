/**
 * The work-order module's OVERVIEW port (Owner directive — the tenant dashboard).
 *
 * ## Why a port and not a query in the dashboard module
 *
 * `wo.*` is private to this module (ADR-001 rule 3; `index.ts` says so and the
 * boundary checker enforces it), so the SQL that counts work orders, their
 * pending approvals and their open assignments lives here and the overview
 * module asks for the answer. Exactly the shape `WorkOrderReportPort` already
 * has on the reporting side, and for exactly the same reason.
 *
 * ## Why a separate class rather than methods on `WorkOrderService`
 *
 * A cross-module consumer should depend on the ONE thing it needs.
 * `WorkOrderService` opens, advances, closes and reopens work orders; handing
 * the whole service to a dashboard under a second name would hand a read-only
 * screen every write in the domain. This class holds five reads and no writes.
 *
 * ## The state CATALOGUE is resolved here, once, and travels with the counts
 *
 * The counts come back keyed on the raw `state` code, because
 * `wo.work_order_states` is dual-scoped and a tenant may shadow a platform code
 * — resolving that precedence in SQL would be a second copy of the rule
 * `WorkOrderCatalogService` owns. Joining the two here means a consumer never
 * sees a bare code it has to interpret, and never has to decide for itself which
 * states are terminal. That last point is the load-bearing one: `is_closed` is
 * TRUE for `cancelled` as well as for `closed`, so a consumer deriving
 * "finished" from a name it recognised would offer every abandoned job.
 *
 * ## A state with NO work orders is reported at zero, not omitted
 *
 * The same decision `WorkOrderReportPort` records for the report's status
 * counts: a work-order state is a catalogue entry, and "no order is awaiting
 * parts" is an answer. A series that omitted the empty states would make a
 * quiet branch look like a misconfigured one.
 *
 * ## It performs NO authorization
 *
 * Deliberately, and stated so it is not mistaken for an omission. The caller has
 * already evaluated its own permission against the company and every branch it
 * passes here, and RLS narrows the statements underneath. A second,
 * differently-shaped check here would be a second definition of scope.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type { LocalDayPeriod } from '@/server/db/period';
import type { WorkOrderRepository } from '../data/work-order-repository';
import type { WorkOrderCatalogService } from './work-order-catalog-service';

/** One state of the tenant's own catalogue, with its live count. */
export interface WorkOrderStateBucket {
  /** The catalogue CODE. Never a hard-coded name — tenants may shadow these. */
  readonly state: string;
  /** The catalogue's own display name for that code. */
  readonly label: string;
  readonly count: number;
  readonly isTerminal: boolean;
}

/** The board, as one snapshot of one branch set. */
export interface WorkOrderBoardCounts {
  readonly byState: readonly WorkOrderStateBucket[];
  /** Live orders in a NON-terminal state — the work actually in the shop. */
  readonly active: number;
  /** Live orders whose parts have been requested and not yet reserved. */
  readonly awaitingParts: number;
  /**
   * Live orders in a CLOSED, non-cancellation state.
   *
   * The same candidate predicate `listClosedNonCancelled` publishes for the
   * delivery-readiness queue, counted rather than paged. It is a count of what
   * is ELIGIBLE for handover, not of what has no blocker: a blocker is composed
   * per order from four fact sources, and composing them for a whole branch to
   * produce one number would cost about five round trips per order.
   */
  readonly readyForDelivery: number;
}

/** One technician and how many jobs they currently hold open. */
export interface TechnicianAssignmentLoad {
  readonly technicianProfileId: string;
  readonly activeCount: number;
}

/** The branch set an overview figure answers for. */
export interface OverviewScope {
  readonly companyId: string;
  readonly branchIds: readonly string[];
}

export class WorkOrderOverviewPort extends ApplicationService {
  protected readonly module = 'work-order';

  constructor(
    private readonly repository: WorkOrderRepository,
    private readonly catalog: WorkOrderCatalogService
  ) {
    super();
  }

  /** The live board: every catalogue state with its count, and three totals. */
  async boardCounts(db: DbHandle, scope: OverviewScope): Promise<WorkOrderBoardCounts> {
    // Sequential: both statements run on the ONE client the transaction holds,
    // so issuing them together would only queue them inside the driver.
    const states = await this.catalog.workOrderStates(db);
    const rows = await this.repository.overviewStateCounts(db, scope);
    const counted = new Map(rows.map((row) => [row.state, row]));

    const byState = states.map((state) => ({
      state: state.code,
      label: state.name,
      count: counted.get(state.code)?.total ?? 0,
      isTerminal: state.isTerminal,
    }));

    let active = 0;
    let awaitingParts = 0;
    let readyForDelivery = 0;
    for (const state of states) {
      const row = counted.get(state.code);
      if (row === undefined) continue;
      if (!state.isTerminal) active += row.total;
      // Counted on the NON-terminal orders only. A finished job whose parts were
      // once requested is not waiting for anything.
      if (!state.isTerminal) awaitingParts += row.awaitingParts;
      if (state.isClosed && !state.isCancellation) readyForDelivery += row.total;
    }

    return { byState, active, awaitingParts, readyForDelivery };
  }

  /** Additional-work requests awaiting a decision, and the orders they hold up. */
  async pendingApprovals(
    db: DbHandle,
    scope: OverviewScope
  ): Promise<{ readonly requests: number; readonly workOrders: number }> {
    return this.repository.overviewPendingApprovals(db, scope);
  }

  /**
   * Work orders opened on each local day of the period.
   *
   * Returned as an ARRAY of the days that have rows, not as a filled series: the
   * consumer owns the period and is the only party that can say which days it
   * asked about, so filling the gaps here would need this port to re-derive the
   * period it was handed.
   */
  async openedPerDay(
    db: DbHandle,
    scope: OverviewScope,
    period: LocalDayPeriod
  ): Promise<ReadonlyMap<string, number>> {
    const rows = await this.repository.overviewOpenedPerDay(db, scope, period);
    return new Map(rows.map((row) => [row.localDay, row.total]));
  }

  /**
   * Work orders that reached a CLOSED, non-cancellation state on each local day.
   *
   * The state set is resolved from the live catalogue here, exactly as
   * `listClosedNonCancelled` resolves it, so no state name is written into this
   * module's SQL and a tenant that renames its closing state keeps a working
   * chart. A tenant whose catalogue resolves no such state gets an empty map,
   * because the repository's `= ANY` matches nothing on an empty array.
   */
  async completedPerDay(
    db: DbHandle,
    scope: OverviewScope,
    period: LocalDayPeriod
  ): Promise<ReadonlyMap<string, number>> {
    const states = (await this.catalog.workOrderStates(db))
      .filter((state) => state.isClosed && !state.isCancellation)
      .map((state) => state.code);
    const rows = await this.repository.overviewStateEntriesPerDay(db, scope, states, period);
    return new Map(rows.map((row) => [row.localDay, row.total]));
  }

  /**
   * Each technician's LIVE open-assignment load, by profile id.
   *
   * "Live" is decided by the job's state and the work order's state, not by the
   * assignment row alone: `wo.job_assignments.valid_to` is stamped only by a
   * reassignment or a removal, so an assignment on a job finished last year is
   * still an unended row. Both state sets are resolved from the live catalogue
   * HERE — the one place that already resolves platform/tenant precedence — and
   * passed down, so no state name reaches the repository's SQL and a tenant that
   * adds its own terminal state is honoured without a code change.
   */
  async assignmentLoad(
    db: DbHandle,
    scope: OverviewScope
  ): Promise<readonly TechnicianAssignmentLoad[]> {
    const jobStates = (await this.catalog.jobStates(db))
      .filter((state) => !state.isTerminal)
      .map((state) => state.code);
    // `!isTerminal` alone would already exclude every cancellation, because
    // `ck_work_order_states_cancellation` makes a cancellation terminal. Both
    // flags are read anyway: they are independent columns, and a predicate that
    // relied on the constraint rather than on the row would be reading the
    // schema's promise instead of the tenant's data.
    const workOrderStates = (await this.catalog.workOrderStates(db))
      .filter((state) => !state.isTerminal && !state.isCancellation)
      .map((state) => state.code);
    return this.repository.overviewActiveAssignments(db, scope, { jobStates, workOrderStates });
  }
}
