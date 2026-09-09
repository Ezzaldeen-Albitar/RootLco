/**
 * The work-order module's REPORTING port (P1-31 prerequisite P-11).
 *
 * ## Why a port and not a query in the reporting module
 *
 * `wo.*` is private to this module (ADR-001 rule 3; `index.ts` says so and the
 * boundary checker enforces it), so the SQL that counts work orders by state
 * lives here and the reporting module asks for the answer. That is the
 * `OpenInventoryCommitments` / `PartyContextRepository` precedent exactly: the
 * owning module answers for its own tables.
 *
 * ## Why a separate class rather than a method on `WorkOrderService`
 *
 * A cross-module consumer should depend on the ONE thing it needs. Exposing the
 * whole work-order service under a second name would hand the reporting module
 * every transition, closure and assignment command as well, and a boundary that
 * is only respected by habit is not one. This class holds a single method and
 * shares the repository and the state catalogue with the services beside it —
 * one resolution of the tenant/platform state override in the process, which is
 * the reason `JobBoardService` shares the catalogue too.
 *
 * ## It performs NO authorization
 *
 * Deliberately, and stated so it is not mistaken for an omission. The caller —
 * `ReportRunService` — has already evaluated `wo.work_order.read` against the
 * company and branch it passes here, at the run operation's branch scope, and
 * RLS narrows the statement underneath. Adding a second, differently-shaped
 * check here would be a second definition of scope, which is the defect
 * `authorization.ts` records at length.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  WORK_ORDER_LIST_ORDER,
  type WorkOrderRepository,
  type WorkOrderStatusSummaryFilter,
} from '../data/work-order-repository';
import type { WorkOrderCatalogService } from './work-order-catalog-service';
import { withPartyContext, type PageInput, type WorkOrderSummary } from './work-order-service';

/** One state, its catalogue label, and how many orders are in it. */
export interface WorkOrderStateCount {
  readonly stateCode: string;
  /**
   * `wo.work_order_states.name`, resolved through the tenant/platform override.
   *
   * A SINGLE text column: the catalogue carries no localised label, so a client
   * that needs Arabic cannot get it from here. That is a schema fact and it is
   * recorded as a named prerequisite in the seam record rather than papered over
   * with a translation invented in the API.
   */
  readonly stateName: string;
  readonly count: number;
}

export interface WorkOrderStatusSummary {
  /**
   * Every ACTIVE state in the tenant's catalogue, including the ones no order is
   * in — those carry `count: 0`.
   *
   * A report that silently omitted the empty states would read as though those
   * states did not exist, and "no orders are awaiting parts" is an answer a
   * manager needs to be able to see.
   */
  readonly counts: readonly WorkOrderStateCount[];
  /** One keyset page of the selection the counts were computed over. */
  readonly workOrders: Page<WorkOrderSummary>;
}

export class WorkOrderReportPort extends ApplicationService {
  protected readonly module = 'work-order';

  constructor(
    private readonly repository: WorkOrderRepository,
    private readonly catalog: WorkOrderCatalogService
  ) {
    super();
  }

  /**
   * Work orders opened in a calendar period in one branch, with every state's
   * count over the WHOLE selection.
   *
   * The catalogue read and the aggregate are combined here rather than in SQL
   * because the state catalogue is tenant-extensible and platform rows may be
   * shadowed: a `LEFT JOIN` in the repository would have to re-implement the
   * `DISTINCT ON (code) … ORDER BY code, (scope = 'tenant') DESC` precedence that
   * `WorkOrderCatalogService` already owns, and two resolutions of that
   * precedence is exactly what this module exists to prevent.
   */
  async statusSummary(
    db: DbHandle,
    filter: WorkOrderStatusSummaryFilter,
    page: PageInput
  ): Promise<WorkOrderStatusSummary> {
    // The ordering contract and the cursor decode stay behind this surface for
    // the reason `WorkOrderService.list` states: a consumer that decoded the
    // cursor itself would be validating it against a contract it had to guess.
    const [summary, states] = await Promise.all([
      this.repository.statusSummary(db, filter, pageRequest(WORK_ORDER_LIST_ORDER, page)),
      this.catalog.workOrderStates(db),
    ]);
    const totals = new Map(summary.counts.map((row) => [row.state, row.total]));
    const counts: WorkOrderStateCount[] = states.map((state) => ({
      stateCode: state.code,
      stateName: state.name,
      count: totals.get(state.code) ?? 0,
    }));
    /*
     * A state that holds rows but is NOT in the active catalogue is still
     * reported, rather than dropped.
     *
     * `wo.work_order_states` can be deactivated while orders sit in that state —
     * there is no foreign key from `wo.work_orders.state` to the catalogue, and
     * `ck_work_orders_state_format` checks only the shape. Dropping such a group
     * would make the counts disagree with the rows on the same page, which is
     * the one property this report must not have. The code stands in for the
     * label, because there is no longer an active row to take one from.
     */
    const known = new Set(states.map((state) => state.code));
    for (const row of summary.counts) {
      if (known.has(row.state)) continue;
      counts.push({ stateCode: row.state, stateName: row.state, count: row.total });
    }
    counts.sort((left, right) => left.stateCode.localeCompare(right.stateCode));

    return {
      counts,
      workOrders: {
        ...summary.page,
        items: await withPartyContext(db, summary.page.items),
      },
    };
  }
}
