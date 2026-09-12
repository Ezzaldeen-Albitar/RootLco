'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { runReport } from '../reports-api';
import { fieldHeading, runTitle } from '../report-labels';
import {
  OVERVIEW_ROW_LIMIT,
  OVERVIEW_SECTIONS,
  overviewReportHref,
  type OverviewSection,
} from '../overview-contract';
import {
  initialReportScope,
  reportGroups,
  type ReportDefinition,
  type ReportGroup,
  type ReportRun,
  type ReportScopeOptions,
  type ReportScopeSelection,
} from '../reports-contract';
import {
  ContextFact,
  MachineName,
  REPORT_TABLE_CELL,
  REPORT_TABLE_HEADER,
  ReportFailure,
  ReportLoading,
} from './ReportShell';
import { ReportScopeForm } from './ReportScopeForm';

/**
 * The operational overview of the four approved report domains (P1-31, FE-010
 * and FE-016; Owner decision **D-19** of 2026-09-12).
 *
 * One branch, one period, four sections: work orders by status; recorded
 * technician labour duration; stock received and issued per item and unit; and
 * invoiced, credit-note, receipt, applied, unapplied and outstanding values per
 * currency and document kind. Each section is one run of that domain's own
 * approved report, and each figure is a string that run published.
 *
 * ## Four reads, and not one number of this screen's own
 *
 * The four reports are run together and each one answers for itself. Nothing here
 * adds, nets, divides, rounds, re-scales, ranks or compares anything: no total
 * across the four domains, no figure per day, no share of anything, no change
 * against another period, no score. **D-19** allows only supported, approved
 * calculations and forbids inventing profit, performance scores or trends — and
 * every summary on this screen is computed by PostgreSQL over the WHOLE selection
 * inside the request that asked for it.
 *
 * That is also why each read asks for a single row: the groups are not a summary
 * of the page, so the rows are not needed here at all. The rows belong to the
 * report screen, which the heading of every section links to, carrying this
 * selection so the two cannot disagree about what was asked.
 *
 * ## A section that cannot answer says so, and the others still answer
 *
 * The reads are settled independently. One report the caller may not read leaves
 * the other three showing their own figures, and the refused one says it was
 * refused, with the reference the backend logged. A refusal is never drawn as a
 * zero, an empty table or a dash: "you may not see this" and "there was none of
 * it" are different facts, and an overview that confused them would be the
 * `P1-27-QA-002` defect on a screen a manager makes decisions from.
 *
 * Four states are kept apart, deliberately:
 *
 *  - the report is **not published to this caller**, or is published and the
 *    platform **cannot run it** — no read is issued at all, and the section says
 *    the report has nothing behind it rather than that there was nothing to
 *    report;
 *  - the read was **refused or failed** — the refusal itself, with its reference;
 *  - the run **published no summary** — the section says so, and this side
 *    computes nothing in its place. The one exception is the work-order domain,
 *    whose older envelope publishes the same counts under the field it deprecated;
 *    reading that is reading the server's own answer, not deriving one;
 *  - the run published **an empty summary** — nothing was recorded for this branch
 *    in these days, which is a measurement and is said as one.
 *
 * ## The branch may be fixed by the address, and never by a literal
 *
 * FE-016 is this screen with `?branchId=` naming the branch — **D-19** requires
 * the same overview for the selected branch "with no hard-coded pilot". The branch
 * is resolved against the caller's own authorized directory; one that is not there
 * renders the no-branch body rather than a guess, and there is no default branch
 * anywhere in this feature.
 */
