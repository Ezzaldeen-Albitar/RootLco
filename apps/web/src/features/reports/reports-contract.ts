/**
 * The report contract (P1-31, FE-011 … FE-014; Owner decisions **D-4** of
 * 2026-09-09, **D-17** of 2026-09-10 and **D-20** of 2026-09-12).
 *
 * | operation             | method | path                            | permissions            |
 * | --------------------- | ------ | ------------------------------- | ---------------------- |
 * | `rpt.report-catalogue` | GET   | `/reports`                      | `rpt.report.read`      |
 * | `rpt.report-read`      | GET   | `/reports/{reportCode}`         | `rpt.report.read`      |
 * | `rpt.report-run`       | GET   | `/reports/{reportCode}/rows`    | `rpt.report.read` plus the dataset's own codes, evaluated server-side |
 *
 * Typed from the three routes that own the shapes —
 * `apps/api/src/app/api/v1/reports/route.ts`,
 * `reports/[reportCode]/route.ts` and `reports/[reportCode]/rows/route.ts` —
 * and from `ReportDefinitionView` in
 * `apps/api/src/modules/reporting/application/report-catalogue-service.ts` and
 * `ReportRunView` in `.../report-run-service.ts`.
 *
 * ## One screen for every report code, because the catalogue decides the set
 *
 * There are four approved report definitions (**D-4**) and the engine registers
 * them one slice at a time. A screen per code would mean four screens whose only
 * difference is a string, and three of them would have to be written against a
 * registry entry that does not exist yet — which is guessing at a contract. So
 * the catalogue is the authority for WHICH reports exist and the run envelope is
 * the authority for WHAT each one renders: the columns, their kinds, the
 * grouping and the drill-through all arrive in the response. Nothing in this
 * feature branches on a report code.
 *
 * ## Two envelope shapes, and both must be tolerated
 *
 * `develop` publishes `countsByState` and no `groups`. The dataset slice that
 * adds the other three reports publishes `groups`, `filters` and `branch` as
 * well, and deprecates `countsByState`. A client that required either shape
 * would break against the other, so `groups`, `filters` and `branch` are
 * OPTIONAL here and the screen reads whichever it was given. `countsByState` is
 * read only when `groups` is absent, which is the direction the deprecation
 * points.
 *
 * ## Every value is the server's string
 *
 * A duration is whole seconds, a quantity is a decimal in the column's own unit
 * and an amount is an exact decimal — all of them strings, because `pg` returns
 * `numeric` as a string and a JSON number cannot carry all three without losing
 * something. Nothing in this feature adds, divides, rounds, re-scales or
 * reformats one. `apps/web/src/lib/money.ts` is the only sanctioned money
 * helper in this application and it is deliberately NOT used: `formatMoney`
 * requires a currency alongside the amount and a canonical four-place scale,
 * and a report cell carries neither — the currency is a separate column on the
 * one dataset that has it. So a measure is rendered as the characters the server
 * sent. That is recorded in `docs/phase-1/phase-1-31/report-screens.md`.
 */
import type { CursorPage } from '@/lib/api/read-operation';

/**
 * The one code every report operation declares.
 *
 * The rows a given report returns need the DATASET's own codes as well, and
 * those are evaluated in the run service at the operation's branch scope and
 * answer the same uniform refusal the route's own check does. They are not
 * declared here because they are per-report and this side cannot know them: a
 * client that listed them would be maintaining a second copy of a registry it
 * cannot see.
 */
export const REPORT_PERMISSIONS = {
  read: 'rpt.report.read',
} as const;

/**
 * The refusals a report read can answer, mirrored so each is rendered as itself.
 *
 * `ERR-IAM-001` is the uniform denial — the caller may not run reports at all,
 * or may not read the rows this dataset returns, or named a company/branch pair
 * outside their tenant; the three are deliberately indistinguishable, and this
 * side must not invent a distinction. `ERR-RES-001` is an unknown report code, a
 * draft, an archived configuration, or a published configuration with no live
 * version. `ERR-VAL-001` is a malformed request, which for this screen means the
 * period: a `to` that is not after `from`.
 */
