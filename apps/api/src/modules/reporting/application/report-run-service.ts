/**
 * Report EXECUTION (P1-31 prerequisite P-11, engine slice 1 of 4).
 *
 * ## What changed since P1-23, and what did not
 *
 * P1-23 published the report catalogue and refused to run anything, because the
 * frozen `rpt` schema binds no data source to a report code and inventing one
 * would have meant inventing a business report nobody approved. That limitation
 * is now answered by the Owner requirement rather than by this module's
 * judgement: a report definition binds a `report_code` to a **code-registered
 * dataset** (`docs/product/owner-requirements-2026-09-06.md:196`,
 * OWR-2026-09-06-A-12). The registry is `domain/report-datasets.ts`; this file
 * is the only place that turns one into rows.
 *
 * What did NOT change: nothing here writes, nothing here exports, and the
 * per-report export permission is still projected rather than exercised. Export
 * is prerequisite P-12 and `rpt.export` remains excluded (change control CC-04).
 *
 * ## The authorization model, in the order it runs
 *
 * 1. The ROUTE authorizes `rpt.report.read` at `scope: 'branch'` with the
 *    caller's company and branch as the `authorizationTarget`. That is the right
 *    to run reports at all, and it must be branch-scoped:
 *    `requiresScopedEvaluation` (`server/auth/authorization.ts:63`) returns false
 *    for a tenant-scoped operation whatever target it is given, so a
 *    tenant-scoped run operation would be decided by the scope-blind
 *    `iam.has_permission`, and `app.branch_ids` is the permission-blind union of
 *    every active grant (P1-18-A-01).
 * 2. THIS service then evaluates the dataset's own `requiredPermission` —
 *    `wo.work_order.read` for the only dataset registered today — against the
 *    same company and branch, through `callerHoldsPermission`, which asks the
 *    same deployed `iam.has_permission_in_scope` every other check asks. A
 *    caller who may run reports but may not read work orders is refused.
 *
 * A single operation cannot declare a per-report permission code — the
 * declaration is a literal, read statically by the authorization gate — so the
 * second check has to happen here. It answers the UNIFORM `ERR-IAM-001`, the
 * same failure the route's own check produces, so a caller cannot tell the two
 * apart and cannot use the difference to discover which datasets exist.
 *
 * ## The order of the two checks is itself a decision
 *
 * The permission is evaluated BEFORE the branch is resolved. An unrestricted
 * grant satisfies `iam.has_permission_in_scope` for a branch id that does not
 * exist, so resolving the branch first would let a caller holding only
 * `rpt.report.read` distinguish a real branch from an invented one by the error
 * code. With the dataset check first, only a caller who could have read the data
 * anyway learns anything.
 *
 * ## The branch resolution is DEFENCE IN DEPTH, not the tenant boundary
 *
 * Stated so it is not mistaken for the control. `requireScopeTargetInTenant`
 * (`server/auth/authorization.ts`, P1-30 CC-14) already resolves the caller's
 * (company, branch) pair under the caller's own RLS BEFORE this handler runs, and
 * refuses a foreign, missing or out-of-company pair with `ERR-IAM-001`. So the
 * `ERR-RES-001` below is not reachable through the published route for a
 * fully-specified pair — the suite proves the 403 arrives first. It is kept
 * because this service is callable without that pre-handler probe, and a read
 * that assumed its caller had been checked would be a read with no floor.
 *
 * ## The period is a calendar range in the BRANCH's timezone
 *
 * `from` is the first day included and `to` is the first day EXCLUDED — the day
 * after the last one reported. Both are resolved against
 * `org.branches.timezone_name`, so "opened on the 3rd" means the 3rd where the
 * workshop is. Half-open rather than closed because a closed upper bound over a
 * day either swallows the next day's first instant or drops the last one's final
 * microsecond, and either shows up only as a total that does not add up.
 *
 * The branch timezone rather than the tenant default (`org.tenants
 * .default_timezone`) is a coordinator DECISION recorded for the Owner to
 * confirm, not a contract fact: both columns exist, both are foreign keys into
 * `shared.timezones`, and no query in the platform buckets by either today. It
 * is written down in `docs/phase-1/phase-1-31/report-engine-seam.md`.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermission } from '@/server/auth/authorization';
import type { DbHandle } from '@/server/db/transaction';
import type { Page } from '@/server/db/pagination';
import { iamOrganizationContext } from '@/modules/iam';
import { workOrderModule } from '@/modules/work-order';
import {
  isReportDatasetCode,
  reportDataset,
  type ReportColumnKind,
  type ReportDatasetCode,
  type ReportDatasetDefinition,
} from '../domain/report-datasets';

/** A column as published to a client. */
export interface ReportColumnView {
  readonly key: string;
  readonly kind: ReportColumnKind;
  /**
   * The client route template a `reference` cell's `value` fills, or null.
   *
   * A template rather than a built URL: the API does not own the client's route
   * table, and emitting `/work-orders/<uuid>` would make this module the
   * authority on a path `apps/web` owns.
   */
  readonly drillThrough: string | null;
}

