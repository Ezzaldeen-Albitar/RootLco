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
  endOfDay,
  formatDayInZone,
  formatInZone,
  rangeOfDays,
} from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listReceptions } from '../api';
import {
  MAX_RECEPTION_SEARCH,
  MIN_RECEPTION_SEARCH,
  RECEPTION_STATUS_GROUPS,
  TERMINAL_RECEPTION_STATUSES,
  UNFINISHED_RECEPTION_STATUSES,
  isFinishedReception,
  type ReceptionListCriteria,
  type ReceptionListEntry,
  type ReceptionStatus,
  type ReceptionStatusGroup,
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
 * here says "overdue" or "due today", and no control offers to sort by one.
 *
 * The customer and the plate ARE published now, and both carry an absence the
 * board renders as words rather than as a blank: a visit that names no service
 * requester yet, a customer whose name this caller may not read, and a
 * registered vehicle carrying no plate are three ordinary states of the data,
 * not three rendering faults.
 *
 * ## One control, over a whole group or over a single code
 *
 * `status` on the wire is ONE frozen code, and for one wave "every unfinished
 * visit" was simply not a request this operation could be sent — a browser that
 * filtered a fetched page to the three would produce short pages and a
 * `hasMore` that lies. `statusGroup` is that request, and it arrived with the
 * board-list contracts.
 *
 * Both answers live in ONE select: the two groups at the top as whole answers,
 * the six codes beneath them grouped the same way. The route refuses a code and
 * a group sent together (`status_and_group_exclusive`), and a single control
 * cannot hold both — so the refusal is unreachable rather than explained. The
 * grouping is derived from `TERMINAL_RECEPTION_STATUSES`, so a graph change
 * moves the control instead of leaving it confidently wrong.
 *
 * "What is still here from before today" is therefore one button again: the
 * **Before today** period, which sends only an upper bound, and the `open`
 * group beside it.
 *
 * ## Everything restarts on a branch change, and paging restarts on a filter
 *
 * The working-context version is part of the search key, so a branch changed in
 * the header abandons the read in flight rather than letting it land under the
 * new branch's name, and the cursor stack is thrown away with it. Any change to
 * the criteria does the same, which is what stops a cursor issued against one
 * ordering being spent against another.
 */

/** The periods the board offers. Each resolves to instants in the branch zone. */
type PeriodKind = 'today' | 'yesterday' | 'last7' | 'beforeToday' | 'custom';

const PERIOD_KINDS: readonly PeriodKind[] = [
  'today',
  'yesterday',
  'last7',
  'beforeToday',
  'custom',
];

/** The period in force, plus the two days a custom one was applied with. */
interface AppliedPeriod {
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
      /*
       * The LAST instant of yesterday, not the first instant of today.
       *
       * The route compares `custody_accepted_at <= to`, closed on both ends. The
       * start of today satisfies that comparison, so sending it puts every visit
       * received in the first millisecond of today — midnight arrivals, and any
       * row the database stamped exactly on the boundary — into a board headed
       * "before today".
       */
      return { to: endOfDay(zone, addDays(today, -1)).toISOString() };
    case 'custom':
      return rangeOfDays(zone, period.from, period.to);
  }
}