export const REPORT_REFUSALS = {
  notPermitted: 'ERR-IAM-001',
  notFound: 'ERR-RES-001',
  invalidRequest: 'ERR-VAL-001',
} as const;

/**
 * How a column's cells are rendered, mirrored from `ReportColumnKind`.
 *
 * Four kinds exist on `develop` and three more arrive with the dataset slice.
 * All seven are listed because a screen that met an unlisted kind would have to
 * guess at a format, and the point of the field is that it never has to.
 */
export const REPORT_COLUMN_KINDS = [
  'text',
  'date',
  'count',
  'reference',
  'duration',
  'quantity',
  'money',
] as const;
export type ReportColumnKind = (typeof REPORT_COLUMN_KINDS)[number];

/** Whether a kind the server sent is one this build knows how to render. */
export function isReportColumnKind(kind: string): kind is ReportColumnKind {
  return (REPORT_COLUMN_KINDS as readonly string[]).includes(kind);
}

/**
 * A drill-through that depends on what the ROW is (**D-20**).
 *
 * One column may carry more than one kind of record — the invoice and payment
 * report has a single document column holding invoices, receipts and credit
 * notes — so it publishes a template per kind instead of one template.
 * `discriminator` names the column whose cell value selects the template, and a
 * kind with no target route is published carrying an explicit absence rather
 * than omitted, because "there is no screen for this" and "this kind is unknown"
 * are different answers.
 */
export interface ReportDrillThroughByKind {
  readonly discriminator: string;
  readonly templates: Readonly<Record<string, string | null>>;
}

/**
 * One column as published.
 *
 * `kind` is typed as `string` rather than as the union above, for the reason
 * `readiness-contract.ts` gives about work-order states: a value the backend
 * adds must arrive as itself and be visible, not be dropped by a type written
 * on this side first. `isReportColumnKind` is what narrows it at the point of
 * rendering.
 */
export interface ReportColumn {
  readonly key: string;
  readonly kind: string;
  readonly drillThrough: string | null;
  /** Absent on the `develop` envelope; present once the dataset slice lands. */
  readonly drillThroughByKind?: ReportDrillThroughByKind | null;
}

/**
 * One cell: what a human reads, and the machine-readable half.
 *
 * Either may be absent, and an absence is a real answer rather than a fault — a
 * work order has no display number until one is issued, and a visit may name no
 * service requester.
 */
export interface ReportCell {
  readonly key: string;
  readonly label: string | null;
  readonly value: string | null;
}

export interface ReportRow {
  readonly cells: readonly ReportCell[];
}

/**
 * One group and its measures, computed over the WHOLE selection.
 *
 * Every measure value is a string — a count, a duration in seconds, a quantity
 * and an amount are all exact, and the column whose key matches the measure name
 * says how to render it. A group key value may be absent: "no party was named"
 * is a group, and folding it into one called "other" would hide it.
 */
export interface ReportGroup {
  readonly key: Readonly<Record<string, string | null>>;
  readonly label: string | null;
  readonly measures: Readonly<Record<string, string>>;
}

/** The half-open period the rows were selected over, and the zone it was resolved in. */
export interface ReportPeriod {
  /** First day included. */
  readonly from: string;
  /** First day EXCLUDED — the day after the last one reported. */
  readonly to: string;
  /** The zone the two days were resolved in: the reported branch's own. */
  readonly timezone: string;
}

/** The company and branch the rows were selected under — **D-17**'s filter context. */
export interface ReportFilterContext {
  readonly companyId: string;
  readonly branchId: string;
}

/** The reported branch, named as well as identified. */
export interface ReportBranch {
  readonly id: string;
  readonly name: string;
}

