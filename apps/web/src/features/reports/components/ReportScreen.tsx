'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { SelectField, TextField } from '@/components/forms/Field';
import { EmptyState } from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { runReport } from '../reports-api';
import { fieldHeading, reportTitle, runTitle } from '../report-labels';
import {
  drillThroughHref,
  isReportDay,
  isReportPeriod,
  reportGroups,
  REPORT_PAGE_SIZE,
  type ReportCell,
  type ReportColumn,
  type ReportDefinition,
  type ReportGroup,
  type ReportRow,
  type ReportRun,
  type ReportScopeOptions,
} from '../reports-contract';
import {
  ContextFact,
  MachineName,
  REPORT_PRIMARY_BUTTON,
  REPORT_SECONDARY_BUTTON,
  REPORT_TABLE_CELL,
  REPORT_TABLE_HEADER,
  ReportFailure,
  ReportLoading,
} from './ReportShell';
import { useCursorTrail } from './use-cursor-trail';

/**
 * One report, run over one branch and one period (P1-31, FE-011 … FE-014).
 *
 * ONE screen serves every report code, and that is the whole design. The
 * catalogue decides which reports exist; the run envelope decides what each one
 * renders — its columns, their kinds, its grouping and its drill-through all
 * arrive in the response. Nothing below branches on a report code, so the three
 * approved reports the engine has not registered yet need no second screen and
 * no contract guessed at in advance.
 *
 * ## Nothing is computed here. Nothing.
 *
 * Every number on this screen is a string the server sent. No total is summed, no
 * duration is divided into hours, no quantity is re-scaled, no amount is
 * reformatted, no percentage is derived and no two values are compared. The
 * groups are computed over the WHOLE selection by PostgreSQL and are not a
 * summary of the page — a page total presented as a branch's position is the
 * `P1-28` round-two defect exactly.
 *
 * A measure is rendered as the characters it arrived as. That is deliberate and
 * it is recorded: this application's one sanctioned money helper needs a currency
 * beside the amount and a canonical four-place scale, and a report cell carries
 * neither — the currency is a separate column on the one dataset that has one. A
 * formatter that guessed either would be changing money on the way to the screen.
 *
 * ## An instant is shown as the server published it
 *
 * `Intl` would render an instant in the BROWSER's timezone, and this report's
 * period is resolved in the BRANCH's (**D-17**). A row read into the period
 * "opened on the 3rd in Amman" would then be drawn under a date that is the 2nd
 * or the 4th for a reader sitting elsewhere, and the report would visibly
 * disagree with itself. So dates and instants are shown as sent, left to right,
 * and the zone the period was resolved in is displayed beside them.
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
 * There is no default period. A report over a whole history is a response whose
 * size the caller chooses, and "the last thirty days" is a business rule nobody
 * has decided.
 *
 * ## Nothing is requested until an operator names a branch and a period
 *
 * The operation is branch-scoped and the pair is its authorization target, not a
 * convenience: without it the backend's check degrades to a scope-blind
 * permission test. So the results are a separately MOUNTED component — before a
 * period and a branch are submitted, the component that would issue the read does
 * not exist.
 *
 * ## A report that cannot be run is not offered a form
 *
 * `executable` is the platform's own answer, and a form drawn over a definition
 * the engine does not implement is a control whose only possible outcome is a
 * refusal.
 */

interface Submitted {
  readonly companyId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string;
}

export function ReportScreen({
  locale,
  messages,
  definition,
  scopeOptions,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly definition: ReportDefinition;
  readonly scopeOptions: ReadState<ReportScopeOptions>;
}) {
  const companies = scopeOptions.status === 'ok' ? scopeOptions.data.companies : [];
  const branches = scopeOptions.status === 'ok' ? scopeOptions.data.branches : [];
  const onlyCompany = companies.length === 1 ? (companies[0]?.id ?? '') : '';
  const onlyCompanyBranches = branches.filter((branch) => branch.companyId === onlyCompany);
  const [draft, setDraft] = useState<Submitted>({
    companyId: onlyCompany,
    branchId: onlyCompanyBranches.length === 1 ? (onlyCompanyBranches[0]?.id ?? '') : '',
    from: '',
    to: '',
  });
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

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

  const submit = () => {
    const found: Record<string, string> = {};
    if (!companies.some((company) => company.id === draft.companyId)) {
      found['companyId'] = 'reports.run.chooseCompany';
    }
    if (
      !branches.some(
        (branch) => branch.id === draft.branchId && branch.companyId === draft.companyId
      )
    ) {
      found['branchId'] = 'reports.run.chooseBranch';
    }
    if (!isReportDay(draft.from)) found['from'] = 'reports.run.needDay';
    if (!isReportDay(draft.to)) found['to'] = 'reports.run.needDay';
    if (isReportDay(draft.from) && isReportDay(draft.to) && !isReportPeriod(draft.from, draft.to)) {
      // The half-open rule, said where it was broken. `to` is EXCLUDED, so an
      // equal pair covers no day at all — and an operator who meant one day has
      // to name the day after it.
      found['to'] = 'reports.run.toAfterFrom';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitted({ ...draft });
  };

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key === undefined ? undefined : translate(messages, key as keyof Messages);
  };

  const chosenBranch = branches.find((branch) => branch.id === submitted?.branchId) ?? null;
  const chosenCompany = companies.find((company) => company.id === submitted?.companyId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeading title={title} code={definition.reportCode} />

      <form
        noValidate
        aria-label={translate(messages, 'reports.run.formLabel')}
        className="rounded-lg border border-border bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={translate(messages, 'reports.run.company')}
            options={companies.map((company) => ({ value: company.id, label: company.legalName }))}
            placeholder={translate(messages, 'form.select.placeholder')}
            required
            value={draft.companyId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, companyId: event.target.value, branchId: '' }))
            }
            error={errorFor('companyId')}
          />
          <SelectField
            label={translate(messages, 'reports.run.branch')}
            options={branches
              .filter((branch) => branch.companyId === draft.companyId)
              .map((branch) => ({ value: branch.id, label: branch.name }))}
            placeholder={translate(messages, 'form.select.placeholder')}
            required
            disabled={!draft.companyId}
            value={draft.branchId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, branchId: event.target.value }))
            }
            error={errorFor('branchId')}
          />
          <TextField
            type="date"
            label={translate(messages, 'reports.run.from')}
            description={translate(messages, 'reports.run.fromHint')}
            required
            value={draft.from}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
            error={errorFor('from')}
          />
          <TextField
            type="date"
            label={translate(messages, 'reports.run.to')}
            description={translate(messages, 'reports.run.toHint')}
            required
            value={draft.to}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            error={errorFor('to')}
          />
        </div>
        <p className="mt-3 text-caption text-text-muted" lang={locale}>
          {translate(messages, 'reports.run.periodRule')}
        </p>
        <div className="mt-4">
          <button type="submit" className={REPORT_PRIMARY_BUTTON}>
            {translate(messages, 'reports.run.show')}
          </button>
        </div>
      </form>

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
          key={JSON.stringify(submitted)}
          locale={locale}
          messages={messages}
          reportCode={definition.reportCode}
          submitted={submitted}
          companyName={chosenCompany?.legalName ?? null}
          branchName={chosenBranch?.name ?? null}
        />
      )}
    </div>
  );
}

