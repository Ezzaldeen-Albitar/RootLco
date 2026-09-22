'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextField } from '@/components/forms/Field';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
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
import {
  addDays,
  dayIn,
  formatDayInZone,
  formatInZone,
  rangeOfDays,
  startOfDay,
} from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listReceptions } from '../api';
import {
  MAX_RECEPTION_SEARCH,
  MIN_RECEPTION_SEARCH,
  RECEPTION_BOARD_PERIODS,
  TERMINAL_RECEPTION_STATUSES,
  UNFINISHED_RECEPTION_STATUSES,
  isFinishedReception,
  type ReceptionBoardPeriod,
  type ReceptionListCriteria,
  type ReceptionListEntry,
  type ReceptionStatus,
} from '../receptions-contract';

/**
 * The reception desk's board — `rec.reception-list` as what the workshop is
 * holding right now (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * ## It reads on arrival, because arriving IS the request
 *
 * This screen used to ask an operator to press "Show the queue" before it read
 * anything. That was structurally honest — the route demanded a branch, and the
 * results were a separately mounted component so that no request could precede
 * intent — and it was the wrong answer to the wrong question. A receptionist who
 * opens the reception queue has expressed intent by opening it. The button was a
 * chore between them and the only thing the page is for.
 *
 * Two facts make the read safe without it. The branch is no longer typed: it is
 * the working context's own named selection, so there is nothing to validate
 * before asking. And the period is BOUNDED — today, in the branch's own zone —
 * so the first request is one day of one branch rather than the whole history of
 * a workshop. "No request before intent" has become "no UNBOUNDED request,
 * ever", which is the property that was actually protecting the backend.
 *
 * ## The day is the BRANCH's day
 *
 * `lib/format.ts` renders instants on the reader's own clock, deliberately, and
 * says so: it "decides no business date". A period boundary is a business date.
 * So the window is computed in `branches[].timezone` — the zone the platform
 * publishes for that branch — and the times in the rows are rendered on the same
 * clock. A service adviser in one city reading another city's board sees that
 * city's day, and the heading says which zone it is.
 *
 * Reading "all my branches" has no single zone. The first authorized branch's is
 * used and the period label NAMES it, because silently picking one of several
 * boundaries and not saying so is how a board comes to disagree with itself.
 *
 * ## What the platform does not publish is not shown
 *
 * There is no due date on a reception visit, anywhere in the schema, so nothing
 * here says "overdue" or "due today". The row carries no customer name and no
 * registration plate either — `ReceptionListEntry` publishes the vehicle's own
 * reference and nothing about its owner — so the board shows the visit, the
 * vehicle reference and the custody fact, and the customer is found on the visit
 * it links to. An empty column headed "Customer" would be a promise the read
 * cannot keep.
 *
 * ## One status at a time, and the reason it is grouped anyway
 *
 * `status` on the wire is ONE code (`z.enum(...).optional()`), so "every
 * unfinished visit" is not a request this operation can be sent, and a browser
 * that filtered a fetched page to the three would produce short pages and a
 * `hasMore` that lies. What the control CAN do is stop making the operator hold
 * the graph in their head: the six codes are offered in two groups — still with
 * us, and finished — derived from `TERMINAL_RECEPTION_STATUSES` rather than
 * listed here, so a graph change moves the control instead of leaving it
 * confidently wrong.
 *
 * "What is still here from before today" is therefore two controls used
 * together: the **Before today** period, which sends only an upper bound, and
 * one status from the **Still with us** group. It is not one button, because one
 * button would have to claim a request the operation cannot be sent.
 *
 * ## Everything restarts on a branch change, and paging restarts on a filter
 *
 * The working-context version is part of the search key, so a branch changed in
 * the header abandons the read in flight rather than letting it land under the
 * new branch's name, and the cursor stack is thrown away with it. Any change to
 * the criteria does the same, which is what stops a cursor issued against one
 * ordering being spent against another.
 */

/**
 * The periods the board offers. Each resolves to instants in the branch zone.
 *
 * Declared in the contract since the dashboard began linking here carrying the
 * period a figure was counted over: a figure labelled "today" that opens a list
 * of the last seven days is a worse answer than no link at all, and one
 * declaration is what keeps the two sides naming the same five periods.
 */
type PeriodKind = ReceptionBoardPeriod;

const PERIOD_KINDS: readonly PeriodKind[] = RECEPTION_BOARD_PERIODS;

/** The period in force, plus the two days a custom one was applied with. */
export interface AppliedPeriod {
  readonly kind: PeriodKind;
  readonly from: string;
  readonly to: string;
}

