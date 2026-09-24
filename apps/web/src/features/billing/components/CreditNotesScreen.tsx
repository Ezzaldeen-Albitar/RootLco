'use client';

/**
 * Credit notes (DEF-T-07).
 *
 * The acceptance campaign took a counter-sale part back, was told "a credit note
 * is waiting for a second person to approve it", and then found nothing anywhere
 * in the product that could open one. The note existed, the approval operation
 * existed, and the second person had no way to see what they were being asked to
 * approve. This screen is the way in.
 *
 * ## One branch at a time, and the reason is not cosmetic
 *
 * `sal.credit-note-list` takes the branch as its TARGET and re-authorizes it
 * server-side, because a credit note is raised against an invoice by a return
 * that never names one — there is no parent document to hang the list off. The
 * branch is the working context's own named selection, stated by the same
 * section the counter and the returns desk use (Owner directive,
 * `P1-32-PRE-OD-UX`): it is chosen once in the header, never on this screen,
 * and the list reads as soon as one branch is selected.
 *
 * ## A refusal is shown as a refusal, never as an empty list
 *
 * Both reads require `sal.finance.view` as well as `sal.credit.manage`, because
 * a credit note's whole row is gated by the finance permission rather than only
 * its amount. A caller without it is refused, and the screen says so — an empty
 * table would say "nothing has been credited at this branch", which would be a
 * different and false statement.
 *
 * ## Nothing here approves anything
 *
 * The approval is a separate act under dual control, and this screen offers no
 * control for it. It states what is waiting, for whom, and for how much; it does
 * not claim a note has been settled, refunded or approved.
 */

import { useCallback, useEffect, useState } from 'react';

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
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';

import { listCreditNotes, readCreditNote } from '../api';
import type { CreditNote } from '../billing-contract';

export function CreditNotesScreen({
  locale,
  messages,
  initialCreditNoteId,
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
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [chosen, setChosen] = useState<string | null>(initialCreditNoteId);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <p className="text-caption text-text-muted">{translate(messages, 'creditNotes.explain')}</p>

      {chosen === null ? null : (
        <CreditNoteDetail
          key={chosen}
          locale={locale}
          messages={messages}
          creditNoteId={chosen}
          onClose={() => setChosen(null)}
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
          onOpen={setChosen}
        />
      )}
    </div>
  );
}

function BranchCreditNotes({
  locale,
  messages,
  target,
  onOpen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly onOpen: (creditNoteId: string) => void;
}) {
  const read = useCallback((where: StockTarget) => listCreditNotes(where), []);
  const { list } = useBranchList<CreditNote>(
    target,
    read,
    'creditNotes.list.refused',
    'creditNotes.list.unavailable'
  );

  return (
    <section aria-labelledby="credit-notes-heading" className={PANEL}>
      <h2 id="credit-notes-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'creditNotes.list.heading')}
      </h2>
      <BranchListView
        messages={messages}
        list={list}
        loadingKey="creditNotes.list.loading"
        noneKey="creditNotes.list.none"
        truncatedKey="creditNotes.list.truncated"
      >
        {(items) => (
          <table className="w-full text-body">
            <caption className="sr-only">{translate(messages, 'creditNotes.list.caption')}</caption>
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
              {items.map((note) => (
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
                  <td>{translateDynamic(messages, `creditNotes.state.${note.approvalState}`)}</td>
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
              ))}
            </tbody>
          </table>
        )}
      </BranchListView>
    </section>
  );
}

type DetailState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'read'; readonly note: CreditNote }
  | { readonly phase: 'failed'; readonly messageKey: string };

/**
 * One credit note, read by id.
 *
 * The read takes no branch, so a note reached from a return's result is shown
 * without the operator having to work out which branch raised it.
 */
function CreditNoteDetail({
  locale,
  messages,
  creditNoteId,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly creditNoteId: string;
  readonly onClose: () => void;
}) {
  const [state, setState] = useState<DetailState>({ phase: 'loading' });

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
  }, [creditNoteId]);

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
        </>
      )}
      <div>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'creditNotes.detail.close')}
        </button>
      </div>
    </section>
  );
}
