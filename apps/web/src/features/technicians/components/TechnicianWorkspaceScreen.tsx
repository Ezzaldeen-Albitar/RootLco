'use client';

import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import {
  useServerTable,
  type ServerPage,
  type ServerTable,
} from '@/components/data-table/use-server-table';
import { MuiEmptyState } from '@/components/states/MuiStates';
import type { BranchTarget } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import {
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import {
  assignmentRoleLabel,
  jobStateLabel,
  workOrderStateLabel,
} from '@/features/work-orders/work-orders-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { readMyQueue } from '../api';
import type { TechnicianQueueEntry } from '../technicians-contract';
import { JobWorkPanel, type WorkspaceCapabilities } from './JobWorkPanel';

/**
 * The technician's own workspace (P1-29, `W4`) — `tech.technician-me-queue`
 * rendered as the work assigned to the signed-in technician, and one job at a
 * time opened for execution.
 *
 * ## Nothing is requested until a branch is named
 *
 * `companyId` and `branchId` are REQUIRED by the operation as its authorization
 * target, exactly as on the work-order board. The branch is the working
 * context's named selection; under "All my branches" — which this read does
 * not serve — the screen says so in words and reads nothing.
 *
 * ## The queue is NOT paged, and this screen does not pretend it is
 *
 * The backend parses `limit` and discards it; the response is `{ items }` with
 * no cursor. So the grid is told the read honours no page size and no sort,
 * and offers neither — every assigned job is on the one page, and a note says
 * so. A paging control on this read would be a control that does nothing.
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * The queue is `OperationalGrid` over `useServerTable`: the grid's own
 * refused, unavailable (with a retry — a throttled or unanswered read
 * included), ended-session and failed states, and each row's "Open" named with
 * the job and its work order, so ten rows are ten different controls. The
 * results are keyed on the branch and the working-context version, so a branch
 * switch drops the previous branch's rows, its open job and any late answer.
 *
 * ## States are said in words
 *
 * The platform's job and work-order states and the two assignment roles are
 * said in the reader's language (browser QA row B.S3 — the queue printed
 * `in_progress` and `primary` as written); a code a workshop added keeps its
 * code, because a translation table keyed on a tenant's own configuration
 * would be a second, rotting copy of it.
 */
export function TechnicianWorkspaceScreen({
  locale,
  messages,
  capabilities,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly capabilities: WorkspaceCapabilities;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <WorkingBranchField
        messages={messages}
        label={translate(messages, 'technicians.workspace.branch')}
      />

      {branch.kind === 'ready' ? (
        <Workspace
          key={`${context.version}:${branch.target.companyId}/${branch.target.branchId}`}
          locale={locale}
          messages={messages}
          target={branch.target}
          capabilities={capabilities}
        />
      ) : (
        <RequiresConcreteBranch
          messages={messages}
          state={branch}
          testId="technician-queue-blocked"
        />
      )}
    </div>
  );
}

/** The queue, and the one job opened from it, for ONE branch. */
function Workspace({
  locale,
  messages,
  target,
  capabilities,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: BranchTarget;
  readonly capabilities: WorkspaceCapabilities;
}) {
  const load = useCallback(async (): Promise<ServerPage<TechnicianQueueEntry>> => {
    const read = await readMyQueue(target);
    if (read.status !== 'ok') {
      return {
        status: read.status,
        rows: [],
        nextCursor: null,
        hasMore: false,
        correlationId: read.correlationId,
      };
    }
    // The whole set: the read is not paged, so there is nothing after it.
    return {
      status: 'ok',
      rows: read.data.items,
      nextCursor: null,
      hasMore: false,
      correlationId: read.correlationId,
      total: read.data.items.length,
    };
  }, [target]);
  // Two server reads: the queue route re-reads the caller's scope first.
  const read = useServerTable<TechnicianQueueEntry>(load, {
    initial: INITIAL_REQUEST,
    serverReads: 2,
  });
  const table: ServerTable<TechnicianQueueEntry> = {
    ...read,
    honours: { pageSize: false, sort: false },
  };
  const [selected, setSelected] = useState<string | null>(null);

  const rows = table.response?.rows ?? [];
  const open =
    selected === null ? null : (rows.find((row) => row.assignmentId === selected) ?? null);

  if (open !== null) {
    return (
      <JobWorkPanel
        locale={locale}
        messages={messages}
        target={target}
        entry={open}
        capabilities={capabilities}
        onBack={() => {
          setSelected(null);
          table.refresh();
        }}
      />
    );
  }

  return (
    <Queue
      locale={locale}
      messages={messages}
      table={table}
      onOpen={setSelected}
      onReload={table.refresh}
    />
  );
}

/** A work order's number, or the sentence for an order that has none yet. */
export function workOrderNumberText(messages: Messages, entry: TechnicianQueueEntry): string {
  return entry.displayNumber ?? translate(messages, 'workOrders.queue.column.noReference');
}

/** The assigned jobs, every one of them, newest assignment first as the backend orders them. */
function Queue({
  locale,
  messages,
  table,
  onOpen,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ServerTable<TechnicianQueueEntry>;
  readonly onOpen: (assignmentId: string) => void;
  readonly onReload: () => void;
}) {
  const t = useCallback((key: string) => translateDynamic(messages, key), [messages]);

  const columns = useMemo<readonly OperationalColumn<TechnicianQueueEntry>[]>(
    () => [
      {
        id: 'job',
        headerKey: 'technicians.workspace.job',
        flex: 2,
        cell: (row) => <bdi className="font-medium">{row.jobTitle}</bdi>,
      },
      {
        id: 'jobState',
        headerKey: 'technicians.workspace.jobState',
        cell: (row) => jobStateLabel(row.jobState, t),
      },
      {
        id: 'workOrder',
        headerKey: 'technicians.workspace.workOrder',
        cell: (row) => (
          <span className="flex flex-col">
            {row.displayNumber ? (
              <code className="font-mono text-caption" dir="ltr">
                {row.displayNumber}
              </code>
            ) : (
              <span className="text-text-muted">{workOrderNumberText(messages, row)}</span>
            )}
            <span className="text-caption text-text-muted">
              {workOrderStateLabel(row.workOrderState, [], t)}
            </span>
          </span>
        ),
      },
      {
        id: 'role',
        headerKey: 'technicians.workspace.role',
        hideBelow: 'md',
        cell: (row) => assignmentRoleLabel(row.assignmentRole, t),
      },
      {
        id: 'since',
        headerKey: 'technicians.workspace.since',
        hideBelow: 'md',
        cell: (row) => <bdi>{formatDateTime(row.validFrom, locale)}</bdi>,
      },
    ],
    [locale, messages, t]
  );

  const rowActions = useCallback(
    (row: TechnicianQueueEntry): readonly RowAction[] => [
      {
        kind: 'button',
        label: translate(messages, 'technicians.workspace.open'),
        onClick: () => onOpen(row.assignmentId),
        about: `${row.jobTitle} · ${workOrderNumberText(messages, row)}`,
      },
    ],
    [messages, onOpen]
  );

  return (
    <section aria-labelledby="technician-queue-heading" className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="technician-queue-heading"
          className="text-section-title font-medium text-text-primary"
        >
          {translate(messages, 'technicians.workspace.queueHeading')}
        </h2>
        <Button type="button" variant="outlined" onClick={onReload}>
          {translate(messages, 'technicians.workspace.reload')}
        </Button>
      </div>
      {/* The truthful description of this read: unpaged, complete, not a page of anything. */}
      <p className="text-caption text-text-muted">
        {translate(messages, 'technicians.workspace.queueNote')}
      </p>
      <OperationalGrid<TechnicianQueueEntry>
        messages={messages}
        locale={locale}
        label={translate(messages, 'technicians.workspace.queueHeading')}
        columns={columns}
        rowId={(row) => row.assignmentId}
        table={table}
        rowActions={rowActions}
        suppressEmptyState
        // The whole set, one answer: no pager to offer.
        unpaged
        testId="technician-queue-grid"
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="technicians.workspace.emptyTitle"
          descriptionKey="technicians.workspace.emptyDescription"
          testId="technician-queue-empty"
        />
      ) : null}
    </section>
  );
}