/**
 * One cell.
 *
 * Two halves, deliberately, because every column in this report has both and a
 * single field would force one of them to be dropped:
 *
 *   * `label` is what a human reads — a display number, a customer's name, a
 *     state's catalogue name. Null when the source has nothing to show.
 *   * `value` is the machine-readable half — a row id for a `reference` column,
 *     a catalogue CODE for a `text` column that renders a label, an ISO-8601
 *     instant for a `date` column.
 *
 * Cells are emitted in `columns` order and repeat the column key, so a client
 * may read them positionally or by name and neither is a guess.
 */
export interface ReportCellView {
  readonly key: string;
  readonly label: string | null;
  readonly value: string | null;
}

export interface ReportRowView {
  readonly cells: readonly ReportCellView[];
}

/** One work-order state and its count over the WHOLE scoped selection. */
export interface ReportStateCountView {
  readonly stateCode: string;
  readonly stateName: string;
  readonly count: number;
}

export interface ReportPeriodView {
  /** First day included, `YYYY-MM-DD`. */
  readonly from: string;
  /** First day EXCLUDED — the day after the last one reported. */
  readonly to: string;
  /** The IANA zone the two days were resolved in: the branch's own. */
  readonly timezone: string;
}

/**
 * The run result.
 *
 * `countsByState` is on the envelope rather than inside a dataset-specific
 * payload, and that is a LIMITATION of slice 1 stated rather than hidden: the
 * one dataset registered today groups by work-order state, so the engine's
 * result type names that grouping. The other three baseline reports (P-11's
 * remaining slices) group differently, and generalising this field is their
 * work — it is listed as a named prerequisite in the seam record so the next
 * slice does not discover it.
 */
export interface ReportRunView {
  readonly reportCode: string;
  /** The i18n key for the report's title. See `ReportDatasetDefinition`. */
  readonly titleKey: string;
  readonly scope: 'branch';
  readonly period: ReportPeriodView;
  /** When the rows were read. */
  readonly generatedAt: string;
  /**
   * `live` — the rows are read from the operational tables inside the request's
   * own transaction. There is no snapshot, no cache and no materialised view
   * behind this, and a client must not present the answer as one.
   */
  readonly freshness: 'live';
  readonly columns: readonly ReportColumnView[];
  readonly countsByState: readonly ReportStateCountView[];
  readonly rows: Page<ReportRowView>;
}