export function ReceptionQueueScreen({
  locale,
  messages,
  canCreate,
  canReachIntake = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
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
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  const [period, setPeriod] = useState<AppliedPeriod>(TODAY_PERIOD);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  /*
   * ONE control over two kinds of answer.
   *
   * `status` is a single frozen code and `statusGroup` is `open` or `finished`;
   * the route refuses the pair with `status_and_group_exclusive` rather than
   * intersecting them. A select whose value is either `group:open` or a code
   * makes that exclusion structural — there is no state in which both are set —
   * and it puts the answer an operator actually wants ("everything still with
   * us") at the top of the same list they were already reading.
   */
  const [status, setStatus] = useState<'' | `group:${ReceptionStatusGroup}` | ReceptionStatus>('');
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
   *
   * Building it inline is also what makes a branch change safe. The scope and
   * the zone are DERIVED from the working context on every render, so there is
   * no stored copy of either to reset when the header moves — the criteria are
   * already the new branch's in the same render the version changes in, and
   * `useSearchRequest` treats that version change as a submission of exactly
   * these criteria rather than waiting out a debounce on the previous ones. The
   * filters below are state, and they SURVIVE a branch change on purpose: they
   * are what the operator asked for and they are not about the branch.
   */
  const asked: Asked | null =
    scope === null || (period.kind === 'custom' && (period.from === '' || period.to === ''))
      ? null
      : {
          scope,
          filters: {
            ...(status === ''
              ? {}
              : status.startsWith('group:')
                ? { statusGroup: status.slice('group:'.length) as ReceptionStatusGroup }
                : { status: status as ReceptionStatus }),
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

  /**
   * "What is still here from before today", as one button.
   *
   * It was two controls used together — the period, then a status from the
   * "still with us" group — because `status` took one code at a time and the
   * set of unfinished statuses could not be sent. `statusGroup` is that set,
   * so the question is one request again and the button asks it.
   */
  const olderUnfinished = () => {
    setRefusal(IDLE);
    setPeriod({ kind: 'beforeToday', from: '', to: '' });
    setStatus('group:open');
  };

  const clearFilters = () => {
    setRefusal(IDLE);
    setPeriod(TODAY_PERIOD);
    setDraftFrom('');
    setDraftTo('');
    setStatus('');
    setTerm('');
  };

  /**
   * Is there anything for Clear to clear?
   *
   * Every input `clearFilters` resets, compared against the value it resets to
   * — so the offer appears exactly when pressing it would change the question.
   * It used to be made only for a SEARCHABLE term, which left the commonest
   * empty board of all (a status or a period that matches nothing today) with
   * no way out but to undo each control by hand.
   *
   * The draft days count even when the period is not custom: they are typed
   * text the operator can see, and a Clear that left them sitting there would
   * be a Clear that did not.
   */
  const filtersApplied =
    period.kind !== TODAY_PERIOD.kind ||
    draftFrom !== '' ||
    draftTo !== '' ||
    status !== '' ||
    trimmed !== '';

  /*
   * The two groups first, as whole answers, then the six codes underneath them
   * grouped the same way. The group entries are what the platform can now be
   * asked directly; the codes are still one at a time, and the grouping is
   * derived from `TERMINAL_RECEPTION_STATUSES` rather than listed here.
   */
  const statusOptions = useMemo(
    () =>
      RECEPTION_STATUS_GROUPS.map((group) => ({
        value: `group:${group}`,
        label: translateDynamic(messages, `receptions.queue.statusWhole.${group}`),
      })),
    [messages]
  );

  const statusGroups = useMemo(
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
        id: 'customer',
        headerKey: 'receptions.queue.column.customer',
        /*
         * Three facts, told apart.
         *
         * No customer at all is a visit that names no service requester yet,
         * which the platform permits. A customer whose `displayName` is null is
         * a caller who may not read the directory — the visit HAS one, and the
         * row says so in words rather than falling back to the identifier,
         * which is the one thing an operator can do nothing with.
         */
        cell: (row) =>
          row.customer === null ? (
            <span className="text-text-muted">
              {translate(messages, 'receptions.queue.column.noCustomer')}
            </span>
          ) : row.customer.displayName === null ? (
            <span className="text-text-muted">
              {translate(messages, 'receptions.queue.column.customerHidden')}
            </span>
          ) : (
            <bdi>{row.customer.displayName}</bdi>
          ),
      },
      {
        id: 'vehicle',
        headerKey: 'receptions.queue.column.vehicle',
        /*
         * The plate first, because that is what a receptionist reads off the
         * car in front of them, with the vehicle's own reference under it. A
         * registered but unplated vehicle is ordinary, not a fault.
         */
        cell: (row) => (
          <span className="flex flex-col">
            {row.plate ? (
              <code className="font-mono text-caption" dir="ltr">
                {row.plate}
              </code>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'receptions.queue.column.noPlate')}
              </span>
            )}
            {row.vehicleDisplayNumber ? (
              <code className="font-mono text-caption text-text-muted" dir="ltr">
                {row.vehicleDisplayNumber}
              </code>
            ) : null}
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
        /*
         * The name, or an absence rendered AS an absence.
         *
         * `branchName` answers null for a branch the directory no longer
         * publishes — revoked between the read and the render, or simply not in
         * this operator's list. An empty cell reads as a rendering fault; the
         * dash is the same mark the technician column uses for "there is
         * nothing here to name".
         */
        cell: (row) => {
          const name = context.branchName(row.branchId);
          return name === null ? <span className="text-text-muted">—</span> : <bdi>{name}</bdi>;
        },
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
        {/*
          A GROUP, named by the label already beside it.

          The buttons are one control with one answer, and without the role a
          screen reader announces six unrelated toggles whose shared heading is
          a stray line of text. `aria-labelledby` rather than a second
          `aria-label` so the name a reader hears and the word on the screen
          cannot drift apart. The work-order board's view chips do the same.
        */}
        <div
          role="group"
          aria-labelledby="reception-queue-period-label"
          className="flex flex-wrap items-center gap-2"
        >
          <span
            id="reception-queue-period-label"
            className="text-label font-medium text-text-primary"
          >
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={olderUnfinished}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.queue.olderUnfinished')}
          </button>
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
            onChange={(event) => setStatus(event.target.value as typeof status)}
            options={statusOptions}
            groups={statusGroups}
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
            locale={locale}
            phase={search.phase}
            correlationId={search.correlationId}
            idle={
              // Reached only while a custom period is half filled in. Nothing
              // else here can be idle — the board reads on arrival.
              <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
                {translate(messages, 'receptions.queue.chooseBothDays')}
              </p>
            }
            {...(search.phase === 'empty' && filtersApplied
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
