/**
 * The tenant dashboard summary (Owner directive — the operations overview).
 *
 * One read that answers the question a branch manager opens the product with:
 * what is in the shop, what is stuck, who is busy, and what ran out. Every
 * figure on it is computed HERE, server-side, from a single SQL aggregate per
 * question over the RLS-bound transaction — never by counting the rows of a
 * paginated read, which would publish a page size as if it were a fact.
 *
 * ## Why it is a module of its own and not a method on `work-order`
 *
 * The answer spans five schemas that five different modules own — `rec`, `wo`,
 * `sal`/`inv` and `tech`, plus `org` for the branches themselves. No one of
 * those modules may read another's tables (ADR-001 rule 3), so the composition
 * has to live somewhere that owns none of them. This module owns NO SCHEMA AT
 * ALL: it has no migration, no table, and its only repository selects `now()`.
 * It is a composition, and its whole job is asking each owning module for its
 * own number and assembling the answer.
 *
 * ## Why it does not require `rpt.report.read`
 *
 * The reporting module already aggregates server-side, and every one of its
 * datasets sits behind `rpt.report.read` — a code a service advisor or a
 * foreman has no reason to hold. Putting the dashboard there would mean the
 * screen every ordinary member of staff opens first is the one screen they
 * cannot open. So the dashboard is entitled by `wo.work_order.read`, the code
 * anyone who works on the shop floor already holds, and every SECTION is then
 * gated on the read code of the module whose data it is.
 *
 * ## Three states per section, and the difference between them matters
 *
 *   `ok`            the figure was computed. A zero is an `ok` with value 0 —
 *                   "nothing is awaiting parts" is an answer, not an absence.
 *   `unauthorized`  this caller does not hold the module read code that section
 *                   needs, in every branch being counted. The section is omitted
 *                   rather than shown at zero, because a zero would be a lie
 *                   about the workshop instead of a fact about the caller.
 *   `unavailable`   the schema cannot answer the question at all, with the
 *                   reason in words. `overdue` is the live example: no work-order
 *                   table carries a promised or due instant, so there is nothing
 *                   to be late against, and inventing one from the opening
 *                   instant plus a guess would be the platform making up a
 *                   commitment nobody gave.
 *
 * A section is `ok` only when the caller holds its code in EVERY branch in the
 * resolved set. A figure that silently summed the branches the caller could read
 * and skipped the rest would be a total that is wrong in a way nothing on the
 * screen could reveal.
 *
 * ## Scope, and what makes it fail closed
 *
 * `companyId` is required. `branchId` is optional and means "this branch";
 * omitting it means "every branch of that company I am authorized in", which is
 * resolved rather than assumed:
 *
 *  1. the set is the one the work-order BOARD resolves for the same request,
 *     through the same two steps, so an "all my branches" figure and the list
 *     it links to cover the same branches (Owner directive, P1-32-PRE-OD-UX):
 *     the pipeline's `authorizedBranches` seam (`resolveAuthorizedBranches`,
 *     bound to this operation, whose only code is the board's
 *     `wo.work_order.read`) decides it, one branch at a time, for a
 *     branch-narrowed caller; and for a caller with no branch narrowing it
 *     answers "the company", which both sides read as every LIVE branch of it
 *     from `iamOrganizationContext().branches.listBranchesForCompany`;
 *  2. a RETIRED branch is in neither set. The resolver's narrowed arm already
 *     drops it (`deleted_at IS NULL`), and the company arm is read through the
 *     same live-branch list on both sides, so an order still standing in a
 *     retired branch is counted by neither the figure nor the list;
 *  3. a NAMED `branchId` goes through `authorizeScope`, which raises the uniform
 *     `ERR-IAM-001` — so an unauthorized branch is refused rather than quietly
 *     dropped, and the refusal never says whether the branch exists;
 *  4. an empty resolved set is refused with the same `ERR-IAM-001`. Answering it
 *     with zeros would tell a caller with no authority anywhere that the company
 *     had no work, which is a statement about the tenant's data.
 *
 * ## The period is a calendar period in ONE zone
 *
 * A single branch is reported in its own `org.branches.timezone_name`. A set of
 * branches is reported in the FIRST one's, and the zone travels in the response
 * so a reader can see which day boundary the figures were cut at — a multi-branch
 * total across two zones cannot be right for both, and saying which one it is
 * beats silently picking one. The day itself is measured on the DATABASE clock
 * (`OverviewClockRepository`), not on this process's.
 *
 * ## No money crosses this surface
 *
 * Not one figure here is an amount, a rate or a currency. That is a scope
 * decision and not an oversight: revenue belongs to reads whose own permission
 * is `sal.finance.view`, and a dashboard that carried it would put a financial
 * figure behind a work-order permission.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import {
  callerHoldsPermission,
  type BranchScopeResolver,
  type ScopeAuthorizer,
} from '@/server/auth/authorization';
import type { LocalDayPeriod } from '@/server/db/period';
import { iamOrganizationContext, type BranchContextRow } from '@/modules/iam';
import { workOrderModule } from '@/modules/work-order';
import { receptionModule } from '@/modules/reception';
import { technicianModule } from '@/modules/technician';
import { inventoryModule } from '@/modules/inventory';
import type { OverviewClockRepository } from '../data/overview-clock-repository';
import {
  enumerateDays,
  resolveDashboardPeriod,
  type DashboardPeriodKind,
} from '../domain/dashboard-period';

/** The base entitlement of the operation, and the floor every branch must pass. */
const WORK_ORDER_READ = 'wo.work_order.read';
/** The module read codes each section is gated on. */
const RECEPTION_READ = 'rec.reception.read';
const DELIVERY_VIEW = 'sal.delivery.view';
const TECHNICIAN_READ = 'tech.technician.read';
const STOCK_READ = 'inv.stock.read';

