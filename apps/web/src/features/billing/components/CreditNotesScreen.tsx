'use client';

/**
 * Credit notes (DEF-T-07): raise one, see what is waiting, and approve.
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

import { useCallback, useEffect, useState } from 'react';

import { SelectField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import {
  BranchListView,
  BranchTargetForm,
  PANEL,
  useBranchList,
} from '@/features/inventory/components/stock-operations';
import { SECONDARY_BUTTON } from '@/features/inventory/components/shared';
import type { StockTarget } from '@/features/inventory/inventory-contract';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';

import { approveCreditNote, listCreditNotes, readCreditNote } from '../api';
import { CREDIT_NOTE_STATES, type CreditNote, type CreditNoteState } from '../billing-contract';
import { CreditNoteRequestForm } from './CreditNoteRequestForm';
import { OutcomeNote, PRIMARY_BUTTON } from './shared';

type ListFilter = CreditNoteState | 'all';

const READERS: Record<ListFilter, (target: StockTarget) => ReturnType<typeof listCreditNotes>> = {
  all: (target) => listCreditNotes(target),
  pending: (target) => listCreditNotes(target, { approvalState: 'pending' }),
  approved: (target) => listCreditNotes(target, { approvalState: 'approved' }),
  rejected: (target) => listCreditNotes(target, { approvalState: 'rejected' }),
};

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
  readonly onOpen: (creditNoteId: string) => void;
  readonly onRequested: (noticeKey: string, creditNoteId: string) => void;
}) {
  const [filter, setFilter] = useState<ListFilter>('pending');
  const read = useCallback((where: StockTarget) => READERS[filter](where), [filter]);
  const { list, reload } = useBranchList<CreditNote>(
    target,
    read,
    'creditNotes.list.refused',
    'creditNotes.list.unavailable',
    `${filter}#${epoch}`
  );

  return (
    <>
      <section aria-labelledby="credit-notes-heading" className={PANEL}>
        <h2 id="credit-notes-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'creditNotes.list.heading')}
        </h2>
        <div className="sm:max-w-xs">
          <SelectField
            label={translate(messages, 'creditNotes.list.status')}
            value={filter}
            onChange={(event) => setFilter(event.target.value as ListFilter)}
            options={[
              ...CREDIT_NOTE_STATES.map((value) => ({
                value,
                label: translateDynamic(messages, `creditNotes.state.${value}`),
              })),
              { value: 'all', label: translate(messages, 'creditNotes.list.all') },
            ]}
          />
        </div>
        <BranchListView
          messages={messages}
          list={list}
          loadingKey="creditNotes.list.loading"
          noneKey="creditNotes.list.none"
          truncatedKey="creditNotes.list.truncated"
        >
          {(items) => (
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'creditNotes.list.caption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'creditNotes.column.reason')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'creditNotes.column.amount')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'creditNotes.column.state')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'creditNotes.column.action')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((note) => {
                  const own = note.requestedBy === currentUserId;
                  return (
                    <tr key={note.id} className="border-t border-border align-top">
                      <td>
                        {note.reason}
                        <span className="block text-caption text-text-muted" dir="ltr">
                          {note.issuedAt === null
                            ? translate(messages, 'creditNotes.notIssued')
                            : formatDateTime(note.issuedAt, locale)}
                        </span>
                      </td>
                      <td className="text-end" dir="ltr">
                        {formatMoney(note.amount, locale)}
                      </td>
                      <td>
                        {translateDynamic(messages, `creditNotes.state.${note.approvalState}`)}
                        {own ? (
                          <span className="block text-caption text-text-muted">
                            {translate(messages, 'creditNotes.byYou')}
                          </span>
                        ) : null}
                        {own && note.approvalState === 'pending' ? (
                          <span className="block text-caption text-text-muted">
                            {translate(messages, 'creditNotes.ownRequest')}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className={SECONDARY_BUTTON}
                          onClick={() => onOpen(note.id)}
                        >
                          {translate(messages, 'creditNotes.open')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </BranchListView>
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
            reload();
          }}
        />
      </section>
    </>
  );
}

type DetailState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'read'; readonly note: CreditNote }
  | { readonly phase: 'failed'; readonly messageKey: string };

/**
 * One credit note, read by id — and, when it is waiting and the caller did not
 * raise it, the approval.
 *
 * The read takes no branch, so a note reached from a return's result is shown
 * without the operator having to work out which branch raised it.
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
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [reads, setReads] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  useEffect(() => {
    let live = true;
    void readCreditNote(creditNoteId).then((answer) => {
      if (!live) return;
      if (answer.status === 'ok') {
        setState({ phase: 'read', note: answer.data });
        return;
      }
      setState({
        phase: 'failed',
        messageKey:
          answer.status === 'denied'
            ? 'creditNotes.detail.refused'
            : answer.status === 'not-found'
              ? 'creditNotes.detail.missing'
              : 'creditNotes.detail.unavailable',
      });
    });
    return () => {
      live = false;
    };
  }, [creditNoteId, reads]);

  const approve = async () => {
    setBusy(true);
    const result = await approveCreditNote(creditNoteId);
    setBusy(false);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      setState({ phase: 'read', note: result.created.creditNote });
      onApproved(
        result.created.replayed ? 'creditNotes.approve.replayed' : 'creditNotes.approve.done'
      );
      return;
    }
    setOutcome(result.state);
    // A conflict means the note or its invoice moved on: read it again so what
    // is shown is what the server now holds.
    if (result.state.status === 'conflict') setReads((n) => n + 1);
  };

  const note = state.phase === 'read' ? state.note : null;
  const own = note !== null && note.requestedBy === currentUserId;

  return (
    <section aria-labelledby="credit-note-detail-heading" className={PANEL}>
      <h2 id="credit-note-detail-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'creditNotes.detail.heading')}
      </h2>
      {state.phase === 'loading' ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'creditNotes.detail.loading')}
        </p>
      ) : state.phase === 'failed' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, state.messageKey)}
        </p>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.detail.amount')}
              </dt>
              <dd className="text-body text-text-primary" dir="ltr">
                {formatMoney(state.note.amount, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.detail.state')}
              </dt>
              <dd className="text-body text-text-primary">
                {translateDynamic(messages, `creditNotes.state.${state.note.approvalState}`)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.detail.approvedAt')}
              </dt>
              <dd className="text-body text-text-primary" dir="ltr">
                {state.note.approvedAt === null
                  ? translate(messages, 'creditNotes.detail.notApproved')
                  : formatDateTime(state.note.approvedAt, locale)}
              </dd>
            </div>
          </dl>
          <div>
            <p className="text-caption text-text-muted">
              {translate(messages, 'creditNotes.detail.reason')}
            </p>
            <p className="text-body text-text-primary">{state.note.reason}</p>
          </div>
          <p className="text-caption text-text-muted">
            {translate(messages, 'creditNotes.detail.approvalNote')}
          </p>
          {state.note.approvalState !== 'pending' ? null : own ? (
            <p className="text-body text-text-secondary">
              {translate(messages, 'creditNotes.detail.ownRequest')}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-caption text-text-muted">
                {translate(messages, 'creditNotes.approve.explain')}
              </p>
              <div>
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  disabled={busy}
                  onClick={() => {
                    void approve();
                  }}
                >
                  {translate(messages, 'creditNotes.approve.action')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'creditNotes.detail.close')}
        </button>
      </div>
    </section>
  );
}
