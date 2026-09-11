/**
 * The report dataset registry (P1-31 prerequisite P-11, engine slice 1 of 4).
 *
 * ## Why a CODE registry beside a configuration table
 *
 * `rpt.report_configurations` describes a report as tenant configuration — a
 * code, a name, a scope level, a per-report export permission and a versioned
 * `parameter_schema`. It contains **no binding from a report code to a data
 * source**, which is why P1-23 published `executable: false` as a literal and
 * refused to invent one (see `application/report-catalogue-service.ts`).
 *
 * The Owner requirement that unblocks this is explicit about the shape: a report
 * definition binds a `report_code` to a **code-registered dataset**
 * (`docs/product/owner-requirements-2026-09-06.md:196`, OWR-2026-09-06-A-12). So
 * the query, the columns and the permission a report needs are declared HERE, in
 * source, where they can be reviewed and gated — and a tenant row remains what it
 * always was: configuration ABOUT a report, never the thing that makes one exist.
 *
 * ## This file holds no I/O, deliberately
 *
 * It is the module's `domain` layer, and boundary rule `B5` forbids a domain file
 * from importing `@/server/db` — even as a type. The definitions below are
 * therefore pure metadata; the function that actually reads rows for a dataset
 * lives in `application/report-run-service.ts`, which is where I/O belongs. The
 * two are held together by the type system rather than by convention: the
 * resolver table there is a `Record<ReportDatasetCode, …>`, so a definition added
 * here without a resolver does not compile.
 *
 * ## The parameter schema is a contract, not a suggestion
 *
 * `from` and `to` are both REQUIRED calendar dates. An unbounded report over a
 * tenant-writable history is a response whose size the caller chooses, and a
 * default period would be an invented business rule — "the last thirty days" is a
 * decision nobody has taken.
 */

/**
 * How a client should render a column, and what the cell carries.
 *
 * The three kinds added for engine slice 2 name MEASURES, and naming them is the
 * point: a cell's `value` is a string whatever the kind, so without the kind a
 * client cannot tell `3600` seconds from `3600` of anything else and would have
 * to guess at a format.
 *
 *   * `duration` — an elapsed time in WHOLE SECONDS, as an integer string. Seconds
 *     rather than hours because hours would be a division, and a division is where
 *     a duration acquires a rounding error that then gets summed.
 *   * `quantity` — a decimal string in the column's own unit, carried unrounded.
 *   * `money` — an exact decimal string. Never a JSON number and never recomputed
 *     by a consumer; `pg` returns `numeric` as a string and it stays one, which is
 *     the rule `scripts/ci/check-exact-money.mjs` enforces inside the financial
 *     trees. No dataset registered today emits one — the kind exists so that the
 *     first one to do so cannot reach for `count` instead.
 */
export type ReportColumnKind =
  'text' | 'date' | 'count' | 'reference' | 'duration' | 'quantity' | 'money';

export interface ReportColumnDefinition {
  /** Stable key. Cells are emitted in column order and carry the same key. */
  readonly key: string;
  readonly kind: ReportColumnKind;
  /**
   * For a `reference` column, the client route template a cell's id drills
   * through to. Absent on every other kind, and `exactOptionalPropertyTypes`
   * makes that an absent KEY rather than a key holding undefined.
   */
  readonly drillThrough?: string;
}

/** One declared parameter of a dataset. Both of today's are required dates. */
export interface ReportParameterDefinition {
  readonly name: string;
  readonly kind: 'date';
  readonly required: boolean;
}

