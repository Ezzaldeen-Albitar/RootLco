'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextField } from '@/components/forms/Field';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import { SessionExpiredState } from '@/components/states/States';
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
import { addDays, dayIn, formatDayInZone, rangeOfDays } from '@/lib/branch-time';
import { formatDateTime, intlLocale } from '@/lib/format';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
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
 * (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * ## It reads on arrival, because arriving IS the request
 *
 * This screen used to make the operator press "Show" before it read anything,
 * and the results were a separately MOUNTED component so that no request could
 * precede intent. That was structurally honest while the branch was TYPED —
 * there was a value to validate first — and it is no longer the right answer. A
 * service adviser who opens the appointment calendar has expressed intent by
 * opening it; the button was a chore between them and the only thing the page
 * is for.
 *
 * Two facts make reading on arrival safe. The branch is the working context's
 * own named selection, so there is nothing to validate before asking. And the
 * period is BOUNDED — today, in the branch's own zone — so the first request is
 * one day of one branch rather than a workshop's whole calendar. "No request
 * before intent" has become "no UNBOUNDED request, ever", which is the property
 * that was actually protecting the backend.
 *
 * ## The day is the BRANCH's day
 *
 * `lib/format.ts` renders instants on the reader's own clock and says in terms
 * that it "decides no business date". A period boundary is a business date, so
 * the window is composed in `branches[].timezone` — the zone the platform
 * publishes for the branch being read. Reading "all my branches" has no single
 * zone: the first authorized branch's is used and the period label NAMES it,
 * because silently picking one of several boundaries is how a board comes to
 * disagree with itself.
 *
 * ## One box, five things it can match
 *
 * `q` reaches part of the requester's name, the tail of their phone number,
 * part of any plate the vehicle has carried, part of its VIN, or part of the
 * appointment number. It is one box because an operator at a counter is holding
 * ONE fact and does not know which of five fields the platform files it under.
 * The structured `status` and period controls stay, because they answer a
 * different question — which slice of the calendar, not which appointment.
 *
 * ## The branch may now be left unnamed
 *
 * `branchId` became optional on this operation with the same directive, so "all
 * my branches" is a request the backend documents rather than something guessed
 * here: the company is named, the branch is omitted, and the API resolves the
 * authorized set one branch at a time against this operation's own code. A
 * selection spanning more than one COMPANY still resolves to nothing, because
 * `companyId` is mandatory and there is no honest single answer.
 *
 * ## Truncation is honest
 *
 * The operation publishes `hasMore` and no total. A page count is never
 * invented, and Next is offered only while the server says more exists.
 *
 * ## Check in, and the control this screen does NOT have
 *
 * **Check in** is offered on a `confirmed` row and on no other. That is the
 * transition graph, not a preference: `rec.reception-create` moves an
 * appointment `confirmed → checked_in` in the same transaction, and any other
 * lifecycle status answers 409 `ERR-TRN-001`. There is NO appointment "Confirm"
 * operation anywhere in this contract — confirmation is a side effect of
 * rescheduling — so no control here says it.
 */

/** The slices of the calendar this board offers. Each resolves in the branch zone. */
const PERIOD_KINDS = ['today', 'next7', 'custom'] as const;
type PeriodKind = (typeof PERIOD_KINDS)[number];

/** The period in force, plus the two days a custom one was applied with. */
interface AppliedPeriod {
  readonly kind: PeriodKind;
  readonly from: string;
  readonly to: string;
}

const TODAY_PERIOD: AppliedPeriod = { kind: 'today', from: '', to: '' };

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
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [status, setStatus] = useState<'' | AppointmentStatus>('');
  const [term, setTerm] = useState('');
  /**
   * The filter form's own refusals, in the shape every form on this product
   * speaks. `attempt` is what moves the cursor to the first bad field, and
   * `useClearOnCorrect` is what stops a complaint outliving the value it was
   * about.
   */
  const [refusal, setRefusal] = useState<ActionState>(IDLE);
  const formRef = useFocusFirstInvalid(refusal);
  const corrections = useClearOnCorrect(refusal);

  /*
   * The zone the day is measured in. One branch: its own. "All my branches":
   * the first authorized one, and the label says so. Anything else and the
   * board is not read at all, so the value is never used.
   */
  const zone =
    (branch.kind === 'ready'
      ? context.branches.find((entry) => entry.id === branch.target.branchId)?.timezone
      : context.branches[0]?.timezone) ?? 'UTC';
  const spansBranches = branch.kind === 'all';
  const zoneBranchName = spansBranches ? (context.branches[0]?.name ?? null) : null;

  /*
   * The scope, or the reason there is none.
   *
   * "All my branches" spanning MORE THAN ONE COMPANY resolves to no company at
   * all — `companyId` is mandatory on this operation and there is no honest
   * single answer — so the board says so rather than picking one.
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
   * SERIALISED criteria rather than on the object's identity, so memoising this
   * would buy nothing and would add a dependency list to keep honest.
   *
   * `null` is "there is nothing to ask for yet" — no resolvable scope, or a
   * custom period with only one of its two days filled in. The hook makes no
   * request at all in that state.
   */
  const asked: Asked | null =
    scope === null || (period.kind === 'custom' && (period.from === '' || period.to === ''))
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
      const page = await listAppointments(criteria.scope, criteria.filters, INITIAL_REQUEST, cursor);
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
  });

  const applyCustom = () => {
    if (draftFrom === '' || draftTo === '') {
      setRefusal(
        invalid(
          { [draftFrom === '' ? 'fromDay' : 'toDay']: 'appointments.calendar.periodIncomplete' },
          (refusal.attempt ?? 0) + 1
        )
      );
      return;
    }
    if (draftTo < draftFrom) {
      // Refused here rather than at the backend. The operation answers 422 for
      // an inverted range, and a 422 arriving as a page-level failure teaches
      // the operator nothing about which of the two boxes to change.
      setRefusal(invalid({ toDay: 'appointments.calendar.rangeInverted' }, (refusal.attempt ?? 0) + 1));
      return;
    }
    setRefusal(IDLE);
    setPeriod({ kind: 'custom', from: draftFrom, to: draftTo });
  };

  const choosePeriod = (kind: PeriodKind) => {
    setRefusal(IDLE);
    setPeriod(kind === 'custom' ? { kind, from: '', to: '' } : { kind, from: '', to: '' });
  };

  const clearFilters = () => {
    setRefusal(IDLE);
    setPeriod(TODAY_PERIOD);
    setDraftFrom('');
    setDraftTo('');
    setStatus('');
    setTerm('');
  };

  const statusOptions = useMemo(
    () =>
      APPOINTMENT_STATUSES.map((code) => ({
        value: code,
        label: translateDynamic(messages, `appointments.status.${code}`),
      })),
    [messages]
  );

  const periodLabel = useMemo(() => {
    const base =
      period.kind === 'custom' && period.from !== '' && period.to !== ''
        ? `${formatDayInZone(period.from, intlLocale(locale), zone)} – ${formatDayInZone(period.to, intlLocale(locale), zone)}`
        : translateDynamic(messages, `appointments.calendar.period.${period.kind}`);
    return zoneBranchName === null
      ? base
      : `${base} · ${translate(messages, 'appointments.calendar.periodZoneOfFirstBranch')} ${zoneBranchName}`;
  }, [period, zone, locale, messages, zoneBranchName]);

  const columns = useMemo<readonly Column<AppointmentListEntry>[]>(
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
        // Rendered only while the board spans branches — see `hiddenColumnIds`.
        // The name, never the identifier: a reference here would be a second
        // thing for the operator to look up.
        cell: (row) => <bdi>{context.branchName(row.branchId) ?? ''}</bdi>,
      },
      {
        id: 'requestedWindow',
        headerKey: 'appointments.column.requestedWindow',
        cell: (row) => (
          <WindowCell
            locale={locale}
            from={row.requestedFrom}
            to={row.requestedTo}
            messages={messages}
          />
        ),
      },
      {
        id: 'confirmedWindow',
        headerKey: 'appointments.column.confirmedWindow',
        cell: (row) =>
          row.confirmedFrom && row.confirmedTo ? (
            <WindowCell
              locale={locale}
              from={row.confirmedFrom}
              to={row.confirmedTo}
              messages={messages}
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
    [context, locale, messages]
  );

  /*
   * A field complaint, already translated. `useClearOnCorrect` answers with a
   * catalogue KEY and stops answering once the operator edits the control,
   * which is the whole behaviour: the sentence was about a value that is no
   * longer there.
   */
  const errorFor = (field: string): string | undefined => {
    const key = corrections.errorFor(field);
    return key === undefined ? undefined : translateDynamic(messages, key);
  };
  const fromError = errorFor('fromDay');
  const toError = errorFor('toDay');

  const blocked =
    branch.kind === 'unchosen' || branch.kind === 'none' || branch.kind === 'unavailable';
  const spansCompanies = branch.kind === 'all' && scope === null;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          search.submit();
        }}
        noValidate
        aria-label={translate(messages, 'appointments.calendar.formLabel')}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label font-medium text-text-primary">
            {translate(messages, 'appointments.calendar.periodLabel')}
          </span>
          {PERIOD_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={period.kind === kind}
              onClick={() => choosePeriod(kind)}
              className={
                period.kind === kind
                  ? 'rounded-md border border-border bg-primary px-3 py-1.5 text-body text-on-primary transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                  : 'rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
              }
            >
              {translateDynamic(messages, `appointments.calendar.period.${kind}`)}
            </button>
          ))}
        </div>

        <p data-testid="appointment-period-label" className="text-supporting text-text-muted">
          {periodLabel}
        </p>

        {period.kind === 'custom' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              type="date"
              dir="ltr"
              label={translate(messages, 'appointments.calendar.fromDay')}
              value={draftFrom}
              onChange={(event) => {
                corrections.noteEdited('fromDay');
                setDraftFrom(event.target.value);
              }}
              {...(fromError === undefined ? {} : { error: fromError })}
            />
            <TextField
              type="date"
              dir="ltr"
              label={translate(messages, 'appointments.calendar.toDay')}
              value={draftTo}
              onChange={(event) => {
                corrections.noteEdited('toDay');
                setDraftTo(event.target.value);
              }}
              {...(toError === undefined ? {} : { error: toError })}
            />
            <div className="flex items-end">
              <button
                type="button"
                onClick={applyCustom}
                className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'appointments.calendar.applyPeriod')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/*
            The branch is STATED, not asked. It is the header's own selection and
            there is exactly one place it can be changed; a second editable
            control here would be a second authority for the same fact.
          */}
          <WorkingBranchField messages={messages} testId="appointment-branch-target" />
          <SelectField
            label={translate(messages, 'appointments.calendar.statusFilter')}
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | AppointmentStatus)}
            options={statusOptions}
            placeholder={translate(messages, 'appointments.calendar.anyStatus')}
          />
          <div className="sm:col-span-2">
            <SearchBox
              messages={messages}
              label={translate(messages, 'appointments.calendar.searchLabel')}
              placeholder={translate(messages, 'appointments.calendar.searchPlaceholder')}
              example={translate(messages, 'appointments.calendar.searchExample')}
              value={term}
              onChange={setTerm}
              onSubmit={search.submit}
              busy={search.phase === 'loading'}
              maxLength={MAX_APPOINTMENT_SEARCH}
              {...(termTooShort
                ? { error: translate(messages, 'appointments.calendar.searchTooShort') }
                : {})}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canManage ? (
            <Link
              href={`/${locale}/appointments/new`}
              className="rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
            >
              {translate(messages, 'appointments.book.title')}
            </Link>
          ) : null}
        </div>
      </form>

      {blocked ? (
        // Named apart from the one the branch field renders above it. The
        // second is not duplication — it is the answer arriving where the
        // question was asked, beside the list that cannot be read.
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

          {/*
            An ended session, said as itself.

            `SearchPhase` collapses an expired session into `failed`, and
            `SearchStates` renders that arm as "something went wrong" with a
            Try again control — a button that cannot work for somebody whose
            session has ended. The finer `table.status` still distinguishes the
            two, so the expired case is rendered here and the shared component
            handles everything else. A shared `expired` arm would be the better
            home for this; `components/search/SearchStates.tsx` is owned
            elsewhere and is left untouched.
          */}
          {search.table.status === 'expired' ? (
            <SessionExpiredState messages={messages} />
          ) : (
          <SearchStates
            messages={messages}
            phase={search.phase}
            correlationId={search.correlationId}
            idle={
              // Reached only while a custom period is half filled in. Nothing
              // else here can be idle — the calendar reads on arrival.
              <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
                {translate(messages, 'appointments.calendar.chooseBothDays')}
              </p>
            }
            {...(search.phase === 'empty'
              ? {
                  onClearFilters: (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {translate(messages, 'appointments.calendar.clearFilters')}
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
          )}

          {search.phase === 'ready' ? (
            <>
              <CalendarTable
                locale={locale}
                messages={messages}
                columns={columns}
                search={search}
                spansBranches={spansBranches}
                canCheckIn={canCheckIn}
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
 * The rows, and the two things an operator does from one.
 *
 * Split out so the screen above reads as filters-then-results rather than as
 * one four-hundred-line function, and so the row actions sit beside the table
 * they belong to.
 */
function CalendarTable({
  locale,
  messages,
  columns,
  search,
  spansBranches,
  canCheckIn,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly columns: readonly Column<AppointmentListEntry>[];
  readonly search: ReturnType<typeof useSearchRequest<AppointmentListEntry, Asked>>;
  readonly spansBranches: boolean;
  readonly canCheckIn: boolean;
}) {
  const router = useRouter();
  return (
    <DataTable<AppointmentListEntry>
      messages={messages}
      columns={columns}
      rowId={(row) => row.id}
      request={search.table.request}
      response={search.table.response}
      status={search.table.status}
      onRequestChange={search.table.setRequest}
      onRetry={search.table.refresh}
      correlationId={search.table.correlationId}
      caption={translate(messages, 'appointments.calendar.caption')}
      hiddenColumnIds={spansBranches ? [] : ['branch']}
      /*
       * The criteria live OUTSIDE `TableRequest` (deliberately: nothing here may
       * reach the address bar), so the table's own empty state would make a
       * claim about the whole branch on the evidence of one range. `empty` is
       * rendered by `SearchStates` instead, which says it about the filters.
       */
      suppressEmptyState
      rowActions={(row) => (
        <span className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.push(`/${locale}/appointments/${row.id}`)}
            className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
          >
            {translate(messages, 'appointments.calendar.open')}
          </button>
          {canCheckIn && row.lifecycleStatus === 'confirmed' ? (
            // Only `confirmed` checks in — every other lifecycle status answers
            // 409 `ERR-TRN-001`, so the affordance follows the graph.
            <Link
              href={`/${locale}/receptions/check-in`}
              className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
            >
              {translate(messages, 'appointments.calendar.checkIn')}
            </Link>
          ) : null}
        </span>
      )}
    />
  );
}

/**
 * One window, stacked start-over-end. Two lines rather than a dashed range:
 * under the bidirectional algorithm a `start – end` pair of formatted
 * date-times reorders in Arabic, and a stacked pair has no neutral to resolve.
 */
function WindowCell({
  locale,
  messages,
  from,
  to,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly from: string;
  readonly to: string;
}) {
  return (
    <span className="flex flex-col">
      <bdi>{formatDateTime(from, locale)}</bdi>
      <span className="text-caption text-text-muted">
        {translate(messages, 'appointments.window.until')} <bdi>{formatDateTime(to, locale)}</bdi>
      </span>
    </span>
  );
}
