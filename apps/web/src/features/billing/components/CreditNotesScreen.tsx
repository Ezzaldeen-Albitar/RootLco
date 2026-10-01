'use client';

/**
 * Credit notes (DEF-T-07): raise one, see what is waiting, and approve, reject
 * or withdraw it. On the shared Material UI wrappers since the sales and finance
 * slice (ADR-022): the branch's notes are `OperationalGrid` rows walked with the
 * route's cursor, the state filter is `FilterToolbar`'s chips, approving and
 * withdrawing ask first (`ConfirmDialog`), and rejecting asks for the reason
 * (`ReasonDialog`).
 *
 * The acceptance campaign took a counter-sale part back, was told "a credit note
 * is waiting for a second person to approve it", and then found nothing anywhere
 * in the product that could open one. The note existed, the approval operation
 * existed, and the second person had no way to see what they were being asked to
 * approve. This screen is the way in — and, since the Owner's requirement that
 * credit notes be usable through the application, the way to raise one against
 * an invoice and the way to approve one.
 *
 * ## One branch at a time, and the reason is not cosmetic
 *
 * `sal.credit-note-list` takes the branch as its TARGET and re-authorizes it
 * server-side, because a credit note is raised against an invoice by a return
 * that never names one — there is no parent document to hang the list off. The
 * branch is the working context's own named selection, stated by the same
 * section the counter and the returns desk use (Owner directive,
 * `P1-32-PRE-OD-UX`): it is chosen once in the header, never on this screen,
 * and the list reads as soon as one branch is selected. It opens on the notes
 * still waiting for approval, because that is the work this screen exists for.
 *
 * ## A refusal is shown as a refusal, never as an empty list
 *
 * Every credit-note operation requires `sal.finance.view` as well as
 * `sal.credit.manage`, because a credit note's whole row is gated by the finance
 * permission rather than only its amount. A caller without it is refused, and
 * the screen says so — an empty table would say "nothing has been credited at
 * this branch", which would be a different and false statement.
 *
 * ## Approving is a second person's act
 *
 * The server refuses the person who raised a note as its approver, with a named
 * rule. The screen knows who is signed in, so on a note the caller raised it
 * does not offer the approval at all and says it is waiting for another
 * approver. The server remains the guarantee: a refusal that arrives anyway (the
 * same person in another session, or a note decided meanwhile) is said in plain
 * words: a named rule reads the note again, and a note that moved on offers to
 * load the latest version.
 *
 * ## Deciding needs its own permission and limit (ADR-023, D13)
 *
 * Approving and rejecting are offered only to a holder of the credit-approval
 * permission who did not raise the note; anybody else who can see the note is
 * told that deciding it needs that permission. An approval is further held by the
 * server to the approver's credit-note limit over every approved credit on the
 * invoice, this note included. Such a refusal (the permission or the limit)
 * says which rule refused it, in words, and leaves the note pending. The note is
 * not read again, because the refusal changed nothing; a decision that landed
 * reads it again, and a conflict (the note or its invoice moved on) offers
 * "Load the latest version".
 *
 * ## A conflict is the shared conflict, and the list follows it (DF-4)
 *
 * A note decided in another tab answers the second tab's decision with a
 * conflict. The detail says so and offers "Load the latest version" — the same
 * way out every edit screen gives a conflict — and holds its decisions until the
 * latest version is loaded, because each would only send the version that has
 * just been refused. The branch list on the same screen is read again at once,
 * so the row no longer reads "Waiting for a second person" for a note that is no
 * longer waiting; every decision that lands re-reads it too.
 *
 * ## Rejecting and withdrawing (ADR-023, D3)
 *
 * A pending note can now be turned down, so it no longer waits forever. Somebody
 * other than the requester REJECTS it and says why; the requester WITHDRAWS
 * their own. Each is offered only to the person the server lets take it, each
 * sends the note's version as the detail read published it, and each is final:
 * a withdrawn or rejected note credits nothing and can never be approved. The
 * server remains the guarantee, and a refusal that arrives anyway is said in
 * words; a note that moved on offers the latest version.
 */

import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';

import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import { BranchTargetForm, PANEL } from '@/features/inventory/components/stock-operations';
import type { StockTarget } from '@/features/inventory/inventory-contract';
import { useReread } from '@/lib/api/use-reread';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';

