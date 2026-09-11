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
 * 2. THIS service then evaluates EVERY code in the dataset's own
 *    `requiredPermissions` — `wo.work_order.read` for `work_orders_by_status`,
 *    `tech.technician.read` AND `wo.work_order.read` for
 *    `technician_labor_time` — against the same
 *    company and branch, through `callerHoldsPermission`, which asks the same
 *    deployed `iam.has_permission_in_scope` every other check asks. A caller who
 *    may run reports but may not read the underlying rows is refused, and the
 *    refusal is of the WHOLE report rather than of some of its columns.
 * 3. An explicit tenant configuration must be published with a live published
 *    version. Its scope ceiling and understood filter allowlist are enforced
 *    before branch resolution or dataset reads. Unknown restrictions fail
 *    closed. Only absence of configuration enables baseline fallback.
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
 * The half-open semantics and the branch zone were APPROVED by the Owner on
 * 2026-09-10 (decision D-17). What remains a recommendation pending Owner
 * approval is the SOURCE COLUMN: that the selected branch's zone be read from
 * `org.branches.timezone_name` rather than `org.tenants.default_timezone`. Both
 * columns exist and both are foreign keys into `shared.timezones`. Reversing the
 * choice is ONE lookup — `iamOrganizationContext().branches.findBranch` below —
 * which is why every dataset takes the resolved zone as an argument and no
 * dataset reads a timezone for itself. It is written down in
 * `docs/phase-1/phase-1-31/report-engine-seam.md`.
 *
 * The predicate that applies the period is `halfOpenLocalDayRange`
 * (`server/db/period.ts`), written once and composed by every dataset, because
 * D-17 requires the conversion to be CONSISTENT and two repositories writing the
 * comparison from memory is how two reports over one period stop adding up.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermission } from '@/server/auth/authorization';
import type { DbHandle } from '@/server/db/transaction';
import type { Page } from '@/server/db/pagination';
import { iamOrganizationContext } from '@/modules/iam';
import { inventoryModule } from '@/modules/inventory';
import { technicianModule } from '@/modules/technician';
import { workOrderModule } from '@/modules/work-order';
import type { ReportCatalogueRepository } from '../data/report-catalogue-repository';
import { assertReportConfiguration } from './report-configuration-policy';
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

/**
 * One GROUP and its measures, computed over the WHOLE scoped selection.
 *
 * This is the generalisation slice 1 named as a prerequisite: `countsByState` put
 * one dataset's grouping on the shared envelope, and the other three baseline
 * reports group by something else. Three fields, and each is a decision:
 *
 *   * `key` — the grouping columns and their values, BY NAME, so a client reading
 *     `{ state: 'open' }` or `{ technician: '<uuid>' }` does not have to know
 *     which dataset it asked for to know what it is looking at. A value may be
 *     null: "no party was named" is a group, and collapsing it into a bucket
 *     called "other" would hide it.
 *   * `label` — what a human reads, or null when the source has nothing to show
 *     or this caller may not be told. Never the key stringified: a label the API
 *     invented is a label that will disagree with the one the detail screen shows.
 *   * `measures` — measure name to value, and every value is a STRING. A count, a
 *     duration in seconds, a quantity and an amount are all exact integers or
 *     exact decimals, and JSON numbers are the one representation that cannot
 *     carry all four without losing something. The column whose `kind` matches
 *     the measure says how to render it.
 *
 * Computed over the SELECTION and never over the page — the P1-28 round-two rule.
 */
export interface ReportGroupView {
  readonly key: Readonly<Record<string, string | null>>;
  readonly label: string | null;
  readonly measures: Readonly<Record<string, string>>;
}

/**
 * The filter context the rows were produced under, echoed back.
 *
 * D-17 requires that the timezone and the filter context be displayed and
 * preserved wherever a result is shown, printed or recorded, so that a number can
 * never be read without the period that produced it. The period already travelled;
 * the scope did not, and a printed page showing a total with no branch on it is
 * exactly the artefact that decision forbids.
 */
export interface ReportFilterContextView {
  readonly companyId: string;
  readonly branchId: string;
}

/** The branch the report was run for, named as well as identified. */
export interface ReportBranchView {
  readonly id: string;
  readonly name: string;
}