/** What a caller asks for. Already validated by the route's schema. */
export interface DashboardSummaryQuery {
  readonly companyId: string;
  readonly branchId?: string | undefined;
  readonly period: DashboardPeriodKind;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

/** One section: computed, withheld for want of a permission, or unanswerable. */
export type DashboardSection<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'unauthorized' }
  | { readonly status: 'unavailable'; readonly reason: string };

/** One work-order state of the tenant's own catalogue, with its live count. */
export interface DashboardStateBucket {
  readonly state: string;
  readonly label: string;
  readonly count: number;
  readonly isTerminal: boolean;
}

/** One day of the period: what was opened and what was finished. */
export interface DashboardTrendPoint {
  /** `YYYY-MM-DD` in the reported timezone. */
  readonly date: string;
  readonly opened: number;
  readonly completed: number;
}

/** One technician's current load. */
export interface DashboardTechnicianLoad {
  readonly technicianId: string;
  /** Null when this caller may not be told who that is. */
  readonly displayName: string | null;
  readonly activeCount: number;
}

/** Every section of the dashboard, each carrying its own state. */
export interface DashboardSections {
  readonly receptionsOpened: DashboardSection<number>;
  readonly activeWorkOrders: DashboardSection<number>;
  readonly awaitingApproval: DashboardSection<number>;
  readonly awaitingParts: DashboardSection<number>;
  readonly readyForDelivery: DashboardSection<number>;
  readonly completedInPeriod: DashboardSection<number>;
  readonly workOrdersByState: DashboardSection<readonly DashboardStateBucket[]>;
  readonly intakeCompletionTrend: DashboardSection<readonly DashboardTrendPoint[]>;
  readonly technicianWorkload: DashboardSection<readonly DashboardTechnicianLoad[]>;
  /**
   * Distinct ITEMS at or below their configured reorder level.
   *
   * Items, not findings: the inventory alert raises one row per applicable
   * reorder level per branch, so a part with a branch level and two shelf levels
   * is three rows, and the same part low in two branches is more again. This
   * figure is the union, because "how many parts are running out" is the question
   * a dashboard is asked. The alert list is therefore expected to be LONGER than
   * this number, and that is not a disagreement between them.
   */
  readonly lowStock: DashboardSection<number>;
  readonly pendingApprovalsCount: DashboardSection<number>;
  readonly overdue: DashboardSection<number>;
}

