'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField } from '@/components/forms/Field';
import { EmptyState } from '@/components/states/States';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
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
 * ## The branch is NAMED, and it is named once
 *
 * The pair used to be two controls on this form: a select over raw references,
 * or two free-text boxes for the operator whose grant is not narrowed. It is
 * now the working context's own selection, chosen in the header and shown here
 * by name. "All my branches" is refused rather than guessed — the route schema
 * demands one branch, and picking one on the operator's behalf would put a
 * board on screen for somewhere they did not ask about.
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
  readonly status: '' | ReceptionStatus;
}

export function ReceptionQueueScreen({
  locale,
  messages,
  canCreate,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /**
   * The session's bare references. Accepted so the page did not have to change,
   * and no longer read: the branch is the working context's named selection.
   */
  readonly companyIds?: readonly string[];
  readonly branchIds?: readonly string[];
  /** `rec.reception.manage` — gates the offer to open a new visit. */
  readonly canCreate: boolean;
}) {
  const branch = useBranchTarget();
  const { version } = useWorkingContext();
  const [draft, setDraft] = useState<Draft>({ status: '' });
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  /*
   * A branch changed in the header RE-TARGETS what is on screen.
   *
   * Remounting the results on `version` was half a fix and the dangerous half.
   * `submitted` still held the branch that was current when Show was pressed,
   * so the remount re-issued the read against the OLD branch while the header
   * — and the field above — named the new one. The operator was looking at one
   * branch's work under another branch's name, which is worse than a stale
   * list: it is a confident wrong answer.
   *
   * The filters survive, because they are what the operator asked for and they
   * are not about the branch. The target is replaced, and the key remount
   * throws the cursor stack away with the old page. A selection that is no
   * longer one branch — "all my branches", or nothing chosen — returns the
   * screen to its idle state rather than guessing which branch to read.
   *
   * Adjusted DURING render, React's documented shape for "reset state when an
   * input changes", and the same one `use-server-table` uses for its load key.
   * An effect would paint one frame of the previous branch's rows first.
   */
  const [lastContextVersion, setLastContextVersion] = useState(version);
  if (version !== lastContextVersion) {
    setLastContextVersion(version);
    setSubmitted((current) =>
      current === null || branch.kind !== 'ready' ? null : { ...current, target: branch.target }
    );
  }

  const statusOptions = useMemo(
    () =>
      RECEPTION_STATUSES.map((status) => ({
        value: status,
        label: translateDynamic(messages, `receptions.status.${status}`),
      })),
    [messages]
  );

  const submit = () => {
    // The branch cannot be missing or mistyped any more: it is the header's own
    // selection or it is nothing, and the button is disabled while it is
    // nothing. There is no local pair left to validate.
    if (branch.kind !== 'ready') return;
    setSubmitted({
      target: branch.target,
      criteria: draft.status ? { status: draft.status } : {},
    });
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
          <WorkingBranchField
            messages={messages}
            label={translate(messages, 'receptions.checkIn.branch')}
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
            disabled={branch.kind !== 'ready'}
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
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
        // table on a new target or filter rather than paging the old one, and
        // carries the working-context version so a branch change cannot leave
        // the previous branch's rows on screen under the new heading.
        <QueueResults
          key={`${version}:${JSON.stringify(submitted)}`}
          locale={locale}
          messages={messages}
          submitted={submitted}
        />
      )}
    </div>
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
