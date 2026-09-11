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
   * and recorded with it, not something this type can derive. The rule the
   * datasets below follow is that a COLUMN which publishes another module's
   * record names that module's read code: `technician_labor_time` publishes a
   * work-order reference, so it declares `wo.work_order.read` beside
   * `tech.technician.read` and a caller must hold both.
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

  /**
   * Recorded technician labour time in a period, in one branch (D-4, slice 2).
   *
   * ## The Owner's columns, in the Owner's order
   *
   * D-4 names them: "technician, branch, work-order reference, work-log date and
   * the recorded duration" (`docs/phase-1/phase-1-31/owner-decisions-2026-09-09.md`).
   * `source` is added beside them because `tech.labor_sessions.source` is a
   * CHECK-constrained three-term vocabulary — `manual`, `timer`, `correction` —
   * and a reader who cannot see that a row is a correction cannot tell an amended
   * figure from an original one. Nothing else was added.
   *
   * ## What "recorded duration" is, and what it is NOT
   *
   * D-4 is explicit: "Recorded duration is duration, and the definition says so:
   * it is not productivity and it is not a payroll figure." The column is the
   * elapsed time of closed sessions and nothing is derived from it.
   *
   * ## There is no status column, so there is no status bucket
   *
   * D-4 says cancelled and deleted logs are excluded. `tech.labor_sessions` has no
   * status column and no cancelled state at all: the soft delete and
   * `source = 'correction'` are its entire lifecycle
   * (`supabase/migrations/20260722099000_tech_labor_sessions.sql`). Showing an
   * empty "cancelled" bucket would read as a real zero, so the report shows no
   * such bucket and the seam record states the absence instead.
   *
   * ## TWO permission codes, one per record this report publishes
   *
   * `tech.technician.read` is the code `tech.labor-session-list` already declares
   * for the same rows — a session says who worked and for how long, which is
   * employee-derived data.
   *
   * `wo.work_order.read` is beside it because this report resolves each session's
   * job to its WORK ORDER and publishes that reference. Slice 2 shipped with the
   * technician code alone and recorded the disclosure openly: a caller holding
   * `rpt.report.read` and `tech.technician.read` and NOT `wo.work_order.read`
   * would learn the work-order ids and display numbers that carried labour in the
   * branch. That is the work-order module's record, read through a report, and a
   * report is not a way to be told something the record's own read operation
   * would refuse. So the list names both and the check is CONJUNCTIVE: the whole
   * report is refused to a caller who lacks either, which is the same fail-closed
   * shape the delivery readiness seam took when a read spanned two modules.
   *
   * This is not a broadening — no caller gains anything — and it is an
   * Engineering consequence of the columns rather than an Owner decision: D-4
   * names "work-order reference" as a column, and naming the column's own read
   * code is what publishing it honestly costs.
   */
  technician_labor_time: Object.freeze({
    code: 'technician_labor_time',
    titleKey: 'reports.technician_labor_time.title',
    scope: 'branch',
    requiredPermissions: Object.freeze(['tech.technician.read', 'wo.work_order.read']),
    parameterSchema: PERIOD_PARAMETERS,
    columns: Object.freeze([
      Object.freeze({
        key: 'technician',
        kind: 'reference',
        // The technician PROFILE id — the identifier `tech.technician-detail`
        // resolves. A template, not a URL: no client screen consumes it yet
        // (FE-012 is not started), and the client's route table is the client's.
        drillThrough: '/technicians/{id}',
      }),
      Object.freeze({ key: 'branch', kind: 'text' }),
      Object.freeze({ key: 'workOrder', kind: 'reference', drillThrough: '/work-orders/{id}' }),
      // The session's START instant, serialised UTC. The DAY it falls on depends
      // on the zone, which is why the envelope states the zone it resolved in.
      Object.freeze({ key: 'workLogDate', kind: 'date' }),
      // Whole seconds as an integer string, computed in SQL. Never a float and
      // never divided into hours here: a division is where a duration acquires
      // the rounding error that a sum then multiplies.
      Object.freeze({ key: 'duration', kind: 'duration' }),
      Object.freeze({ key: 'source', kind: 'text' }),
    ]),
  }),

  /**
   * Stock movements in a period, in one branch, totalled per item and unit
   * (D-4, D-5, D-17 — engine slice 3).
   *
   * ## The Owner's columns, in the Owner's order
   *
   * D-4 names them: "movement date, reference and type, the item, the warehouse
   * or location, and the quantity with its unit. Totals are separated by item and
   * by compatible unit, and the distinct meanings of a return and a transfer are
   * preserved rather than netted away"
   * (`docs/phase-1/phase-1-31/owner-decisions-2026-09-09.md` § 3). The
   * column list below is exactly that, split where the source splits: `reference`
   * and `movementType` are two columns because `inv.stock_movements` carries them
   * as two columns, and `direction` is published beside the type because the
   * table constrains the pair together (`ck_stock_movements_type_direction`) and a
   * reader who cannot see the direction cannot tell an adjustment up from an
   * adjustment down. Nothing else was added.
   *
   * ## There IS no transfer, and the report says so rather than showing an empty row
   *
   * D-4 asks that "the distinct meanings of a return and a transfer are preserved
   * rather than netted away". `inv.stock_movements.movement_type` is CHECK-constrained to
   * exactly five terms — `opening`, `issue`, `return`, `damage`, `adjustment`
   * (`supabase/migrations/20260723094000_inv_ledger.sql`) — and TRANSFER IS NOT
   * ONE OF THEM. The inventory module disclaims transfers by design: the
   * `transfer` movement kind and the `transit` location type were dropped in
   * Phase 1-10, so there is no primitive a transfer could be built on and a
   * two-movement "transfer" assembled here would mint a business fact the ledger
   * cannot express.
   *
   * So the report renders the five terms that exist and the seam record states the
   * absence of the sixth. What D-4's sentence still binds, and what this dataset
   * does implement, is that a RETURN is never netted against an ISSUE: the totals
   * are keyed by movement type and the `in` and `out` halves are separate
   * measures, never one signed sum. `signed_qty` exists on the table and is
   * deliberately not read.
   *
   * ## Why the quantity is a string and the unit is a column
   *
   * `quantity` is `numeric(12,3)` and travels as a decimal string end-to-end, the
   * convention the inventory repository already holds without exception
   * (`inventory-read-service.ts`), because IEEE-754 cannot represent the third
   * decimal place. `unit` is its own column because a quantity without its unit
   * is not a quantity — D-5 forbids a single quantity across unlike items, and the
   * group key carries the unit for the same reason.
   *
   * ## `item` is a reference WITHOUT a drill-through, and that is measured
   *
   * The cell carries the item id beside its SKU, so a client that can resolve an
   * item resolves it. No `drillThrough` template is published because THERE IS NO
   * PER-ITEM READ OPERATION to name: the register holds `inv.item-search`, a
   * list, and no `inv.item-read`. Slice 1 set the precedent that a `reference`
   * column may have no template — `customer` and `vehicle` both do — and inventing
   * a route for an operation that does not exist would publish a link that cannot
   * resolve. It is recorded as a named prerequisite instead.
   *
   * ## One permission code
   *
   * `inv.stock.read` is the code `inv.stock-movement-list` declares for the same
   * rows (`apps/api/src/app/api/v1/stock-movements/route.ts`). Every column this
   * report publishes is `inv` master data or the ledger itself, so unlike the
   * labour report there is no second module's record in the row and no second
   * code to name.
   */
  inventory_movements: Object.freeze({
    code: 'inventory_movements',
    titleKey: 'reports.inventory_movements.title',
    scope: 'branch',
    requiredPermissions: Object.freeze(['inv.stock.read']),
    parameterSchema: PERIOD_PARAMETERS,
    columns: Object.freeze([
      // The movement's own business instant, serialised UTC. The DAY it falls on
      // depends on the zone, which is why the envelope states the zone it
      // resolved in.
      Object.freeze({ key: 'occurredAt', kind: 'date' }),
      // The `reference_kind` / `reference_id` pair. `uq_stock_movements_source`
      // makes the pair single-use per direction, so the two together ARE the
      // document reference: the kind is the label and the id is the value.
      Object.freeze({ key: 'reference', kind: 'text' }),
      Object.freeze({ key: 'movementType', kind: 'text' }),
      Object.freeze({ key: 'direction', kind: 'text' }),
      // No `drillThrough` — see above; there is no per-item read operation.
      Object.freeze({ key: 'item', kind: 'reference' }),
      Object.freeze({ key: 'location', kind: 'text' }),
      // A decimal string in the unit the next column names. The `quantity` kind
      // is how a client knows it is neither a count nor an amount.
      Object.freeze({ key: 'quantity', kind: 'quantity' }),
      Object.freeze({ key: 'unit', kind: 'text' }),
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
