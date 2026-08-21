'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import { EmptyState } from '@/components/states/States';
import type { BranchTarget } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listReceptions } from '../api';
import {
  RECEPTION_STATUSES,
  type ReceptionListCriteria,
  type ReceptionListEntry,
  type ReceptionStatus,
} from '../receptions-contract';
import { receptionAffordances } from '../check-in/closure';

/**
 * The branch reception queue (`P1-28-FE-001`, the queue half) —
 * `rec.reception-list` as a board of what the workshop is holding.
 *
 * ## Nothing is requested until the operator names a branch
 *
 * `companyId` and `branchId` are REQUIRED query parameters: they are the
 * authorization TARGET (`P1-18-A-01`), and the server deliberately refuses to
 * guess which of a multi-grant operator's branches a board is for. So the
 * results are a separately MOUNTED component, the same structure the appointment
 * calendar and the vehicle search use: before a target is submitted, the
 * component that would issue the read does not exist. "No request before intent"
 * is structural here, not a flag somebody can forget to check.
 *
 * ## Truncation is honest, and there is no total
 *
 * The operation publishes `hasMore` and `nextCursor` and NO count. The table
 * renders exactly that — a page count is never invented, "Next" is offered only
 * while the server says more exists, and the ordering (most recently received
 * first, fixed, no sort) is stated rather than implied by a clickable header.
 *
 * ## Custody is the column that matters, and the affordance is graph-derived
 *
 * `custodyReleasedAt === null` means the workshop still HOLDS the vehicle. A
 * visit sitting in a non-terminal status with the vehicle still held is the
 * abandoned-visit case the two terminal exits exist for, and
 * `uq_reception_visits_open_vehicle` means that vehicle cannot be received again
 * until one of them runs.
 *
 * Which rows may take one is read off `RECEPTION_TRANSITIONS` through
 * `receptionAffordances` — never a hand list of statuses, so a graph change
 * moves the board instead of leaving it confidently wrong.
 *
 * The affordance NAVIGATES; it does not close from the row. That is deliberate
 * and it is a QA-004 decision, not caution: `close-without-work` and `refuse`
 * are `If-Match` guarded, and the version on a board row is a snapshot of
 * whenever the page was fetched. Committing a custody release against it would
 * be presenting a cached version across user-visible staleness — precisely what
 * the rule forbids — and would answer 409 for any operator who left the board
 * open. The link lands on the visit, whose own read supplies the version the
 * command is guarded with.
 */

interface Submitted {
  readonly target: BranchTarget;
  readonly criteria: ReceptionListCriteria;
}

interface Draft {
  readonly companyId: string;
  readonly branchId: string;
  readonly status: '' | ReceptionStatus;
}

export function ReceptionQueueScreen({
  locale,
  messages,
  companyIds,
  branchIds,
  canCreate,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The session's resolved scope — server-resolved, never asserted back. */
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  /** `rec.reception.manage` — gates the offer to open a new visit. */
  readonly canCreate: boolean;
}) {
  const [draft, setDraft] = useState<Draft>({
    companyId: companyIds.length === 1 ? (companyIds[0] ?? '') : '',
    branchId: branchIds.length === 1 ? (branchIds[0] ?? '') : '',
    status: '',
  });
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const statusOptions = useMemo(
    () =>
      RECEPTION_STATUSES.map((status) => ({
        value: status,
        label: translateDynamic(messages, `receptions.status.${status}`),
      })),
    [messages]
  );

  const submit = () => {
    const found: Record<string, string> = {};
    if (draft.companyId.trim().length === 0) found['companyId'] = 'field.required';
    if (draft.branchId.trim().length === 0) found['branchId'] = 'field.required';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitted({
      target: { companyId: draft.companyId.trim(), branchId: draft.branchId.trim() },
      criteria: draft.status ? { status: draft.status } : {},
    });
  };

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        aria-label={translate(messages, 'receptions.queue.formLabel')}
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ScopeField
            messages={messages}
            label={translate(messages, 'receptions.checkIn.company')}
            ids={companyIds}
            value={draft.companyId}
            onChange={(next) => setDraft((d) => ({ ...d, companyId: next }))}
            error={errorFor('companyId')}
          />
          <ScopeField
            messages={messages}
            label={translate(messages, 'receptions.checkIn.branch')}
            ids={branchIds}
            value={draft.branchId}
            onChange={(next) => setDraft((d) => ({ ...d, branchId: next }))}
            error={errorFor('branchId')}
          />
          <SelectField
            label={translate(messages, 'receptions.queue.statusFilter')}
            value={draft.status}
            onChange={(event) =>
              setDraft((d) => ({ ...d, status: event.target.value as Draft['status'] }))
            }
            options={statusOptions}
            placeholder={translate(messages, 'receptions.queue.anyStatus')}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover"
          >
            {translate(messages, 'receptions.queue.show')}
          </button>
          {canCreate ? (
            <Link
              href={`/${locale}/receptions/check-in`}
              className="ms-auto rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
            >
              {translate(messages, 'receptions.queue.checkInVehicle')}
            </Link>
          ) : null}
        </div>
      </form>

      {submitted === null ? (
        <EmptyState
          messages={messages}
          titleKey="receptions.queue.idleTitle"
          descriptionKey="receptions.queue.idleBody"
        />
      ) : (
        // Mounted only after submission — see the docblock. The key restarts the
        // table on a new target or filter rather than paging the old one.
        <QueueResults
          key={JSON.stringify(submitted)}
          locale={locale}
          messages={messages}
          submitted={submitted}
        />
      )}
    </div>
  );
}

