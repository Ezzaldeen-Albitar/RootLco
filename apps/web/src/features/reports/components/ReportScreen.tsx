'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import {
  dayToPicker,
  ZonedDateTimeField,
  type MomentProblem,
} from '@/components/forms/mui/DateField';
import { FormRadioGroupField } from '@/components/forms/mui/FormRadioGroupField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import {
  useWorkingContext,
  useWorkingContextChange,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { zoneDisplayName } from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import { runReport } from '../reports-api';
import {
  fieldHeading,
  formatReportMoney,
  formatReportTime,
  groupCurrency,
  groupDisplayLabel,
  reportCreditStatusLabel,
  reportDocumentStatusLabel,
  reportDocumentTypeLabel,
  reportPartyRoleLabel,
  reportStateLabel,
  reportTitle,
  runTitle,
} from '../report-labels';
import {
  drillThroughHref,
  initialReportScope,
  isReportInstant,
  reportAsOfRequest,
  reportGroups,
  REPORT_PAGE_SIZE,
  type ReportAsOfChoice,
  type ReportCell,
  type ReportColumn,
  type ReportDefinition,
  type ReportGroup,
  type ReportRow,
  type ReportRun,
  type ReportScopeOptions,
  type ReportScopeSelection,
} from '../reports-contract';
import { ContextFact, MachineName, ReportFailure, ReportLoading } from './ReportShell';
import { ReportScopeForm } from './ReportScopeForm';
import { ReportExportPanel } from './ReportExportPanel';
import { ReportSnapshotsPanel } from './ReportSnapshotsPanel';
import { trailTable, useCursorTrail } from './use-cursor-trail';
import { useWorkingReportScope } from './use-working-report-scope';

/**
 * One report, run over one branch and one period (P1-31, FE-011 … FE-014).
 *
 * ONE screen serves every report code, and that is the whole design. The
 * catalogue decides which reports exist; the run envelope decides what each one
 * renders — its columns, their kinds, its grouping and its drill-through all
 * arrive in the response. The four registered reports share this screen and its
 * scoped export control without duplicating their dataset rules in the browser.
 *
 * ## Nothing is computed here. Nothing.
 *
 * Every number on this screen is a string the server sent. No total is summed, no
 * duration is divided into hours, no quantity is re-scaled, no percentage is
 * derived and no two values are compared. The groups are computed over the WHOLE
 * selection by PostgreSQL and are not a summary of the page — a page total
 * presented as a branch's position is the `P1-28` round-two defect exactly.
 *
 * An amount is WRITTEN, never changed (finance checkpoint, DF-6). A `money` cell
 * is shown through `formatMoney` with the currency its own row states — the
 * dataset's `currency` column — so a JOD amount reads at JOD's three decimals as
 * it does on every other screen, and a digit below the minor unit is still shown
 * rather than rounded away. A group keyed by a currency writes its measures the
 * same way. An amount with no currency beside it, or that is not a canonical
 * decimal, is shown as the characters it arrived as: a formatter that guessed a
 * currency would be changing money on the way to the screen.
 *
 * ## An instant is shown on the BRANCH's clock, never the browser's
 *
 * `Intl` left to itself would render an instant in the BROWSER's timezone, and
 * this report's period is resolved in the BRANCH's (**D-17**). A row read into
 * the period "opened on the 3rd in Amman" would then be drawn under a date that
 * is the 2nd or the 4th for a reader sitting elsewhere, and the report would
 * visibly disagree with itself. So every date and instant - the rows and the
 * time the report was read - is formatted in the zone the period was resolved in
 * (`formatReportTime`), in the reader's language, and that zone is displayed
 * beside them by its name and offset (`zoneDisplayName`: "Jordan Time (GMT+3)"),
 * never as the identifier the platform stores (DF-B5). The raw ISO string is not
 * what an operator reads (Browser QA part 7, row 6.7).
 *
 * ## The period is half-open, and the screen says so where it is typed
 *
 * `from` is the first day included and `to` is the first day EXCLUDED — the day
 * after the last one reported. The rule is stated beside the two controls rather
 * than in a document, because it is the one thing an operator will get wrong. An
 * equal pair is an EMPTY period and is refused here rather than sent, so the
 * operator is told which box to correct instead of receiving a validation
 * failure about a request they never saw.
 *
 * ## It reads on arrival for the working branch and today, and nothing wider
 *
 * The Owner directive (`P1-32-PRE-OD-UX`) asks every list to read on arrival,
 * bounded to today, within the working context. So when the address names
 * nothing and the working context names ONE branch the report directory holds,
 * the form starts on that branch and on today in that branch's own zone —
 * `[today, tomorrow)` — and that selection is read at once
 * (`useWorkingReportScope`). A switch of the working branch follows it. The
 * operator widens the period or picks another branch by name, and the form then
 * holds their choice until the working branch changes.
 *
 * No wider default is chosen: "the last thirty days" is a business rule nobody
 * has decided, and "today" is the directive's own bound.
 *
 * ## Nothing is requested without one branch and a period
 *
 * The operation is branch-scoped and the pair is its authorization target, not a
 * convenience: without it the backend's check degrades to a scope-blind
 * permission test. The server enforces no union over "All my branches", so under
 * that posture — or with no branch chosen yet — nothing is read and the screen
 * says a report covers one branch at a time. The results are a separately
 * MOUNTED component: before a selection exists, the component that would issue
 * the read does not exist.
 *
 * ## A report that cannot be run is not offered a form
 *
 * `executable` is the platform's own answer, and a form drawn over a definition
 * the engine does not implement is a control whose only possible outcome is a
 * refusal.
 *
 * ## The form is shared, and the address may fill it in
 *
 * The company, branch and period controls live in `ReportScopeForm`, which the
 * operational overview asks the same question with (FE-010). The behaviour is the
 * one this screen always had; only the file changed.
 *
 * A selection named in the ADDRESS fills the form in — that is how the overview's
 * drill-through arrives here carrying the branch and the period the figure was
 * read over, instead of asking the operator to type them again under a heading
 * that claims to be about that branch. Nothing is submitted for them, and
 * anything the caller's own directory does not hold is dropped rather than shown:
 * see `initialReportScope`. An address that names anything at all takes the place
 * of the working context: the form is filled from it and the operator runs it.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-REPA`)
 *
 * The rows are cursor pages, so they are drawn by `OperationalGrid` (G1–G9): an
 * unknown count, "Page N", and Previous and Next that walk the run's own cursor
 * trail (`trailTable`) — the trail keeps the whole envelope of the page it
 * holds, so the period, the zone, the moment and the groups shown are always the
 * shown page's. The groups are one bounded answer with no cursor and are drawn as
 * the Material table (the planner ruling of 2026-10-09). The states are the
 * Material ones, the as-of choice is `FormRadioGroupField` with the moment picker,
 * and a refused moment takes the cursor (`useLocalRefusal`). Pressing Apply twice
 * with the same choice reads nothing again: an unchanged choice is not a new one.
 */