/**
 * A resolved period, as a dataset read receives it.
 *
 * `toExclusive` rather than `to`, because the name is the contract: a reader who
 * sees `to` assumes the last day reported, and that assumption is the off-by-one
 * the half-open period exists to prevent. Published from this module's index so a
 * port on another module can accept exactly this shape instead of restating it.
 */
export interface ReportPeriodInput {
  /** First day included, `YYYY-MM-DD`. */
  readonly from: string;
  /** First day EXCLUDED — the day after the last one reported, `YYYY-MM-DD`. */
  readonly toExclusive: string;
  /** The IANA zone the two days are resolved in: the branch's own. */
  readonly timezoneName: string;
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
 * Slice 1 put `countsByState` on this envelope and recorded the limitation
 * openly: the one dataset registered then grouped by work-order state, so the
 * shared result type named that grouping, and the seam record listed
 * generalising it as a named prerequisite for the next slice. This is that
 * slice, and `groups` is the generalisation.
 */
export interface ReportRunView {
  readonly reportCode: string;
  /** The i18n key for the report's title. See `ReportDatasetDefinition`. */
  readonly titleKey: string;
  readonly scope: 'branch';
  readonly period: ReportPeriodView;
  /** The company and branch the rows were selected under (D-17). */
  readonly filters: ReportFilterContextView;
  /** The reported branch, named. The run resolves it anyway, for the timezone. */
  readonly branch: ReportBranchView;
  /** When the rows were read. */
  readonly generatedAt: string;
  /**
   * `live` — the rows are read from the operational tables inside the request's
   * own transaction. There is no snapshot, no cache and no materialised view
   * behind this, and a client must not present the answer as one.
   */
  readonly freshness: 'live';
  readonly columns: readonly ReportColumnView[];
  /** Every group of the WHOLE selection, with its measures. Dataset-shaped. */
  readonly groups: readonly ReportGroupView[];
  /**
   * @deprecated Superseded by `groups`. Read `groups` instead.
   *
   * Kept, and kept CORRECT, for `work_orders_by_status` only — it is DERIVED from
   * that dataset's groups rather than computed a second time, so the two cannot
   * disagree. It is empty for every other dataset, which is the honest answer: a
   * technician's recorded hours have no work-order state, and filling this field
   * with something would be inventing a grouping the report does not have.
   *
   * It survives this slice rather than being removed in it because removing a
   * published field and adding its replacement in one change gives a consumer no
   * window in which both exist. Its removal is a named prerequisite of the slice
   * that retires it.
   */
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
interface ResolverInput extends ReportPeriodInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * What a resolver returns. The envelope around it is assembled below.
 *
 * TWO fields and no dataset-specific third: a resolver produces the groups of the
 * whole selection and one page of rows, and every other field on the envelope is
 * the engine's, computed identically for every dataset. That is what stops the
 * next slice from adding a fourth field named after its own grouping — the defect
 * `countsByState` is.
 */
interface ResolverResult {
  readonly groups: readonly ReportGroupView[];
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
    // One group per state, in the port's own order. The count is a string here
    // like every other measure — `countsByState` is derived back from it below,
    // so the two cannot disagree about a single state.
    groups: summary.counts.map((entry) => ({
      key: { state: entry.stateCode },
      label: entry.stateName,
      measures: { count: String(entry.count) },
    })),
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
 * `technician_labor_time` — engine slice 2 (D-4, D-17).
 *
 * ## Two ports, because two modules own the tables
 *
 * `tech.labor_sessions` is the technician module's and `wo.jobs` is the work-order
 * module's, so the rows come from `technicianModule().reportPort` and the
 * work-order each session belongs to comes from `workOrderModule().reportPort`.
 * Neither query is written here. That is not ceremony: `tech.labor_sessions`
 * carries `job_id` and no work-order column, so the only alternative was a join
 * across a private schema, which ADR-001 rule 3 forbids and the boundary checker
 * refuses.
 *
 * ## The second call is over the PAGE, deliberately
 *
 * The work-order references are resolved for the ids on the page and for nothing
 * else, in ONE batched statement. The TOTALS do not need them — the report groups
 * by technician, not by work order — so resolving them for the whole selection
 * would read rows nobody displays.
 *
 * ## A missing reference renders as absent, never as a guess
 *
 * `workOrder` may be null when a session's job is outside the reported branch,
 * which is a state the scoped resolution produces rather than an error. The cell
 * carries null on both halves; nothing substitutes the job id for the work order
 * id, because a client drilling through would then open the wrong record.
 *
 * ## Nothing is recomputed
 *
 * The duration arrives as an integer string computed in SQL, and it is placed in
 * the cell unchanged. No subtraction, no division into hours, no `Number`: a
 * duration that is divided once is a duration that carries a rounding error into
 * every total built on it, and D-4 says this figure is a duration and not a
 * derived measure of anything.
 */
const runTechnicianLaborTime: ReportResolver = async (db, input) => {
  const report = await technicianModule().reportPort.laborTotals(
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
  const references = await workOrderModule().reportPort.workOrdersForJobs(
    db,
    report.sessions.items.map((session) => session.jobId),
    { companyId: input.companyId, branchId: input.branchId }
  );
  const byJob = new Map(references.map((entry) => [entry.jobId, entry]));

  return {
    groups: report.totals.map((total) => ({
      key: { technician: total.technicianProfileId },
      label: total.technicianName,
      measures: { durationSeconds: total.durationSeconds },
    })),
    rows: {
      ...report.sessions,
      items: report.sessions.items.map((session) => {
        const workOrder = byJob.get(session.jobId);
        return {
          cells: [
            // Null label when this caller may not be told who the technician is.
            // The profile id travels either way, so the row is never anonymous to
            // a caller who can already resolve it elsewhere.
            cell('technician', session.technicianName, session.technicianProfileId),
            cell('branch', input.branchName, input.branchId),
            cell('workOrder', workOrder?.label ?? null, workOrder?.workOrderId ?? null),
            // The session's START instant, serialised UTC like every other
            // published timestamp. Which DAY it falls on depends on the zone,
            // which is why the envelope states the zone it resolved in.
            cell('workLogDate', null, session.startedAt),
            // Whole seconds. The column's `kind` is `duration`, which is how a
            // client knows this string is not a count.
            cell('duration', null, session.durationSeconds),
            // The raw three-term vocabulary. No label, because the catalogue has
            // none to give and an English word invented here would ship as though
            // it were one.
            cell('source', null, session.source),
          ],
        };
      }),
    },
  };
};

/**
 * `inventory_movements` — engine slice 3 (D-4, D-5, D-17).
 *
 * ## One port, because one module owns every table in the row
 *
 * The ledger, the item, its unit and the location are all `inv.*`, which is the
 * inventory module's private schema (ADR-001 rule 3). So one call to
 * `inventoryModule().reportPort` produces the whole row and the whole total, and
 * nothing is joined or resolved here.
 *
 * ## The groups are keyed on THREE things, and that is the Owner's rule
 *
 * `(itemId, uomCode, movementType)`. D-5 forbids a single quantity across unlike
 * items and D-4 requires totals "separated by item and by compatible unit", so
 * the item and the unit are both in the key: two units of one item can never
 * merge into one number, because they are two groups.
 *
 * The movement type is in the key because D-4 requires the distinct meanings of
 * the movement kinds to be preserved. Within a type the `in` and `out` halves are
 * TWO MEASURES rather than one signed sum, so a return is never netted against an
 * issue. Nothing on this envelope is a grand total.
 *
 * ## Nothing is recomputed
 *
 * Every quantity arrives as a decimal string from `numeric(12,3)` and is placed
 * in the cell unchanged — no `Number`, no `toFixed`, no addition here. The sums
 * are computed in SQL over the same expression the rows carry, so adding a page
 * by hand can never disagree with the group.
 */
const runInventoryMovements: ReportResolver = async (db, input) => {
  const report = await inventoryModule().reportPort.movementSummary(
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

  return {
    groups: report.totals.map((total) => ({
      key: {
        item: total.itemId,
        unit: total.uomCode,
        movementType: total.movementType,
      },
      // The SKU is what a human reads; the unit and the type are already legible
      // in the key, and repeating them in the label would be this module
      // inventing a format for a string a client renders.
      label: total.sku,
      measures: { quantityIn: total.quantityIn, quantityOut: total.quantityOut },
    })),
    rows: {
      ...report.movements,
      items: report.movements.items.map((movement) => ({
        cells: [
          // The movement's own business instant, serialised UTC. Which DAY it
          // falls on depends on the zone, which is why the envelope states the
          // zone it resolved in.
          cell('occurredAt', null, movement.occurredAt),
          // The kind labels the reference and the id identifies it. The two are
          // not concatenated: joining them would make this module the authority
          // on how a reference is spelled, which belongs to whoever renders it.
          cell('reference', movement.referenceKind, movement.referenceId),
          // The raw five-term vocabulary and the two-term direction. No labels,
          // because no catalogue carries a name for either and an English word
          // invented here would ship as though it were one.
          cell('movementType', null, movement.movementType),
          cell('direction', null, movement.direction),
          cell('item', movement.sku, movement.itemId),
          // The location's NAME is what a human reads and its CODE is the
          // machine-readable half — the `state` column's treatment in slice 1,
          // for the same reason: `uq_stock_locations_code` makes the code unique
          // within a branch, so it identifies the location as well as an id
          // would, and it is the string a store actually uses. Both columns are
          // NOT NULL, so neither half is ever absent.
          cell('location', movement.locationName, movement.locationCode),
          // A decimal string, unrounded, in the unit the next cell names.
          cell('quantity', null, movement.quantity),
          cell('unit', movement.uomName, movement.uomCode),
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
  technician_labor_time: runTechnicianLaborTime,
  inventory_movements: runInventoryMovements,
});

/**
 * `countsByState`, DERIVED from `work_orders_by_status`'s own groups.
 *
 * The deprecated field is filled from the replacement rather than computed a
 * second time, so the two can never report different numbers for one state — two
 * computations of one answer being the way a deprecated field quietly becomes
 * wrong while nothing fails.
 *
 * `Number.parseInt` is the only place this module turns a measure back into a
 * number, and it is safe HERE for a reason that does not generalise: the measure
 * is a `count(*)::int` from PostgreSQL, so it is a small integer with no fraction
 * and no precision to lose. A duration or an amount must never make this trip,
 * which is why every other measure stays a string all the way to the wire.
 *
 * Any dataset that is not `work_orders_by_status` gets an empty list.
 */
function countsByStateFrom(
  code: ReportDatasetCode,
  groups: readonly ReportGroupView[]
): readonly ReportStateCountView[] {
  if (code !== 'work_orders_by_status') return [];
  return groups.flatMap((group) => {
    const stateCode = group.key.state;
    if (stateCode === undefined || stateCode === null) return [];
    return [
      {
        stateCode,
        stateName: group.label ?? stateCode,
        count: Number.parseInt(group.measures.count ?? '0', 10),
      },
    ];
  });
}

/** `YYYY-MM-DD`, validated again here because this service is callable directly. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ReportRunService extends ApplicationService {
  protected readonly module = 'reporting';

  constructor(private readonly repository: ReportCatalogueRepository) {
    super();
  }

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
    //
    // EVERY declared code, and the WHOLE report is refused on the first one the
    // caller lacks. Not a partial report with the unreadable columns blanked: a
    // blanked column inside a total is a total that silently under-reports, and a
    // reader cannot tell it from a real one.
    for (const required of definition.requiredPermissions) {
      const permitted = await callerHoldsPermission(db, required, {
        companyId: input.companyId,
        branchId: input.branchId,
      });
      if (permitted) continue;
      throw new AppFailure('ERR-IAM-001', {
        message: `Denied ${definition.code}: missing ${required}`,
        // The same disclosure `requirePermissions` makes, for the same reason:
        // the required code is documented API metadata, and the RESOURCE is
        // never named. The code NAMED is the first one missing rather than the
        // whole declared list, so a caller learns what to ask for without being
        // told which of the others they already hold.
        safeDetails: { requiredPermissions: [required] },
      });
    }

    assertReportConfiguration(await this.repository.findByCode(db, definition.code), definition, {
      companyId: input.companyId,
      branchId: input.branchId,
      from: input.from,
      to: input.to,
    });

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
      // D-17: the filter context travels with the numbers, so a printed or
      // recorded result can never be read without the selection that produced it.
      filters: { companyId: input.companyId, branchId: input.branchId },
      branch: { id: input.branchId, name: branch.name },
      generatedAt: new Date().toISOString(),
      freshness: 'live',
      columns: definition.columns.map((column) => ({
        key: column.key,
        kind: column.kind,
        drillThrough: column.drillThrough ?? null,
      })),
      groups: resolved.groups,
      countsByState: countsByStateFrom(input.reportCode, resolved.groups),
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