/** The whole response. */
export interface DashboardSummaryView {
  readonly period: {
    readonly kind: DashboardPeriodKind;
    /** First calendar day included. */
    readonly from: string;
    /** LAST calendar day included. */
    readonly to: string;
    /** The IANA zone the two days above are calendar days in. */
    readonly timezone: string;
  };
  readonly generatedAt: string;
  /** Exactly the branches the figures were computed over. */
  readonly branchIds: readonly string[];
  readonly sections: DashboardSections;
}

/** A computed figure. */
const ok = <T>(value: T): DashboardSection<T> => ({ status: 'ok', value });
/** Withheld: the caller lacks the section's module read code. */
const unauthorized = <T>(): DashboardSection<T> => ({ status: 'unauthorized' });
/** Unanswerable: the schema holds nothing the question could be asked of. */
const unavailable = <T>(reason: string): DashboardSection<T> => ({
  status: 'unavailable',
  reason,
});

/**
 * The reason `overdue` cannot be computed, in words rather than as a code.
 *
 * Written once, here, because it is a claim about the schema and a reader has to
 * be able to check it: `wo.work_orders` carries `opened_at` and nothing else
 * temporal, and no table in `wo` holds a promised or agreed completion instant.
 * When one lands, this constant is what fails to make sense any more.
 */
const NO_DUE_INSTANT =
  'A work order records when it was opened and not when it was promised, so the ' +
  'platform holds nothing to measure lateness against.';

export class DashboardSummaryService extends ApplicationService {
  protected readonly module = 'overview';

  constructor(private readonly clock: OverviewClockRepository) {
    super();
  }