export function ReportScreen({
  locale,
  messages,
  definition,
  scopeOptions,
  canExport = false,
  canSnapshot = false,
  named = {},
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly definition: ReportDefinition;
  readonly scopeOptions: ReadState<ReportScopeOptions>;
  readonly canExport?: boolean;
  /**
   * Whether the operator may save and restate a frozen snapshot of a report that
   * keeps them (Owner decision D16, P1-32-PRE-OD-FD16C): `rpt.report.configure`,
   * which the backend requires to save one with the report's own codes. Reading
   * the snapshots needs only the report.
   */
  readonly canSnapshot?: boolean;
  /**
   * The selection the ADDRESS named — the overview's drill-through, or a link
   * somebody kept. Resolved against the caller's own directory by
   * `initialReportScope`, which drops anything that is not there rather than
   * approximating it, and nothing is submitted for the operator: the form is
   * filled in, and they press the button.
   */
  readonly named?: Partial<ReportScopeSelection>;
}) {
  const companies = scopeOptions.status === 'ok' ? scopeOptions.data.companies : [];
  const branches = scopeOptions.status === 'ok' ? scopeOptions.data.branches : [];
  const [chosen, setChosen] = useState<ReportScopeSelection | null>(null);
  /*
   * Which moment the amounts are shown as of (Owner decision D16). Kept beside
   * the selection — the screen keeps its filters in its own state, not the
   * address — and returned to the end of the period whenever the selection
   * changes, because a moment chosen for one period may fall outside the next.
   */
  const [asOfChoice, setAsOfChoice] = useState<ReportAsOfChoice>({ mode: 'end' });
  /*
   * The working branch and today, when the address names nothing. The
   * operator's own submission takes its place until the working context
   * changes, when the screen follows the new branch again.
   */
  const addressNamed = Object.keys(named).length > 0;
  const working = useWorkingReportScope(scopeOptions.status === 'ok' ? scopeOptions.data : null);
  const followed = !addressNamed && working.kind === 'ready' ? working.selection : null;
  const { version } = useWorkingContext();
  useWorkingContextChange(() => {
    if (!addressNamed) {
      setChosen(null);
      setAsOfChoice({ mode: 'end' });
    }
  });
  const submitted = chosen ?? followed;

  const title = reportTitle(messages, definition);

  if (!definition.executable) {
    return (
      <div className="flex flex-col gap-3">
        <ReportHeading title={title} code={definition.reportCode} />
        <MuiEmptyState
          messages={messages}
          titleKey="reports.run.notRunnableTitle"
          descriptionKey="reports.run.notRunnableBody"
        />
      </div>
    );
  }

  if (scopeOptions.status !== 'ok') {
    return (
      <ReportFailure
        messages={messages}
        locale={locale}
        status={scopeOptions.status}
        correlationId={scopeOptions.correlationId}
      />
    );
  }

  if (
    companies.length === 0 ||
    !branches.some((branch) => companies.some((company) => company.id === branch.companyId))
  ) {
    return (
      <MuiEmptyState
        messages={messages}
        titleKey="reports.run.noScopesTitle"
        descriptionKey="reports.run.noScopesBody"
      />
    );
  }

  const chosenBranch = branches.find((branch) => branch.id === submitted?.branchId) ?? null;
  const chosenCompany = companies.find((company) => company.id === submitted?.companyId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeading title={title} code={definition.reportCode} />

      {!addressNamed && working.kind === 'oneBranch' ? (
        <p role="status" className="text-supporting text-text-secondary" lang={locale}>
          {translate(messages, 'reports.run.oneBranchNote')}
        </p>
      ) : null}

      <ReportScopeForm
        // Re-seeded when the working branch (or the day it answers) changes, so
        // the form always shows the selection that was read.
        key={`${String(version)}:${followed === null ? '' : JSON.stringify(followed)}`}
        locale={locale}
        messages={messages}
        options={scopeOptions.data}
        initial={followed ?? initialReportScope(scopeOptions.data, named)}
        submitKey="reports.run.show"
        onSubmit={(selection) => {
          setChosen(selection);
          setAsOfChoice({ mode: 'end' });
        }}
      />

      {submitted === null ? (
        <MuiEmptyState
          messages={messages}
          titleKey="reports.run.idleTitle"
          descriptionKey="reports.run.idleBody"
        />
      ) : (
        // Mounted only after submission — see the docblock. The key restarts the
        // read on a new period or branch rather than paging the previous one with
        // cursors issued against a different selection.
        <ReportResults
          key={`${JSON.stringify(submitted)}|${JSON.stringify(asOfChoice)}`}
          locale={locale}
          messages={messages}
          reportCode={definition.reportCode}
          submitted={submitted}
          asOfChoice={asOfChoice}
          onAsOfChange={(next) =>
            setAsOfChoice((current) =>
              JSON.stringify(current) === JSON.stringify(next) ? current : next
            )
          }
          companyName={chosenCompany?.legalName ?? null}
          branchName={chosenBranch?.name ?? null}
          canExport={canExport}
          canSnapshot={canSnapshot}
        />
      )}
    </div>
  );
}