export function ReportOverviewScreen({
  locale,
  messages,
  scopeOptions,
  catalogue,
  fixedBranchId = null,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly scopeOptions: ReadState<ReportScopeOptions>;
  readonly catalogue: ReadState<CursorPage<ReportDefinition>>;
  /** FE-016: the branch named in the address, or nothing. Never a literal. */
  readonly fixedBranchId?: string | null;
}) {
  const [submitted, setSubmitted] = useState<ReportScopeSelection | null>(null);

  if (scopeOptions.status !== 'ok') {
    return (
      <ReportFailure
        messages={messages}
        status={scopeOptions.status}
        correlationId={scopeOptions.correlationId}
      />
    );
  }

  if (catalogue.status !== 'ok') {
    // The catalogue is what says whether each of the four can be run at all. A
    // screen that ran them anyway would turn one refusal into four.
    return (
      <ReportFailure
        messages={messages}
        status={catalogue.status}
        correlationId={catalogue.correlationId}
      />
    );
  }

  const { companies, branches } = scopeOptions.data;
  const reachable = branches.filter((branch) =>
    companies.some((company) => company.id === branch.companyId)
  );
  const fixedBranch =
    fixedBranchId === null ? null : (reachable.find((b) => b.id === fixedBranchId) ?? null);

  if (companies.length === 0 || reachable.length === 0) {
    return (
      <EmptyState
        messages={messages}
        titleKey="reports.run.noScopesTitle"
        descriptionKey="reports.run.noScopesBody"
      />
    );
  }

  if (fixedBranchId !== null && fixedBranch === null) {
    // A branch named in the address that the caller's directory does not hold.
    // The same body as "you have no branch", on purpose: whether that branch
    // exists elsewhere is not something this screen may disclose, and choosing a
    // different branch would answer a question nobody asked.
    return (
      <EmptyState
        messages={messages}
        titleKey="reports.run.noScopesTitle"
        descriptionKey="reports.run.noScopesBody"
      />
    );
  }

  const initial = initialReportScope(
    scopeOptions.data,
    fixedBranch === null ? {} : { branchId: fixedBranch.id }
  );

  return (
    <div className="flex flex-col gap-4">
      <ReportScopeForm
        locale={locale}
        messages={messages}
        options={scopeOptions.data}
        initial={initial}
        submitKey="reports.overview.show"
        fixedBranchId={fixedBranch === null ? null : fixedBranch.id}
        onSubmit={setSubmitted}
      />

      {submitted === null ? (
        <EmptyState
          messages={messages}
          titleKey="reports.overview.idleTitle"
          descriptionKey="reports.overview.idleBody"
        />
      ) : (
        // Mounted only after submission, like the report screen: before a branch
        // and a period are named, the component that would issue the four reads
        // does not exist.
        <OverviewResults
          key={JSON.stringify(submitted)}
          locale={locale}
          messages={messages}
          definitions={catalogue.data.items}
          selection={submitted}
          companyName={companies.find((c) => c.id === submitted.companyId)?.legalName ?? null}
          branchName={reachable.find((b) => b.id === submitted.branchId)?.name ?? null}
        />
      )}
    </div>
  );
}

/** What one section knows after the four reads have settled. */
type SectionOutcome = ReadState<ReportRun> | 'unreachable';

/**
 * The first run that answered, in the order the overview shows its sections.
 *
 * Its period, zone, filter context and freshness are the banner. All four runs
 * carry the same selection, so the first answer states it once — and when none
 * answered there is nothing to state, which is why this may return nothing.
 */
function firstPublishedRun(outcomes: Readonly<Record<string, SectionOutcome>>): ReportRun | null {
  for (const section of OVERVIEW_SECTIONS) {
    const outcome = outcomes[section.reportCode];
    if (outcome === undefined || outcome === 'unreachable') continue;
    if (outcome.status === 'ok') return outcome.data;
  }
  return null;
}

/** The caller's own catalogue entry for a code, or nothing at all. */
function definitionFor(
  definitions: readonly ReportDefinition[],
  reportCode: string
): ReportDefinition | null {
  return definitions.find((definition) => definition.reportCode === reportCode) ?? null;
}