export interface ReportRunInput {
  readonly reportCode: string;
  readonly companyId: string;
  readonly branchId: string;
  /** First day included, `YYYY-MM-DD`. */
  readonly from: string;
  /** First day EXCLUDED, `YYYY-MM-DD`. */
  readonly to: string;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** What a resolver is handed once the period and the scope are settled. */
interface ResolverInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly from: string;
  readonly toExclusive: string;
  readonly timezoneName: string;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** What a resolver returns. The envelope around it is assembled below. */
interface ResolverResult {
  readonly countsByState: readonly ReportStateCountView[];
  readonly rows: Page<ReportRowView>;
}

type ReportResolver = (db: DbHandle, input: ResolverInput) => Promise<ResolverResult>;

const cell = (key: string, label: string | null, value: string | null): ReportCellView => ({
  key,
  label,
  value,
});

/**
 * `work_orders_by_status` — the first and only registered dataset.
 *
 * The rows come through the work-order module's reporting PORT, not from SQL
 * written here: `wo.*` is that module's private schema (ADR-001 rule 3), and the
 * port is the same shape as the `OpenInventoryCommitments` and reception
 * party-context ports this codebase already uses to cross a boundary.
 *
 * Every cell is taken from the projection the port already returns. Nothing is
 * recomputed, so a work order that reads one way on the board cannot read
 * another way in the report — the specific failure a second mapper produces.
 */
const runWorkOrdersByStatus: ReportResolver = async (db, input) => {
  const summary = await workOrderModule().reportPort.statusSummary(
    db,
    {
      companyId: input.companyId,
      branchId: input.branchId,
      from: input.from,
      toExclusive: input.toExclusive,
      timezoneName: input.timezoneName,
    },
    { cursor: input.cursor, limit: input.limit }
  );
  const stateNames = new Map(summary.counts.map((entry) => [entry.stateCode, entry.stateName]));

  return {
    countsByState: summary.counts,
    rows: {
      ...summary.workOrders,
      items: summary.workOrders.items.map((order) => ({
        cells: [
          // The drill-through target. `displayNumber` is nullable — the number is
          // allocated by the sequence when the order is issued a document, not
          // when it is opened — so the label may be absent while the id never is.
          cell('workOrder', order.displayNumber, order.id),
          cell('branch', input.branchName, order.branchId),
          // Null when the visit named no `service_requester` at the order's
          // `opened_at`. That is a REAL state — the role is a deferred contract
          // — and the report renders the absence rather than inventing a party.
          cell(
            'customer',
            order.customer === null ? null : order.customer.displayName,
            order.customer === null ? null : order.customer.partnerId
          ),
          // The plate is the identifier a workshop uses; the make and model are
          // the fallback when the plate history has nothing at this instant.
          cell(
            'vehicle',
            order.vehicle.registrationPlate ?? order.vehicle.makeModel,
            order.vehicle.vehicleId
          ),
          // An instant, serialised UTC, exactly as every other read publishes it.
          // The DAY it falls on depends on the zone, which is why the period
          // states the zone it was resolved in.
          cell('openedAt', null, order.openedAt),
          cell('state', stateNames.get(order.state) ?? order.state, order.state),
        ],
      })),
    },
  };
};

/**
 * Code → resolver, TOTAL by construction.
 *
 * `Record<ReportDatasetCode, …>` over the registry's own key union: a dataset
 * added to `REPORT_DATASETS` without a resolver here does not compile, and a
 * resolver for a code that is not registered does not compile either. That is
 * what holds the two halves of the registry together across the layer boundary
 * `B5` requires between them.
 */
const RESOLVERS: Readonly<Record<ReportDatasetCode, ReportResolver>> = Object.freeze({
  work_orders_by_status: runWorkOrdersByStatus,
});

/** `YYYY-MM-DD`, validated again here because this service is callable directly. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ReportRunService extends ApplicationService {
  protected readonly module = 'reporting';

  /**
   * Runs one registered report over one branch and one calendar period.
   *
   * An unknown code answers `ERR-RES-001` — the same failure
   * `rpt.report-read` gives for a draft, an archived report, another tenant's
   * report and a code that never existed. The catalogue must not become a way to
   * enumerate what the platform can run.
   */
  async run(db: DbHandle, input: ReportRunInput): Promise<ReportRunView> {
    if (!isReportDatasetCode(input.reportCode)) {
      throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });
    }
    const definition: ReportDatasetDefinition = reportDataset(input.reportCode);
    assertPeriod(input.from, input.to);

    // FIRST. See the file header: resolving the branch before this would let a
    // caller who cannot read the data learn whether a branch exists.
    const permitted = await callerHoldsPermission(db, definition.requiredPermission, {
      companyId: input.companyId,
      branchId: input.branchId,
    });
    if (!permitted) {
      throw new AppFailure('ERR-IAM-001', {
        message: `Denied ${definition.code}: missing ${definition.requiredPermission}`,
        // The same disclosure `requirePermissions` makes, for the same reason:
        // the required code is documented API metadata, and the RESOURCE is
        // never named.
        safeDetails: { requiredPermissions: [definition.requiredPermission] },
      });
    }

    const branch = await iamOrganizationContext().branches.findBranch(db, {
      companyId: input.companyId,
      branchId: input.branchId,
    });
    if (branch === null) {
      // Absent, deleted, in another company or outside this caller's RLS reach
      // all answer identically. Defence in depth: the route's own
      // `requireScopeTargetInTenant` probe has already refused every one of those
      // with ERR-IAM-001 before this point — see the file header.
      throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });
    }

    const resolved = await RESOLVERS[input.reportCode](db, {
      companyId: input.companyId,
      branchId: input.branchId,
      branchName: branch.name,
      from: input.from,
      toExclusive: input.to,
      timezoneName: branch.timezoneName,
      cursor: input.cursor,
      limit: input.limit,
    });

    return {
      reportCode: definition.code,
      titleKey: definition.titleKey,
      scope: definition.scope,
      period: { from: input.from, to: input.to, timezone: branch.timezoneName },
      generatedAt: new Date().toISOString(),
      freshness: 'live',
      columns: definition.columns.map((column) => ({
        key: column.key,
        kind: column.kind,
        drillThrough: column.drillThrough ?? null,
      })),
      countsByState: resolved.countsByState,
      rows: resolved.rows,
    };
  }
}

/**
 * The period, refused before anything is read.
 *
 * `from === to` is an EMPTY period rather than a single day, because `to` is
 * exclusive — a caller who means one day sends the next day as `to`. Refusing it
 * is the honest answer: a report that returned nothing for a period a caller
 * believed covered a day would be read as "no work orders", which is a wrong
 * answer rather than an empty one.
 */
function assertPeriod(from: string, to: string): void {
  const violations: Array<{ path: string; rule: string }> = [];
  if (!DAY.test(from)) violations.push({ path: 'query.from', rule: 'invalid_format' });
  if (!DAY.test(to)) violations.push({ path: 'query.to', rule: 'invalid_format' });
  if (violations.length === 0 && from >= to) {
    // Lexicographic comparison IS chronological for `YYYY-MM-DD`, which is the
    // property the format was designed for; no Date is constructed, so no
    // timezone is applied to a value that has none yet.
    violations.push({ path: 'query.to', rule: 'must_be_after_from' });
  }
  if (violations.length > 0) {
    throw new AppFailure('ERR-VAL-001', {
      message: 'The report period is not a valid half-open day range.',
      safeDetails: { violations },
    });
  }
}
