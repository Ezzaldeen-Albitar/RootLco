'use client';

import { useEffect, useState } from 'react';
import { SelectField } from '@/components/forms/Field';
import {
  BackendUnavailableState,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { BranchTarget, ItemsOnly, ReadState } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
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
 * target, exactly as on the work-order board. When the session resolves to one
 * company and one branch there is nothing to choose and the queue loads at
 * once; otherwise the technician names the branch and the read is issued then.
 *
 * ## The queue is NOT paged, and this screen does not pretend it is
 *
 * The backend parses `limit` and discards it; the response is `{ items }` with
 * no cursor. So there is no "next page" here, no page size, no count of pages —
 * every assigned job is listed, and a note says so. A paging control on this
 * read would be a control that does nothing, which is a lie with a button.
 *
 * ## `state` codes render as codes
 *
 * `wo.job_states` and `wo.work_order_states` are tenant-extensible. A
 * translation table keyed on a tenant's own configuration would be a second,
 * rotting copy of it.
 */
export function TechnicianWorkspaceScreen({
  locale,
  messages,
  companyIds,
  branchIds,
  capabilities,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The session's resolved scope — server-resolved, never asserted back. */
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  readonly capabilities: WorkspaceCapabilities;
}) {
  const single =
    companyIds.length === 1 && branchIds.length === 1
      ? { companyId: companyIds[0] ?? '', branchId: branchIds[0] ?? '' }
      : null;

  const [draft, setDraft] = useState<BranchTarget>({
    companyId: companyIds.length === 1 ? (companyIds[0] ?? '') : '',
    branchId: branchIds.length === 1 ? (branchIds[0] ?? '') : '',
  });
  const [target, setTarget] = useState<BranchTarget | null>(single);
  const [queue, setQueue] = useState<ReadState<ItemsOnly<TechnicianQueueEntry>> | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (target === null) return;
    let cancelled = false;
    void readMyQueue(target).then((next) => {
      if (!cancelled) setQueue(next);
    });
    return () => {
      cancelled = true;
    };
  }, [target, reload]);

  const refresh = () => setReload((n) => n + 1);

  const submitTarget = () => {
    if (draft.companyId.length === 0 || draft.branchId.length === 0) return;
    setSelected(null);
    setQueue(null);
    setTarget({ companyId: draft.companyId, branchId: draft.branchId });
  };

  return (
    <div className="flex min-h-0 flex-col gap-6">
      {single === null ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitTarget();
          }}
          noValidate
          className="flex flex-wrap items-end gap-3"
        >
          <SelectField
            label={translate(messages, 'technicians.workspace.company')}
            value={draft.companyId}
            onChange={(event) => setDraft({ ...draft, companyId: event.target.value })}
            options={companyIds.map((id) => ({ value: id, label: id }))}
            placeholder={translate(messages, 'technicians.workspace.company')}
            required
          />
          <SelectField
            label={translate(messages, 'technicians.workspace.branch')}
            value={draft.branchId}
            onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}
            options={branchIds.map((id) => ({ value: id, label: id }))}
            placeholder={translate(messages, 'technicians.workspace.branch')}
            required
          />
          <button type="submit" className={SECONDARY_BUTTON}>
            {translate(messages, 'technicians.workspace.showQueue')}
          </button>
        </form>
      ) : null}

      {target === null ? null : queue === null ? (
        <LoadingState messages={messages} />
      ) : queue.status === 'denied' ? (
        <PermissionDeniedState
          messages={messages}
          correlationId={queue.correlationId ?? undefined}
        />
      ) : queue.status === 'expired' ? (
        <SessionExpiredState messages={messages} />
      ) : queue.status === 'unavailable' ? (
        <BackendUnavailableState
          messages={messages}
          correlationId={queue.correlationId ?? undefined}
        />
      ) : queue.status !== 'ok' ? (
        <ErrorState messages={messages} correlationId={queue.correlationId ?? undefined} />
      ) : selected !== null && queue.data.items.some((entry) => entry.assignmentId === selected) ? (
        <JobWorkPanel
          locale={locale}
          messages={messages}
          target={target}
          entry={queue.data.items.find((entry) => entry.assignmentId === selected)!}
          capabilities={capabilities}
          onBack={() => {
            setSelected(null);
            refresh();
          }}
        />
      ) : (
        <Queue
          locale={locale}
          messages={messages}
          items={queue.data.items}
          onOpen={setSelected}
          onReload={refresh}
        />
      )}
    </div>
  );
}

export const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

/** The assigned jobs, every one of them, newest assignment first as the backend orders them. */
function Queue({
  locale,
  messages,
  items,
  onOpen,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly items: readonly TechnicianQueueEntry[];
  readonly onOpen: (assignmentId: string) => void;
  readonly onReload: () => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        messages={messages}
        titleKey="technicians.workspace.emptyTitle"
        descriptionKey="technicians.workspace.emptyDescription"
        action={
          <button type="button" onClick={onReload} className={SECONDARY_BUTTON}>
            {translate(messages, 'technicians.workspace.reload')}
          </button>
        }
      />
    );
  }

  return (
    <section aria-labelledby="technician-queue-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="technician-queue-heading"
          className="text-section-title font-medium text-text-primary"
        >
          {translate(messages, 'technicians.workspace.queueHeading')}
        </h2>
        <button type="button" onClick={onReload} className={SECONDARY_BUTTON}>
          {translate(messages, 'technicians.workspace.reload')}
        </button>
      </div>
      {/* The truthful description of this read: unpaged, complete, not a page of anything. */}
      <p className="text-caption text-text-muted">
        {translate(messages, 'technicians.workspace.queueNote')}
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((entry) => (
          <li
            key={entry.assignmentId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-body font-medium text-text-primary">{entry.jobTitle}</span>
              <span className="text-caption text-text-secondary">
                {translate(messages, 'technicians.workspace.workOrder')}{' '}
                {entry.displayNumber ?? entry.workOrderId} · {entry.workOrderState}
              </span>
              <span className="text-caption text-text-secondary">
                {translate(messages, 'technicians.workspace.jobState')} {entry.jobState} ·{' '}
                {translate(messages, 'technicians.workspace.role')} {entry.assignmentRole} ·{' '}
                {translate(messages, 'technicians.workspace.since')}{' '}
                {formatDateTime(entry.validFrom, locale)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpen(entry.assignmentId)}
              className={SECONDARY_BUTTON}
            >
              {translate(messages, 'technicians.workspace.open')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