function OverviewResults({
  locale,
  messages,
  definitions,
  selection,
  companyName,
  branchName,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly definitions: readonly ReportDefinition[];
  readonly selection: ReportScopeSelection;
  readonly companyName: string | null;
  readonly branchName: string | null;
}) {
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, SectionOutcome>> | null>(null);

  useEffect(() => {
    let live = true;
    const runnable = OVERVIEW_SECTIONS.filter((section) => {
      const definition = definitionFor(definitions, section.reportCode);
      return definition !== null && definition.executable;
    });

    const read = async () => {
      /*
       * Settled, not raced and not chained.
       *
       * `Promise.all` would discard three good answers because of one refusal,
       * and a sequence would make the slowest report decide when the first one is
       * readable. Each entry below is one report answering for itself; a promise
       * that REJECTED (rather than answering a refusal) is recorded as a failure
       * of that section alone.
       */
      const settled = await Promise.allSettled(
        runnable.map((section) =>
          runReport({
            reportCode: section.reportCode,
            companyId: selection.companyId,
            branchId: selection.branchId,
            from: selection.from,
            to: selection.to,
            cursor: null,
            limit: OVERVIEW_ROW_LIMIT,
          })
        )
      );
      if (!live) return;
      const next: Record<string, SectionOutcome> = {};
      runnable.forEach((section, index) => {
        const result = settled[index];
        next[section.reportCode] =
          result !== undefined && result.status === 'fulfilled'
            ? result.value
            : { status: 'error', correlationId: null };
      });
      setOutcomes(next);
    };

    void read();
    return () => {
      live = false;
    };
  }, [definitions, selection]);

  if (outcomes === null) return <ReportLoading messages={messages} />;

  /*
   * The context banner is the FIRST successful run's own — D-17 requires the
   * period, the zone it was resolved in and the filter context to travel with the
   * result. All four runs carry the same selection, and every figure below is
   * displayed inside the section whose run published it, so one banner states the
   * period once rather than four times. When no run succeeded there is no banner:
   * a period drawn from the form would be this screen asserting what the server
   * answered over.
   */
  const context = firstPublishedRun(outcomes);

  return (
    <section aria-labelledby="report-overview-heading" className="flex flex-col gap-4">
      <h3 id="report-overview-heading" className="sr-only">
        {translate(messages, 'reports.overview.resultsHeading')}
      </h3>

      {context === null ? null : (
        <>
          <dl className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
            <ContextFact label={translate(messages, 'reports.context.from')}>
              <span dir="ltr">{context.period.from}</span>
            </ContextFact>
            <ContextFact label={translate(messages, 'reports.context.to')}>
              <span dir="ltr">{context.period.to}</span>
            </ContextFact>
            <ContextFact label={translate(messages, 'reports.context.timezone')}>
              <MachineName value={context.period.timezone} />
            </ContextFact>
            <ContextFact label={translate(messages, 'reports.context.company')}>
              {companyName === null ? (
                <MachineName value={context.filters?.companyId ?? selection.companyId} />
              ) : (
                <bdi>{companyName}</bdi>
              )}
            </ContextFact>
            <ContextFact label={translate(messages, 'reports.context.branch')}>
              {context.branch !== undefined ? (
                <bdi>{context.branch.name}</bdi>
              ) : branchName === null ? (
                <MachineName value={context.filters?.branchId ?? selection.branchId} />
              ) : (
                <bdi>{branchName}</bdi>
              )}
            </ContextFact>
            <ContextFact label={translate(messages, 'reports.context.freshness')}>
              {context.freshness === 'live' ? (
                translate(messages, 'reports.context.freshness.live')
              ) : (
                <MachineName value={context.freshness} />
              )}
            </ContextFact>
            <ContextFact label={translate(messages, 'reports.context.generatedAt')}>
              <span dir="ltr">{context.generatedAt}</span>
            </ContextFact>
          </dl>
          <p className="text-caption text-text-muted" lang={locale}>
            {translate(messages, 'reports.context.periodNote')}
          </p>
        </>
      )}

      {OVERVIEW_SECTIONS.map((section) => (
        <OverviewSectionPanel
          key={section.reportCode}
          locale={locale}
          messages={messages}
          section={section}
          definition={definitionFor(definitions, section.reportCode)}
          outcome={outcomes[section.reportCode] ?? 'unreachable'}
          selection={selection}
        />
      ))}

      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.overview.serverNote')}
      </p>
    </section>
  );
}

/**
 * One section: one approved report, its summary, and a way into the report itself.
 *
 * The heading is the report's own name and the link carries the whole selection,
 * so the rows an operator opens are the rows the figure was read over.
 */
function OverviewSectionPanel({
  locale,
  messages,
  section,
  definition,
  outcome,
  selection,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly section: OverviewSection;
  readonly definition: ReportDefinition | null;
  readonly outcome: SectionOutcome;
  readonly selection: ReportScopeSelection;
}) {
  const headingId = `overview-section-${section.reportCode}`;
  const title = runTitle(messages, section.titleKey);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={headingId} className="text-label font-medium text-text-primary">
          {title === null ? <MachineName value={section.reportCode} /> : <bdi>{title}</bdi>}
        </h4>
        <Link
          href={overviewReportHref(locale, section.reportCode, selection)}
          className="text-body text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'reports.overview.openReport')}
        </Link>
      </div>
      <p className="text-caption text-text-muted" lang={locale}>
        {translateDynamic(messages, section.captionKey)}
      </p>
      <SectionBody
        locale={locale}
        messages={messages}
        section={section}
        caption={title ?? section.reportCode}
        definition={definition}
        outcome={outcome}
      />
    </section>
  );
}