/**
 * One scope identifier: a select over the session's resolved ids, or a plain
 * identifier input when the session is UNRESTRICTED (an empty array means
 * "everything in the workspace", and the platform publishes no company/branch
 * directory this screen could turn into names).
 */
function ScopeField({
  messages,
  label,
  ids,
  value,
  onChange,
  error,
}: {
  readonly messages: Messages;
  readonly label: string;
  readonly ids: readonly string[];
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly error: string | undefined;
}) {
  if (ids.length > 0) {
    return (
      <SelectField
        label={label}
        description={translate(messages, 'admin.contractGap.noDirectory')}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={ids.map((id) => ({ value: id, label: id }))}
        placeholder={translate(messages, 'form.select.placeholder')}
        error={error}
      />
    );
  }
  return (
    <TextField
      label={label}
      description={translate(messages, 'receptions.checkIn.scopeUnrestricted')}
      required
      spellCheck={false}
      dir="ltr"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
    />
  );
}

function QueueResults({
  locale,
  messages,
  submitted,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly submitted: Submitted;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listReceptions(submitted.target, submitted.criteria, request, cursor),
    [submitted]
  );
  const table = useServerTable<ReceptionListEntry>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<ReceptionListEntry>[]>(
    () => [
      {
        id: 'displayNumber',
        headerKey: 'receptions.queue.column.reference',
        cell: (row) =>
          row.displayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.displayNumber}
            </code>
          ) : (
            // Never the internal identifier: a reference slot showing one reads
            // as the visit's number.
            <span className="text-text-muted">
              {translate(messages, 'receptions.queue.column.noReference')}
            </span>
          ),
      },
      {
        id: 'receptionStatus',
        headerKey: 'receptions.queue.column.status',
        cell: (row) => translateDynamic(messages, `receptions.status.${row.receptionStatus}`),
      },
      {
        id: 'origin',
        headerKey: 'receptions.queue.column.origin',
        cell: (row) => translateDynamic(messages, `receptions.origin.${row.origin}`),
      },
      {
        id: 'vehicle',
        headerKey: 'receptions.queue.column.vehicle',
        cell: (row) =>
          row.vehicleDisplayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.vehicleDisplayNumber}
            </code>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'receptions.queue.column.noVehicleReference')}
            </span>
          ),
      },
      {
        id: 'custodyAcceptedAt',
        headerKey: 'receptions.queue.column.received',
        cell: (row) => <bdi>{formatDateTime(row.custodyAcceptedAt, locale)}</bdi>,
      },
      {
        id: 'custody',
        headerKey: 'receptions.queue.column.custody',
        cell: (row) =>
          row.custodyReleasedAt === null ? (
            <span className="text-body text-text-primary">
              {translate(messages, 'receptions.queue.custodyHeld')}
            </span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'receptions.queue.custodyReleased')}{' '}
              <bdi>{formatDateTime(row.custodyReleasedAt, locale)}</bdi>
            </span>
          ),
      },
    ],
    [locale, messages]
  );

  return (
    <section aria-labelledby="reception-queue-heading" className="flex min-h-0 flex-col gap-2">
      <h2 id="reception-queue-heading" className="sr-only">
        {translate(messages, 'receptions.queue.resultsHeading')}
      </h2>
      <DataTable<ReceptionListEntry>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'receptions.queue.caption')}
        /*
         * The criteria live OUTSIDE `TableRequest` (deliberately: nothing here
         * may reach the address bar), so `isNarrowed` is permanently false and
         * the table's own empty state would make a claim about the whole branch
         * on the evidence of one filter. The screen states the true sentence
         * below instead.
         */
        suppressEmptyState
        rowActions={(row) => (
          <span className="flex flex-wrap gap-3">
            <Link
              href={`/${locale}/receptions/check-in/${row.id}`}
              className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
            >
              {translate(messages, 'receptions.queue.open')}
            </Link>
            {receptionAffordances(row.receptionStatus).closeWithoutWork ||
            receptionAffordances(row.receptionStatus).refuse ? (
              <Link
                href={`/${locale}/receptions/check-in/${row.id}`}
                className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
              >
                {/*
                 * Labelled as NAVIGATION, because that is all it is: the href is
                 * the row's own visit, the same destination as "Open the visit"
                 * beside it, and no release happens from the board.
                 *
                 * It read "End the visit and release the vehicle" (`F2`) — a
                 * link promising a write it cannot perform. The label now says
                 * where it goes and what can be done there; the guarded close is
                 * taken on the visit, against that visit's own version (QA-004).
                 */}
                {translate(messages, 'receptions.queue.releaseVehicle')}
              </Link>
            ) : null}
            <Link
              href={`/${locale}/receptions/check-in/${row.id}/acknowledgement`}
              className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
            >
              {translate(messages, 'receptions.queue.acknowledgement')}
            </Link>
          </span>
        )}
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'receptions.queue.noneMatching')}
        </p>
      ) : null}
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.queue.orderingNote')}
      </p>
    </section>
  );
}