import {
  approveCreditNote,
  listCreditNotes,
  readCreditNote,
  rejectCreditNote,
  withdrawCreditNote,
  type CreateOutcome,
} from '../api';
import {
  CREDIT_NOTE_STATES,
  type CreditNote,
  type CreditNoteEcho,
  type CreditNoteState,
} from '../billing-contract';
import { CreditNoteRequestForm } from './CreditNoteRequestForm';
import { OutcomeNote, When } from './shared';

/** `''` is every state — the toolbar's own "All" choice. */
type ListFilter = CreditNoteState | '';

/**
 * The conflicts that mean "the note moved on since it was shown" — a stale
 * version, or a note already decided or no longer covered by its invoice. The
 * adapter gives exactly these two sentences to a conflict that names no rule
 * (`../api.ts`); a conflict that names its rule keeps its own sentence.
 */
const VERSION_CONFLICTS: ReadonlySet<string> = new Set([
  'creditNotes.decision.conflict',
  'creditNotes.approve.conflict',
]);

/** The route's `MAX_REASON` for a rejection reason: two thousand characters. */
const CREDIT_NOTE_REASON_MAX = 2000;

export function CreditNotesScreen({
  locale,
  messages,
  initialCreditNoteId,
  currentUserId,
  canDecide = false,
  canSearchInvoices = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /**
   * A note named in the address, opened straight onto its detail.
   *
   * This is how the returns screen links to the credit a return raised: the
   * detail read takes an id and no branch, so the note can be shown before — or
   * without — a branch ever being chosen.
   */
  readonly initialCreditNoteId: string | null;
  /** The signed-in person, compared with `requestedBy` to say why an approval is not offered. */
  readonly currentUserId: string;
  /**
   * `sal.credit.approve` — whether Approve and Reject are offered on somebody
   * else's pending note (D13). The server re-checks it in the note's own branch,
   * and checks the approver's limit, whatever the screen offered.
   */
  readonly canDecide?: boolean;
  /** `sal.invoice.manage` — the invoice list the raise form finds an invoice through. */
  readonly canSearchInvoices?: boolean;
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [chosen, setChosen] = useState<string | null>(initialCreditNoteId);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped when a note changes state, so the branch list reads again.
  const [epoch, setEpoch] = useState(0);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <p className="text-caption text-text-muted">{translate(messages, 'creditNotes.explain')}</p>

      {notice === null ? null : (
        <p role="status" className="rounded-lg border border-border bg-surface p-3 text-body">
          {translateDynamic(messages, notice)}
        </p>
      )}

      {chosen === null ? null : (
        <CreditNoteDetail
          key={chosen}
          locale={locale}
          messages={messages}
          creditNoteId={chosen}
          currentUserId={currentUserId}
          canDecide={canDecide}
          onClose={() => setChosen(null)}
          onDecided={(key) => {
            setNotice(key);
            setEpoch((n) => n + 1);
          }}
          onListChanged={() => setEpoch((n) => n + 1)}
        />
      )}

      <BranchTargetForm
        messages={messages}
        formLabelKey="creditNotes.targetLabel"
        explainKey="creditNotes.targetExplain"
        onChosen={setTarget}
      />

      {target === null ? null : (
        <BranchCreditNotes
          key={`${target.companyId}:${target.branchId}`}
          locale={locale}
          messages={messages}
          target={target}
          epoch={epoch}
          currentUserId={currentUserId}
          canSearchInvoices={canSearchInvoices}
          chosen={chosen}
          onOpen={setChosen}
          onRequested={(key, creditNoteId) => {
            setNotice(key);
            setChosen(creditNoteId);
          }}
        />
      )}
    </div>
  );
}