  /**
   * The dashboard, for one company and either one branch or every authorized one.
   *
   * `authorizeScope` is the route pipeline's own re-evaluation of THIS
   * operation's declared permissions against a target discovered inside the
   * transaction. It is used for the named-branch case rather than a bare
   * `callerHoldsPermission`, so the refusal carries the operation's declared
   * codes and is raised inside the transaction that would have read the rows.
   *
   * `authorizedBranches` is the same pipeline's `resolveAuthorizedBranches`,
   * bound to this operation — the seam the work-order board resolves its own
   * all-branches set with — and is used when no branch is named.
   */
  async summary(
    db: DbHandle,
    query: DashboardSummaryQuery,
    authorizeScope: ScopeAuthorizer,
    authorizedBranches: BranchScopeResolver
  ): Promise<DashboardSummaryView> {
    const branches = await this.resolveBranches(db, query, authorizeScope, authorizedBranches);
    const branchIds = branches.map((branch) => branch.branchId);
    const scope = { companyId: query.companyId, branchIds };

    // The first branch of the resolved set decides the zone, and the response
    // says which zone that was. `listBranchesForCompany` orders by name then id,
    // so "first" is stable across calls rather than whatever the planner
    // returned.
    const timezoneName = branches[0]?.timezoneName ?? 'UTC';
    const clock = await this.clock.reading(db, timezoneName);
    const period = resolveDashboardPeriod({
      kind: query.period,
      localToday: clock.localDay,
      timezoneName,
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });
    const localPeriod: LocalDayPeriod = {
      from: period.from,
      toExclusive: period.toExclusive,
      timezoneName: period.timezoneName,
    };

    // Sequential, not `Promise.all`. Every statement on this path runs on the
    // ONE client the transaction holds, so concurrent calls do not overlap — the
    // driver queues them and warns that it will stop doing so — and the apparent
    // parallelism would buy nothing while making the ordering of a refusal
    // depend on a scheduler.
    const mayReadReceptions = await this.holdsEverywhere(db, RECEPTION_READ, scope);
    const mayViewDeliveries = await this.holdsEverywhere(db, DELIVERY_VIEW, scope);
    const mayReadTechnicians = await this.holdsEverywhere(db, TECHNICIAN_READ, scope);
    const mayReadStock = await this.holdsEverywhere(db, STOCK_READ, scope);

    const overview = workOrderModule().overviewPort;
    const board = await overview.boardCounts(db, scope);
    const approvals = await overview.pendingApprovals(db, scope);
    const opened = await overview.openedPerDay(db, scope, localPeriod);
    const completed = await overview.completedPerDay(db, scope, localPeriod);

    const trend: DashboardTrendPoint[] = enumerateDays(period).map((date) => ({
      date,
      opened: opened.get(date) ?? 0,
      completed: completed.get(date) ?? 0,
    }));
    const completedInPeriod = trend.reduce((total, point) => total + point.completed, 0);

    return {
      period: {
        kind: period.kind,
        from: period.from,
        to: period.to,
        timezone: period.timezoneName,
      },
      generatedAt: clock.asOf.toISOString(),
      branchIds,
      sections: {
        receptionsOpened: mayReadReceptions
          ? ok(await receptionModule().receptionRead.overviewVisitsOpened(db, scope, localPeriod))
          : unauthorized(),
        activeWorkOrders: ok(board.active),
        awaitingApproval: ok(approvals.workOrders),
        awaitingParts: ok(board.awaitingParts),
        // Gated on the DELIVERY code although the rows are work orders: the
        // figure is the handover queue's own candidate set — closed and not
        // cancelled, the predicate `listClosedNonCancelled` publishes — so the
        // person it is for is the person who may see deliveries.
        readyForDelivery: mayViewDeliveries ? ok(board.readyForDelivery) : unauthorized(),
        completedInPeriod: ok(completedInPeriod),
        workOrdersByState: ok(board.byState),
        intakeCompletionTrend: ok(trend),
        technicianWorkload: mayReadTechnicians
          ? ok(await this.technicianWorkload(db, scope))
          : unauthorized(),
        lowStock: mayReadStock
          ? ok(await this.lowStock(db, query.companyId, branchIds))
          : unauthorized(),
        pendingApprovalsCount: ok(approvals.requests),
        overdue: unavailable(NO_DUE_INSTANT),
      },
    };
  }

  /**
   * The branches the figures will be computed over, or a refusal.
   *
   * A NAMED branch is authorized through the pipeline's own `authorizeScope`
   * first and looked up second. The order is the same one
   * `requireScopeTargetInTenant` insists on for every query-scoped read: a
   * caller missing the permission must be told that, not told whether the branch
   * is visible.
   */
  private async resolveBranches(
    db: DbHandle,
    query: DashboardSummaryQuery,
    authorizeScope: ScopeAuthorizer,
    authorizedBranches: BranchScopeResolver
  ): Promise<readonly BranchContextRow[]> {
    // `iamOrganizationContext` and NOT `iamModule`: the organizational root is
    // provider-free, so reading a branch's timezone cannot make this read depend
    // on the Supabase environment variables and answer `ERR-SYS-001` wherever
    // they are unset — the measured reason that root exists at all.
    const branches = iamOrganizationContext().branches;

    if (query.branchId !== undefined) {
      await authorizeScope({ companyId: query.companyId, branchId: query.branchId });
      const branch = await branches.findBranch(db, {
        companyId: query.companyId,
        branchId: query.branchId,
      });
      if (branch === null) {
        // The uniform denial, never a 404: saying "not found" here would confirm
        // that a branch id the caller guessed is absent from the tenant.
        throw new AppFailure('ERR-IAM-001', {
          safeDetails: { requiredPermissions: [WORK_ORDER_READ] },
          message: 'Denied ovw.dashboard-summary-read: the named branch is not visible',
        });
      }
      return [branch];
    }

    // The board's own resolution, step for step (see the module note): the
    // seam decides a narrowed caller's branches and refuses one holding none;
    // `undefined` means the company, read as its LIVE branches — the list the
    // board reads for the same answer. The live list is read either way because
    // it carries the zone and the stable name order the figures are cut in.
    const narrowed = await authorizedBranches(query.companyId);
    const live = await branches.listBranchesForCompany(db, query.companyId);
    const authorized =
      narrowed === undefined ? live : live.filter((branch) => narrowed.includes(branch.branchId));
    if (authorized.length === 0) {
      throw new AppFailure('ERR-IAM-001', {
        safeDetails: { requiredPermissions: [WORK_ORDER_READ] },
        message: 'Denied ovw.dashboard-summary-read: no branch of that company is authorized',
      });
    }
    return authorized;
  }

