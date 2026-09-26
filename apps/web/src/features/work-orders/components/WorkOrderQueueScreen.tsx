'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { DigitsEcho } from '@/components/forms/DigitsEcho';
import { SelectField, TextField } from '@/components/forms/Field';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import { readDashboardSummaryCancellable } from '@/features/overview/dashboard-summary-read';
import { figureStateOf, type DashboardSummary } from '@/features/overview/overview-contract';
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
import { readWorkOrderCatalogue } from '../api';
import { listWorkOrdersCancellable } from '../work-order-list-read';
import {
  MAX_WORK_ORDER_SEARCH,
  MIN_WORK_ORDER_SEARCH,
  WORK_ORDER_BOARD_DEFAULT_VIEW,
  WORK_ORDER_BOARD_VIEWS,
  WORK_ORDER_KINDS,
  finishedStates,
  openStates,
  workOrderStateLabel,
  type WorkOrderBoardView,
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
 * NINE, and each is one request the route already accepts:
 *
 *   - **Still with us** — `stateGroup: 'active'`, and the DEFAULT. The backend
 *     resolves the group from the tenant catalogue's own terminal and
 *     cancellation flags, so a workshop that defines its own state is covered
 *     on the day it defines it. Any age: the question is "what is still ours",
 *     not "what arrived recently".
 *   - **All** — no narrowing at all.
 *   - **Created today** — `openedFrom`/`openedTo` over the branch's day.
 *   - **Finished today** — `completedFrom`/`completedTo` over the same day. A
 *     different question from the one above it, and the platform records it
 *     separately; either bound narrows the board to finished work by
 *     construction, because an unfinished order has no completion instant.
 *   - the five board FLAGS, each backed by a row the schema really keeps: a live
 *     job assignment for the caller, parts not yet in hand on an unfinished
 *     order, a pending additional-work request, a pending quality result, and a
 *     closed non-cancellation state.
 *
 * Two of these could not be asked for at all one wave ago — `state` took a
 * single catalogue code and there was no completion window — and this screen
 * reported them as gaps rather than filtering a fetched page in the browser,
 * which produces short pages and a `hasMore` that lies. The board-list
 * contracts closed both.
 *
 * A state CODE and a state GROUP may not travel together: the route answers 422
 * `state_and_group_exclusive` rather than intersecting them. The exclusion is
 * structural here — choosing a state moves the view off **Still with us**, and
 * choosing that view clears the state — so the refusal is unreachable and the
 * screen never has to explain it.
 *
 * ## Counts come from the aggregate, never from the page
 *
 * A board holds one page. Counting its rows answers "how many are on this page"
 * and printing that beside a view called "Waiting for parts" states something
 * else entirely. `ovw.dashboard-summary-read` computes each figure as a SQL
 * aggregate over the whole scoped selection inside the RLS-bound transaction;
 * this screen reads it through `features/overview`, which the dashboard wave
 * reuses.
 *
 * ## A figure sits on a chip only where the two count the same SET
 *
 * Four of the nine views qualify, and each is an identity rather than a
 * resemblance — `chipFigure` below carries the proof for each, and the reason
 * every other view carries no number. The rest of the published figures live in
 * the strip, labelled with the set the AGGREGATE counts, and the strip says
 * plainly that it is about the branch's day rather than about the list.
 *
 * The pairing is checked, not assumed. "Awaiting parts" is the case that taught
 * it: the aggregate once counted NON-TERMINAL orders whose `parts_forward_state`
 * was `requested` while the list filter was any `parts_forward_state` other than
 * `none` in any state at all, and the two sat beside each other as one claim.
 * Both now use ONE backend predicate, and only that is what put it on a chip.
 *
 * Each figure carries its own state and all three are rendered apart: computed,
 * withheld for want of the section's own read code, or unanswerable. A withheld
 * figure reads "not available to you" rather than nought, because nought would
 * be a false statement about the workshop instead of a true one about the
 * caller. The `reason` an unanswerable section carries is server-authored PROSE
 * and never reaches the screen; the catalogue's own sentence is rendered.
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

/**
 * The views the operation can actually be sent. See the docblock.
 *
 * Declared in the contract rather than here since the dashboard began linking
 * to them: a link built from a name this board does not recognise lands on the
 * unfiltered list while looking as though it worked, and one declaration is
 * what stops the two sides drifting apart.
 */
type ViewKind = WorkOrderBoardView;

const VIEW_KINDS: readonly ViewKind[] = WORK_ORDER_BOARD_VIEWS;

/** What became of a state code that arrived in the address. See the body. */
type Arrival = 'none' | 'pending' | 'accepted' | 'refused' | 'unread';

/** The board opens on the work that is still the workshop's problem. */
const DEFAULT_VIEW: ViewKind = WORK_ORDER_BOARD_DEFAULT_VIEW;

/** What the read is asked for: the scope it is addressed to and the filters. */
interface Asked {
  readonly scope: BranchScope;
  readonly filters: WorkOrderListCriteria;
}

/**
 * What one view asks for. Everything absent is "did not ask".
 *
 * Two of them are windows rather than flags, and both are measured on the
 * BRANCH's clock: "created today" over the opened instant and "completed today"
 * over the completion instant. Either completion bound narrows the board to
 * finished work by construction, because an unfinished work order has no
 * completion instant at all.
 */
function criteriaOf(view: ViewKind, zone: string): WorkOrderListCriteria {
  const today = dayIn(zone);
  switch (view) {
    case 'active': {
      // The GROUP, not a state code. The backend resolves it from the tenant
      // catalogue's own flags, so a workshop that defines its own state is
      // covered on the day it defines it — and it is exactly the set the
      // overview aggregate calls active.
      return { stateGroup: 'active' };
    }
    case 'openedToday': {
      const window = rangeOfDays(zone, today, today);
      return { openedFrom: window.from, openedTo: window.to };
    }
    case 'completedToday': {
      const window = rangeOfDays(zone, today, today);
      return { completedFrom: window.from, completedTo: window.to };
    }
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
      return {};
  }
}

export function WorkOrderQueueScreen({
  locale,
  messages,
  initialView = DEFAULT_VIEW,
  initialState = '',
  canReachDelivery = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /**
   * All three codes the delivery queue's own page requires —
   * `sal.delivery.view`, `wo.work_order.read` and `sal.finance.view`, the set
   * `DELIVERY_READINESS_PERMISSIONS` names.
   *
   * Gating the LINK on the destination's own rule is the point, and the rule is
   * the whole set rather than the one code the navigation entry carries: the
   * delivery page refuses an operator missing ANY of the three, so an offer made
   * on the strength of one of them lands on a refusal. Defaulting to `false`
   * means a caller that has not decided offers nothing, which is the direction
   * a mistake here should fail in.
   */
  readonly canReachDelivery?: boolean;
  /**
   * The view this board opens on, when it was reached from a figure elsewhere.
   *
   * Validated by the ROUTE against `WORK_ORDER_BOARD_VIEWS` before it arrives,
   * so an unrecognised name never reaches this component: it becomes the
   * default view, which is what the address without it means.
   */
  readonly initialView?: WorkOrderBoardView | undefined;
  /**
   * The state code this board opens filtered to.
   *
   * The route checks its SHAPE against the one the operation accepts; this
   * screen checks its MEANING against the workshop's own catalogue, because the
   * two are different questions and only the second can be answered here. A
   * well-formed code for a state nobody defined is dropped with a notice, and
   * the board reads unfiltered. See the arrival note in the body.
   */
  readonly initialState?: string | undefined;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  /*
   * The arriving view and state are the board's STARTING position and nothing
   * more. Once here, the strip and the picker own them — a reader who presses
   * another view is not fighting the address they came from.
   *
   * The view is one of nine this repository declares, so it is believed on
   * sight. The state is a code out of the WORKSHOP's own vocabulary, which this
   * repository does not hold: it is left out of the filter until the catalogue
   * has been read and says the workshop keeps it. See the arrival note below.
   */
  //
  // A state that arrives with the default view starts on `all` instead: the
  // default sends a state GROUP, the list operation refuses a code and a group
  // together, and a refused code must leave the board showing everything.
  const [view, setView] = useState<ViewKind>(
    initialState.trim() !== '' && initialView === 'active' ? 'all' : initialView
  );
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

  /*
   * What became of a state code that arrived in the address.
   *
   *   `none`     — none arrived.
   *   `pending`  — one did, and the catalogue has not answered yet. The board
   *                asks for NOTHING in this state: a code matching the
   *                operation's shape is not thereby a code this workshop keeps,
   *                and sending it would either narrow the board by a state
   *                nobody defined or be answered 422 far from the link.
   *   `accepted` — the catalogue names it. The picker shows it and the read
   *                carries it.
   *   `refused`  — the catalogue was read and does not name it. The code is
   *                DROPPED, the picker stands at "Any state", and a line says
   *                the requested state is not one this workshop uses rather
   *                than letting the board look filtered when it is not.
   *   `unread`   — the catalogue could not be read at all. The code is DROPPED
   *                for the same reason — nothing established that the workshop
   *                keeps it — but the line says what actually happened: the
   *                state list could not be loaded, so the state was not
   *                applied. Saying "not one this workshop uses" here would be a
   *                claim about the workshop that nobody checked.
   *
   * A ref decides it once, at arrival. The catalogue is re-read whenever the
   * working branch changes, and re-running this on a later read would overwrite
   * a state the operator has since chosen with one from an address they left
   * behind.
   */
  const requestedState = initialState.trim();
  const openedWith: 'none' | 'pending' = requestedState === '' ? 'none' : 'pending';
  // Both start from the same expression rather than one reading the other: a
  // ref may not be read during render, and this is the render that sets up.
  const arrivalRef = useRef<Arrival>(openedWith);
  const [arrival, setArrival] = useState<Arrival>(openedWith);

  useEffect(() => {
    let cancelled = false;
    void readWorkOrderCatalogue().then((read) => {
      if (cancelled) return;
      const states = read.status === 'ok' ? read.data.workOrderStates : [];
      if (read.status === 'ok') setCatalogue(states);
      if (arrivalRef.current === 'pending') {
        const known = states.some((entry) => entry.code === requestedState);
        arrivalRef.current = read.status !== 'ok' ? 'unread' : known ? 'accepted' : 'refused';
        setArrival(arrivalRef.current);
        if (known) {
          setState(requestedState);
          // The same exclusion `chooseState` keeps: a state code never travels
          // with the `active` group, so an accepted code moves the view off it.
          setView((current) => (current === 'active' ? 'all' : current));
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [context.version, requestedState]);

  /*
   * The figures, read once per scope and period.
   *
   * `period: 'today'` because the two figures this board shows — how much work
   * is open, and how much finished — are the day's questions.
   *
   * The response names the zone those days were counted in, and the strip
   * RENDERS it rather than merely receiving it: the aggregate resolves the day
   * on the database clock in the branch's own zone, and a figure headed
   * "finished today" is a claim about a day boundary the reader cannot see.
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
    // Aborted when the scope moves or the board unmounts, so the figures for a
    // branch the operator has left are cancelled, not only discarded
    // (P1-32-PRE-OD-READ). A cancelled read rejects; that rejection is this
    // effect's own doing and there is nothing to show for it.
    const controller = new AbortController();
    void readDashboardSummaryCancellable(
      { companyId, branchId },
      { period: 'today' },
      controller.signal
    ).then(
      (read) => {
        if (!cancelled) setSummary({ key: summaryKey, read });
      },
      () => undefined
    );
    return () => {
      cancelled = true;
      controller.abort();
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

  /*
   * The operator's own opened-date range, which is a SEPARATE control from the
   * "created today" view and overrides it when both are set: the explicit dates
   * are the more specific ask, and sending two windows over one column would be
   * the screen arguing with itself.
   */
  const openedWindow =
    openedRange === null ? null : rangeOfDays(zone, openedRange.from, openedRange.to);

  /*
   * Built inline on every render — `useSearchRequest` keys on the SERIALISED
   * criteria rather than on the object's identity, so a new object with the same
   * content asks for the same thing. `null` is "there is nothing to ask for",
   * which here means no resolvable scope.
   */
  /*
   * Built inline, and that is also what makes a branch change safe: the scope
   * and the zone are derived from the working context on every render, so
   * nothing local holds a stale copy of either. The version change and the new
   * criteria arrive in the same render, and `useSearchRequest` treats the
   * version change as a submission of exactly these criteria.
   *
   * Nothing is asked for while a code that arrived in the address is still
   * unresolved. A board that read first and narrowed second would show the
   * whole branch for a frame under a heading the address promised was filtered.
   */
  const asked: Asked | null =
    scope === null || arrival === 'pending'
      ? null
      : {
          scope,
          filters: {
            ...criteriaOf(view, zone),
            /*
             * A state CODE and a state GROUP may not travel together: the route
             * answers 422 `state_and_group_exclusive` rather than intersecting
             * them. The exclusion is structural here rather than validated —
             * choosing a state moves the view off `active`, and choosing
             * `active` clears the state — so the refusal is unreachable and the
             * screen never has to explain it.
             */
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
      cursor: string | null,
      signal: AbortSignal
    ): Promise<ReadState<CursorPage<WorkOrderListEntry>>> => {
      // Cancellable (P1-32-PRE-OD-READ): a superseded read — the operator typed
      // again or switched branch — is aborted, not only discarded.
      const page = await listWorkOrdersCancellable(
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

  /*
   * Choosing a state moves the view off the one that sends a group, and
   * choosing that view clears the state. See the criteria above: the backend
   * refuses the pair, and the honest fix is a screen that cannot send it.
   */
  const chooseState = (next: string) => {
    setState(next);
    if (next !== '' && view === 'active') setView('all');
  };

  const chooseView = (next: ViewKind) => {
    setView(next);
    if (next === 'active') setState('');
  };

  const clearFilters = () => {
    setView(DEFAULT_VIEW);
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
        // The name, or an absence rendered as one — never an empty cell, which
        // reads as a rendering fault rather than as "there is nothing to name".
        cell: (row) => {
          const name = context.branchName(row.branchId);
          return name === null ? <span className="text-text-muted">—</span> : <bdi>{name}</bdi>;
        },
      },
    ],
    [catalogue, context, locale, messages, zone]
  );

  const blocked =
    branch.kind === 'unchosen' || branch.kind === 'none' || branch.kind === 'unavailable';
  const spansCompanies = branch.kind === 'all' && scope === null;

  /*
   * Every figure the aggregate publishes for this board, in the aggregate's own
   * terms.
   *
   * The label of each one states the SET it counts — "open orders waiting for
   * parts", not a bare "parts" — because that is the only way a figure and a
   * list filter can sit on one screen without appearing to disagree.
   */
  const FIGURES = [
    {
      id: 'active',
      labelKey: 'workOrders.queue.figure.active',
      section: sections?.activeWorkOrders,
    },
    {
      id: 'completed',
      labelKey: 'workOrders.queue.figure.completedToday',
      section: sections?.completedInPeriod,
    },
    {
      id: 'awaitingApproval',
      labelKey: 'workOrders.queue.figure.awaitingApproval',
      section: sections?.awaitingApproval,
    },
    {
      id: 'awaitingParts',
      labelKey: 'workOrders.queue.figure.awaitingParts',
      section: sections?.awaitingParts,
    },
    {
      id: 'readyForDelivery',
      labelKey: 'workOrders.queue.figure.readyForDelivery',
      section: sections?.readyForDelivery,
    },
  ] as const;
  const figures = FIGURES.map((entry) => ({ ...entry, state: figureStateOf(entry.section) }));

  /**
   * The figure a view's chip may carry, or `null` where the two still count
   * different sets.
   *
   * FOUR of the nine agree EXACTLY, and each agreement is a fact about the
   * database rather than a resemblance:
   *
   *   - `active` — the route resolves the group as
   *     `!isTerminal && !isCancellation` and the aggregate as `!isTerminal`.
   *     `ck_work_order_states_cancellation` makes a cancellation terminal, so
   *     the second conjunct is implied and the sets are identical.
   *   - `readyForDelivery` — both resolve `isClosed && !isCancellation` from
   *     the live catalogue.
   *   - `awaitingParts` — both are the repository's ONE
   *     `waitingForPartsPredicate`: parts `requested` or `reserved_elsewhere`,
   *     on a live order that is not in a terminal state.
   *   - `awaitingApproval` — both are the repository's ONE
   *     `PENDING_DECISION_EXISTS` over live work orders: the aggregate counts
   *     distinct work orders, not requests, and no longer counts a request whose
   *     work order was soft-deleted.
   *
   * The other five carry no figure, and each for a stated reason:
   *
   *   - `all` and `mine` — the aggregate publishes no such total.
   *   - `openedToday` — the aggregate's per-day opened counts sit inside a
   *     trend array under their own definition, which has not been held against
   *     this window.
   *   - `completedToday` — the aggregate counts ENTRIES into a finished state
   *     during the day; the list requires the order to be finished NOW. They
   *     disagree about a job completed this morning and reopened this
   *     afternoon.
   *   - `awaitingQuality` — the aggregate publishes no section for it.
   */
  const chipFigure = (kindOfView: ViewKind): number | null => {
    if (sections === null) return null;
    const section =
      kindOfView === 'active'
        ? sections.activeWorkOrders
        : kindOfView === 'readyForDelivery'
          ? sections.readyForDelivery
          : kindOfView === 'awaitingParts'
            ? sections.awaitingParts
            : kindOfView === 'awaitingApproval'
              ? sections.awaitingApproval
              : undefined;
    const resolved = figureStateOf(section);
    return resolved.kind === 'figure' ? resolved.value : null;
  };
  const anyFigure = figures.some((entry) => entry.state.kind !== 'absent');
  const figureZone =
    summary !== null && summary.read.status === 'ok' ? summary.read.data.period.timezone : null;

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
          {/*
            A FIGURE ONLY WHERE THE TWO PREDICATES ARE THE SAME SET.

            A number beside a view is read as "this is how many the list below
            will show", so it may only appear where that is true. `chipFigure`
            carries the four that agree and the reason each of the other five
            does not; the strip below carries every published figure, labelled
            by what the AGGREGATE counts, for the ones a chip cannot claim.

            The figures are still branch-wide: a chip's number is the view's own
            predicate over the whole branch, and the list additionally honours
            whatever else the operator has set here. The strip says so.
          */}
          {VIEW_KINDS.map((kindOfView) => {
            const figure = chipFigure(kindOfView);
            return (
              <button
                key={kindOfView}
                type="button"
                aria-pressed={view === kindOfView}
                onClick={() => chooseView(kindOfView)}
                className={
                  view === kindOfView
                    ? 'rounded-md border border-border bg-primary px-3 py-1.5 text-body text-on-primary transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                    : 'rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                }
              >
                {translateDynamic(messages, `workOrders.queue.view.${kindOfView}`)}
                {figure === null ? null : (
                  <span className="ms-2 text-caption">{formatInteger(figure, locale)}</span>
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
            // The list read is a union the server enforces, so "All my
            // branches" is named here as what the board is showing — never the
            // "choose one branch" ask beside rows from both (QA part 7, 1b.4).
            acceptsAllBranches
          />
          <SelectField
            label={translate(messages, 'workOrders.queue.stateFilter')}
            description={translate(messages, 'workOrders.queue.stateFilterHelp')}
            value={state}
            onChange={(event) => chooseState(event.target.value)}
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
        The branch's day, from the aggregate — never from the page.

        A board holds one page, so counting its rows answers "how many are on
        this page". Every figure here is a SQL aggregate over the whole scoped
        selection, computed inside the read's own transaction, and each is
        labelled with the set it counts so it cannot be read as a preview of the
        list below.
      */}
      {!anyFigure ? null : (
        <div
          data-testid="work-order-summary-strip"
          className="flex flex-col gap-1 rounded-md border border-border bg-surface-subtle px-3 py-2 text-supporting text-text-secondary"
        >
          <p className="flex flex-wrap items-center gap-3">
            {figures.map((entry) =>
              entry.state.kind === 'absent' ? null : (
                <span key={entry.id} data-testid={`figure-${entry.id}`}>
                  {translateDynamic(messages, entry.labelKey)}{' '}
                  {entry.state.kind === 'figure' ? (
                    <bdi>{formatInteger(entry.state.value, locale)}</bdi>
                  ) : entry.state.kind === 'withheld' ? (
                    // A permission answer, not a business one. A zero would say
                    // the workshop has none of these.
                    <span className="text-text-muted">
                      {translate(messages, 'workOrders.queue.figure.withheld')}
                    </span>
                  ) : (
                    // The platform holds nothing the question could be asked of,
                    // and no permission would change that. The operation sends a
                    // sentence explaining which; it is server prose, so the
                    // catalogue's own sentence is rendered instead.
                    <span className="text-text-muted">
                      {translate(messages, 'workOrders.queue.figure.unavailable')}
                    </span>
                  )}
                </span>
              )
            )}
          </p>
          <p className="text-caption text-text-muted" lang={locale}>
            {translate(
              messages,
              spansBranches
                ? 'workOrders.queue.figure.noteAllBranches'
                : 'workOrders.queue.figure.note'
            )}
            {figureZone === null ? null : (
              <>
                {' '}
                {translate(messages, 'workOrders.queue.figure.zone')}{' '}
                <bdi data-testid="figure-zone">{figureZone}</bdi>
              </>
            )}
          </p>
        </div>
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

          {/*
            An address asked for a state this workshop does not keep. The board
            is showing everything, and says so — silently ignoring the request
            would leave the reader believing they are looking at a filtered list.
          */}
          {arrival === 'refused' ? (
            <p
              role="status"
              data-testid="work-order-queue-state-unknown"
              className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
            >
              {translate(messages, 'workOrders.queue.stateNotRecognised')}
            </p>
          ) : arrival === 'unread' ? (
            <p
              role="status"
              data-testid="work-order-queue-state-unapplied"
              className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
            >
              {translate(messages, 'workOrders.queue.stateListUnavailable')}
            </p>
          ) : null}

          <SearchStates
            messages={messages}
            locale={locale}
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
              {view === 'readyForDelivery' && canReachDelivery ? (
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