function BranchCreditNotes({
  locale,
  messages,
  target,
  epoch,
  currentUserId,
  canSearchInvoices,
  chosen,
  onOpen,
  onRequested,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  /** Moves when a note changes state elsewhere on the screen; the list reads again. */
  readonly epoch: number;
  readonly currentUserId: string;
  readonly canSearchInvoices: boolean;
  readonly chosen: string | null;
  readonly onOpen: (creditNoteId: string) => void;
  readonly onRequested: (noticeKey: string, creditNoteId: string) => void;
}) {
  const [filter, setFilter] = useState<ListFilter>('pending');
  const [raised, setRaised] = useState(0);
  const load = useCallback(
    async (request: TableRequest, cursor: string | null): Promise<ServerPage<CreditNote>> => {
      const page = await listCreditNotes(target, filter === '' ? {} : { approvalState: filter }, {
        cursor,
        limit: request.pageSize,
      });
      if (page.status !== 'ok') {
        return {
          status: page.status,
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: page.correlationId,
        };
      }
      return {
        status: 'ok',
        rows: page.data.items,
        nextCursor: page.data.nextCursor,
        hasMore: page.data.hasMore,
        correlationId: page.correlationId,
      };
    },
    [target, filter]
  );
  const table = useServerTable<CreditNote>(load, {
    initial: INITIAL_REQUEST,
    // The filter lives outside the table request, and a note raised or
    // approved here is a new read: both are named so a change re-reads.
    loadKey: `${filter}#${epoch}#${raised}`,
  });

  const columns = useMemo<readonly OperationalColumn<CreditNote>[]>(
    () => [
      {
        id: 'reason',
        headerKey: 'creditNotes.column.reason',
        flex: 2,
        cell: (note) => (
          <span className="flex flex-col">
            <bdi>{note.reason}</bdi>
            <span className="text-caption text-text-muted">
              {note.issuedAt === null ? (
                translate(messages, 'creditNotes.notIssued')
              ) : (
                <When value={note.issuedAt} locale={locale} />
              )}
            </span>
          </span>
        ),
      },
      {
        id: 'amount',
        headerKey: 'creditNotes.column.amount',
        numeric: true,
        cell: (note) => (
          <span className="font-mono" dir="ltr">
            {formatMoney(note.amount, locale)}
          </span>
        ),
      },
      {
        id: 'state',
        headerKey: 'creditNotes.column.state',
        flex: 1.4,
        cell: (note) => {
          const own = note.requestedBy === currentUserId;
          return (
            <span className="flex flex-col">
              <span>{translateDynamic(messages, `creditNotes.state.${note.approvalState}`)}</span>
              {own ? (
                <span className="text-caption text-text-muted">
                  {translate(messages, 'creditNotes.byYou')}
                </span>
              ) : null}
              {own && note.approvalState === 'pending' ? (
                <span className="text-caption text-text-muted">
                  {translate(messages, 'creditNotes.ownRequest')}
                </span>
              ) : null}
            </span>
          );
        },
      },
    ],
    [currentUserId, locale, messages]
  );

  const rowActions = useCallback(
    (note: CreditNote): readonly RowAction[] => [
      {
        kind: 'button',
        label: translate(messages, 'creditNotes.open'),
        about: `${formatMoney(note.amount, locale)} ${note.reason}`,
        // A choice among the rows: which note is open is announced with it.
        pressed: note.id === chosen,
        onClick: () => onOpen(note.id),
      },
    ],
    [chosen, locale, messages, onOpen]
  );

  return (
    <>
      <section aria-labelledby="credit-notes-heading" className={PANEL}>
        <h2 id="credit-notes-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'creditNotes.list.heading')}
        </h2>
        <FilterToolbar
          messages={messages}
          label={translate(messages, 'creditNotes.list.filtersLabel')}
          testId="credit-notes-toolbar"
          filters={[
            {
              kind: 'chips',
              key: 'approvalState',
              label: translate(messages, 'creditNotes.list.status'),
              options: CREDIT_NOTE_STATES.map((value) => ({
                value,
                label: translateDynamic(messages, `creditNotes.state.${value}`),
              })),
              value: filter,
              onChange: (next) => setFilter(next as ListFilter),
            },
          ]}
        />
        <OperationalGrid<CreditNote>
          messages={messages}
          locale={locale}
          label={translate(messages, 'creditNotes.list.caption')}
          columns={columns}
          rowId={(note) => note.id}
          table={table}
          rowActions={rowActions}
          suppressEmptyState
          // A refusal names what it needs: the credit code AND the finance view.
          stateDescriptions={{
            denied: 'creditNotes.list.refused',
            unavailable: 'creditNotes.list.unavailable',
            error: 'creditNotes.list.unavailable',
          }}
          testId="credit-notes-grid"
        />
        {table.response && table.response.rows.length === 0 ? (
          <p className="py-4 text-center text-body text-text-secondary" lang={locale}>
            {translate(messages, 'creditNotes.list.none')}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="credit-note-request-heading" className={PANEL}>
        <CreditNoteRequestForm
          locale={locale}
          messages={messages}
          source={{ kind: 'find', target, canSearchInvoices }}
          onRequested={(echo) => {
            onRequested(
              echo.replayed ? 'creditNotes.request.replayed' : 'creditNotes.request.recorded',
              echo.creditNote.id
            );
            setFilter('pending');
            setRaised((n) => n + 1);
          }}
        />
      </section>
    </>
  );
}

/**
 * One credit note, read by id — and, while it is waiting, the decisions the
 * signed-in person may take on it (ADR-023, D3).
 *
 * The read takes no branch, so a note reached from a return's result is shown
 * without the operator having to work out which branch raised it.
 *
 *  - Somebody else's pending note: approve it (asks first, naming the amount and
 *    the reason) or reject it (asks for the reason, which is required and is a
 *    field error when blank).
 *  - Your own pending note: it waits for another approver, and you may withdraw
 *    it (asks first).
 *  - A decided note shows its decision and offers nothing: every decision is
 *    final.
 *
 * Rejecting and withdrawing send the note's `recordVersion` exactly as this read
 * published it. A conflict — the note changed or was decided since it was read —
 * is said in words with "Load the latest version" beside it, the branch list is
 * read again, and the decisions wait until the latest version is loaded. A
 * decision that landed reads the note again, and stays busy until it has.
 */
type Decision = 'approve' | 'reject' | 'withdraw';

function CreditNoteDetail({
  locale,
  messages,
  creditNoteId,
  currentUserId,
  canDecide,
  onClose,
  onDecided,
  onListChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly creditNoteId: string;
  readonly currentUserId: string;
  readonly canDecide: boolean;
  readonly onClose: () => void;
  readonly onDecided: (noticeKey: string) => void;
  /** Asks the branch list to read again: a conflict means its row may be stale too. */
  readonly onListChanged: () => void;
}) {
  const read = useCallback(() => readCreditNote(creditNoteId), [creditNoteId]);
  const detail = useReread<CreditNote>(read);
  const [asking, setAsking] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // The shown version was refused as stale: decisions wait for the latest one.
  const [stale, setStale] = useState(false);
  // The server's refusal of the rejection reason, drawn on the reason box itself.
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  const state = detail.value;
  const note = state?.status === 'ok' ? state.data : null;
  const own = note !== null && note.requestedBy === currentUserId;
  // Somebody else's note, and the caller holds the credit-approval permission (D13).
  const decides = note !== null && !own && canDecide;

  /**
   * What a decision's answer does to the screen. Returns true when the note must
   * be read again — after a decision that landed, and after a conflict that names
   * its rule — so each sender below re-reads in its own body, right after its own
   * guarded call. Every conflict reads the branch list again at once. A conflict
   * that means the note or its invoice moved on offers the latest version
   * instead of replacing what the operator is looking at under them.
   */
  const settle = (
    decision: Decision,
    result: CreateOutcome<CreditNoteEcho> | null,
    notices: { readonly done: string; readonly replayed: string }
  ): boolean => {
    if (result === null) {
      setAsking(null);
      setOutcome(unreachable(1));
      return false;
    }
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setAsking(null);
      setOutcome(null);
      setReasonError(undefined);
      onDecided(result.created.replayed ? notices.replayed : notices.done);
      return true;
    }
    const reasonRefusal = result.state.fieldErrors?.['reason'];
    if (decision === 'reject' && reasonRefusal !== undefined) {
      // A refusal of the reason stays on the reason box, with the typed text kept.
      setReasonError(translateDynamic(messages, reasonRefusal));
      return false;
    }
    setAsking(null);
    setOutcome(result.state);
    if (result.state.status !== 'conflict') return false;
    // Either way the list row may be stale: it is read again at once.
    onListChanged();
    if (result.state.messageKey !== undefined && VERSION_CONFLICTS.has(result.state.messageKey)) {
      // The note moved on since it was shown: the shared conflict's way out.
      setStale(true);
      return false;
    }
    // A conflict that names its rule says why in words; the note is read again.
    return true;
  };

  /** The conflict's way out: the note as stored now, and the list with it. */
  const loadLatest = async () => {
    setBusy(true);
    try {
      await detail.reload();
      setStale(false);
      setOutcome(null);
      onListChanged();
    } finally {
      setBusy(false);
    }
  };

  // Each sender stays busy until the note has been read again.
  const approve = async () => {
    setBusy(true);
    try {
      const result = await approveCreditNote(creditNoteId).catch(() => null);
      const reread = settle('approve', result, {
        done: 'creditNotes.approve.done',
        replayed: 'creditNotes.approve.replayed',
      });
      if (reread) await detail.reload();
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (version: number) => {
    setBusy(true);
    try {
      const result = await withdrawCreditNote(creditNoteId, version).catch(() => null);
      const reread = settle('withdraw', result, {
        done: 'creditNotes.withdraw.done',
        replayed: 'creditNotes.withdraw.replayed',
      });
      if (reread) await detail.reload();
    } finally {
      setBusy(false);
    }
  };
  const reject = async (version: number, reason: string) => {
    setBusy(true);
    try {
      const result = await rejectCreditNote(creditNoteId, { reason }, version).catch(() => null);
      const reread = settle('reject', result, {
        done: 'creditNotes.reject.done',
        replayed: 'creditNotes.reject.replayed',
      });
      if (reread) await detail.reload();
    } finally {
      setBusy(false);
    }
  };

  const open = (decision: Decision) => {
    setOutcome(null);
    setReasonError(undefined);
    setAsking(decision);
  };

  return (
    <section aria-labelledby="credit-note-detail-heading" className={PANEL}>
      <h2 id="credit-note-detail-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'creditNotes.detail.heading')}
      </h2>
      {state === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : state.status !== 'ok' ? (
        state.status === 'not-found' ? (
          <p role="alert" className="text-body text-error">
            {translate(messages, 'creditNotes.detail.missing')}
          </p>
        ) : (
          <MuiReadFailureState
            messages={messages}
            locale={locale}
            status={state.status}
            correlationId={state.correlationId}
            descriptionKey={
              state.status === 'denied'
                ? 'creditNotes.detail.refused'
                : 'creditNotes.detail.unavailable'
            }
            onRetry={() => void detail.reload()}
          />
        )
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.detail.amount')}
              </dt>
              <dd className="font-mono text-body text-text-primary" dir="ltr">
                {formatMoney(state.data.amount, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.detail.state')}
              </dt>
              <dd className="text-body text-text-primary">
                {translateDynamic(messages, `creditNotes.state.${state.data.approvalState}`)}
              </dd>
            </div>
            <DecisionDate note={state.data} locale={locale} messages={messages} />
          </dl>
          <div>
            <p className="text-caption text-text-muted">
              {translate(messages, 'creditNotes.detail.reason')}
            </p>
            <p className="text-body text-text-primary">
              <bdi>{state.data.reason}</bdi>
            </p>
          </div>
          {state.data.approvalState === 'rejected' && state.data.decisionReason !== null ? (
            <div>
              <p className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.detail.rejectionReason')}
              </p>
              <p className="text-body text-text-primary">
                <bdi>{state.data.decisionReason}</bdi>
              </p>
            </div>
          ) : null}
          {state.data.approvalState === 'pending' ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'creditNotes.detail.approvalNote')}
            </p>
          ) : (
            <p className="text-caption text-text-muted">
              {state.data.approvalState === 'withdrawn' && state.data.decidedBy === currentUserId
                ? translate(messages, 'creditNotes.detail.withdrawnByYou')
                : null}{' '}
              {translate(messages, 'creditNotes.detail.final')}
            </p>
          )}
          {state.data.approvalState !== 'pending' ? null : own ? (
            <div className="flex flex-col gap-2">
              <p className="text-body text-text-secondary">
                {translate(messages, 'creditNotes.detail.ownRequest')}
              </p>
              <p className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.withdraw.explain')}
              </p>
              <div>
                <Button
                  type="button"
                  variant="outlined"
                  color="error"
                  disabled={busy || stale}
                  aria-busy={busy || undefined}
                  onClick={() => open('withdraw')}
                >
                  {translate(messages, 'creditNotes.withdraw.action')}
                </Button>
              </div>
            </div>
          ) : !decides ? (
            <p className="text-body text-text-secondary" data-testid="credit-note-cannot-decide">
              {translate(messages, 'creditNotes.detail.cannotDecide')}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.approve.explain')}
              </p>
              <p className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.approve.limitExplain')}
              </p>
              <p className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.reject.explain')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="contained"
                  disabled={busy || stale}
                  aria-busy={busy || undefined}
                  onClick={() => open('approve')}
                >
                  {translate(messages, 'creditNotes.approve.action')}
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  color="error"
                  disabled={busy || stale}
                  aria-busy={busy || undefined}
                  onClick={() => open('reject')}
                >
                  {translate(messages, 'creditNotes.reject.action')}
                </Button>
              </div>
            </div>
          )}
          <ConfirmDialog
            open={asking === 'approve' && decides}
            messages={messages}
            title={translate(messages, 'creditNotes.approve.confirmTitle')}
            description={formatMessage(translate(messages, 'creditNotes.approve.confirmExplain'), {
              amount: formatMoney(state.data.amount, locale),
              reason: state.data.reason,
            })}
            confirmLabel={translate(messages, 'creditNotes.approve.action')}
            pending={busy}
            onCancel={() => setAsking(null)}
            onConfirm={() => void approve()}
            testId="credit-note-approve-dialog"
          />
          <ConfirmDialog
            open={asking === 'withdraw' && note !== null && own}
            messages={messages}
            title={translate(messages, 'creditNotes.withdraw.confirmTitle')}
            description={formatMessage(translate(messages, 'creditNotes.withdraw.confirmExplain'), {
              amount: formatMoney(state.data.amount, locale),
              reason: state.data.reason,
            })}
            confirmLabel={translate(messages, 'creditNotes.withdraw.action')}
            destructive
            pending={busy}
            onCancel={() => setAsking(null)}
            onConfirm={() => void withdraw(state.data.recordVersion)}
            testId="credit-note-withdraw-dialog"
          />
          <ReasonDialog
            open={asking === 'reject' && decides}
            messages={messages}
            title={translate(messages, 'creditNotes.reject.confirmTitle')}
            description={formatMessage(translate(messages, 'creditNotes.reject.confirmExplain'), {
              amount: formatMoney(state.data.amount, locale),
            })}
            confirmLabel={translate(messages, 'creditNotes.reject.action')}
            reasonLabel={translate(messages, 'creditNotes.reject.reason')}
            reasonError={reasonError}
            maxLength={CREDIT_NOTE_REASON_MAX}
            destructive
            pending={busy}
            onCancel={() => setAsking(null)}
            onConfirm={(reason) => void reject(state.data.recordVersion, reason)}
            testId="credit-note-reject-dialog"
          />
        </>
      )}
      <OutcomeNote messages={messages} outcome={outcome} />
      {stale ? (
        <div>
          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void loadLatest()}
            data-testid="credit-note-load-latest"
          >
            {translate(messages, 'form.loadLatest')}
          </Button>
        </div>
      ) : null}
      <div>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'creditNotes.detail.close')}
        </Button>
      </div>
    </section>
  );
}

/**
 * The date that says where a note stands: approved on, withdrawn on or rejected
 * on — or, while it waits, that it is not approved yet. A withdrawn or rejected
 * note never reads "not approved yet", which would suggest it still might be.
 */
function DecisionDate({
  note,
  locale,
  messages,
}: {
  readonly note: CreditNote;
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const declined = note.approvalState === 'withdrawn' || note.approvalState === 'rejected';
  const labelKey =
    note.approvalState === 'withdrawn'
      ? 'creditNotes.detail.withdrawnAt'
      : note.approvalState === 'rejected'
        ? 'creditNotes.detail.rejectedAt'
        : 'creditNotes.detail.approvedAt';
  const when = declined ? note.decidedAt : note.approvedAt;
  return (
    <div>
      <dt className="text-caption text-text-muted">{translate(messages, labelKey)}</dt>
      <dd className="text-body text-text-primary">
        {when === null ? (
          translate(messages, 'creditNotes.detail.notApproved')
        ) : (
          <When value={when} locale={locale} />
        )}
      </dd>
    </div>
  );
}
