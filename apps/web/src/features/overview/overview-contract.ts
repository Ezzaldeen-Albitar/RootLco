/**
 * The operations overview contract (`ovw.dashboard-summary-read`).
 *
 * | operation                   | method | path                 | permission           |
 * | --------------------------- | ------ | -------------------- | -------------------- |
 * | `ovw.dashboard-summary-read`| GET    | `/dashboard/summary` | `wo.work_order.read` |
 *
 * Typed from the route that owns the shape —
 * `apps/api/src/app/api/v1/dashboard/summary/route.ts` — and from
 * `DashboardSummaryView` in
 * `apps/api/src/modules/overview/application/dashboard-summary-service.ts`.
 * Nothing here is invented; every field below exists on the published response.
 *
 * ## Why a board consumes this rather than counting its own rows
 *
 * A board holds ONE PAGE. Counting its rows answers "how many are on this page",
 * and rendering that beside a filter called "Awaiting parts" states something
 * entirely different and false. The operation computes each figure as a SQL
 * aggregate over the whole scoped selection inside the RLS-bound transaction, so
 * it is the only honest source of a count on a cursor-paginated screen — which
 * is also why it is here, in a feature of its own, rather than inside either
 * board: the dashboard wave consumes the same adapter.
 *
 * ## Every section carries its own state, and a withheld one is not a zero
 *
 * The operation is entitled by the code anyone on the shop floor already holds,
 * and then gates each section again on the read code of the module whose data it
 * is. A section the caller may not see comes back `unauthorized`. Rendering that
 * as `0` would be a false statement about the workshop instead of a true one
 * about the caller, so `DashboardSection` is a discriminated union and a
 * consumer must decide what to show for all three arms.
 */

/** The permission the operation registers. */
export const DASHBOARD_SUMMARY_PERMISSION = 'wo.work_order.read';

/** `DASHBOARD_PERIOD_KINDS`, mirrored from the overview module. */
export const DASHBOARD_PERIODS = ['today', 'yesterday', 'last7', 'custom'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** One figure: computed, withheld for want of a permission, or unanswerable. */
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

/** One technician's current load. `displayName` is null when it may not be read. */
export interface DashboardTechnicianLoad {
  readonly technicianId: string;
  readonly displayName: string | null;
  readonly activeCount: number;
}

/**
 * Every section the operation publishes.
 *
 * All of them are mirrored even though the two boards read five, because a
 * mirror that omits a published field is its own defect: the next consumer would
 * add it back in a second place and the two would drift.
 */
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
  readonly lowStock: DashboardSection<number>;
  readonly pendingApprovalsCount: DashboardSection<number>;
  readonly overdue: DashboardSection<number>;
}

/** The whole response. */
export interface DashboardSummary {
  readonly period: {
    readonly kind: DashboardPeriod;
    /** First calendar day included, `YYYY-MM-DD`. */
    readonly from: string;
    /** LAST calendar day included, `YYYY-MM-DD`. */
    readonly to: string;
    /** The IANA zone those two days are calendar days in. */
    readonly timezone: string;
  };
  readonly generatedAt: string;
  /** Exactly the branches the figures were computed over. */
  readonly branchIds: readonly string[];
  readonly sections: DashboardSections;
}

/** What a caller asks for. The branch is optional exactly as the route says. */
export interface DashboardSummaryCriteria {
  readonly period: DashboardPeriod;
  /** `YYYY-MM-DD`, and only with `period: 'custom'`. */
  readonly from?: string;
  readonly to?: string;
}

/**
 * What a screen should render for one figure.
 *
 * FOUR arms, not two, because the three the operation publishes mean three
 * different things to the person reading and a fourth — the whole read failed —
 * means a fourth:
 *
 *   - `figure`      the platform computed it;
 *   - `withheld`    the caller lacks the section's own module read code. A zero
 *                   here would be a false statement about the workshop instead
 *                   of a true one about the caller;
 *   - `unavailable` the schema holds nothing the question could be asked of.
 *                   Different from withheld: no permission would change it;
 *   - `absent`      no answer at all, because the aggregate itself was not read.
 *
 * The `reason` a section carries for `unavailable` is deliberately NOT part of
 * this: it is a server-authored SENTENCE, and no server prose reaches a screen
 * in this application. The caller renders its own catalogue sentence.
 */
export type FigureState =
  | { readonly kind: 'figure'; readonly value: number }
  | { readonly kind: 'withheld' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'absent' };

export function figureStateOf(section: DashboardSection<number> | undefined): FigureState {
  if (section === undefined) return { kind: 'absent' };
  if (section.status === 'ok') return { kind: 'figure', value: section.value };
  if (section.status === 'unauthorized') return { kind: 'withheld' };
  return { kind: 'unavailable' };
}
