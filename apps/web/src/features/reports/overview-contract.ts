/**
 * What the operational overview shows, and in what order (P1-31, FE-010 and
 * FE-016; Owner decision **D-19** of 2026-09-12).
 *
 * D-19 defines FE-010 as an operational overview of the FOUR approved report
 * domains, with useful summaries from their authoritative server results, branch
 * and period filters, visible freshness and timezone, and drill-through. This
 * module is the list of those four domains and of the summary each one publishes.
 * It holds no measurement, no calculation and no threshold — every figure on the
 * screen is a string the server sent.
 *
 * ## Why a declared list rather than "render whatever arrives"
 *
 * The report screen renders whatever the envelope carries, and that is right for
 * a screen whose subject is one report. An overview is a different claim: it says
 * "this is the operational picture of the four approved domains". A section that
 * silently disappeared because a measure was renamed would quietly narrow that
 * claim, and an overview that grew a fifth section because the engine registered
 * something new would make a claim the Owner did not approve. So the four codes
 * and the measures each section shows are written down here, in the Owner's own
 * order, and the screen renders exactly them.
 *
 * A measure the server sends that is NOT declared here is still shown — after the
 * declared ones, named as what it is. Dropping it would be this side deciding an
 * operator may not see something the engine published.
 *
 * ## The measures are the engine's own group measures
 *
 * Each name below is a key of `ReportGroup.measures` as the run service publishes
 * it, and each is displayed through `reports.field.<name>` in the message
 * catalogue — the same namespace the report screen names columns and group keys
 * by, so one word cannot have two translations. `overviewFieldKey` is that rule
 * in one place.
 *
 * Nothing here is a total of a total: the engine computes every group over the
 * WHOLE selection, and the overview asks for one row of rows because it needs
 * none of them. Quantities are not added across items or units, amounts are not
 * added across currencies or document kinds, and seconds are never turned into
 * hours.
 */

/** One section of the overview: one approved report, and the summary it publishes. */
export interface OverviewSection {
  /** The report code the section runs. */
  readonly reportCode: string;
  /** The report's own title key, as the engine and the catalogue publish it. */
  readonly titleKey: string;
  /** What the section shows, in the operator's words. */
  readonly captionKey: string;
  /** The group key fields this section expects, in display order. */
  readonly keyNames: readonly string[];
  /** The measures this section shows, in display order. */
  readonly measureNames: readonly string[];
}

/**
 * The four approved domains, in the order **D-19** names them.
 *
 * Work orders by status; recorded technician labour duration; inventory movement
 * summaries separated by item and compatible unit; and invoice, credit-note,
 * receipt, unallocated and outstanding values kept semantically distinct and
 * grouped by currency.
 *
 * The group keys and measure names are the engine's, read from the run service's
 * own dataset definitions. `inventory_movements` keys on the item, the unit AND
 * the movement kind, which is what "separated by item and compatible unit" is
 * answered by: there is no row on this screen that spans two items or two units,
 * because there is no such group. `invoice_payment_summary` keys on the currency
 * and the document kind, and its six measures are six columns — an invoiced
 * amount, what is still owed, credit notes, receipts, what has been applied and
 * what has not. None of them is added to another, in any direction.
 */
export const OVERVIEW_SECTIONS: readonly OverviewSection[] = Object.freeze([
  Object.freeze({
    reportCode: 'work_orders_by_status',
    titleKey: 'reports.work_orders_by_status.title',
    captionKey: 'reports.overview.caption.workOrders',
    keyNames: Object.freeze(['state']),
    measureNames: Object.freeze(['count']),
  }),
  Object.freeze({
    reportCode: 'technician_labor_time',
    titleKey: 'reports.technician_labor_time.title',
    captionKey: 'reports.overview.caption.labour',
    keyNames: Object.freeze(['technician']),
    measureNames: Object.freeze(['durationSeconds']),
  }),
  Object.freeze({
    reportCode: 'inventory_movements',
    titleKey: 'reports.inventory_movements.title',
    captionKey: 'reports.overview.caption.inventory',
    keyNames: Object.freeze(['item', 'unit', 'movementType']),
    measureNames: Object.freeze(['quantityIn', 'quantityOut']),
  }),
  Object.freeze({
    reportCode: 'invoice_payment_summary',
    titleKey: 'reports.invoice_payment_summary.title',
    captionKey: 'reports.overview.caption.invoices',
    keyNames: Object.freeze(['currency', 'documentType']),
    measureNames: Object.freeze([
      'invoiced',
      'outstanding',
      'creditNotes',
      'receipts',
      'allocated',
      'unallocated',
    ]),
  }),
]);

/** The report codes the overview runs, in the order it shows them. */
export const OVERVIEW_REPORT_CODES: readonly string[] = Object.freeze(
  OVERVIEW_SECTIONS.map((section) => section.reportCode)
);

/**
 * The page size every overview read asks for: ONE row.
 *
 * The overview shows summaries and no rows at all. The groups it renders are
 * computed by the engine over the whole selection and are not a summary of the
 * page, so a page of fifty rows would be fifty rows fetched, serialised and
 * discarded on every read — four times over. One is the smallest the route
 * accepts (`limit` is 1 … 100), and it is asked for explicitly rather than left to
 * the platform's default of fifty.
 *
 * It is deliberately not ZERO and there is deliberately no flag that suppresses
 * the rows: a `summaryOnly` parameter on the operation was considered and
 * rejected, because it would be a new backend contract for a saving the existing
 * one already allows. That is recorded in
 * `docs/phase-1/phase-1-31/operational-overview.md`.
 */
export const OVERVIEW_ROW_LIMIT = 1;

/** The message key a measure, a group key or a column is named by. */
export function overviewFieldKey(name: string): string {
  return `reports.field.${name}`;
}

/**
 * The words the recorded-labour section may never contain.
 *
 * **D-19** approves "recorded technician labor duration, **without calling it
 * productivity**" and forbids inventing performance scores. Recorded seconds are
 * a measurement of time that was logged; productivity, utilisation, efficiency
 * and a performance score are judgements about a person, and none of them is
 * published by anything, approved by anyone or computable from a duration alone.
 *
 * The list exists so the prohibition is TESTABLE rather than remembered: the
 * rendered section is scanned for every word below, in both languages, because a
 * heading somebody adds later in Arabic would otherwise escape an English-only
 * check.
 */
export const LABOUR_FORBIDDEN_WORDS: readonly string[] = Object.freeze([
  'productivity',
  'utilisation',
  'utilization',
  'efficiency',
  'performance',
  'إنتاجية',
  'كفاءة',
  'أداء',
]);

/**
 * The link from a section to the report itself, carrying the whole selection.
 *
 * The four filters travel in the address so the report opens over the SAME branch
 * and the SAME period the summary was read over. A drill-through that landed on an
 * empty form would make an operator retype the selection and invite them to type a
 * different one, and the number they clicked would then be beside rows from
 * somewhere else.
 *
 * Nothing is defaulted here and no value is invented: the four are the selection
 * the operator submitted. The report screen re-resolves them against the caller's
 * own directory and drops anything it does not hold.
 */
export function overviewReportHref(
  locale: string,
  reportCode: string,
  selection: {
    readonly companyId: string;
    readonly branchId: string;
    readonly from: string;
    readonly to: string;
  }
): string {
  const params = new URLSearchParams({
    companyId: selection.companyId,
    branchId: selection.branchId,
    from: selection.from,
    to: selection.to,
  });
  return `/${locale}/reports/${encodeURIComponent(reportCode)}?${params.toString()}`;
}
