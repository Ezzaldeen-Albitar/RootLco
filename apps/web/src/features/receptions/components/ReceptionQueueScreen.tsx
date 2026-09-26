'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { FilterToolbar, type ToolbarFilter } from '@/components/filters/FilterToolbar';
import { boardInstantWindow } from '@/components/filters/period';
import { MuiSearchStates, type NoResultsReason } from '@/components/states/MuiStates';
import {
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import {
  useBranchTarget,
  type BranchTargetState,
} from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { WorkingContextBranch } from '@/features/working-context/working-context-contract';
import type { BranchScope, CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';
import { formatDayInZone, formatInZone } from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import { listReceptionsCancellable } from '../reception-list-read';
import {
  MAX_RECEPTION_SEARCH,
  MIN_RECEPTION_SEARCH,
  RECEPTION_BOARD_PERIODS,
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
 *
 * ## On the Material UI wrappers (ADR-022)
 *
 * The filters are `FilterToolbar` — the grouped status select, the one search
 * box, the board's five periods sent as instants on the branch's clock
 * (`period.ts#boardInstantWindow`) with the two chosen days checked at their
 * boxes, a summary line that states the period AND the clock it is counted on,
 * and the board's own links beside them. The rows are `OperationalGrid` over the
 * same `useSearchRequest(...).table`, and every state other than an answer is
 * `MuiSearchStates`. Nothing about how the board reads changed: the same
 * criteria, the same cancellable route, the same version key.
 *
 * The window is computed HERE on every render from the period in force and the
 * zone, never stored from the toolbar's callback: a branch switch that changes
 * the zone must move the window in the same render, and a stored window would
 * still be the previous branch's day.
 */

/**
 * The periods the board offers. Each resolves to instants in the branch zone.
 *
 * Declared in the contract since the dashboard began linking here carrying the
 * period a figure was counted over: a figure labelled "today" that opens a list
 * of the last seven days is a worse answer than no link at all, and one
 * declaration is what keeps the two sides naming the same five periods.
 */
const PERIOD_KINDS = RECEPTION_BOARD_PERIODS;

/** The period in force, plus the two days a custom one was applied with. */
export interface AppliedPeriod {
  readonly kind: (typeof PERIOD_KINDS)[number];
  readonly from: string;
  readonly to: string;
}

const TODAY_PERIOD: AppliedPeriod = { kind: 'today', from: '', to: '' };

/** The status control's value: nothing, a whole group, or one code — never both. */
type StatusChoice = '' | `group:${ReceptionStatusGroup}` | ReceptionStatus;

/** What the read is asked for: the scope it is addressed to and the filters. */
interface Asked {
  readonly scope: BranchScope;
  readonly filters: ReceptionListCriteria;
}

/**
 * The clock the board's days are counted on, and whose it is.
 *
 * One branch: its own zone. "All my branches": the first authorized branch's,
 * and its NAME is returned so the summary line can say whose clock it is — see
 * the docblock. A zone the directory does not publish falls back to `UTC`, and
 * the summary names `UTC`, so the fallback is stated rather than silent.
 * Anything else and the board is not read at all, so the value is never used.
 * Exported so the fallback is tested on the function: no rendered state
 * reaches it while the directory publishes a zone for every branch.
 */
export function boardClock(
  branch: BranchTargetState,
  branches: readonly Pick<WorkingContextBranch, 'id' | 'name' | 'timezone'>[]
): {
  readonly zone: string;
  readonly spansBranches: boolean;
  readonly zoneBranchName: string | null;
} {
  const zone =
    (branch.kind === 'ready'
      ? branches.find((entry) => entry.id === branch.target.branchId)?.timezone
      : branches[0]?.timezone) ?? 'UTC';
  const spansBranches = branch.kind === 'all';
  return {
    zone,
    spansBranches,
    zoneBranchName: spansBranches ? (branches[0]?.name ?? null) : null,
  };
}

export function ReceptionQueueScreen({
  locale,
  messages,
  canCreate,
  canReachIntake = false,
  searchesCustomers = true,
  initialPeriod,
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
  /**
   * Whether the server matches this caller's search on a customer's name and
   * phone — `crm.customer.read`, the code the reception read checks before it
   * searches those details. Without it a term is matched on the plate, the
   * chassis and the visit number only, and an empty answer says so rather than
   * reading as "nothing exists" (Browser QA part 7, row 2.8).
   */
  readonly searchesCustomers?: boolean;
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

  /*
   * The period in force. A chosen range that arrived with the address opens the
   * toolbar's two boxes filled with it, so the range the reader is looking at is
   * the range the form shows — the toolbar sets its boxes from this value. An
   * empty pair would invite them to "apply" a period they never asked for.
   */
  const [period, setPeriod] = useState<AppliedPeriod>(initialPeriod ?? TODAY_PERIOD);
  /*
   * What Clear owes the toolbar's two date boxes. `periodReset` is bumped by
   * Clear so the boxes close and their days go even when the period was
   * already Today — a reset the period value alone cannot express. `typedDays`
   * is the toolbar telling us the open boxes hold days, so Clear is offered for
   * them as it was when the boxes lived here.
   */
  const [periodReset, setPeriodReset] = useState(0);
  const [typedDays, setTypedDays] = useState(false);
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
  const [status, setStatus] = useState<StatusChoice>('');
  const [term, setTerm] = useState('');

  const { zone, spansBranches, zoneBranchName } = boardClock(branch, context.branches);

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
            ...boardInstantWindow(period, zone),
            ...(termIsSearchable ? { q: trimmed } : {}),
          },
        };

  const load = useCallback(
    async (
      criteria: Asked,
      cursor: string | null,
      signal: AbortSignal
    ): Promise<ReadState<CursorPage<ReceptionListEntry>>> => {
      // Cancellable (P1-32-PRE-OD-READ): a superseded read — the operator typed
      // again or switched branch — is aborted, not only discarded.
      const page = await listReceptionsCancellable(
        criteria.scope,
        criteria.filters,
        INITIAL_REQUEST,
        cursor,
        signal
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

  const search = useSearchRequest<ReceptionListEntry, Asked>({
    criteria: asked,
    load,
    version: context.version,
    // A board read is narrowed whenever it carries a bound, a status or a term
    // — and every one carries a period's bound — so an empty answer is "no
    // matches", never "nothing here yet" (route checklist, G10).
    narrows: (criteria) => Object.keys(criteria.filters).length > 0,
  });

  /**
   * "What is still here from before today", as one button.
   *
   * It was two controls used together — the period, then a status from the
   * "still with us" group — because `status` took one code at a time and the
   * set of unfinished statuses could not be sent. `statusGroup` is that set,
   * so the question is one request again and the button asks it.
   */
  const olderUnfinished = () => {
    setPeriod({ kind: 'beforeToday', from: '', to: '' });
    setStatus('group:open');
  };

  const clearFilters = () => {
    setPeriod(TODAY_PERIOD);
    setPeriodReset((count) => count + 1);
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
   * Days typed into the toolbar's open boxes count even when they are not
   * applied: they are text the operator can see, and a Clear that left them
   * sitting there would be a Clear that did not. Clear bumps `periodReset`,
   * which closes the boxes and drops the days even while Today is already in
   * force. The search box counts by the same rule, on its RAW text: a term of
   * spaces asks nothing, but it is still text in the box.
   */
  const filtersApplied =
    period.kind !== TODAY_PERIOD.kind || typedDays || status !== '' || term !== '';

  /*
   * What narrowed an empty answer, in the operator's terms: the term they typed
   * — matched on fewer details for an account that may not read customers — or
   * otherwise the period and the status. Every read is bounded by a period, so
   * an empty board is always a narrowed one and never "nothing here yet".
   */
  const emptyReason: NoResultsReason = termIsSearchable
    ? searchesCustomers
      ? 'search'
      : 'searchLimited'
    : 'filters';

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
    // The clock is always stated, not only when several branches share one
    // board (Browser QA part 7, row 3.1): a reader on another clock cannot tell
    // "today" from "today on my laptop" otherwise.
    const clock = formatMessage(translate(messages, 'receptions.queue.zoneNote'), { zone });
    return zoneName === null
      ? `${base} · ${clock}`
      : `${base} · ${translate(messages, 'receptions.queue.periodZoneOfFirstBranch')} ${zoneName} · ${clock}`;
  }, [period, zone, locale, messages, spansBranches, zoneBranchName]);

  const allColumns = useMemo<readonly OperationalColumn<ReceptionListEntry>[]>(
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
        // Passed to the grid only while the board spans branches — see
        // `columns` below. The name, never the identifier: a reference here
        // would be a second thing for the operator to look up.
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
   * The branch column exists only while the board spans branches. On one branch
   * every row is that branch's, the page already names it, and a column
   * repeating it would be noise — so it is not passed at all rather than hidden.
   */
  const columns = useMemo(
    () => (spansBranches ? allColumns : allColumns.filter((column) => column.id !== 'branch')),
    [allColumns, spansBranches]
  );

  /*
   * The next action, decided by the graph rather than by a list of codes. A
   * visit that can still move is one the desk has work to finish on; a finished
   * one is a record to open. Both land on the same read, which is what supplies
   * the version any guarded command needs — the board's own row version is a
   * snapshot and must never be spent on a write (QA-004). Both are links: no
   * reception write is reachable from this board.
   */
  const rowActions = useCallback(
    (row: ReceptionListEntry): readonly RowAction[] => {
      const about = row.displayNumber ?? undefined;
      return [
        {
          kind: 'link',
          label: isFinishedReception(row.receptionStatus)
            ? translate(messages, 'receptions.queue.open')
            : translate(messages, 'receptions.queue.continueCheckIn'),
          href: `/${locale}/receptions/check-in/${row.id}`,
          about,
        },
        {
          kind: 'link',
          label: translate(messages, 'receptions.queue.acknowledgement'),
          href: `/${locale}/receptions/check-in/${row.id}/acknowledgement`,
          about,
        },
      ];
    },
    [locale, messages]
  );

  const statusFilter: ToolbarFilter = {
    kind: 'select',
    key: 'status',
    label: translate(messages, 'receptions.queue.statusFilter'),
    value: status,
    onChange: (next) => setStatus(next as StatusChoice),
    options: statusOptions,
    groups: statusGroups,
    placeholder: translate(messages, 'receptions.queue.anyStatus'),
  };

  const blocked =
    branch.kind === 'unchosen' || branch.kind === 'none' || branch.kind === 'unavailable';
  const spansCompanies = branch.kind === 'all' && scope === null;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/*
        The branch is STATED, not asked. It is the header's own selection and
        there is exactly one place it can be changed; a second editable control
        here would be a second authority for the same fact. A board that did not
        name it would leave the operator to remember which branch they are
        reading. Under "All my branches" it names the set and its company.
      */}
      <div className="max-w-md">
        <WorkingBranchField
          messages={messages}
          label={translate(messages, 'receptions.checkIn.branch')}
          acceptsAllBranches
        />
      </div>

      <FilterToolbar
        messages={messages}
        label={translate(messages, 'receptions.queue.formLabel')}
        testId="reception-queue-toolbar"
        search={{
          label: translate(messages, 'receptions.queue.searchLabel'),
          placeholder: translate(messages, 'receptions.queue.searchPlaceholder'),
          example: translate(messages, 'receptions.queue.searchExample'),
          value: term,
          onChange: setTerm,
          onSubmit: search.submit,
          busy: search.phase === 'loading',
          maxLength: MAX_RECEPTION_SEARCH,
          error: termTooShort ? translate(messages, 'receptions.queue.searchTooShort') : undefined,
        }}
        filters={[statusFilter]}
        period={{
          format: 'instants',
          presets: PERIOD_KINDS,
          value: period,
          zone,
          // Only the SELECTION is kept. The window is derived from it and the
          // zone on every render — see the docblock.
          onChange: (selection) => setPeriod(selection),
          resetKey: periodReset,
          onTypedDaysChange: setTypedDays,
        }}
        summary={periodLabel}
        actions={
          <>
            {/*
              "What is still here from before today", as one button: the
              Before today period and the open group, in one request.
            */}
            <Button type="button" variant="outlined" size="small" onClick={olderUnfinished}>
              {translate(messages, 'receptions.queue.olderUnfinished')}
            </Button>
            {canCreate ? (
              <Button
                component={Link}
                href={`/${locale}/receptions/check-in`}
                variant="outlined"
                size="small"
              >
                {translate(messages, 'receptions.queue.checkInVehicle')}
              </Button>
            ) : null}
            {canReachIntake ? (
              <Button
                component={Link}
                href={`/${locale}/reception/walk-in`}
                variant="outlined"
                size="small"
              >
                {translate(messages, 'receptions.queue.newCustomer')}
              </Button>
            ) : null}
          </>
        }
      />

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

          <MuiSearchStates
            messages={messages}
            locale={locale}
            phase={search.phase}
            correlationId={search.correlationId}
            emptyReason={emptyReason}
            onRetry={search.submit}
            idle={
              // Reached only while a custom period is half filled in. Nothing
              // else here can be idle — the board reads on arrival.
              <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
                {translate(messages, 'receptions.queue.chooseBothDays')}
              </p>
            }
            onClearFilters={
              search.phase === 'empty' && filtersApplied ? (
                <Button type="button" variant="outlined" size="small" onClick={clearFilters}>
                  {translate(messages, 'receptions.queue.clearFilters')}
                </Button>
              ) : undefined
            }
          />

          {search.phase === 'ready' ? (
            <>
              <OperationalGrid<ReceptionListEntry>
                messages={messages}
                locale={locale}
                label={translate(messages, 'receptions.queue.caption')}
                columns={columns}
                rowId={(row) => row.id}
                table={search.table}
                rowActions={rowActions}
                suppressEmptyState
                testId="reception-queue-grid"
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