/** One work-order state and its count over the whole selection — the deprecated field. */
export interface ReportStateCount {
  readonly stateCode: string;
  readonly stateName: string;
  readonly count: number;
}

/**
 * The run result — `ReportRunView`.
 *
 * `freshness` is typed as `string` and rendered from the value: it is `live`
 * today, which is a claim about provenance (the rows were read from the
 * operational tables inside the request's own transaction, with no snapshot and
 * no cache behind them). A client must not present that as something else, and
 * must not present a future value as `live`.
 */
export interface ReportRun {
  readonly reportCode: string;
  readonly titleKey: string;
  readonly scope: string;
  readonly period: ReportPeriod;
  readonly generatedAt: string;
  readonly freshness: string;
  readonly columns: readonly ReportColumn[];
  readonly rows: CursorPage<ReportRow>;
  /** Deprecated on the newer envelope. Read only when `groups` is absent. */
  readonly countsByState?: readonly ReportStateCount[];
  /** Present once the dataset slice lands; the generalisation of the field above. */
  readonly groups?: readonly ReportGroup[];
  /** Present once the dataset slice lands — **D-17**'s echoed filter context. */
  readonly filters?: ReportFilterContext;
  /** Present once the dataset slice lands. */
  readonly branch?: ReportBranch;
}

/**
 * One definition — `ReportDefinitionView`.
 *
 * `executable` is the platform's own answer to "can this be run", and the
 * catalogue screen renders it rather than deciding it: a published configuration
 * whose code the engine does not implement is a definition a reader may see and
 * must not be offered to run. `titleKey` is a translation key for a platform
 * baseline and absent for a tenant row, which carries `name` — that operator's
 * own words — instead.
 */
export interface ReportDefinition {
  readonly reportCode: string;
  readonly name: string;
  readonly scopeLevel: string;
  readonly exportPermissionCode: string | null;
  readonly versionNumber: number | null;
  readonly parameterSchema: unknown;
  readonly publishedAt: string | null;
  readonly recordVersion: number;
  readonly executable: boolean;
  readonly source: string;
  readonly titleKey: string | null;
}

/** The named company and branch choices a run is addressed to. */
export interface ReportScopeOptions {
  readonly companies: readonly { readonly id: string; readonly legalName: string }[];
  readonly branches: readonly {
    readonly id: string;
    readonly companyId: string;
    readonly name: string;
  }[];
}

/**
 * The page size a request may carry, mirrored from the route's own schema.
 *
 * `schemas.limit` on all three operations refuses anything above 100 with a
 * validation failure rather than clamping, so a client that sent more would be
 * told its whole request was invalid. The shared table offers 10, 25, 50 and
 * 100, so the ceiling is never reached from the interface — it is mirrored
 * because a ceiling only this side knows is a ceiling that stops being
 * respected when the table's options change.
 */
export const MAX_REPORT_PAGE_SIZE = 100;

/**
 * The size every request asks for.
 *
 * 50 is the platform's own `DEFAULT_PAGE_SIZE`, which is what all three routes
 * apply to a request that sends no `limit`. So the screens ask for exactly what
 * the operation would have chosen for them, and the number is written down on
 * this side rather than left implicit — a page size nobody states is a page size
 * that changes meaning when the server's default moves.
 */
export const REPORT_PAGE_SIZE = 50;

/** The size a request actually carries. Never above the route's ceiling. */
export function reportPageSize(requested: number): number {
  if (!Number.isInteger(requested) || requested < 1) return MAX_REPORT_PAGE_SIZE;
  return requested > MAX_REPORT_PAGE_SIZE ? MAX_REPORT_PAGE_SIZE : requested;
}