/**
 * The report's name. A report this build has words for is shown by its name
 * alone: its code is a machine name, and printing it under the title put an
 * identifier in front of every operator (DF-B5). Only a report with no name to
 * show is headed by its code, shown as the code it is.
 */
function ReportHeading({ title, code }: { readonly title: string | null; readonly code: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className="text-section-title font-medium text-text-primary">
        {title === null ? <MachineName value={code} /> : <bdi>{title}</bdi>}
      </h2>
    </div>
  );
}

const runSignals = (run: ReportRun) => ({
  nextCursor: run.rows.nextCursor,
  hasMore: run.rows.hasMore,
});

function ReportResults({
  locale,
  messages,
  reportCode,
  submitted,
  asOfChoice,
  onAsOfChange,
  companyName,
  branchName,
  canExport,
  canSnapshot,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportCode: string;
  readonly submitted: ReportScopeSelection;
  readonly asOfChoice: ReportAsOfChoice;
  readonly onAsOfChange: (choice: ReportAsOfChoice) => void;
  readonly companyName: string | null;
  readonly branchName: string | null;
  readonly canExport: boolean;
  readonly canSnapshot: boolean;
}) {
  const { companyId, branchId, from, to } = submitted;
  /*
   * The moment the FIRST answer was computed as of (D16). Every later page, and a
   * return to the first, asks for exactly that moment, so a default of "now" — or
   * the end of a period still running — cannot drift between the pages of one
   * report. The first request carries the operator's choice.
   */
  const pinnedAsOf = useRef<string | null>(null);
  const read = useCallback(
    async (cursor: string | null) => {
      const outcome = await runReport({
        reportCode,
        companyId,
        branchId,
        from,
        to,
        asOf: pinnedAsOf.current ?? reportAsOfRequest(asOfChoice),
        cursor,
        limit: REPORT_PAGE_SIZE,
      });
      if (outcome.status === 'ok' && outcome.data.asOf !== undefined) {
        pinnedAsOf.current ??= outcome.data.asOf;
      }
      return outcome;
    },
    [reportCode, companyId, branchId, from, to, asOfChoice]
  );
  const trail = useCursorTrail<ReportRun>(read, runSignals);
  const answered =
    trail.outcome !== null && trail.outcome.status === 'ok' ? trail.outcome.data : null;
  /*
   * The last page that answered, kept while the next one is read.
   *
   * The grid keeps the report's columns by it, so a page move draws skeleton
   * rows under the same header instead of a blank region; and the facts above
   * the rows — the period, the zone, the moment, the export, the groups — stay
   * mounted, so a page move neither drops a typed export reason nor takes the
   * cursor away. Every page of one report carries the same selection and the
   * same pinned moment (D16), and no rows are drawn while the next page is
   * read, so nothing of one page is ever shown beside another page's rows. A
   * page that is refused or fails is drawn as itself, with nothing kept above it.
   */
  const [held, setHeld] = useState<ReportRun | null>(null);
  if (answered !== null && held !== answered) setHeld(answered);
  const run = answered ?? (trail.loading ? held : null);
  const table = trailTable(
    trail,
    (page: ReportRun) =>
      page.rows.items.map((row, index) => ({ id: `${String(trail.page)}:${String(index)}`, row })),
    REPORT_PAGE_SIZE
  );
  const shapeColumns = run === null ? null : run.columns;
  const shapeZone = run === null ? null : run.period.timezone;
  const gridColumns = useMemo<readonly OperationalColumn<ReportGridRow>[]>(
    () =>
      shapeColumns === null || shapeZone === null
        ? []
        : shapeColumns.map((column) => ({
            id: column.key,
            // A column this build has no word for is headed by its own key, as
            // the machine name it is; the grid takes a catalogue key or text.
            headerKey:
              fieldHeading(messages, column.key) === null
                ? column.key
                : `reports.field.${column.key}`,
            numeric: NUMERIC_KINDS.has(column.kind),
            cell: (entry: ReportGridRow) => (
              <CellValue
                locale={locale}
                messages={messages}
                zone={shapeZone}
                column={column}
                row={entry.row}
                cell={entry.row.cells.find((candidate) => candidate.key === column.key) ?? null}
              />
            ),
          })),
    [shapeColumns, shapeZone, locale, messages]
  );

  if (run === null) {
    // No page is held: the first one is still being read, or this page could
    // not be. Either is drawn as itself, and an outage can be retried.
    const failed = trail.loading ? null : trail.outcome;
    if (failed !== null && failed.status !== 'ok') {
      return (
        <ReportFailure
          messages={messages}
          locale={locale}
          status={failed.status}
          correlationId={failed.correlationId}
          onRetry={trail.refresh}
        />
      );
    }
    return <ReportLoading messages={messages} />;
  }

  const title = runTitle(messages, run.titleKey);

  return (
    <section aria-labelledby="report-result-heading" className="flex flex-col gap-4">
      <h3 id="report-result-heading" className="sr-only">
        {title === null ? reportCode : title}
      </h3>

      <RunEnvelope
        locale={locale}
        messages={messages}
        reportCode={reportCode}
        run={run}
        submitted={submitted}
        asOfChoice={asOfChoice}
        onAsOfChange={onAsOfChange}
        companyName={companyName}
        branchName={branchName}
        canExport={canExport}
        canSnapshot={canSnapshot}
      />

      {run.rows.items.length === 0 && trail.page === 1 ? (
        // The honest zero: a sentence, not an empty grid, which would read as
        // a report that failed to load.
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.run.noRows')}
        </p>
      ) : (
        <OperationalGrid<ReportGridRow>
          messages={messages}
          locale={locale}
          label={translate(messages, 'reports.run.rowsCaption')}
          columns={gridColumns}
          rowId={(entry) => entry.id}
          table={table}
          suppressEmptyState
          testId="report-rows"
        />
      )}
      {run.rows.items.length === 0 && trail.page > 1 ? (
        <p className="py-4 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.catalogue.noFurther')}
        </p>
      ) : null}
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.run.pagingNote')}
      </p>
    </section>
  );
}

