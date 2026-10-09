'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { MuiEmptyState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { listReportCatalogue } from '../reports-api';
import { reportTitle } from '../report-labels';
import { REPORT_PAGE_SIZE, reportPageSize, type ReportDefinition } from '../reports-contract';
import { ContextFact, MachineName } from './ReportShell';

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
 * Which reports a caller may see at all is the SERVER's answer too: a dataset
 * the caller may not read (Owner decision D17, finance kept from narrow roles) is
 * not in the page, so it has no row, no name and no link here. Nothing on this
 * side hides or adds one.
 *
 * ## The order is the server's
 *
 * The first page carries the code-registered baselines before the workshop's own
 * published rows, and after that the rows ascend by code. The page is therefore
 * NOT sorted throughout, which is stated in the operation's own contract, and
 * nothing here re-sorts it — a client that did would be asserting an ordering the
 * operation does not publish. So no header sorts (`honours.sort`).
 *
 * ## Every row links, including one that cannot be run
 *
 * The link opens the report's own screen, which reads the definition again and
 * states there whether it can be run. A row that could not be opened at all
 * would leave an operator unable to see what a definition says — and a control
 * that exists for some rows and silently vanishes for others reads as a fault
 * rather than as a fact about the report.
 *
 * ## A report is named, not coded (`P1-32-PRE-OD-REPA`)
 *
 * A report this build has words for is shown by its name alone — the platform's
 * title in the reader's language, or the workshop's own label as written — and
 * its level by a word. The code is a machine name and is shown only for a report
 * with no name to show, as the code it is.
 *
 * ## On Material UI (ADR-022)
 *
 * The catalogue read takes a cursor and a size, so it is `OperationalGrid` over
 * `useServerTable` (G1–G9): an unknown count, "Page N", Previous and Next on the
 * cursor stack, rows per page, and the shared states with a retry where retrying
 * can change the answer.
 *
 * ## Export belongs to a submitted report selection
 *
 * The report screen offers the P-12 export command after a branch and period have
 * been submitted, under explicit export permission and published configuration.
 * The catalogue itself has no selection to export. Platform baselines still name
 * no export authority, and the backend commits a disclosure audit before returning
 * any generated file.
 */
export function ReportCatalogueScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const load = useCallback(
    async (request: TableRequest, cursor: string | null): Promise<ServerPage<ReportDefinition>> => {
      const outcome = await listReportCatalogue({
        cursor,
        limit: reportPageSize(request.pageSize),
      });
      if (outcome.status !== 'ok') {
        return {
          status: outcome.status,
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: outcome.correlationId,
        };
      }
      return {
        status: 'ok',
        rows: outcome.data.items,
        nextCursor: outcome.data.nextCursor,
        hasMore: outcome.data.hasMore,
        correlationId: outcome.correlationId,
      };
    },
    []
  );
  const read = useServerTable<ReportDefinition>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: REPORT_PAGE_SIZE },
  });
  // The catalogue takes a cursor and a size; its order is its own.
  const table = { ...read, honours: { pageSize: true, sort: false } };

  const columns = useMemo<readonly OperationalColumn<ReportDefinition>[]>(
    () => [
      {
        id: 'report',
        headerKey: 'reports.catalogue.column.report',
        flex: 2,
        cell: (definition) => {
          const title = reportTitle(messages, definition);
          return (
            <Link
              href={`/${locale}/reports/${encodeURIComponent(definition.reportCode)}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {title === null ? <MachineName value={definition.reportCode} /> : <bdi>{title}</bdi>}
            </Link>
          );
        },
      },
      {
        id: 'origin',
        headerKey: 'reports.catalogue.column.origin',
        // `platform` and `tenant` are the two values the operation publishes,
        // each rendered from its own message. An unrecognised value is rendered
        // as the machine name it is, rather than silently falling into one of
        // the two — which would tell an operator that a report is the
        // platform's when the server said something else.
        cell: (definition) =>
          definition.source === 'platform' ? (
            translate(messages, 'reports.catalogue.origin.platform')
          ) : definition.source === 'tenant' ? (
            translate(messages, 'reports.catalogue.origin.workshop')
          ) : (
            <MachineName value={definition.source} />
          ),
      },
      {
        id: 'scope',
        headerKey: 'reports.catalogue.column.scope',
        cell: (definition) => <ScopeLevel messages={messages} value={definition.scopeLevel} />,
      },
      {
        id: 'runnable',
        headerKey: 'reports.catalogue.column.runnable',
        cell: (definition) =>
          definition.executable
            ? translate(messages, 'reports.catalogue.runnable.yes')
            : translate(messages, 'reports.catalogue.runnable.no'),
      },
    ],
    [locale, messages]
  );

  const settledEmpty =
    table.status === 'idle' && table.response !== null && table.response.rows.length === 0;

  if (settledEmpty && table.request.page === 1) {
    // Nothing published to this caller: said once, with no empty grid under it.
    return (
      <MuiEmptyState
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
      <OperationalGrid<ReportDefinition>
        messages={messages}
        locale={locale}
        label={translate(messages, 'reports.catalogue.caption')}
        columns={columns}
        rowId={(definition) => definition.reportCode}
        table={table}
        suppressEmptyState
        testId="report-catalogue"
      />
      {settledEmpty ? (
        <p className="py-4 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'reports.catalogue.noFurther')}
        </p>
      ) : null}

      <ContextFact label={translate(messages, 'reports.catalogue.orderingLabel')}>
        {translate(messages, 'reports.catalogue.orderingNote')}
      </ContextFact>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'reports.catalogue.noDownload')}
      </p>
    </section>
  );
}

/**
 * A report's level in words: one branch, one company, or the whole organisation
 * — the three the platform defines. A level this build has no word for is shown
 * as the machine name it is, never forced into one of the three.
 */
function ScopeLevel({ messages, value }: { readonly messages: Messages; readonly value: string }) {
  if (value === 'branch') return <>{translate(messages, 'reports.catalogue.scope.branch')}</>;
  if (value === 'company') return <>{translate(messages, 'reports.catalogue.scope.company')}</>;
  if (value === 'tenant') return <>{translate(messages, 'reports.catalogue.scope.tenant')}</>;
  return <MachineName value={value} />;
}