/** A calendar day as both routes demand it, with no zone and no instant. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isReportDay(value: string): boolean {
  return DAY.test(value);
}

/**
 * Whether a period is the half-open range **D-17** approved.
 *
 * `from` must be the first day included and `to` the first day EXCLUDED, so an
 * equal pair is an EMPTY period rather than a single day and is refused — the
 * route refuses it too, and refusing it here means the operator is told which
 * box to correct instead of being handed a validation failure about a request
 * they never saw.
 *
 * The comparison is lexicographic, which IS chronological for this format. No
 * date is constructed, so no zone is applied to a value that does not carry one
 * yet, and nothing here is arithmetic on the operator's input.
 */
export function isReportPeriod(from: string, to: string): boolean {
  return isReportDay(from) && isReportDay(to) && from < to;
}

/**
 * The route templates THIS application can serve.
 *
 * The API publishes a route TEMPLATE rather than a built URL, precisely because
 * it does not own the client's route table — and the client's route table is
 * what decides whether a template resolves. Three templates are published
 * across the four approved datasets and only the work-order one has a page
 * today: there is no per-technician screen, no invoice detail screen and no
 * receipt detail screen in this application, and a credit note has no read
 * operation at all, so the server publishes an explicit absence for it.
 *
 * A reference cell whose template is not in this set renders as the reference it
 * is, with no link. Rendering a link to a route that 404s is the defect the
 * navigation model refuses for exactly the same reason.
 */
export const SERVED_DRILL_THROUGH_TEMPLATES: readonly string[] = Object.freeze([
  '/work-orders/{id}',
]);

/**
 * The template a cell drills through to, or nothing.
 *
 * Three answers, and the difference between the last two is the one **D-20**
 * asked to be preserved: a column with a single target, a column whose target
 * depends on the row's kind, and a kind whose target is published as absent.
 * An unknown discriminator value also yields nothing, rather than the first
 * template in the map.
 */
export function drillThroughTemplate(column: ReportColumn, row: ReportRow): string | null {
  const byKind = column.drillThroughByKind;
  if (byKind) {
    const discriminating = row.cells.find((cell) => cell.key === byKind.discriminator);
    const kind = discriminating?.value ?? null;
    if (kind === null) return null;
    return Object.prototype.hasOwnProperty.call(byKind.templates, kind)
      ? (byKind.templates[kind] ?? null)
      : null;
  }
  return column.drillThrough;
}

/**
 * The locale-prefixed link for a reference cell, or nothing at all.
 *
 * `{id}` is the only placeholder any published template uses, and a template
 * carrying a placeholder this function cannot fill yields nothing rather than a
 * URL with a brace in it. The value is encoded, never interpolated raw.
 */
export function drillThroughHref(
  column: ReportColumn,
  row: ReportRow,
  cell: ReportCell,
  locale: string
): string | null {
  const template = drillThroughTemplate(column, row);
  if (template === null) return null;
  if (!SERVED_DRILL_THROUGH_TEMPLATES.includes(template)) return null;
  if (cell.value === null || cell.value.length === 0) return null;
  const filled = template.replace('{id}', encodeURIComponent(cell.value));
  return filled.includes('{') ? null : `/${locale}${filled}`;
}

/**
 * The groups to render, with the deprecation resolved in one place.
 *
 * `groups` is the field an overview reads. `countsByState` is its predecessor,
 * correct for one dataset and empty for the rest, and it is read ONLY when
 * `groups` is absent — which is the case on the envelope `develop` publishes
 * today. Reading both would double-count the one dataset that has both, since
 * the newer envelope DERIVES the old field from the new one.
 */
export function reportGroups(run: ReportRun): readonly ReportGroup[] {
  if (run.groups !== undefined) return run.groups;
  return (run.countsByState ?? []).map((entry) => ({
    key: { state: entry.stateCode },
    label: entry.stateName,
    // The count reaches the screen as the characters the server sent. It is
    // never added to anything, and `String` here is a rendering of an integer
    // the envelope typed as a number, not arithmetic on it.
    measures: { count: String(entry.count) },
  }));
}
