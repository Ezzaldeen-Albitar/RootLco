/**
 * `overview` module — public surface (Owner directive — the tenant dashboard).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/overview`.
 * The boundary checker and the ESLint rule both reject
 * `@/modules/overview/<anything>`.
 *
 * ## What this module owns
 *
 * NO SCHEMA. It is the one module in the tree with no migration, no table and
 * no `deleted_at`, and that is deliberate rather than a stage it has not reached
 * yet. The operations overview is a COMPOSITION: every figure on it belongs to a
 * schema another module owns — `rec` for the visits, `wo` for the orders, their
 * approvals and their assignments, `tech` for who the technicians are, `inv` for
 * what ran out, `org` for the branches and their timezones — and rule 3 forbids
 * reading any of them from here. So this module asks each owning module for its
 * own number, through that module's public index, and assembles the answer.
 *
 * Its single repository selects `now()` and nothing else. That is not a table
 * read: the local calendar day a period is cut at must come from the database's
 * clock rather than from this process's, for the same reason `readSessionState`
 * answers every expiry question in SQL.
 *
 * ## What no other module may do
 *
 * Nothing here is a source of truth, so there is nothing for another module to
 * be kept away from. The direction of the dependency is the rule instead: this
 * module imports five others and none of them imports it. A module that needed
 * a figure from the dashboard would be asking the wrong thing — the figure it
 * wants belongs to whichever module owns the rows.
 *
 * ## What this module deliberately does not do
 *
 * - **It carries no money.** Not one amount, rate or currency crosses this
 *   surface. Revenue belongs to reads whose own permission is
 *   `sal.finance.view`; publishing it here would put a financial figure behind a
 *   work-order permission.
 * - **It defines no rule of its own.** "Low stock", "closed and not cancelled",
 *   "still awaiting a decision" are all rules the owning modules already wrote,
 *   and each is composed from the same SQL those modules' own reads run. A
 *   second definition here would be a second answer to a question the product
 *   already answers somewhere else.
 * - **It does not page.** Every figure is a single SQL aggregate. A count taken
 *   from the rows of a page is a page size wearing the clothes of a fact.
 */
import { composeModule } from '@/server/layering';
import { OverviewClockRepository } from './data/overview-clock-repository';
import { DashboardSummaryService } from './application/dashboard-summary-service';

export type {
  DashboardSection,
  DashboardSections,
  DashboardStateBucket,
  DashboardSummaryQuery,
  DashboardSummaryView,
  DashboardTechnicianLoad,
  DashboardTrendPoint,
} from './application/dashboard-summary-service';

export {
  DASHBOARD_PERIOD_KINDS,
  MAX_DASHBOARD_PERIOD_DAYS,
  enumerateDays,
  resolveDashboardPeriod,
  shiftDay,
  type DashboardPeriod,
  type DashboardPeriodKind,
} from './domain/dashboard-period';

/** Composition root: constructs the module's services once per process. */
export const overviewModule = composeModule({
  module: 'overview',
  create: () => ({
    dashboard: new DashboardSummaryService(new OverviewClockRepository()),
  }),
});
