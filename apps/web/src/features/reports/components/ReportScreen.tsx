'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { RadioGroupField } from '@/components/forms/Field';
import {
  dayToPicker,
  ZonedDateTimeField,
  type MomentProblem,
} from '@/components/forms/mui/DateField';
import { EmptyState } from '@/components/states/States';
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
import {
  ContextFact,
  MachineName,
  REPORT_SECONDARY_BUTTON,
  REPORT_TABLE_CELL,
  REPORT_TABLE_HEADER,
  ReportFailure,
  ReportLoading,
} from './ReportShell';
import { ReportScopeForm } from './ReportScopeForm';
import { ReportExportPanel } from './ReportExportPanel';
import { ReportSnapshotsPanel } from './ReportSnapshotsPanel';
import { useCursorTrail } from './use-cursor-trail';
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
        <EmptyState
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
      <EmptyState
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
        <EmptyState
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
          onAsOfChange={setAsOfChoice}
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

  if (trail.loading || trail.outcome === null) return <ReportLoading messages={messages} />;
  if (trail.outcome.status !== 'ok') {
    return (
      <ReportFailure
        messages={messages}
        status={trail.outcome.status}
        correlationId={trail.outcome.correlationId}
      />
    );
  }

  const run = trail.outcome.data;
  const groups = reportGroups(run);
  const rows = run.rows.items;
  const title = runTitle(messages, run.titleKey);
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
    <section aria-labelledby="report-result-heading" className="flex flex-col gap-4">
      <h3 id="report-result-heading" className="sr-only">
        {title === null ? reportCode : title}
      </h3>

      {/*
        D-17: the timezone and the filter context travel with the result
        wherever it is shown, so a number can never be read without the period
        that produced it. Every fact below is the envelope's own; the branch name
        prefers the one the run resolved and falls back to the name the operator
        picked it by.
      */}
      <dl className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
        <ContextFact label={translate(messages, 'reports.context.from')}>
          <span dir="ltr">{run.period.from}</span>
        </ContextFact>
        <ContextFact label={translate(messages, 'reports.context.to')}>
          <span dir="ltr">{run.period.to}</span>
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

      {rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.run.noRows')}
        </p>
      ) : (
        <RowsTable
          locale={locale}
          messages={messages}
          zone={run.period.timezone}
          columns={run.columns}
          rows={rows}
          captionKey="reports.run.rowsCaption"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={REPORT_SECONDARY_BUTTON}
          disabled={!trail.canGoBack}
          onClick={trail.goBack}
        >
          {translate(messages, 'reports.page.previous')}
        </button>
        <button
          type="button"
          className={REPORT_SECONDARY_BUTTON}
          disabled={!trail.canGoForward}
          onClick={trail.goForward}
        >
          {translate(messages, 'reports.page.next')}
        </button>
      </div>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.run.pagingNote')}
      </p>
    </section>
  );
}

/**
 * A page of report rows, live or frozen in a snapshot (P1-32-PRE-OD-FD16B): one
 * table, so a saved row reads exactly as the live one did.
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
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse">
        <caption className="sr-only">{translate(messages, captionKey)}</caption>
        <thead className="bg-table-header">
          <tr>
            {columns.map((column) => {
              const heading = fieldHeading(messages, column.key);
              return (
                <th key={column.key} scope="col" className={REPORT_TABLE_HEADER}>
                  {heading === null ? <MachineName value={column.key} /> : heading}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // The operation publishes no row identifier — a report row is a
            // projection, not a record — so the position in the page is the
            // key. It is stable for the page being rendered, which is what a
            // key is for.
            <tr key={`${String(index)}`} className="border-t border-border-subtle">
              {columns.map((column) => (
                <td key={column.key} className={REPORT_TABLE_CELL}>
                  <CellValue
                    locale={locale}
                    messages={messages}
                    zone={zone}
                    column={column}
                    row={row}
                    cell={row.cells.find((candidate) => candidate.key === column.key) ?? null}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Which moment the amounts are shown as of (Owner decision D16): the end of the
 * period (the report's own default), now, or a moment the operator types on the
 * reported branch's clock.
 *
 * Applying a choice re-reads the report; nothing is computed here. A moment only
 * partly typed is refused with the incomplete-entry message — never "required",
 * which would tell the operator the box is empty when it is not — and a moment
 * before the period starts or later than now is refused before a request is spent,
 * with the bound it broke. The server refuses both too.
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
  const [errorKey, setErrorKey] = useState<keyof Messages | null>(null);

  const apply = () => {
    if (mode !== 'at') {
      setErrorKey(null);
      onApply({ mode });
      return;
    }
    if (problem === 'incomplete') {
      setErrorKey('reports.asOf.incomplete');
      return;
    }
    if (problem !== null) {
      setErrorKey('reports.asOf.invalid');
      return;
    }
    if (moment === '' || !isReportInstant(moment)) {
      setErrorKey('reports.asOf.chooseMoment');
      return;
    }
    const opens = dayToPicker(periodFrom, zone);
    if (opens !== null && Date.parse(moment) < opens.valueOf()) {
      setErrorKey('reports.asOf.beforePeriod');
      return;
    }
    if (Date.parse(moment) > Date.now()) {
      setErrorKey('reports.asOf.afterNow');
      return;
    }
    setErrorKey(null);
    onApply({ mode: 'at', instant: moment });
  };

  return (
    <form
      noValidate
      aria-label={translate(messages, 'reports.asOf.legend')}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <RadioGroupField
        label={translate(messages, 'reports.asOf.legend')}
        name="report-as-of"
        value={mode}
        onChange={(next) => {
          setErrorKey(null);
          setMode(next === 'now' || next === 'at' ? next : 'end');
        }}
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
          onChange={(next) => {
            setErrorKey(null);
            setMoment(next);
          }}
          onProblem={setProblem}
          error={errorKey === null ? undefined : translate(messages, errorKey)}
          testId="report-as-of-moment"
        />
      ) : errorKey === null ? null : (
        <p role="alert" className="text-supporting text-error">
          {translate(messages, errorKey)}
        </p>
      )}
      <div>
        <button type="submit" className={REPORT_SECONDARY_BUTTON}>
          {translate(messages, 'reports.asOf.apply')}
        </button>
      </div>
    </form>
  );
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
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse">
          <caption className="sr-only">{translate(messages, 'reports.groups.caption')}</caption>
          <thead className="bg-table-header">
            <tr>
              <th scope="col" className={REPORT_TABLE_HEADER}>
                {translate(messages, 'reports.groups.column.group')}
              </th>
              {measureNames.map((name) => {
                const heading = fieldHeading(messages, name);
                return (
                  <th key={name} scope="col" className={REPORT_TABLE_HEADER}>
                    {heading === null ? <MachineName value={name} /> : heading}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const label = groupDisplayLabel(messages, group);
              return (
                <tr key={JSON.stringify(group.key)} className="border-t border-border-subtle">
                  <td className={REPORT_TABLE_CELL}>
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
                  </td>
                  {measureNames.map((name) => {
                    const measure = group.measures[name];
                    const currency = groupCurrency(group);
                    return (
                      <td key={name} className={REPORT_TABLE_CELL}>
                        {measure === undefined ? (
                          <span className="text-text-muted" lang={locale}>
                            {translate(messages, 'reports.groups.noMeasure')}
                          </span>
                        ) : (
                          <span dir="ltr">{formatReportMoney(measure, currency, locale)}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