/** The four states a section can be in, each said as itself. */
function SectionBody({
  locale,
  messages,
  section,
  caption,
  definition,
  outcome,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly section: OverviewSection;
  /** The table's accessible name: the report's own, so four tables are four. */
  readonly caption: string;
  readonly definition: ReportDefinition | null;
  readonly outcome: SectionOutcome;
}) {
  if (definition === null) {
    // Not in the caller's catalogue: unknown code, unpublished, archived, or a
    // report this caller may not read. The four are deliberately one answer.
    return (
      <p className="text-body text-text-secondary" lang={locale}>
        {translate(messages, 'reports.overview.notPublished')}
      </p>
    );
  }

  if (!definition.executable) {
    // The platform's own answer. No read was issued for this section.
    return (
      <p className="text-body text-text-secondary" lang={locale}>
        {translate(messages, 'reports.overview.notRunnable')}
      </p>
    );
  }

  if (outcome === 'unreachable') {
    return (
      <p className="text-body text-text-secondary" lang={locale}>
        {translate(messages, 'reports.overview.notRunnable')}
      </p>
    );
  }

  if (outcome.status !== 'ok') {
    return (
      <ReportFailure
        messages={messages}
        status={outcome.status}
        correlationId={outcome.correlationId}
      />
    );
  }

  const run = outcome.data;
  if (run.groups === undefined && section.reportCode !== 'work_orders_by_status') {
    /*
     * The engine published no grouping for this domain.
     *
     * Nothing is derived here in its place — not from the rows on this page, not
     * from the deprecated field that only ever answered for the work-order
     * domain. A summary this side computed would be a figure with no authority
     * behind it, which is the one thing D-4 and D-19 both refuse.
     */
    return (
      <p className="text-body text-text-secondary" lang={locale}>
        {translate(messages, 'reports.overview.noSummary')}
      </p>
    );
  }

  // `reportGroups` reads `groups` when the envelope has one and the deprecated
  // state counts only when it does not — which is the work-order domain's older
  // envelope answering the same question with the same numbers.
  const groups = reportGroups(run);
  if (groups.length === 0) {
    return (
      <p className="text-body text-text-secondary" lang={locale}>
        {translate(messages, 'reports.overview.noneInPeriod')}
      </p>
    );
  }

  return (
    <SummaryTable
      locale={locale}
      messages={messages}
      section={section}
      caption={caption}
      groups={groups}
    />
  );
}

/**
 * The section's summary, as the server grouped it.
 *
 * One column per group key and one per measure. The declared columns come first,
 * in the order `overview-contract.ts` names them, so a section's shape does not
 * depend on which group happened to arrive first; a key or a measure the engine
 * sent that the contract does not name is appended and shown as what it is,
 * because dropping it would be this side hiding something the engine published.
 *
 * A missing measure renders as an ABSENCE. A zero is a measurement and "this
 * group has no such measure" is not — an invoice group carries no receipt total
 * and printing `0` there would state that no money was received.
 */
function SummaryTable({
  locale,
  messages,
  section,
  caption,
  groups,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly section: OverviewSection;
  readonly caption: string;
  readonly groups: readonly ReportGroup[];
}) {
  const keyNames = [...section.keyNames];
  const measureNames = [...section.measureNames];
  for (const group of groups) {
    for (const name of Object.keys(group.key)) {
      if (!keyNames.includes(name)) keyNames.push(name);
    }
    for (const name of Object.keys(group.measures)) {
      if (!measureNames.includes(name)) measureNames.push(name);
    }
  }
  const present = keyNames.filter((name) => groups.some((group) => name in group.key));
  // A single-key group may carry a LABEL — the state's own name rather than its
  // code. With more than one key there is no single thing the label could be
  // naming, so each key is shown as itself.
  const labelled = present.length === 1;

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-table-header">
          <tr>
            {present.map((name) => {
              const heading = fieldHeading(messages, name);
              return (
                <th key={name} scope="col" className={REPORT_TABLE_HEADER}>
                  {heading === null ? <MachineName value={name} /> : heading}
                </th>
              );
            })}
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
              {present.map((name) => (
                <td key={name} className={REPORT_TABLE_CELL}>
                  <GroupKeyValue
                    locale={locale}
                    messages={messages}
                    group={group}
                    name={name}
                    labelled={labelled}
                  />
                </td>
              ))}
              {measureNames.map((name) => {
                const measure = group.measures[name];
                return (
                  <td key={name} className={REPORT_TABLE_CELL}>
                    {measure === undefined ? (
                      <span className="text-text-muted" lang={locale}>
                        {translate(messages, 'reports.groups.noMeasure')}
                      </span>
                    ) : (
                      // Exactly as sent. Nothing here adds, rounds, re-scales,
                      // divides or turns seconds into hours.
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
  );
}

/** One group key value: the operator's word for it when there is one. */
function GroupKeyValue({
  locale,
  messages,
  group,
  name,
  labelled,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly group: ReportGroup;
  readonly name: string;
  readonly labelled: boolean;
}) {
  if (labelled && group.label !== null) return <bdi>{group.label}</bdi>;
  if (!(name in group.key)) {
    return (
      <span className="text-text-muted" lang={locale}>
        {translate(messages, 'reports.cell.missing')}
      </span>
    );
  }
  const value = group.key[name] ?? null;
  if (value === null) {
    return (
      <span className="text-text-muted" lang={locale}>
        {translate(messages, 'reports.groups.unnamed')}
      </span>
    );
  }
  return <MachineName value={value} />;
}
