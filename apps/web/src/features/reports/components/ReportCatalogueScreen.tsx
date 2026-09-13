'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { CursorPage } from '@/lib/api/read-operation';
import { listReportCatalogue } from '../reports-api';
import { reportTitle } from '../report-labels';
import { REPORT_PAGE_SIZE, type ReportDefinition } from '../reports-contract';
import {
  ContextFact,
  MachineName,
  REPORT_SECONDARY_BUTTON,
  REPORT_TABLE_CELL,
  REPORT_TABLE_HEADER,
  ReportFailure,
  ReportLoading,
} from './ReportShell';
import { useCursorTrail } from './use-cursor-trail';

/**
 * The report catalogue (P1-31, FE-011 … FE-014; Owner decision **D-4**).
 *
 * The published report definitions a workshop may read, one page at a time,
 * exactly as `rpt.report-catalogue` returns them.
 *
 * ## What this screen decides: nothing
 *
 * Which reports exist, whether each can be RUN, whose report each one is and
 * what it is called are all fields of the response. This component renders those
 * fields and derives none of them from the others. In particular it does not
 * treat "the platform ships this code" as "this can be run": `executable` is the
 * platform's own answer, and a published configuration whose code the engine does
 * not implement is a definition a reader may see and must not be offered to run.
 *
 * ## The order is the server's
 *
 * The first page carries the code-registered baselines before the workshop's own
 * published rows, and after that the rows ascend by code. The page is therefore
 * NOT sorted throughout, which is stated in the operation's own contract, and
 * nothing here re-sorts it — a client that did would be asserting an ordering the
 * operation does not publish.
 *
 * ## Every row links, including one that cannot be run
 *
 * The link opens the report's own screen, which reads the definition again and
 * states there whether it can be run. A row that could not be opened at all
 * would leave an operator unable to see what a definition says — and a control
 * that exists for some rows and silently vanishes for others reads as a fault
 * rather than as a fact about the report.
 *
 * ## No download is offered, because there is no operation to offer
 *
 * Report export is a prerequisite that has not been built and the export
 * permission is deliberately withheld, so a baseline names no export authority at
 * all. A download assembled in the browser would be a copy of restricted data
 * leaving through a path with no server-side authorization and no record of it.
 */
const catalogueSignals = (page: CursorPage<ReportDefinition>) => ({
  nextCursor: page.nextCursor,
  hasMore: page.hasMore,
});

export function ReportCatalogueScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const read = useCallback(
    (cursor: string | null) => listReportCatalogue({ cursor, limit: REPORT_PAGE_SIZE }),
    []
  );
  const trail = useCursorTrail<CursorPage<ReportDefinition>>(read, catalogueSignals);

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

  const rows = trail.outcome.data.items;
  if (rows.length === 0 && !trail.canGoBack) {
    return (
      <EmptyState
        messages={messages}
        titleKey="reports.catalogue.noneTitle"
        descriptionKey="reports.catalogue.noneBody"
      />
    );
  }

  return (
    <section aria-labelledby="report-catalogue-heading" className="flex flex-col gap-3">
      <h2 id="report-catalogue-heading" className="sr-only">
        {translate(messages, 'reports.catalogue.resultsHeading')}
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse">
          <caption className="sr-only">{translate(messages, 'reports.catalogue.caption')}</caption>
          <thead className="bg-table-header">
            <tr>
              <th scope="col" className={REPORT_TABLE_HEADER}>
                {translate(messages, 'reports.catalogue.column.report')}
              </th>
              <th scope="col" className={REPORT_TABLE_HEADER}>
                {translate(messages, 'reports.catalogue.column.origin')}
              </th>
              <th scope="col" className={REPORT_TABLE_HEADER}>
                {translate(messages, 'reports.catalogue.column.scope')}
              </th>
              <th scope="col" className={REPORT_TABLE_HEADER}>
                {translate(messages, 'reports.catalogue.column.runnable')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((definition) => {
              const title = reportTitle(messages, definition);
              return (
                <tr key={definition.reportCode} className="border-t border-border-subtle">
                  <td className={REPORT_TABLE_CELL}>
                    <Link
                      href={`/${locale}/reports/${encodeURIComponent(definition.reportCode)}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {title === null ? (
                        <MachineName value={definition.reportCode} />
                      ) : (
                        <bdi>{title}</bdi>
                      )}
                    </Link>
                    {title === null ? null : (
                      <span className="mt-1 block">
                        <MachineName value={definition.reportCode} />
                      </span>
                    )}
                  </td>
                  <td className={REPORT_TABLE_CELL}>
                    {/*
                      `platform` and `tenant` are the two values the operation
                      publishes, and each is rendered from its own message. An
                      unrecognised value is rendered as the machine name it is,
                      rather than silently falling into one of the two — which
                      would tell an operator that a report is the platform's when
                      the server said something else.
                    */}
                    {definition.source === 'platform' ? (
                      translate(messages, 'reports.catalogue.origin.platform')
                    ) : definition.source === 'tenant' ? (
                      translate(messages, 'reports.catalogue.origin.workshop')
                    ) : (
                      <MachineName value={definition.source} />
                    )}
                  </td>
                  <td className={REPORT_TABLE_CELL}>
                    <MachineName value={definition.scopeLevel} />
                  </td>
                  <td className={REPORT_TABLE_CELL}>
                    {definition.executable
                      ? translate(messages, 'reports.catalogue.runnable.yes')
                      : translate(messages, 'reports.catalogue.runnable.no')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.catalogue.noFurther')}
        </p>
      ) : null}

      {/*
        Previous and Next, and no page number. The operation returns an
        end-of-set signal and no total, so a position in a count of pages would
        be a number this screen invented.
      */}
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

      <ContextFact label={translate(messages, 'reports.catalogue.orderingLabel')}>
        {translate(messages, 'reports.catalogue.orderingNote')}
      </ContextFact>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.catalogue.noDownload')}
      </p>
    </section>
  );
}
