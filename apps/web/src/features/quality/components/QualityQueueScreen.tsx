'use client';

/**
 * The branch QC queue (P1-29 W8): `qms.qc-record-branch-list` for the branch
 * the operator is working in — a scope is resolved server-side from the
 * session, and the screen only says WHICH of the caller's branches to show.
 * Each row links to the work order's quality and closure view.
 *
 * The branch is the working context's NAMED selection, chosen once in the
 * header. It used to be two selects over raw references on this form, which
 * asked an operator to recognise a branch by a string they could not read.
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * The rows are `OperationalGrid` over `useServerTable`: server mode, no count
 * (`rowCount -1`), the cursor footer walking the page the read handed back, and
 * the grid's own refused, unavailable (with a retry — a throttled or
 * unanswered read included), ended-session and failed states. The result
 * filter is a `FormSelectField` whose value is part of the read's key, so
 * changing it goes back to page one and drops the cursor stack. A branch
 * switch remounts the results (keyed on the branch and the working-context
 * version), so the previous branch's rows and cursors never survive it, and
 * "All my branches" — which this read does not serve — is refused in words.
 *
 * Each row's action names what it opens AND which row it is — the result and
 * the moment it was finalized, then the order's reference (the quality read
 * publishes no work-order number: route checklist, recorded gap 11) — so ten
 * rows are ten different links to assistive technology.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import {
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { BranchTarget } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listQcQueue } from '../api';
import type { QcRecord } from '../quality-contract';

const OVERALL_RESULTS = ['open', 'passed', 'failed'] as const;

export function QualityQueueScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();
  const [overallResult, setOverallResult] = useState('');

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <WorkingBranchField messages={messages} label={translate(messages, 'quality.queue.branch')} />

      {branch.kind === 'ready' ? (
        <section
          aria-labelledby="qc-queue-heading"
          className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="qc-queue-heading" className="text-section-title font-medium text-text-primary">
              {translate(messages, 'quality.queue.heading')}
            </h2>
            {/* A filter, not a form field: it re-reads on change and is never submitted. */}
            <FormSelectField
              name="overallResult"
              label={translate(messages, 'quality.queue.filterResult')}
              value={overallResult}
              onChange={setOverallResult}
              options={OVERALL_RESULTS.map((value) => ({
                value,
                label: translate(messages, `quality.result.${value}`),
              }))}
              placeholder={translate(messages, 'quality.queue.anyResult')}
              testId="qc-queue-filter"
            />
          </div>
          {/*
            Keyed on the branch AND the working-context version, so a branch
            changed in the header throws the previous branch's cursor stack away
            with its rows rather than paging one branch's queue under another
            branch's name.
          */}
          <QueueResults
            key={`${context.version}:${branch.target.companyId}/${branch.target.branchId}`}
            locale={locale}
            messages={messages}
            target={branch.target}
            overallResult={overallResult}
          />
        </section>
      ) : (
        <RequiresConcreteBranch messages={messages} state={branch} testId="qc-queue-blocked" />
      )}
    </div>
  );
}

function QueueResults({
  locale,
  messages,
  target,
  overallResult,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: BranchTarget;
  readonly overallResult: string;
}) {
  const load = useCallback(
    async (request: TableRequest, cursor: string | null): Promise<ServerPage<QcRecord>> => {
      const read = await listQcQueue(
        target,
        { ...(overallResult ? { overallResult } : {}), limit: request.pageSize },
        cursor
      );
      if (read.status !== 'ok') {
        return {
          status: read.status,
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: read.correlationId,
        };
      }
      return {
        status: 'ok',
        rows: read.data.items,
        nextCursor: read.data.nextCursor,
        hasMore: read.data.hasMore,
        correlationId: read.correlationId,
      };
    },
    [target, overallResult]
  );
  // The result filter lives OUTSIDE the table request, so it is the read's key:
  // a change goes back to page one and drops the cursor stack.
  const table = useServerTable<QcRecord>(load, {
    initial: INITIAL_REQUEST,
    loadKey: overallResult,
  });

  const columns = useMemo<readonly OperationalColumn<QcRecord>[]>(
    () => [
      {
        id: 'result',
        headerKey: 'quality.queue.column.result',
        cell: (row) => translateDynamic(messages, `quality.result.${row.overallResult}`),
      },
      {
        id: 'finalizedAt',
        headerKey: 'quality.queue.finalizedAt',
        cell: (row) =>
          row.finalizedAt === null ? (
            <span className="text-text-muted">
              {translate(messages, 'quality.queue.notFinalized')}
            </span>
          ) : (
            <bdi>{formatDateTime(row.finalizedAt, locale)}</bdi>
          ),
      },
      {
        id: 'workOrder',
        headerKey: 'quality.queue.column.workOrder',
        hideBelow: 'md',
        // The order's reference, to tell rows apart: the quality read publishes
        // no work-order number (route checklist, recorded gap 11).
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.workOrderId}
          </code>
        ),
      },
    ],
    [locale, messages]
  );

  const rowActions = useCallback(
    (row: QcRecord): readonly RowAction[] => [
      {
        kind: 'link',
        label: translate(messages, 'quality.queue.openOrder'),
        href: `/${locale}/work-orders/${row.workOrderId}/closure`,
        about: [
          translateDynamic(messages, `quality.result.${row.overallResult}`),
          row.finalizedAt === null ? null : formatDateTime(row.finalizedAt, locale),
          row.workOrderId,
        ]
          .filter((part): part is string => part !== null)
          .join(' · '),
      },
    ],
    [locale, messages]
  );

  return (
    <>
      <OperationalGrid<QcRecord>
        messages={messages}
        locale={locale}
        label={translate(messages, 'quality.queue.heading')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        /*
         * The branch lives OUTSIDE `TableRequest` — it is an authorization
         * target, not a filter an operator applied — so the grid's own empty
         * state would make a claim about the whole branch. The screen states
         * the true sentence below.
         */
        suppressEmptyState
        testId="qc-queue-grid"
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey={overallResult ? 'quality.queue.noneMatchingTitle' : 'quality.queue.emptyTitle'}
          descriptionKey={
            overallResult ? 'quality.queue.noneMatchingBody' : 'quality.queue.emptyBody'
          }
          testId="qc-queue-empty"
        />
      ) : null}
    </>
  );
}