const TODAY_PERIOD: AppliedPeriod = { kind: 'today', from: '', to: '' };

/** What the read is asked for: the scope it is addressed to and the filters. */
interface Asked {
  readonly scope: BranchScope;
  readonly filters: ReceptionListCriteria;
}

/**
 * The instants a period covers, in the branch's zone.
 *
 * `beforeToday` has no lower bound on purpose: "what is still here from before
 * today" is a question about a beginning nobody named, and inventing one would
 * hide the oldest visits — which are the ones the question is about.
 */
function windowOf(
  period: AppliedPeriod,
  zone: string
): { readonly from?: string; readonly to?: string } {
  const today = dayIn(zone);
  switch (period.kind) {
    case 'today':
      return rangeOfDays(zone, today, today);
    case 'yesterday': {
      const day = addDays(today, -1);
      return rangeOfDays(zone, day, day);
    }
    case 'last7':
      // Seven days INCLUDING today, which is what "the last 7 days" means to
      // the person asking. Six back plus today.
      return rangeOfDays(zone, addDays(today, -6), today);
    case 'beforeToday':
      return { to: startOfDay(zone, today).toISOString() };
    case 'custom':
      return rangeOfDays(zone, period.from, period.to);
  }
}

export function ReceptionQueueScreen({
  locale,
  messages,
  canCreate,
  canReachIntake = false,
  initialPeriod,
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
  /**
   * `crm.customer.read` — the same code the walk-in desk's own route gates on.
   *
   * Gating the LINK on the destination's own permission is the point: an offer
   * that lands on a refusal is worse than no offer, and this screen must not
   * invent a second, softer rule for who may receive a new customer.
   */
  readonly canReachIntake?: boolean;
  /**
   * The period this board opens on, when it was reached from a figure counted
   * over one.
   *
   * Validated by the ROUTE against `RECEPTION_BOARD_PERIODS` and, for a chosen
   * range, against the calendar-day shape — so an unrecognised period never
   * reaches this component and the board simply opens on today, which is what
   * the address without it means.
   */
  readonly initialPeriod?: AppliedPeriod | undefined;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  const [period, setPeriod] = useState<AppliedPeriod>(initialPeriod ?? TODAY_PERIOD);
  /*
   * The two boxes start filled when a chosen range arrived with the address, so
   * the range the reader is looking at is the range the form shows. An empty
   * pair would invite them to "apply" a period they never asked for.
   */
  const [draftFrom, setDraftFrom] = useState(initialPeriod?.from ?? '');
  const [draftTo, setDraftTo] = useState(initialPeriod?.to ?? '');
  const [status, setStatus] = useState<'' | ReceptionStatus>('');
  const [term, setTerm] = useState('');
  /**
   * The filter form's own refusals, in the shape every form on this product
   * speaks. `attempt` is what moves the cursor to the first bad field and what
   * lets the same complaint be announced twice.
   */
  const [refusal, setRefusal] = useState<ActionState>(IDLE);
  const formRef = useFocusFirstInvalid(refusal);
  const corrections = useClearOnCorrect(refusal);

  /*
   * The zone the day is measured in.
   *
   * One branch: its own. "All my branches": the first authorized one, and the
   * label says so — see the docblock. Anything else and the board is not read at
   * all, so the value is never used.
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
  const termIsSearchable = trimmed.length >= MIN_RECEPTION_SEARCH;
  const termTooShort = trimmed.length > 0 && !termIsSearchable;

  /*
   * Built inline on every render, deliberately.
   *
   * `useSearchRequest` keys on the SERIALISED criteria, not on the object's
   * identity — its own docblock says so — so memoising this would buy nothing
   * and would introduce a dependency list that has to be kept honest against
   * five inputs. A new object with the same content asks for the same thing.
   *
   * `null` is "there is nothing to ask for yet": no resolvable scope, or a
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
    ): Promise<ReadState<CursorPage<ReceptionListEntry>>> => {
      const page = await listReceptions(criteria.scope, criteria.filters, INITIAL_REQUEST, cursor);
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: { items: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore },
        correlationId: page.correlationId,
      };
    },
    []
  );

  const search = useSearchRequest<ReceptionListEntry, Asked>({
    criteria: asked,
    load,
    version: context.version,
  });

  const applyCustom = () => {
    if (draftFrom === '' || draftTo === '') {
      setRefusal(
        invalid(
          { [draftFrom === '' ? 'from' : 'to']: 'receptions.queue.periodIncomplete' },
          (refusal.attempt ?? 0) + 1
        )
      );
      return;
    }
    if (draftTo < draftFrom) {
      // Refused here rather than at the backend. The operation answers 422 for
      // an inverted range, and a 422 arriving as a page-level failure teaches
      // the operator nothing about which of the two boxes to change.
      setRefusal(invalid({ to: 'receptions.queue.invertedRange' }, (refusal.attempt ?? 0) + 1));
      return;
    }
    setRefusal(IDLE);
    setPeriod({ kind: 'custom', from: draftFrom, to: draftTo });
  };

  const choosePeriod = (kind: PeriodKind) => {
    setRefusal(IDLE);
    if (kind === 'custom') {
      setPeriod({ kind: 'custom', from: '', to: '' });
      return;
    }
    setPeriod({ kind, from: '', to: '' });
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
    () => [
      {
        label: translate(messages, 'receptions.queue.statusGroupOpen'),
        options: UNFINISHED_RECEPTION_STATUSES.map((code) => ({
          value: code,
          label: translateDynamic(messages, `receptions.status.${code}`),
        })),
      },
      {
        label: translate(messages, 'receptions.queue.statusGroupFinished'),
        options: TERMINAL_RECEPTION_STATUSES.map((code) => ({
          value: code,
          label: translateDynamic(messages, `receptions.status.${code}`),
        })),
      },
    ],
    [messages]
  );

  const periodLabel = useMemo(() => {
    const zoneName = spansBranches && zoneBranchName !== null ? zoneBranchName : null;
    const base =
      period.kind === 'custom' && period.from !== '' && period.to !== ''
        ? `${formatDayInZone(period.from, intlLocale(locale), zone)} – ${formatDayInZone(period.to, intlLocale(locale), zone)}`
        : translateDynamic(messages, `receptions.queue.period.${period.kind}`);
    return zoneName === null
      ? base
      : `${base} · ${translate(messages, 'receptions.queue.periodZoneOfFirstBranch')} ${zoneName}`;
  }, [period, zone, locale, messages, spansBranches, zoneBranchName]);

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
        id: 'receptionStatus',
        headerKey: 'receptions.queue.column.status',
        cell: (row) => translateDynamic(messages, `receptions.status.${row.receptionStatus}`),
      },
      {
        id: 'branch',
        headerKey: 'receptions.queue.column.branch',
        // Rendered only while the board spans branches — see `hiddenColumnIds`
        // below. The name, never the identifier: a reference here would be a
        // second thing for the operator to look up.
        cell: (row) => <bdi>{context.branchName(row.branchId) ?? ''}</bdi>,
      },
      {
        id: 'custodyAcceptedAt',
        headerKey: 'receptions.queue.column.received',
        // On the BRANCH's clock, so the time agrees with the day in the heading.
        cell: (row) => <bdi>{formatInZone(row.custodyAcceptedAt, intlLocale(locale), zone)}</bdi>,
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
              <bdi>{formatInZone(row.custodyReleasedAt, intlLocale(locale), zone)}</bdi>
            </span>
          ),
      },
    ],
    [context, locale, messages, zone]
  );

  /*
   * A field complaint, already translated.
   *
   * `useClearOnCorrect` answers with a catalogue KEY and stops answering once
   * the operator edits the control, which is the whole behaviour: the sentence
   * was about a value that is no longer there.
   */
  const errorFor = (field: string): string | undefined => {
    const key = corrections.errorFor(field);
    return key === undefined ? undefined : translateDynamic(messages, key);
  };
  const fromError = errorFor('from');
  const toError = errorFor('to');

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
        aria-label={translate(messages, 'receptions.queue.formLabel')}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label font-medium text-text-primary">
            {translate(messages, 'receptions.queue.periodLabel')}
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
              {translateDynamic(messages, `receptions.queue.period.${kind}`)}
            </button>
          ))}
        </div>

        <p data-testid="reception-period-label" className="text-supporting text-text-muted">
          {periodLabel}
        </p>

        {period.kind === 'custom' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              type="date"
              label={translate(messages, 'receptions.queue.fromDay')}
              value={draftFrom}
              onChange={(event) => {
                corrections.noteEdited('from');
                setDraftFrom(event.target.value);
              }}
              {...(fromError === undefined ? {} : { error: fromError })}
            />
            <TextField
              type="date"
              label={translate(messages, 'receptions.queue.toDay')}
              value={draftTo}
              onChange={(event) => {
                corrections.noteEdited('to');
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
                {translate(messages, 'receptions.queue.applyPeriod')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/*
            The branch is STATED, not asked. It is the header's own selection and
            there is exactly one place it can be changed; a second editable
            control here would be a second authority for the same fact. A board
            that did not name it would leave the operator to remember which
            branch they are reading.
          */}
          <WorkingBranchField
            messages={messages}
            label={translate(messages, 'receptions.checkIn.branch')}
          />
          <SelectField
            label={translate(messages, 'receptions.queue.statusFilter')}
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | ReceptionStatus)}
            groups={statusOptions}
            placeholder={translate(messages, 'receptions.queue.anyStatus')}
          />
          <div className="sm:col-span-2">
            <SearchBox
              messages={messages}
              label={translate(messages, 'receptions.queue.searchLabel')}
              placeholder={translate(messages, 'receptions.queue.searchPlaceholder')}
              example={translate(messages, 'receptions.queue.searchExample')}
              value={term}
              onChange={setTerm}
              onSubmit={search.submit}
              busy={search.phase === 'loading'}
              maxLength={MAX_RECEPTION_SEARCH}
              {...(termTooShort
                ? { error: translate(messages, 'receptions.queue.searchTooShort') }
                : {})}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canCreate ? (
            <Link
              href={`/${locale}/receptions/check-in`}
              className="rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
            >
              {translate(messages, 'receptions.queue.checkInVehicle')}
            </Link>
          ) : null}
          {canReachIntake ? (
            <Link
              href={`/${locale}/reception/walk-in`}
              className="rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
            >
              {translate(messages, 'receptions.queue.newCustomer')}
            </Link>
          ) : null}
        </div>
      </form>

      {blocked ? (
        // Named apart from the one the branch field renders above it. The
        // second is not duplication — it is the answer arriving where the
        // question was asked, beside the list that cannot be read — and giving
        // them one name is what would make a test unable to say which it means.
        <RequiresConcreteBranch
          messages={messages}
          state={branch}
          testId="reception-queue-blocked"
        />
      ) : spansCompanies ? (
        <p
          role="status"
          data-testid="reception-queue-spans-companies"
          className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
        >
          {translate(messages, 'workingContext.spansCompanies')}
        </p>
      ) : (
        <section aria-labelledby="reception-queue-heading" className="flex min-h-0 flex-col gap-2">
          <h2 id="reception-queue-heading" className="sr-only">
            {translate(messages, 'receptions.queue.resultsHeading')}
          </h2>

          <SearchStates
            messages={messages}
            phase={search.phase}
            correlationId={search.correlationId}
            idle={
              // Reached only while a custom period is half filled in. Nothing
              // else here can be idle — the board reads on arrival.
              <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
                {translate(messages, 'receptions.queue.chooseBothDays')}
              </p>
            }
            {...(search.phase === 'empty' && termIsSearchable
              ? {
                  onClearFilters: (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {translate(messages, 'receptions.queue.clearFilters')}
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
              <DataTable<ReceptionListEntry>
                messages={messages}
                columns={columns}
                rowId={(row) => row.id}
                request={search.table.request}
                response={search.table.response}
                status={search.table.status}
                onRequestChange={search.table.setRequest}
                onRetry={search.table.refresh}
                correlationId={search.table.correlationId}
                caption={translate(messages, 'receptions.queue.caption')}
                hiddenColumnIds={spansBranches ? [] : ['branch']}
                suppressEmptyState
                rowActions={(row) => (
                  <span className="flex flex-wrap gap-3">
                    <Link
                      href={`/${locale}/receptions/check-in/${row.id}`}
                      className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                    >
                      {/*
                       * The next action, decided by the graph rather than by a
                       * list of codes. A visit that can still move is one the
                       * desk has work to finish on; a finished one is a record
                       * to open. Both land on the same read, which is what
                       * supplies the version any guarded command needs — the
                       * board's own row version is a snapshot and must never be
                       * spent on a write (QA-004).
                       */}
                      {isFinishedReception(row.receptionStatus)
                        ? translate(messages, 'receptions.queue.open')
                        : translate(messages, 'receptions.queue.continueCheckIn')}
                    </Link>
                    <Link
                      href={`/${locale}/receptions/check-in/${row.id}/acknowledgement`}
                      className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                    >
                      {translate(messages, 'receptions.queue.acknowledgement')}
                    </Link>
                  </span>
                )}
              />
              <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
                {translate(messages, 'receptions.queue.orderingNote')}
              </p>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