export interface ReportDatasetDefinition {
  readonly code: string;
  /**
   * The i18n key a client renders as the report's title.
   *
   * A KEY rather than a label, because a platform baseline has no operator who
   * could have written one and the platform must not ship an English string as
   * though it were a tenant's own name for the report.
   */
  readonly titleKey: string;
  /**
   * Always `branch` for the datasets registered today, and that is an
   * authorization fact rather than a preference. `authorization.ts:63`
   * (`requiresScopedEvaluation`) evaluates a TENANT-scoped operation
   * scope-blind, so a run operation that did not declare a branch scope and
   * require a company/branch pair would let a caller holding the dataset's read
   * code in one branch report on another.
   */
  readonly scope: 'branch';
  /**
   * The read codes the UNDERLYING data requires, ALL of them, checked in the run
   * service at the operation's branch scope.
   *
   * Not a second declaration of the operation's own permission: the operation
   * declares `rpt.report.read` (the right to run reports at all) and these are
   * the rights to see the rows the dataset returns. A single operation cannot
   * declare a per-report code, so the second check is performed in the service
   * and answers the uniform `ERR-IAM-001`.
   *
   * ## A LIST, and conjunctive, from slice 2 onward
   *
   * Slice 1 carried one code because one dataset needed one. The list is evaluated
   * as ALL of them, never "any of": the service refuses the WHOLE report on the
   * first code the caller lacks, rather than returning a report with the columns
   * that caller could not see blanked out — a blanked column inside a total is a
   * total that silently under-reports, which is worse than a refusal.
   *
   * What a dataset PUTS in this list is a disclosure decision taken per dataset
   * and recorded on the entry itself, not something this type can derive: a
   * dataset publishing a reference into another module's rows is stating what a
   * holder of the codes below is thereby told.
   */
  readonly requiredPermissions: readonly string[];
  readonly parameterSchema: readonly ReportParameterDefinition[];
  readonly columns: readonly ReportColumnDefinition[];
}

/** `from` and `to` — the closed-open calendar period every dataset accepts. */
const PERIOD_PARAMETERS: readonly ReportParameterDefinition[] = Object.freeze([
  Object.freeze({ name: 'from', kind: 'date', required: true }),
  Object.freeze({ name: 'to', kind: 'date', required: true }),
]);

/**
 * Every dataset the engine can run, by code.
 *
 * A frozen object rather than an array so `keyof typeof` is the code union: an
 * unregistered code is a compile error at every call site, and the run service's
 * resolver table is total by construction.
 */
export const REPORT_DATASETS = Object.freeze({
  /**
   * Work orders opened in a period, in one branch, with the count of every state.
   *
   * The columns answer a service manager's question — which cars are in the shop,
   * whose they are, and where each one has got to — so the reference column
   * carries the work-order id beside its display number and a client can open the
   * order the row is about rather than search for it.
   *
   * `branch` is emitted as a NAME as well as an id because the run resolves the
   * branch anyway: the period bounds are bucketed in the branch's own timezone,
   * so `org.branches` is read on every run and the name costs nothing extra.
   */
  work_orders_by_status: Object.freeze({
    code: 'work_orders_by_status',
    titleKey: 'reports.work_orders_by_status.title',
    scope: 'branch',
    requiredPermissions: Object.freeze(['wo.work_order.read']),
    parameterSchema: PERIOD_PARAMETERS,
    columns: Object.freeze([
      Object.freeze({
        key: 'workOrder',
        kind: 'reference',
        // The id travels in the cell; this is the template a client fills.
        drillThrough: '/work-orders/{id}',
      }),
      Object.freeze({ key: 'branch', kind: 'text' }),
      Object.freeze({ key: 'customer', kind: 'reference' }),
      Object.freeze({ key: 'vehicle', kind: 'reference' }),
      Object.freeze({ key: 'openedAt', kind: 'date' }),
      Object.freeze({ key: 'state', kind: 'text' }),
    ]),
  }),
} as const satisfies Record<string, ReportDatasetDefinition>);

/** The registered codes, as a union. An unknown code cannot be written. */
export type ReportDatasetCode = keyof typeof REPORT_DATASETS;

/** The registered codes, in declaration order. Bounded by the source tree. */
export const REPORT_DATASET_CODES: readonly ReportDatasetCode[] = Object.freeze(
  Object.keys(REPORT_DATASETS) as ReportDatasetCode[]
);

/**
 * Whether a caller-supplied string names a registered dataset.
 *
 * A type guard rather than a boolean so the caller narrows: everything after this
 * test indexes `REPORT_DATASETS` without a lookup that can return undefined.
 */
export function isReportDatasetCode(code: string): code is ReportDatasetCode {
  return Object.prototype.hasOwnProperty.call(REPORT_DATASETS, code);
}

/** The definition for a registered code. Widened to the interface on purpose. */
export function reportDataset(code: ReportDatasetCode): ReportDatasetDefinition {
  return REPORT_DATASETS[code];
}