/** One row of the report's grid: the row as the server sent it, and its place. */
interface ReportGridRow {
  /** The page and the position in it — a report row is a projection, not a record. */
  readonly id: string;
  readonly row: ReportRow;
}

/** The column kinds whose values are figures, aligned as figures. */
const NUMERIC_KINDS: ReadonlySet<string> = new Set(['count', 'duration', 'quantity', 'money']);

/**
 * Everything one answered page says about itself, above its rows: the period,
 * the zone and the filter context (D-17), the moment its amounts are as of and
 * the choice of another (D16), the export, the snapshots, and the groups.
 */
function RunEnvelope({
  locale,
  messages,
  reportCode,
  run,
  submitted,
  asOfChoice,
  onAsOfChange,
  companyName,
  branchName,
  canExport,
  canSnapshot,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportCode: string;
  readonly run: ReportRun;
  readonly submitted: ReportScopeSelection;
  readonly asOfChoice: ReportAsOfChoice;
  readonly onAsOfChange: (choice: ReportAsOfChoice) => void;
  readonly companyName: string | null;
  readonly branchName: string | null;
  readonly canExport: boolean;
  readonly canSnapshot: boolean;
}) {
  const groups = reportGroups(run);
  /*
   * D16: the moment the amounts are as of, on the BRANCH's clock with the zone
   * named, exactly as the server stated it. Only a report that answered with one
   * says it; a live report claims no moment.
   */
  const asOf = run.freshness === 'as_of' && run.asOf !== undefined ? run.asOf : null;
  const asOfMoment =
    asOf === null
      ? null
      : `${formatReportTime(asOf, locale, run.period.timezone)} (${zoneDisplayName(
          run.period.timezone,
          intlLocale(locale),
          asOf
        )})`;

  return (
    <>
      {/*
        D-17: the timezone and the filter context travel with the result
        wherever it is shown, so a number can never be read without the period
        that produced it. Every fact below is the envelope's own; the branch name
        prefers the one the run resolved and falls back to the name the operator
        picked it by. The two days are written for reading on the branch's
        clock, with the day itself kept as the machine value.
      */}
      <dl className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
        <ContextFact label={translate(messages, 'reports.context.from')}>
          <time dateTime={run.period.from} data-testid="report-period-from">
            {formatReportTime(run.period.from, locale, run.period.timezone)}
          </time>
        </ContextFact>
        <ContextFact label={translate(messages, 'reports.context.to')}>
          <time dateTime={run.period.to} data-testid="report-period-to">
            {formatReportTime(run.period.to, locale, run.period.timezone)}
          </time>
        </ContextFact>
        <ContextFact label={translate(messages, 'reports.context.timezone')}>
          <bdi data-testid="report-zone">
            {zoneDisplayName(run.period.timezone, intlLocale(locale), run.generatedAt)}
          </bdi>
        </ContextFact>
        <ContextFact label={translate(messages, 'reports.context.company')}>
          {companyName === null ? (
            <MachineName value={run.filters?.companyId ?? submitted.companyId} />
          ) : (
            <bdi>{companyName}</bdi>
          )}
        </ContextFact>
        <ContextFact label={translate(messages, 'reports.context.branch')}>
          {run.branch !== undefined ? (
            <bdi>{run.branch.name}</bdi>
          ) : branchName === null ? (
            <MachineName value={run.filters?.branchId ?? submitted.branchId} />
          ) : (
            <bdi>{branchName}</bdi>
          )}
        </ContextFact>
        <ContextFact label={translate(messages, 'reports.context.freshness')}>
          {run.freshness === 'live' ? (
            translate(messages, 'reports.context.freshness.live')
          ) : asOf !== null ? (
            translate(messages, 'reports.context.freshness.asOf')
          ) : (
            <MachineName value={run.freshness} />
          )}
        </ContextFact>
        <ContextFact label={translate(messages, 'reports.context.generatedAt')}>
          <time dateTime={run.generatedAt}>
            {formatReportTime(run.generatedAt, locale, run.period.timezone)}
          </time>
        </ContextFact>
      </dl>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.context.periodNote')}
      </p>

      {asOf === null || asOfMoment === null ? null : (
        <section
          aria-labelledby="report-as-of-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <p
            id="report-as-of-heading"
            className="text-body font-medium text-text-primary"
            data-testid="report-as-of"
            lang={locale}
          >
            <bdi>
              {formatMessage(translate(messages, 'reports.asOf.statement'), {
                moment: asOfMoment,
              })}
            </bdi>
          </p>
          <p className="text-caption text-text-muted" lang={locale}>
            {translate(messages, 'reports.asOf.note')}
          </p>
          <AsOfChoiceForm
            messages={messages}
            zone={run.period.timezone}
            periodFrom={run.period.from}
            choice={asOfChoice}
            onApply={onAsOfChange}
          />
        </section>
      )}

      <ReportExportPanel
        messages={messages}
        reportCode={reportCode}
        permitted={canExport}
        selection={{
          companyId: run.filters?.companyId ?? submitted.companyId,
          branchId: run.filters?.branchId ?? submitted.branchId,
          from: run.period.from,
          to: run.period.to,
        }}
        asOf={asOf}
        asOfMoment={asOfMoment}
      />

      {run.snapshots === true ? (
        <ReportSnapshotsPanel
          locale={locale}
          messages={messages}
          reportCode={reportCode}
          selection={{
            companyId: run.filters?.companyId ?? submitted.companyId,
            branchId: run.filters?.branchId ?? submitted.branchId,
            from: run.period.from,
            to: run.period.to,
          }}
          companyName={companyName}
          branchName={run.branch?.name ?? branchName}
          zone={run.period.timezone}
          asOf={asOf}
          asOfMoment={asOfMoment}
          canSave={canSnapshot}
          renderRows={(columns, frozen) => (
            <RowsTable
              locale={locale}
              messages={messages}
              zone={run.period.timezone}
              columns={columns}
              rows={frozen}
              captionKey="reports.snapshots.rowsCaption"
            />
          )}
        />
      ) : null}

      {groups.length === 0 ? null : (
        <GroupTable messages={messages} groups={groups} locale={locale} />
      )}
    </>
  );
}