  /**
   * Whether the caller holds one code in EVERY branch being counted.
   *
   * `every` and not `some`, because the figures are sums across the set. A
   * caller holding `inv.stock.read` in one of three branches would otherwise be
   * shown a low-stock count for the whole company that is really a count for a
   * third of it, with nothing on the response to say so.
   */
  private async holdsEverywhere(
    db: DbHandle,
    permissionCode: string,
    scope: { readonly companyId: string; readonly branchIds: readonly string[] }
  ): Promise<boolean> {
    for (const branchId of scope.branchIds) {
      if (
        !(await callerHoldsPermission(db, permissionCode, { companyId: scope.companyId, branchId }))
      )
        return false;
    }
    return true;
  }

  /** Open assignments per technician, named through the owning module. */
  private async technicianWorkload(
    db: DbHandle,
    scope: { readonly companyId: string; readonly branchIds: readonly string[] }
  ): Promise<readonly DashboardTechnicianLoad[]> {
    const load = await workOrderModule().overviewPort.assignmentLoad(db, scope);
    const labels = await technicianModule().labelPort.labelsForProfiles(
      db,
      load.map((entry) => entry.technicianProfileId)
    );
    // Busiest first, then by id so the order is total and a redraw does not
    // reshuffle two technicians who hold the same number of jobs.
    return [...load]
      .sort(
        (left, right) =>
          right.activeCount - left.activeCount ||
          left.technicianProfileId.localeCompare(right.technicianProfileId)
      )
      .map((entry) => ({
        technicianId: entry.technicianProfileId,
        displayName: labels.get(entry.technicianProfileId) ?? null,
        activeCount: entry.activeCount,
      }));
  }

  /**
   * How many distinct ITEMS are low, across the resolved branches.
   *
   * ## A union, never a sum
   *
   * The inventory alert's unit is a FINDING — one row per applicable reorder
   * level per branch — so one part can raise several: a branch-wide level plus a
   * level on each of two shelves is three rows, and the same part low in two
   * branches adds two more. Adding the per-branch answers would publish "5 items
   * low" for a stock-room holding one empty bin, which is the wrong figure in the
   * direction that causes an unnecessary order. The module therefore returns IDS
   * and this collects them into a set, so the number is the count of parts a
   * buyer would have to do something about.
   *
   * ## Still one call per branch
   *
   * The inventory selection resolves reorder-level specificity against ONE
   * branch, and widening it to an array would change which level wins for an item
   * that has both a company-wide and a branch-specific one — a change to the
   * alert RULE rather than to the plumbing, and the alert and this figure must
   * stay the same rule. Sequential rather than `Promise.all`, because every
   * statement here runs on the one client the transaction holds.
   */
  private async lowStock(
    db: DbHandle,
    companyId: string,
    branchIds: readonly string[]
  ): Promise<number> {
    const items = new Set<string>();
    for (const branchId of branchIds) {
      for (const itemId of await inventoryModule().alerts.lowStockItemIds(db, {
        companyId,
        branchId,
      })) {
        items.add(itemId);
      }
    }
    return items.size;
  }
}
