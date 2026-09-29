'use client';

/**
 * Credit notes (DEF-T-07): raise one, see what is waiting, and approve. On the
 * shared Material UI wrappers since the sales and finance slice (ADR-022): the
 * branch's notes are `OperationalGrid` rows walked with the route's cursor, the
 * state filter is `FilterToolbar`'s chips, and approving asks first
 * (`ConfirmDialog`).
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
 * words and the note is read again.
 *
 * There is no rejection. The backend publishes no operation for it, and a
 * pending note credits nothing, so leaving one unapproved is already the safe
 * outcome.
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

import { approveCreditNote, listCreditNotes, readCreditNote } from '../api';
import { CREDIT_NOTE_STATES, type CreditNote, type CreditNoteState } from '../billing-contract';
import { CreditNoteRequestForm } from './CreditNoteRequestForm';
import { OutcomeNote, When } from './shared';

/** `''` is every state — the toolbar's own "All" choice. */
type ListFilter = CreditNoteState | '';

export function CreditNotesScreen({
  locale,
  messages,
  initialCreditNoteId,
  currentUserId,
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
          onClose={() => setChosen(null)}
          onApproved={(key) => {
            setNotice(key);
            setEpoch((n) => n + 1);
          }}
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
 * One credit note, read by id — and, when it is waiting and the caller did not
 * raise it, the approval.
 *
 * The read takes no branch, so a note reached from a return's result is shown
 * without the operator having to work out which branch raised it. Approving
 * asks first, naming the amount and the reason, and stays busy until the note
 * has been read again.
 */
function CreditNoteDetail({
  locale,
  messages,
  creditNoteId,
  currentUserId,
  onClose,
  onApproved,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly creditNoteId: string;
  readonly currentUserId: string;
  readonly onClose: () => void;
  readonly onApproved: (noticeKey: string) => void;
}) {
  const read = useCallback(() => readCreditNote(creditNoteId), [creditNoteId]);
  const detail = useReread<CreditNote>(read);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const approve = async () => {
    setBusy(true);
    try {
      let result: Awaited<ReturnType<typeof approveCreditNote>>;
      try {
        result = await approveCreditNote(creditNoteId);
      } catch {
        setAsking(false);
        setOutcome(unreachable(1));
        return;
      }
      notifyActionResult(result.state, messages);
      setAsking(false);
      if (result.state.status === 'success' && result.created) {
        setOutcome(null);
        onApproved(
          result.created.replayed ? 'creditNotes.approve.replayed' : 'creditNotes.approve.done'
        );
        // Busy until the note, now approved, is read again.
        await detail.reload();
        return;
      }
      setOutcome(result.state);
      // A conflict means the note or its invoice moved on: read it again so what
      // is shown is what the server now holds.
      if (result.state.status === 'conflict') await detail.reload();
    } finally {
      setBusy(false);
    }
  };

  const state = detail.value;
  const note = state?.status === 'ok' ? state.data : null;
  const own = note !== null && note.requestedBy === currentUserId;

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
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.detail.approvedAt')}
              </dt>
              <dd className="text-body text-text-primary">
                {state.data.approvedAt === null ? (
                  translate(messages, 'creditNotes.detail.notApproved')
                ) : (
                  <When value={state.data.approvedAt} locale={locale} />
                )}
              </dd>
            </div>
          </dl>
          <div>
            <p className="text-caption text-text-muted">
              {translate(messages, 'creditNotes.detail.reason')}
            </p>
            <p className="text-body text-text-primary">
              <bdi>{state.data.reason}</bdi>
            </p>
          </div>
          <p className="text-caption text-text-muted">
            {translate(messages, 'creditNotes.detail.approvalNote')}
          </p>
          {state.data.approvalState !== 'pending' ? null : own ? (
            <p className="text-body text-text-secondary">
              {translate(messages, 'creditNotes.detail.ownRequest')}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.approve.explain')}
              </p>
              <div>
                <Button
                  type="button"
                  variant="contained"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => {
                    setOutcome(null);
                    setAsking(true);
                  }}
                >
                  {translate(messages, 'creditNotes.approve.action')}
                </Button>
              </div>
            </div>
          )}
          <ConfirmDialog
            open={asking && note !== null && !own}
            messages={messages}
            title={translate(messages, 'creditNotes.approve.confirmTitle')}
            description={formatMessage(translate(messages, 'creditNotes.approve.confirmExplain'), {
              amount: formatMoney(state.data.amount, locale),
              reason: state.data.reason,
            })}
            confirmLabel={translate(messages, 'creditNotes.approve.action')}
            pending={busy}
            onCancel={() => setAsking(false)}
            onConfirm={() => void approve()}
            testId="credit-note-approve-dialog"
          />
        </>
      )}
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'creditNotes.detail.close')}
        </Button>
      </div>
    </section>
  );
}