/**
 * A page of report rows frozen in a snapshot (P1-32-PRE-OD-FD16B), drawn as the
 * Material table: the snapshot panel hands over one page it has read and walks
 * its own pages, so this draws the rows it is given and nothing else. The cells
 * are the live grid's own (`CellValue`), so a saved row reads exactly as the live
 * one did.
 */
function RowsTable({
  locale,
  messages,
  zone,
  columns,
  rows,
  captionKey,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly zone: string;
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly ReportRow[];
  readonly captionKey: keyof Messages;
}) {
  return (
    <TableContainer className="rounded-lg border border-border bg-surface">
      <Table size="small">
        <caption className="sr-only">{translate(messages, captionKey)}</caption>
        <TableHead>
          <TableRow>
            {columns.map((column) => {
              const heading = fieldHeading(messages, column.key);
              return (
                <TableCell key={column.key} scope="col">
                  {heading === null ? <MachineName value={column.key} /> : heading}
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            // The operation publishes no row identifier — a report row is a
            // projection, not a record — so the position in the page is the
            // key. It is stable for the page being rendered, which is what a
            // key is for.
            <TableRow key={`${String(index)}`} className="align-top">
              {columns.map((column) => (
                <TableCell key={column.key}>
                  <CellValue
                    locale={locale}
                    messages={messages}
                    zone={zone}
                    column={column}
                    row={row}
                    cell={row.cells.find((candidate) => candidate.key === column.key) ?? null}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/**
 * Which moment the amounts are shown as of (Owner decision D16): the end of the
 * period (the report's own default), now, or a moment the operator types on the
 * reported branch's clock.
 *
 * Applying a choice re-reads the report; nothing is computed here. "Now" is sent
 * as the word and resolved by the database's clock, never this browser's. A
 * moment only partly typed is refused with the incomplete-entry message — never
 * "required", which would tell the operator the box is empty when it is not — and
 * a moment before the period starts or later than now is refused before a request
 * is spent, with the bound it broke. The server refuses both too. A refusal puts
 * the cursor on the moment and is withdrawn once the moment changes.
 */
function AsOfChoiceForm({
  messages,
  zone,
  periodFrom,
  choice,
  onApply,
}: {
  readonly messages: Messages;
  readonly zone: string;
  readonly periodFrom: string;
  readonly choice: ReportAsOfChoice;
  readonly onApply: (choice: ReportAsOfChoice) => void;
}) {
  const [mode, setMode] = useState<ReportAsOfChoice['mode']>(choice.mode);
  const [moment, setMoment] = useState(choice.mode === 'at' ? choice.instant : '');
  const [problem, setProblem] = useState<MomentProblem>(null);
  // A complaint about the moment is withdrawn once the moment, or the choice
  // it belongs to, changes.
  const { errorKey, formRef, refuse } = useLocalRefusal({
    moment: `${mode}|${moment}|${problem ?? ''}`,
  });

  const apply = () => {
    if (mode !== 'at') {
      refuse({});
      onApply({ mode });
      return;
    }
    const refusal = momentRefusal(moment, problem, periodFrom, zone);
    refuse(refusal === null ? {} : { moment: refusal });
    if (refusal !== null) return;
    onApply({ mode: 'at', instant: moment });
  };
  const refused = errorKey('moment');

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={translate(messages, 'reports.asOf.legend')}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <FormRadioGroupField
        label={translate(messages, 'reports.asOf.legend')}
        name="report-as-of"
        value={mode}
        onChange={(next) => setMode(next === 'now' || next === 'at' ? next : 'end')}
        options={[
          { value: 'end', label: translate(messages, 'reports.asOf.endOfPeriod') },
          { value: 'now', label: translate(messages, 'reports.asOf.now') },
          { value: 'at', label: translate(messages, 'reports.asOf.specific') },
        ]}
      />
      {mode === 'at' ? (
        <ZonedDateTimeField
          messages={messages}
          label={translate(messages, 'reports.asOf.moment')}
          description={translate(messages, 'reports.asOf.momentHint')}
          timezone={zone}
          value={moment}
          onChange={setMoment}
          onProblem={setProblem}
          error={refused === undefined ? undefined : translate(messages, refused as keyof Messages)}
          testId="report-as-of-moment"
        />
      ) : null}
      <div>
        <Button type="submit" variant="outlined">
          {translate(messages, 'reports.asOf.apply')}
        </Button>
      </div>
    </form>
  );
}

/** Why a typed moment cannot be applied, as a catalogue key, or `null` when it can. */
function momentRefusal(
  moment: string,
  problem: MomentProblem,
  periodFrom: string,
  zone: string
): keyof Messages | null {
  if (problem === 'incomplete') return 'reports.asOf.incomplete';
  if (problem !== null) return 'reports.asOf.invalid';
  if (moment === '' || !isReportInstant(moment)) return 'reports.asOf.chooseMoment';
  const opens = dayToPicker(periodFrom, zone);
  if (opens !== null && Date.parse(moment) < opens.valueOf()) return 'reports.asOf.beforePeriod';
  if (Date.parse(moment) > Date.now()) return 'reports.asOf.afterNow';
  return null;
}

/**
 * The groups, computed by the server over the WHOLE selection.
 *
 * Above the rows, because it answers a different question: the rows are one page
 * and these are the totals of everything the period and the branch selected. A
 * group whose measure is absent renders the absence rather than a zero — a zero
 * is a measurement and "this group has no such measure" is not.
 *
 * The measure COLUMNS are the union of the measure names the groups carry, in
 * first-seen order. There is no declaration of them on the envelope, and
 * inventing an order would put a workshop's own grouping into an arrangement this
 * side chose.
 *
 * One bounded answer with no cursor, so it is the Material table rather than the
 * grid (the planner ruling of 2026-10-09); nothing is paged, and nothing more
 * exists than what is drawn.
 */
function GroupTable({
  messages,
  groups,
  locale,
}: {
  readonly messages: Messages;
  readonly groups: readonly ReportGroup[];
  readonly locale: Locale;
}) {
  const keyNames: string[] = [];
  const measureNames: string[] = [];
  for (const group of groups) {
    for (const name of Object.keys(group.key)) {
      if (!keyNames.includes(name)) keyNames.push(name);
    }
    for (const name of Object.keys(group.measures)) {
      if (!measureNames.includes(name)) measureNames.push(name);
    }
  }

  return (
    <section aria-labelledby="report-groups-heading" className="flex flex-col gap-2">
      <h4 id="report-groups-heading" className="text-label font-medium text-text-primary">
        {translate(messages, 'reports.groups.heading')}
      </h4>
      <TableContainer className="rounded-lg border border-border bg-surface">
        <Table size="small">
          <caption className="sr-only">{translate(messages, 'reports.groups.caption')}</caption>
          <TableHead>
            <TableRow>
              <TableCell scope="col">
                {translate(messages, 'reports.groups.column.group')}
              </TableCell>
              {measureNames.map((name) => {
                const heading = fieldHeading(messages, name);
                return (
                  <TableCell key={name} scope="col" align="right">
                    {heading === null ? <MachineName value={name} /> : heading}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((group) => {
              const label = groupDisplayLabel(messages, group);
              return (
                <TableRow key={JSON.stringify(group.key)} className="align-top">
                  <TableCell>
                    {label === null ? (
                      <span className="flex flex-col gap-1">
                        {keyNames.map((name) => {
                          if (!(name in group.key)) return null;
                          const heading = fieldHeading(messages, name);
                          const value = group.key[name] ?? null;
                          // A document kind is said in words (DF-5); any other
                          // key value is the server's and is shown as a code.
                          const worded =
                            name === 'documentType'
                              ? reportDocumentTypeLabel(messages, value)
                              : null;
                          return (
                            <span key={name} className="text-caption text-text-secondary">
                              {heading === null ? <MachineName value={name} /> : heading}
                              {': '}
                              {value === null ? (
                                translate(messages, 'reports.groups.unnamed')
                              ) : worded !== null ? (
                                <bdi>{worded}</bdi>
                              ) : (
                                <MachineName value={value} />
                              )}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <bdi>{label}</bdi>
                    )}
                  </TableCell>
                  {measureNames.map((name) => {
                    const measure = group.measures[name];
                    const currency = groupCurrency(group);
                    return (
                      <TableCell key={name} align="right">
                        {measure === undefined ? (
                          <span className="text-text-muted" lang={locale}>
                            {translate(messages, 'reports.groups.noMeasure')}
                          </span>
                        ) : (
                          <span dir="ltr">{formatReportMoney(measure, currency, locale)}</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}

/**
 * A text cell whose value is one of the invoice-and-payment report's codes, in
 * the reader's language, or `null` when the column is not one of them or the
 * code is outside the vocabulary this build words.
 */
function codedLabel(
  messages: Messages,
  key: string,
  row: ReportRow,
  value: string | null
): string | null {
  if (key === 'documentType') return reportDocumentTypeLabel(messages, value);
  if (key === 'partyRole') return reportPartyRoleLabel(messages, value);
  if (key === 'status') {
    const documentType =
      row.cells.find((candidate) => candidate.key === 'documentType')?.value ?? null;
    return reportDocumentStatusLabel(messages, documentType, value);
  }
  return null;
}

/**
 * One cell, rendered by the column's declared KIND.
 *
 * The kind is the whole reason the field exists: a cell's value is a string
 * whatever it holds, so without it a client cannot tell `3600` seconds from
 * `3600` of anything else and would have to guess at a format. A kind this build
 * does not recognise is rendered as what arrived rather than forced into one of
 * the kinds it does know — guessing would present a duration as a count.
 *
 * A `reference` whose label is absent shows the ABSENCE, never the internal
 * identifier: a reference slot holding a raw identifier reads to an operator as
 * the record's own number, which is the `delivery.queue` finding.
 */
function CellValue({
  locale,
  messages,
  zone,
  column,
  row,
  cell,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The zone the period was resolved in: the reported branch's own. */
  readonly zone: string;
  readonly column: ReportColumn;
  readonly row: ReportRow;
  readonly cell: ReportCell | null;
}) {
  if (cell === null) {
    // The envelope emits cells in column order and repeats the column key, so a
    // column with no cell is a contract the server did not keep. It is reported
    // as absent rather than rendered as empty, which would read as a value.
    return (
      <span className="text-text-muted" lang={locale}>
        {translate(messages, 'reports.cell.missing')}
      </span>
    );
  }

  if (column.kind === 'reference') {
    const href = drillThroughHref(column, row, cell, locale);
    const shown =
      cell.label === null ? (
        <span className="text-text-muted" lang={locale}>
          {translate(messages, 'reports.cell.noReference')}
        </span>
      ) : (
        <bdi>{cell.label}</bdi>
      );
    if (href === null || cell.label === null) return shown;
    return (
      <Link href={href} className="text-primary underline-offset-2 hover:underline">
        {shown}
      </Link>
    );
  }

  if (column.kind === 'date') {
    // On the branch's clock, never the browser's. See the screen's docblock: a
    // browser-local reformatting would put a row in a different day from the
    // one the report counted it in.
    return cell.value === null ? (
      <span className="text-text-muted" lang={locale}>
        {translate(messages, 'reports.cell.none')}
      </span>
    ) : (
      <time dateTime={cell.value}>{formatReportTime(cell.value, locale, zone)}</time>
    );
  }

  if (column.kind === 'money') {
    // Written with the currency the row states, never rounded (DF-6). Without a
    // currency beside it the amount is shown exactly as sent.
    const currency = row.cells.find((candidate) => candidate.key === 'currency')?.value ?? null;
    return cell.value === null ? (
      <span className="text-text-muted" lang={locale}>
        {translate(messages, 'reports.cell.none')}
      </span>
    ) : (
      <span dir="ltr">{formatReportMoney(cell.value, currency, locale)}</span>
    );
  }

  if (column.kind === 'count' || column.kind === 'duration' || column.kind === 'quantity') {
    // Exact, and exactly as sent. Nothing here rounds, scales, divides or adds.
    return cell.value === null ? (
      <span className="text-text-muted" lang={locale}>
        {translate(messages, 'reports.cell.none')}
      </span>
    ) : (
      <span dir="ltr">{cell.value}</span>
    );
  }

  // `text` and every kind this build has not met. The label is what a human
  // reads; the value is the catalogue code behind it and is shown as a code when
  // there is no label to show instead.
  // A work-order state is said in the reader's language; the server's name for
  // it is English whatever the reader's language (Browser QA part 7, row 6.7).
  const state = column.key === 'state' ? reportStateLabel(messages, cell.value) : null;
  if (state !== null) return <bdi>{state}</bdi>;
  // An invoice's credit status (D7) is said in the reader's language too.
  const credit =
    column.key === 'creditStatus' ? reportCreditStatusLabel(messages, cell.value) : null;
  if (credit !== null) return <bdi>{credit}</bdi>;
  // The invoice-and-payment report's own codes (DF-5): the kind of document, the
  // party's role, and the document's status in the vocabulary of its own kind.
  const coded = codedLabel(messages, column.key, row, cell.value);
  if (coded !== null) return <bdi>{coded}</bdi>;
  if (cell.label !== null) return <bdi>{cell.label}</bdi>;
  if (cell.value !== null) return <MachineName value={cell.value} />;
  return (
    <span className="text-text-muted" lang={locale}>
      {translate(messages, 'reports.cell.none')}
    </span>
  );
}
