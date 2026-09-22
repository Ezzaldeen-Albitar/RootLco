'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { DigitsEcho } from '@/components/forms/DigitsEcho';
import { SelectField, TextField } from '@/components/forms/Field';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import { readDashboardSummary } from '@/features/overview/api';
import { figureOf, type DashboardSummary } from '@/features/overview/overview-contract';
import {
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { BranchScope, CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';
import { IDLE, invalid, type ActionState } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { dayIn, formatInZone, rangeOfDays } from '@/lib/branch-time';
import { formatInteger, intlLocale } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listWorkOrders, readWorkOrderCatalogue } from '../api';
import {
  MAX_WORK_ORDER_SEARCH,
  MIN_WORK_ORDER_SEARCH,
  WORK_ORDER_KINDS,
  finishedStates,
  openStates,
  workOrderStateLabel,
  type WorkOrderKind,
  type WorkOrderListCriteria,
  type WorkOrderListEntry,
  type WorkOrderStateCatalogueEntry,
} from '../work-orders-contract';

/**
 * The work-order board — `wo.work-order-list` as what the workshop is holding
 * open (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * ## It reads on arrival
 *
 * The board used to wait behind a "Show work orders" button. A foreman who
 * opens the work-order board has expressed intent by opening it; the button was
 * a chore between them and the only thing the page is for. What made the button
 * necessary was an unresolvable branch, and the branch is now the working
 * context's own named selection — so there is nothing left to validate before
 * asking.
 *
 * ## The quick views are exactly the ones the operation can be SENT
 *
 * Five board flags exist on the wire and each is backed by a row the schema
 * really keeps: a live job assignment for the caller, a non-`none` parts
 * forward state, a pending additional-work request, a pending quality result,
 * and a closed non-cancellation state. Those five, plus "opened today" over the
 * `openedFrom`/`openedTo` window and the unfiltered board, are the seven views
 * offered here.
 *
 * **Two views that were asked for are not offered, because the operation cannot
 * express them.** `state` on the wire is ONE catalogue code
 * (`z.string().regex(...).optional()`), so "every non-terminal state" is not a
 * request that can be sent; and there is no `completedFrom`/`completedTo`
 * window, so "completed today" is not one either. Filtering a fetched page in
 * the browser would produce short pages and a `hasMore` that lies, which is the
 * failure the backend's own query-time filtering exists to avoid. Both FIGURES
 * are published by `ovw.dashboard-summary-read` and are shown as figures — see
 * below — because a count the platform computed is honest even where a filter
 * does not exist.
 *
 * ## Counts come from the aggregate, never from the page
 *
 * A board holds one page. Counting its rows answers "how many are on this page"
 * and printing that beside a view called "Awaiting parts" states something else
 * entirely. `ovw.dashboard-summary-read` computes each figure as a SQL aggregate
 * over the whole scoped selection inside the RLS-bound transaction; this screen
 * reads it through `features/overview`, which the dashboard wave reuses. A
 * section the caller may not see comes back `unauthorized` and NO figure is
 * rendered — a zero would be a false statement about the workshop instead of a
 * true one about the caller.
 *
 * ## The state label is the tenant's, or the platform's, and never a guess
 *
 * `wo.work_order_states` is tenant-extensible. `wo.work-order-catalogue`
 * publishes the live graph, so which states mean "still here" is DATA — read
 * once per branch — rather than a list in this repository. A code the platform
 * does not define is labelled with the tenant's own `name` from that catalogue,
 * and with neither it is rendered as the opaque token it is.
 *
 * ## No due date exists, so nothing here is late
 *
 * The schema records no due date on a work order. Nothing on this board says
 * "overdue", "due today" or "late", and no control offers to sort by one.
 */

/** The views the operation can actually be sent. See the docblock. */
type ViewKind =
  | 'all'
  | 'openedToday'
  | 'mine'
  | 'awaitingApproval'
  | 'awaitingParts'
  | 'awaitingQuality'
  | 'readyForDelivery';

const VIEW_KINDS: readonly ViewKind[] = [
  'all',
  'openedToday',
  'mine',
  'awaitingApproval',
  'awaitingParts',
  'awaitingQuality',
  'readyForDelivery',
];

/** What the read is asked for: the scope it is addressed to and the filters. */
interface Asked {
  readonly scope: BranchScope;
  readonly filters: WorkOrderListCriteria;
}

/** The flags one view turns on. Everything absent is "did not ask". */
function flagsOf(view: ViewKind): WorkOrderListCriteria {
  switch (view) {
    case 'mine':
      return { assignedToMe: true };
    case 'awaitingApproval':
      return { awaitingApproval: true };
    case 'awaitingParts':
      return { awaitingParts: true };
    case 'awaitingQuality':
      return { awaitingQuality: true };
    case 'readyForDelivery':
      return { readyForDelivery: true };
    case 'all':
    case 'openedToday':
      return {};
  }
}

export function WorkOrderQueueScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /**
   * The session's bare references. Accepted so the page did not have to change,
   * and no longer read: the branch is the working context's named selection.
   */
  readonly companyIds?: readonly string[];
  readonly branchIds?: readonly string[];
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  const [view, setView] = useState<ViewKind>('all');
  const [state, setState] = useState('');
  const [kind, setKind] = useState<'' | WorkOrderKind>('');
  const [term, setTerm] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [openedRange, setOpenedRange] = useState<{ from: string; to: string } | null>(null);
  const [refusal, setRefusal] = useState<ActionState>(IDLE);
  const formRef = useFocusFirstInvalid(refusal);
  const corrections = useClearOnCorrect(refusal);

  const zone =
    (branch.kind === 'ready'
      ? context.branches.find((entry) => entry.id === branch.target.branchId)?.timezone
      : context.branches[0]?.timezone) ?? 'UTC';
  const spansBranches = branch.kind === 'all';

  const scope: BranchScope | null =
    branch.kind === 'ready'
      ? { companyId: branch.target.companyId, branchId: branch.target.branchId }
      : branch.kind === 'all' && context.selection?.companyId
        ? { companyId: context.selection.companyId, branchId: null }
        : null;
  const companyId = scope?.companyId ?? null;
  const branchId = scope?.branchId ?? null;

  /*
   * The tenant's state graph, read once per scope.
   *
   * It changes at tenant-configuration frequency, which is to say almost never,
   * and nothing on this board can label a state without it. Read failures are
   * silent by design: the board still works, and a code simply renders as
   * itself — which is exactly what it did before this read existed.
   */
  const [catalogue, setCatalogue] = useState<readonly WorkOrderStateCatalogueEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    void readWorkOrderCatalogue().then((read) => {
      if (!cancelled && read.status === 'ok') setCatalogue(read.data.workOrderStates);
    });
    return () => {
      cancelled = true;
    };
  }, [context.version]);

  /*
   * The figures, read once per scope and period.
   *
   * `period: 'today'` because the two figures this board shows — how much work
   * is open, and how much finished — are the day's questions. The response
   * carries the zone the day was measured in, and the strip says so.
   */
  const summaryKey =
    companyId === null ? null : `${companyId}:${branchId ?? ''}:${context.version}`;
  const [summary, setSummary] = useState<{
    readonly key: string;
    readonly read: ReadState<DashboardSummary>;
  } | null>(null);
  useEffect(() => {
    if (summaryKey === null || companyId === null) return undefined;
    let cancelled = false;
    void readDashboardSummary({ companyId, branchId }, { period: 'today' }).then((read) => {
      if (!cancelled) setSummary({ key: summaryKey, read });
    });
    return () => {
      cancelled = true;
    };
  }, [summaryKey, companyId, branchId]);

  /*
   * Filed under the scope it was read for, and DISCARDED when the scope moves.
   *
   * Clearing it from the effect would be a synchronous state write inside an
   * effect — a cascading render, and the rule that catches it is right. Holding
   * the key instead means a figure read for one branch can never be rendered
   * beside another branch's board, not even for the frame before the new read
   * lands.
   */
  const sections =
    summary !== null && summary.key === summaryKey && summary.read.status === 'ok'
      ? summary.read.data.sections
      : null;

  const trimmed = term.trim();
  const termIsSearchable = trimmed.length >= MIN_WORK_ORDER_SEARCH;
  const termTooShort = trimmed.length > 0 && !termIsSearchable;

  const today = dayIn(zone);
  const openedWindow =
    view === 'openedToday'
      ? rangeOfDays(zone, today, today)
      : openedRange === null
        ? null
        : rangeOfDays(zone, openedRange.from, openedRange.to);

  /*
   * Built inline on every render — `useSearchRequest` keys on the SERIALISED
   * criteria rather than on the object's identity, so a new object with the same
   * content asks for the same thing. `null` is "there is nothing to ask for",
   * which here means no resolvable scope.
   */
  const asked: Asked | null =
    scope === null
      ? null
      : {
          scope,
          filters: {
            ...flagsOf(view),
            ...(state.trim() === '' ? {} : { state: state.trim() }),
            ...(kind === '' ? {} : { kind }),
            ...(openedWindow === null
              ? {}
              : { openedFrom: openedWindow.from, openedTo: openedWindow.to }),
            ...(termIsSearchable ? { q: trimmed } : {}),
          },
        };

  const load = useCallback(
    async (
      criteria: Asked,
      cursor: string | null
    ): Promise<ReadState<CursorPage<WorkOrderListEntry>>> => {
      const page = await listWorkOrders(criteria.scope, criteria.filters, INITIAL_REQUEST, cursor);
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: { items: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore },
        correlationId: page.correlationId,
      };
    },
    []
  );

  const search = useSearchRequest<WorkOrderListEntry, Asked>({
    criteria: asked,
    load,
    version: context.version,
  });

  const applyOpenedRange = () => {
    if (draftFrom === '' || draftTo === '') {
      setRefusal(
        invalid(
          { [draftFrom === '' ? 'openedFrom' : 'openedTo']: 'workOrders.queue.periodIncomplete' },
          (refusal.attempt ?? 0) + 1
        )
      );
      return;
    }
    if (draftTo < draftFrom) {
      // The operation answers 422 for an inverted window. A 422 arriving as a
      // page-level failure teaches the operator nothing about which box to fix.
      setRefusal(
        invalid({ openedTo: 'workOrders.queue.invertedRange' }, (refusal.attempt ?? 0) + 1)
      );
      return;
    }
    setRefusal(IDLE);
    setOpenedRange({ from: draftFrom, to: draftTo });
  };

  const clearOpenedRange = () => {
    setRefusal(IDLE);
    setDraftFrom('');
    setDraftTo('');
    setOpenedRange(null);
  };

  const clearFilters = () => {
    setView('all');
    setState('');
    setKind('');
    setTerm('');
    clearOpenedRange();
  };

  const errorFor = (field: string): string | undefined => {
    const key = corrections.errorFor(field);
    return key === undefined ? undefined : translateDynamic(messages, key);
  };
  const openedFromError = errorFor('openedFrom');
  const openedToError = errorFor('openedTo');

  const stateGroups = useMemo(
    () => [
      {
        label: translate(messages, 'workOrders.queue.stateGroupOpen'),
        options: openStates(catalogue).map((entry) => ({
          value: entry.code,
          label: workOrderStateLabel(entry.code, catalogue, (key) =>
            translateDynamic(messages, key)
          ),
        })),
      },
      {
        label: translate(messages, 'workOrders.queue.stateGroupFinished'),
        options: finishedStates(catalogue).map((entry) => ({
          value: entry.code,
          label: workOrderStateLabel(entry.code, catalogue, (key) =>
            translateDynamic(messages, key)
          ),
        })),
      },
    ],
    [catalogue, messages]
  );

  const kindOptions = useMemo(
    () =>
      WORK_ORDER_KINDS.map((value) => ({
        value,
        label: translateDynamic(messages, `workOrders.kind.${value}`),
      })),
    [messages]
  );

  /**
   * The figure beside a view's name, or `null` for "no figure exists".
   *
   * Three of the seven views have a matching aggregate; the other four do not,
   * and they show no number rather than a zero or a dash that reads as one.
   */
  const countFor = (kindOfView: ViewKind): number | null => {
    if (sections === null) return null;
    switch (kindOfView) {
      case 'awaitingApproval':
        return figureOf(sections.awaitingApproval);
      case 'awaitingParts':
        return figureOf(sections.awaitingParts);
      case 'readyForDelivery':
        return figureOf(sections.readyForDelivery);
      default:
        return null;
    }
  };

  const columns = useMemo<readonly Column<WorkOrderListEntry>[]>(
    () => [
      {
        id: 'displayNumber',
        headerKey: 'workOrders.queue.column.reference',
        cell: (row) =>
          row.displayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.displayNumber}
            </code>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'workOrders.queue.column.noReference')}
            </span>
          ),
      },
      {
        id: 'customer',
        headerKey: 'workOrders.queue.column.customer',
        cell: (row) =>
          row.customer === null ? (
            // A real and permitted state, not a fault: the visit named no
            // service requester.
            <span className="text-text-muted">
              {translate(messages, 'workOrders.queue.column.noCustomer')}
            </span>
          ) : (
            <span className="flex flex-col">
              <bdi>{row.customer.displayName}</bdi>
              <span className="text-caption text-text-muted">
                {/*
                 * `receptions.partyRole.*`, not a `workOrders.*` copy of it.
                 * The role IS the reception party role — the same frozen
                 * seven-value vocabulary — surfaced on the work order that
                 * visit produced.
                 */}
                {translateDynamic(
                  messages,
                  `receptions.partyRole.${row.customer.relationshipRole}`
                )}
                {row.customer.hasAdditionalParties
                  ? ` · ${translate(messages, 'workOrders.queue.column.moreParties')}`
                  : ''}
              </span>
            </span>
          ),
      },
      {
        id: 'vehicle',
        headerKey: 'workOrders.queue.column.vehicle',
        cell: (row) =>
          row.vehicle.registrationPlate || row.vehicle.makeModel ? (
            <span className="flex flex-col">
              {row.vehicle.registrationPlate ? (
                <code className="font-mono text-caption" dir="ltr">
                  {row.vehicle.registrationPlate}
                </code>
              ) : null}
              {row.vehicle.makeModel ? <bdi>{row.vehicle.makeModel}</bdi> : null}
            </span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'workOrders.queue.column.noVehicleDetail')}
            </span>
          ),
      },
      {
        id: 'state',
        headerKey: 'workOrders.queue.column.state',
        cell: (row) => (
          <bdi>
            {workOrderStateLabel(row.state, catalogue, (key) => translateDynamic(messages, key))}
          </bdi>
        ),
      },
      {
        id: 'assignedTechnician',
        headerKey: 'workOrders.queue.column.technician',
        /*
         * Three different facts, and only one of them is a name.
         *
         * No live assignment at all is an absence of work, not of a person.
         * An assignment whose `displayName` is null is a caller who may not read
         * the user directory — the work order still says somebody holds it. A
         * screen that rendered both as one dash would hide the difference.
         */
        cell: (row) =>
          row.assignedTechnician === null ? (
            <span className="text-text-muted">
              {translate(messages, 'workOrders.queue.column.unassigned')}
            </span>
          ) : row.assignedTechnician.displayName === null ? (
            <span className="text-text-muted">
              {translate(messages, 'workOrders.queue.column.technicianHidden')}
            </span>
          ) : (
            <bdi>{row.assignedTechnician.displayName}</bdi>
          ),
      },
      {
        id: 'openedAt',
        headerKey: 'workOrders.queue.column.opened',
        cell: (row) => <bdi>{formatInZone(row.openedAt, intlLocale(locale), zone)}</bdi>,
      },
      {
        id: 'completedAt',
        headerKey: 'workOrders.queue.column.completed',
        // Null whenever the order is not currently in a terminal state — a
        // reopened order reports null again, which is a fact and not a gap.
        cell: (row) =>
          row.completedAt === null ? (
            <span className="text-text-muted">—</span>
          ) : (
            <bdi>{formatInZone(row.completedAt, intlLocale(locale), zone)}</bdi>
          ),
      },
      {
        id: 'branch',
        headerKey: 'workOrders.queue.column.branch',
        cell: (row) => <bdi>{context.branchName(row.branchId) ?? ''}</bdi>,
      },
    ],
    [catalogue, context, locale, messages, zone]
  );

  const blocked =
    branch.kind === 'unchosen' || branch.kind === 'none' || branch.kind === 'unavailable';
  const spansCompanies = branch.kind === 'all' && scope === null;

  const activeFigure = sections === null ? null : figureOf(sections.activeWorkOrders);
  const completedFigure = sections === null ? null : figureOf(sections.completedInPeriod);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          search.submit();
        }}
        noValidate
        aria-label={translate(messages, 'workOrders.queue.formLabel')}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div
          role="group"
          aria-label={translate(messages, 'workOrders.queue.viewLabel')}
          className="flex flex-wrap items-center gap-2"
        >
          {VIEW_KINDS.map((kindOfView) => {
            const count = countFor(kindOfView);
            return (
              <button
                key={kindOfView}
                type="button"
                aria-pressed={view === kindOfView}
                onClick={() => setView(kindOfView)}
                className={
                  view === kindOfView
                    ? 'rounded-md border border-border bg-primary px-3 py-1.5 text-body text-on-primary transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                    : 'rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                }
              >
                {translateDynamic(messages, `workOrders.queue.view.${kindOfView}`)}
                {count === null ? null : (
                  <span className="ms-2 text-caption">{formatInteger(count, locale)}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/*
            Stated rather than asked, for the reason the reception board states
            it: the branch is the header's own selection, there is one place it
            can be changed, and a board that did not name it would leave the
            operator to remember which branch they are reading.
          */}
          <WorkingBranchField
            messages={messages}
            label={translate(messages, 'workOrders.queue.branch')}
          />
          <SelectField
            label={translate(messages, 'workOrders.queue.stateFilter')}
            description={translate(messages, 'workOrders.queue.stateFilterHelp')}
            value={state}
            onChange={(event) => setState(event.target.value)}
            groups={stateGroups}
            placeholder={translate(messages, 'workOrders.queue.anyState')}
          />
          <SelectField
            label={translate(messages, 'workOrders.queue.kindFilter')}
            value={kind}
            onChange={(event) => setKind(event.target.value as '' | WorkOrderKind)}
            options={kindOptions}
            placeholder={translate(messages, 'workOrders.queue.anyKind')}
          />
          <div className="flex flex-col gap-1">
            <SearchBox
              messages={messages}
              label={translate(messages, 'workOrders.queue.searchLabel')}
              placeholder={translate(messages, 'workOrders.queue.searchPlaceholder')}
              example={translate(messages, 'workOrders.queue.searchExample')}
              value={term}
              onChange={setTerm}
              onSubmit={search.submit}
              busy={search.phase === 'loading'}
              maxLength={MAX_WORK_ORDER_SEARCH}
              {...(termTooShort
                ? { error: translate(messages, 'workOrders.queue.searchTooShort') }
                : {})}
            />
            <DigitsEcho messages={messages} value={term} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            type="date"
            label={translate(messages, 'workOrders.queue.openedFrom')}
            value={draftFrom}
            onChange={(event) => {
              corrections.noteEdited('openedFrom');
              setDraftFrom(event.target.value);
            }}
            {...(openedFromError === undefined ? {} : { error: openedFromError })}
          />
          <TextField
            type="date"
            label={translate(messages, 'workOrders.queue.openedTo')}
            value={draftTo}
            onChange={(event) => {
              corrections.noteEdited('openedTo');
              setDraftTo(event.target.value);
            }}
            {...(openedToError === undefined ? {} : { error: openedToError })}
          />
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={applyOpenedRange}
              className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {translate(messages, 'workOrders.queue.applyOpenedRange')}
            </button>
            {openedRange === null ? null : (
              <button
                type="button"
                onClick={clearOpenedRange}
                className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'workOrders.queue.clearOpenedRange')}
              </button>
            )}
          </div>
        </div>
      </form>

      {/*
        The day's two figures, from the aggregate.

        Shown as figures and not as views, because the operation has no filter
        that could reach either set: `state` is one code and there is no
        completed-date window. A figure the platform computed is honest; a chip
        that pretended to filter would not be.
      */}
      {activeFigure === null && completedFigure === null ? null : (
        <p
          data-testid="work-order-summary-strip"
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2 text-supporting text-text-secondary"
        >
          {activeFigure === null ? null : (
            <span data-testid="figure-active">
              {translate(messages, 'workOrders.queue.figure.active')}{' '}
              <bdi>{formatInteger(activeFigure, locale)}</bdi>
            </span>
          )}
          {completedFigure === null ? null : (
            <span data-testid="figure-completed">
              {translate(messages, 'workOrders.queue.figure.completedToday')}{' '}
              <bdi>{formatInteger(completedFigure, locale)}</bdi>
            </span>
          )}
        </p>
      )}

      {blocked ? (
        // Named apart from the one the branch field renders above it. The
        // second is not duplication — it is the answer arriving where the
        // question was asked, beside the list that cannot be read — and giving
        // them one name is what would make a test unable to say which it means.
        <RequiresConcreteBranch
          messages={messages}
          state={branch}
          testId="work-order-queue-blocked"
        />
      ) : spansCompanies ? (
        <p
          role="status"
          data-testid="work-order-queue-spans-companies"
          className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
        >
          {translate(messages, 'workingContext.spansCompanies')}
        </p>
      ) : (
        <section aria-labelledby="work-order-queue-heading" className="flex min-h-0 flex-col gap-2">
          <h2 id="work-order-queue-heading" className="sr-only">
            {translate(messages, 'workOrders.queue.resultsHeading')}
          </h2>

          <SearchStates
            messages={messages}
            phase={search.phase}
            correlationId={search.correlationId}
            {...(search.phase === 'empty'
              ? {
                  onClearFilters: (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {translate(messages, 'workOrders.queue.clearFilters')}
                    </button>
                  ),
                }
              : {})}
            {...(search.phase === 'unavailable' || search.phase === 'failed'
              ? {
                  retry: (
                    <button
                      type="button"
                      onClick={search.submit}
                      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {translate(messages, 'state.retry')}
                    </button>
                  ),
                }
              : {})}
          />

          {search.phase === 'ready' ? (
            <>
              <DataTable<WorkOrderListEntry>
                messages={messages}
                columns={columns}
                rowId={(row) => row.id}
                request={search.table.request}
                response={search.table.response}
                status={search.table.status}
                onRequestChange={search.table.setRequest}
                onRetry={search.table.refresh}
                correlationId={search.table.correlationId}
                caption={translate(messages, 'workOrders.queue.caption')}
                hiddenColumnIds={spansBranches ? [] : ['branch']}
                suppressEmptyState
                rowActions={(row) => (
                  <span className="flex flex-wrap gap-3">
                    <Link
                      href={`/${locale}/work-orders/${row.id}`}
                      className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                    >
                      {/*
                       * The next action names what can be done where it lands —
                       * it never performs it. Nothing on this board advances a
                       * work order: a row's `recordVersion` is a snapshot of
                       * whenever the page was fetched, and spending it on an
                       * `If-Match` write would answer 409 for any operator who
                       * left the board open. The detail read supplies the
                       * version its own commands are guarded with.
                       *
                       * The label follows the VIEW rather than the row, because
                       * that is where the fact lives: a row carries no
                       * approval state and no delivery readiness, but every row
                       * of the "awaiting approval" view is awaiting one.
                       */}
                      {view === 'awaitingApproval'
                        ? translate(messages, 'workOrders.queue.openForApproval')
                        : view === 'readyForDelivery'
                          ? translate(messages, 'workOrders.queue.openForDelivery')
                          : translate(messages, 'workOrders.queue.open')}
                    </Link>
                  </span>
                )}
              />
              <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
                {translate(messages, 'workOrders.queue.orderingNote')}
              </p>
              {view === 'readyForDelivery' ? (
                <Link
                  href={`/${locale}/delivery`}
                  className="px-2 text-body text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                >
                  {translate(messages, 'workOrders.queue.deliveryQueue')}
                </Link>
              ) : null}
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
