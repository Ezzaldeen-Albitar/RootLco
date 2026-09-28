'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { FilterToolbar, type ToolbarFilter } from '@/components/filters/FilterToolbar';
import { MuiSearchStates, type NoResultsReason } from '@/components/states/MuiStates';
import {
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { BranchScope, CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';
import {
  addDays,
  dayIn,
  formatInZone,
  formatPeriodInZone,
  rangeOfDays,
  zoneLabelAt,
  type CalendarDay,
} from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listAppointments } from '../api';
import {
  APPOINTMENT_STATUSES,
  MAX_APPOINTMENT_SEARCH,
  MIN_APPOINTMENT_SEARCH,
  type AppointmentListCriteria,
  type AppointmentListEntry,
  type AppointmentStatus,
} from '../appointments-contract';

/**
 * The branch calendar (`P1-28-FE-001`) — `apt.appointment-list` as a day queue
 * (Owner directive, `P1-32-PRE-OD-UX`), on the Material UI wrappers (ADR-022).
 *
 * ## It reads on arrival, because arriving IS the request
 *
 * A service adviser who opens the appointment calendar has expressed intent by
 * opening it. Two facts make reading on arrival safe: the branch is the working
 * context's own named selection, so there is nothing to validate before
 * asking; and the period is BOUNDED — today, in the branch's own zone — so the
 * first request is one day of one branch rather than a workshop's whole
 * calendar. "No request before intent" became "no UNBOUNDED request, ever",
 * which is the property that was actually protecting the backend.
 *
 * ## The day is the BRANCH's day, and the times are the branch's times
 *
 * A period boundary is a business date, so the window is composed in
 * `branches[].timezone` — the zone the platform publishes for the branch being
 * read. Reading "all my branches" has no single zone: the first authorized
 * branch's is used and the summary line NAMES it. A zone the directory does not
 * publish falls back to `UTC`, and the line says `UTC`. The times in each row
 * are drawn on that row's own branch clock; under "all my branches", where rows
 * can come from branches on different clocks, each time carries its clock's
 * name.
 *
 * ## The calendar's two views, and chosen days
 *
 * The views are the ones the calendar has always had: **Today** and **the next
 * 7 days** (today plus six forward), as chips with no added "All" — the board
 * is never unbounded. Chosen days are `FilterToolbar`'s own date range: two MIT
 * date pickers on the branch's clock, checked before anything is asked for
 * (both days, the last not before the first), refused on the box to fix with
 * the cursor moved there and the typed days kept. Applying the range puts the
 * calendar on those days and no chip is pressed; choosing a chip or pressing
 * Clear puts the range away. MUI X Scheduler is not used: it is a beta
 * component (ADR-022), and the calendar is a list of appointments, not a grid
 * of hours.
 *
 * ## One box, five things it can match
 *
 * `q` reaches part of the requester's name, the tail of their phone number,
 * part of any plate the vehicle has carried, part of its VIN, or part of the
 * appointment number. It is sent as typed — digits typed on an Arabic keyboard
 * included — and the server folds them. The structured `status` and period
 * controls stay, because they answer a different question.
 *
 * ## The branch may be left unnamed
 *
 * `branchId` is optional on this operation, so "all my branches" is a request
 * the backend documents: the company is named, the branch is omitted, and the
 * API resolves the authorized set one branch at a time against this operation's
 * own code. A selection spanning more than one COMPANY resolves to nothing,
 * because `companyId` is mandatory and there is no honest single answer.
 *
 * ## Truncation is honest
 *
 * The operation publishes `hasMore` and no total. The rows are
 * `OperationalGrid` over `useSearchRequest(...).table`: server pagination, no
 * count (`rowCount` -1), Next only while the server says more exists.
 *
 * ## Check in, and the control this screen does NOT have
 *
 * **Check in** is offered on a `confirmed` row and on no other. That is the
 * transition graph: `rec.reception-create` moves an appointment
 * `confirmed → checked_in`, and any other lifecycle status answers 409
 * `ERR-TRN-001`. There is NO appointment "Confirm" operation anywhere in this
 * contract — confirmation is a side effect of rescheduling — so no control
 * here says it.
 */

/** The calendar's views. Each resolves in the branch zone. */
const PRESETS = ['today', 'next7'] as const;
type Preset = (typeof PRESETS)[number];

/** The period in force: a view, or two chosen days. */
type AppliedPeriod =
  | { readonly kind: Preset }
  | { readonly kind: 'custom'; readonly from: CalendarDay; readonly to: CalendarDay };

const TODAY_PERIOD: AppliedPeriod = { kind: 'today' };

/** What the read is asked for: the scope it is addressed to, and the filters. */
interface Asked {
  readonly scope: BranchScope;
  readonly filters: AppointmentListCriteria;
}

/** A period as the two inclusive instants the route's schema accepts. */
function windowOf(
  period: AppliedPeriod,
  zone: string
): { readonly from?: string; readonly to?: string } {
  const today = dayIn(zone);
  switch (period.kind) {
    case 'today':
      return rangeOfDays(zone, today, today);
    case 'next7':
      // Seven days INCLUDING today, which is what "the next 7 days" means to
      // the person asking. Today plus six forward.
      return rangeOfDays(zone, today, addDays(today, 6));
    case 'custom':
      return rangeOfDays(zone, period.from, period.to);
  }
}

function isPreset(value: string): value is Preset {
  return (PRESETS as readonly string[]).includes(value);
}

export function AppointmentCalendarScreen({
  locale,
  messages,
  canManage,
  canCheckIn,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `apt.appointment.manage` — gates the offer to book. */
  readonly canManage: boolean;
  /** `rec.reception.manage` — gates the day queue's arrival affordance. */
  readonly canCheckIn: boolean;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  const [period, setPeriod] = useState<AppliedPeriod>(TODAY_PERIOD);
  /*
   * What Clear owes the toolbar's date boxes: `rangeReset` is bumped so the
   * boxes empty even when no range was applied, and `typedRange` is the toolbar
   * telling this screen the boxes hold typed days, so Clear counts them.
   */
  const [rangeReset, setRangeReset] = useState(0);
  const [typedRange, setTypedRange] = useState(false);
  const [status, setStatus] = useState<'' | AppointmentStatus>('');
  const [term, setTerm] = useState('');

  /*
   * The zone the day is measured in. One branch: its own. "All my branches":
   * the first authorized one, and the summary says so. Anything else and the
   * board is not read at all, so the value is never used.
   */
  const zone =
    (branch.kind === 'ready'
      ? context.branches.find((entry) => entry.id === branch.target.branchId)?.timezone
      : context.branches[0]?.timezone) || 'UTC';
  const spansBranches = branch.kind === 'all';
  const zoneBranchName = spansBranches ? (context.branches[0]?.name ?? null) : null;

  /*
   * The scope, or the reason there is none. "All my branches" spanning MORE
   * THAN ONE COMPANY resolves to no company at all — `companyId` is mandatory
   * on this operation — so the board says so rather than picking one.
   */
  const scope: BranchScope | null =
    branch.kind === 'ready'
      ? { companyId: branch.target.companyId, branchId: branch.target.branchId }
      : branch.kind === 'all' && context.selection?.companyId
        ? { companyId: context.selection.companyId, branchId: null }
        : null;

  const trimmed = term.trim();
  const termIsSearchable = trimmed.length >= MIN_APPOINTMENT_SEARCH;
  const termTooShort = trimmed.length > 0 && !termIsSearchable;

  /*
   * Built inline on every render, deliberately: `useSearchRequest` keys on the
   * SERIALISED criteria rather than on the object's identity. `null` is "there
   * is nothing to ask for" — no resolvable scope — and the hook makes no
   * request at all in that state.
   */
  const asked: Asked | null =
    scope === null
      ? null
      : {
          scope,
          filters: {
            ...(status === '' ? {} : { status }),
            ...windowOf(period, zone),
            ...(termIsSearchable ? { q: trimmed } : {}),
          },
        };

  const load = useCallback(
    async (
      criteria: Asked,
      cursor: string | null
    ): Promise<ReadState<CursorPage<AppointmentListEntry>>> => {
      const page = await listAppointments(
        criteria.scope,
        criteria.filters,
        INITIAL_REQUEST,
        cursor
      );
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: { items: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore },
        correlationId: page.correlationId,
      };
    },
    []
  );

  const search = useSearchRequest<AppointmentListEntry, Asked>({
    criteria: asked,
    load,
    version: context.version,
    // Every read is narrowed by its period at least, so an empty answer is a
    // statement about the period and the filters — never "nothing exists".
    narrows: (criteria) => Object.keys(criteria.filters).length > 0,
  });

  const choosePreset = (next: string) => {
    if (!isPreset(next)) return;
    setPeriod({ kind: next });
    // The chosen days are put away: the view is what the calendar now shows.
    setRangeReset((count) => count + 1);
  };

  /*
   * The toolbar checks the pair before it reaches here — both days, the last
   * not before the first — and refuses it on the box to fix: the operation
   * answers 422 for an inverted range, and a page-level failure teaches the
   * operator nothing about which of the two boxes to change.
   */
  const applyDays = (from: CalendarDay, to: CalendarDay) => {
    setPeriod({ kind: 'custom', from, to });
  };

  const clearDays = () => {
    setPeriod(TODAY_PERIOD);
    setRangeReset((count) => count + 1);
  };

  const clearFilters = () => {
    clearDays();
    setStatus('');
    setTerm('');
  };

  /** Is there anything for Clear to clear? Days typed into the boxes count. */
  const filtersApplied = period.kind !== 'today' || status !== '' || term !== '' || typedRange;

  const emptyReason: NoResultsReason = termIsSearchable ? 'search' : 'filters';

  const statusOptions = useMemo(
    () =>
      APPOINTMENT_STATUSES.map((code) => ({
        value: code,
        label: translateDynamic(messages, `appointments.status.${code}`),
      })),
    [messages]
  );

  const summary = useMemo(() => {
    const base =
      period.kind === 'custom'
        ? formatPeriodInZone(period.from, period.to, intlLocale(locale), zone)
        : translateDynamic(messages, `appointments.calendar.period.${period.kind}`);
    // The clock is always stated: a reader on another clock cannot tell "today"
    // from "today on my laptop" otherwise.
    const clock = formatMessage(translate(messages, 'appointments.calendar.zoneNote'), { zone });
    return zoneBranchName === null
      ? `${base} · ${clock}`
      : `${base} · ${translate(messages, 'appointments.calendar.periodZoneOfFirstBranch')} ${zoneBranchName} · ${clock}`;
  }, [period, zone, locale, messages, zoneBranchName]);

  /** The clock a row's times are drawn on: its own branch's, else the board's. */
  const rowZone = useCallback(
    (row: AppointmentListEntry): string =>
      context.branches.find((entry) => entry.id === row.branchId)?.timezone || zone,
    [context.branches, zone]
  );

  const allColumns = useMemo<readonly OperationalColumn<AppointmentListEntry>[]>(
    () => [
      {
        id: 'displayNumber',
        headerKey: 'appointments.column.reference',
        cell: (row) =>
          row.displayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.displayNumber}
            </code>
          ) : (
            // Never the internal identifier: a reference slot showing one reads
            // as the appointment's number.
            <span className="text-text-muted">
              {translate(messages, 'appointments.column.noReference')}
            </span>
          ),
      },
      {
        id: 'lifecycleStatus',
        headerKey: 'appointments.column.status',
        cell: (row) => translateDynamic(messages, `appointments.status.${row.lifecycleStatus}`),
      },
      {
        id: 'branch',
        headerKey: 'appointments.column.branch',
        // Passed only while the board spans branches. The name, never the
        // identifier.
        cell: (row) => <bdi>{context.branchName(row.branchId) ?? ''}</bdi>,
      },
      {
        id: 'requestedWindow',
        headerKey: 'appointments.column.requestedWindow',
        flex: 1.4,
        cell: (row) => (
          <WindowCell
            locale={locale}
            messages={messages}
            from={row.requestedFrom}
            to={row.requestedTo}
            zone={rowZone(row)}
            nameClock={spansBranches}
          />
        ),
      },
      {
        id: 'confirmedWindow',
        headerKey: 'appointments.column.confirmedWindow',
        flex: 1.4,
        cell: (row) =>
          row.confirmedFrom && row.confirmedTo ? (
            <WindowCell
              locale={locale}
              messages={messages}
              from={row.confirmedFrom}
              to={row.confirmedTo}
              zone={rowZone(row)}
              nameClock={spansBranches}
            />
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'appointments.window.notConfirmed')}
            </span>
          ),
      },
      {
        id: 'vehicle',
        headerKey: 'appointments.column.vehicle',
        cell: (row) =>
          row.vehicleDisplayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.vehicleDisplayNumber}
            </code>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'appointments.column.noVehicleReference')}
            </span>
          ),
      },
      {
        id: 'requester',
        headerKey: 'appointments.column.requester',
        cell: (row) =>
          row.requesterDisplayName ?? (
            <span className="text-text-muted">
              {translate(messages, 'appointments.column.nameUnavailable')}
            </span>
          ),
      },
      {
        id: 'type',
        headerKey: 'appointments.column.type',
        cell: (row) =>
          row.appointmentTypeName ?? (
            <span className="text-text-muted">
              {translate(messages, 'appointments.column.nameUnavailable')}
            </span>
          ),
      },
    ],
    [context, locale, messages, rowZone, spansBranches]
  );

  const columns = useMemo(
    () => (spansBranches ? allColumns : allColumns.filter((column) => column.id !== 'branch')),
    [allColumns, spansBranches]
  );

  /*
   * What an operator does from a row: open it, and — on a `confirmed` row, for
   * a holder of `rec.reception.manage` — check the vehicle in. Both are links
   * named with the appointment number, so ten rows of "Open" are ten different
   * controls to a screen reader. Neither writes.
   */
  const rowActions = useCallback(
    (row: AppointmentListEntry): readonly RowAction[] => [
      {
        kind: 'link',
        label: translate(messages, 'appointments.calendar.open'),
        href: `/${locale}/appointments/${row.id}`,
        about: row.displayNumber ?? undefined,
      },
      ...(canCheckIn && row.lifecycleStatus === 'confirmed'
        ? [
            {
              kind: 'link' as const,
              label: translate(messages, 'appointments.calendar.checkIn'),
              href: `/${locale}/receptions/check-in`,
              about: row.displayNumber ?? undefined,
            },
          ]
        : []),
    ],
    [canCheckIn, locale, messages]
  );

  const periodFilter: ToolbarFilter = {
    kind: 'chips',
    key: 'period',
    label: translate(messages, 'appointments.calendar.periodLabel'),
    // The views carry no "everything": the calendar is never unbounded. While
    // chosen days are in force no view is pressed.
    allChoice: false,
    value: period.kind === 'custom' ? '' : period.kind,
    onChange: choosePreset,
    options: PRESETS.map((kind) => ({
      value: kind,
      label: translateDynamic(messages, `appointments.calendar.period.${kind}`),
    })),
  };

  const statusFilter: ToolbarFilter = {
    kind: 'select',
    key: 'status',
    label: translate(messages, 'appointments.calendar.statusFilter'),
    value: status,
    onChange: (next) => setStatus(next as '' | AppointmentStatus),
    options: statusOptions,
    placeholder: translate(messages, 'appointments.calendar.anyStatus'),
  };

  const blocked =
    branch.kind === 'unchosen' || branch.kind === 'none' || branch.kind === 'unavailable';
  const spansCompanies = branch.kind === 'all' && scope === null;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/*
        The branch is STATED, not asked. It is the header's own selection and
        there is exactly one place it can be changed; a second editable control
        here would be a second authority for the same fact.
      */}
      <div className="max-w-md">
        <WorkingBranchField
          messages={messages}
          testId="appointment-branch-target"
          acceptsAllBranches
        />
      </div>

      <FilterToolbar
        messages={messages}
        label={translate(messages, 'appointments.calendar.formLabel')}
        testId="appointment-calendar-toolbar"
        search={{
          label: translate(messages, 'appointments.calendar.searchLabel'),
          placeholder: translate(messages, 'appointments.calendar.searchPlaceholder'),
          example: translate(messages, 'appointments.calendar.searchExample'),
          value: term,
          onChange: setTerm,
          onSubmit: search.submit,
          busy: search.phase === 'loading',
          maxLength: MAX_APPOINTMENT_SEARCH,
          error: termTooShort
            ? translate(messages, 'appointments.calendar.searchTooShort')
            : undefined,
          echoDigits: true,
        }}
        filters={[periodFilter, statusFilter]}
        range={{
          key: 'days',
          fromLabel: translate(messages, 'appointments.calendar.fromDay'),
          toLabel: translate(messages, 'appointments.calendar.toDay'),
          applyLabel: translate(messages, 'appointments.calendar.applyPeriod'),
          clearLabel: translate(messages, 'appointments.calendar.clearDays'),
          value: period.kind === 'custom' ? { from: period.from, to: period.to } : null,
          zone,
          onApply: applyDays,
          onClear: clearDays,
          resetKey: rangeReset,
          onTypedDaysChange: setTypedRange,
        }}
        summary={summary}
        actions={
          canManage ? (
            <Button
              component={Link}
              href={`/${locale}/appointments/new`}
              variant="outlined"
              size="small"
            >
              {translate(messages, 'appointments.book.title')}
            </Button>
          ) : undefined
        }
      />

      {blocked ? (
        // Named apart from the one the branch field renders above it: the
        // answer arriving where the question was asked, beside the list that
        // cannot be read.
        <RequiresConcreteBranch
          messages={messages}
          state={branch}
          testId="appointment-calendar-blocked"
        />
      ) : spansCompanies ? (
        <p
          role="status"
          data-testid="appointment-calendar-spans-companies"
          className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
        >
          {translate(messages, 'workingContext.spansCompanies')}
        </p>
      ) : (
        <section
          aria-labelledby="appointment-results-heading"
          className="flex min-h-0 flex-col gap-2"
        >
          <h2 id="appointment-results-heading" className="sr-only">
            {translate(messages, 'appointments.calendar.resultsHeading')}
          </h2>

          <MuiSearchStates
            messages={messages}
            locale={locale}
            phase={search.phase}
            correlationId={search.correlationId}
            emptyReason={emptyReason}
            onRetry={search.submit}
            onClearFilters={
              search.phase === 'empty' && filtersApplied ? (
                <Button type="button" variant="outlined" size="small" onClick={clearFilters}>
                  {translate(messages, 'appointments.calendar.clearFilters')}
                </Button>
              ) : undefined
            }
          />

          {search.phase === 'ready' ? (
            <>
              <OperationalGrid<AppointmentListEntry>
                messages={messages}
                locale={locale}
                label={translate(messages, 'appointments.calendar.caption')}
                columns={columns}
                rowId={(row) => row.id}
                table={search.table}
                rowActions={rowActions}
                suppressEmptyState
                testId="appointment-calendar-grid"
              />
              <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
                {translate(messages, 'appointments.calendar.orderingNote')}
              </p>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}

/**
 * One window, stacked start-over-end, on the branch's clock. Two lines rather
 * than a dashed range: under the bidirectional algorithm a `start – end` pair of
 * formatted date-times reorders in Arabic, and a stacked pair has no neutral to
 * resolve. `nameClock` adds the clock's name where the summary line cannot
 * speak for every row.
 */
function WindowCell({
  locale,
  messages,
  from,
  to,
  zone,
  nameClock,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly from: string;
  readonly to: string;
  readonly zone: string;
  readonly nameClock: boolean;
}) {
  const language = intlLocale(locale);
  return (
    <span className="flex flex-col">
      <bdi>{formatInZone(from, language, zone)}</bdi>
      <span className="text-caption text-text-muted">
        {translate(messages, 'appointments.window.until')}{' '}
        <bdi>{formatInZone(to, language, zone)}</bdi>
        {nameClock ? (
          <>
            {' '}
            <bdi data-testid="appointment-window-clock">{zoneLabelAt(from, language, zone)}</bdi>
          </>
        ) : null}
      </span>
    </span>
  );
}