/** The report's name, with its code shown as the code it is. */
function ReportHeading({ title, code }: { readonly title: string | null; readonly code: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className="text-section-title font-medium text-text-primary">
        {title === null ? <MachineName value={code} /> : <bdi>{title}</bdi>}
      </h2>
      {title === null ? null : <MachineName value={code} />}
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
  companyName,
  branchName,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportCode: string;
  readonly submitted: Submitted;
  readonly companyName: string | null;
  readonly branchName: string | null;
}) {
  const { companyId, branchId, from, to } = submitted;
  const read = useCallback(
    (cursor: string | null) =>
      runReport({
        reportCode,
        companyId,
        branchId,
        from,
        to,
        cursor,
        limit: REPORT_PAGE_SIZE,
      }),
    [reportCode, companyId, branchId, from, to]
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
          <MachineName value={run.period.timezone} />
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
          ) : (
            <MachineName value={run.freshness} />
          )}
        </ContextFact>
        <ContextFact label={translate(messages, 'reports.context.generatedAt')}>
          <span dir="ltr">{run.generatedAt}</span>
        </ContextFact>
      </dl>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.context.periodNote')}
      </p>

      {groups.length === 0 ? null : (
        <GroupTable messages={messages} groups={groups} locale={locale} />
      )}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.run.noRows')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse">
            <caption className="sr-only">{translate(messages, 'reports.run.rowsCaption')}</caption>
            <thead className="bg-table-header">
              <tr>
                {run.columns.map((column) => {
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
                  {run.columns.map((column) => (
                    <td key={column.key} className={REPORT_TABLE_CELL}>
                      <CellValue
                        locale={locale}
                        messages={messages}
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
            {groups.map((group) => (
              <tr key={JSON.stringify(group.key)} className="border-t border-border-subtle">
                <td className={REPORT_TABLE_CELL}>
                  {group.label === null ? (
                    <span className="flex flex-col gap-1">
                      {keyNames.map((name) => {
                        if (!(name in group.key)) return null;
                        const heading = fieldHeading(messages, name);
                        const value = group.key[name] ?? null;
                        return (
                          <span key={name} className="text-caption text-text-secondary">
                            {heading === null ? <MachineName value={name} /> : heading}
                            {': '}
                            {value === null ? (
                              translate(messages, 'reports.groups.unnamed')
                            ) : (
                              <MachineName value={value} />
                            )}
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    <bdi>{group.label}</bdi>
                  )}
                </td>
                {measureNames.map((name) => {
                  const measure = group.measures[name];
                  return (
                    <td key={name} className={REPORT_TABLE_CELL}>
                      {measure === undefined ? (
                        <span className="text-text-muted" lang={locale}>
                          {translate(messages, 'reports.groups.noMeasure')}
                        </span>
                      ) : (
                        <span dir="ltr">{measure}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
  column,
  row,
  cell,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
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
    // As sent. See the screen's docblock: a browser-local reformatting would put
    // a row in a different day from the one the report counted it in.
    return cell.value === null ? (
      <span className="text-text-muted" lang={locale}>
        {translate(messages, 'reports.cell.none')}
      </span>
    ) : (
      <span dir="ltr">{cell.value}</span>
    );
  }

  if (
    column.kind === 'count' ||
    column.kind === 'duration' ||
    column.kind === 'quantity' ||
    column.kind === 'money'
  ) {
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
  if (cell.label !== null) return <bdi>{cell.label}</bdi>;
  if (cell.value !== null) return <MachineName value={cell.value} />;
  return (
    <span className="text-text-muted" lang={locale}>
      {translate(messages, 'reports.cell.none')}
    </span>
  );
}
