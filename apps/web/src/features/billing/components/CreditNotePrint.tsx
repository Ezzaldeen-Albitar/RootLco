'use client';

import { useCallback, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';

import { PrintDocument } from '@/components/print/PrintDocument';
import { PrintUnsavedNote } from '@/components/print/PrintUnsavedNote';
import { MuiLoadingState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { useReread } from '@/lib/api/use-reread';

import { readCreditNote } from '../api';
import type { CreditNoteDetail } from '../billing-contract';
import { Money, When } from './shared';

/**
 * The printable credit note (Owner decision D10, P1-32-PRE-OD-FD10).
 *
 * The backend publishes no print route, so the paper is composed from
 * `sal.credit-note-detail` — the read the credit-note screen already makes — and
 * read again when the copy is opened, so the paper carries the note as it stands
 * now rather than as it stood when the screen first showed it. No PDF is
 * generated: this is HTML that prints well, through the shared frame.
 *
 * ## The same gate as the screen
 *
 * There is no print permission code (dedicated print codes wait on the Owner's
 * open question Q9). The copy is offered on the credit-notes page, which needs
 * `sal.credit.manage` and `sal.finance.view` before anything is read, and the
 * read it makes declares the same — so nobody can print what they cannot read on
 * screen.
 *
 * ## No credit-note number exists
 *
 * A credit note carries no document number of its own: numbering is an open point
 * held with the deferred legal tax-invoice fields (the accounting questionnaire),
 * and no numbering policy is invented here. The copy is identified by a reference
 * composed only from what the note already holds — the invoice it credits, by
 * number, and the moment it was requested — and the footer says so.
 *
 * ## Names, never ids
 *
 * The invoice is named by its number and the customer it bills by name; every
 * person is named as the server names them, and a name it withholds is said to be
 * not shown. No id is printed.
 */
export function CreditNotePrintPanel({
  locale,
  messages,
  creditNoteId,
  epoch,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly creditNoteId: string;
  /** Bumped whenever the screen learns the note may have changed; an open copy reads again. */
  readonly epoch: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-labelledby="credit-note-print-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 print:border-0 print:p-0"
      lang={locale}
      data-testid="credit-note-print-panel"
    >
      <div className="flex flex-wrap items-center gap-3" data-print="hide">
        <h2 id="credit-note-print-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'creditNotes.print.heading')}
        </h2>
        <Button
          type="button"
          variant="outlined"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {translate(messages, open ? 'creditNotes.print.close' : 'creditNotes.print.open')}
        </Button>
      </div>
      {open ? (
        // Keyed on the screen's epoch: a decision or a conflict elsewhere on the
        // screen reads the copy again, and the panel stays open.
        <OpenCopy key={epoch} locale={locale} messages={messages} creditNoteId={creditNoteId} />
      ) : null}
    </section>
  );
}

/** The open copy: its own read, the Print button once it has landed, or why it cannot print. */
function OpenCopy({
  locale,
  messages,
  creditNoteId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly creditNoteId: string;
}) {
  const read = useCallback(() => readCreditNote(creditNoteId), [creditNoteId]);
  const note = useReread<CreditNoteDetail>(read);
  const state = note.value;

  return (
    <>
      <div className="flex flex-col gap-3" data-print="hide">
        <PrintUnsavedNote messages={messages} />
        {state !== null && state.status === 'ok' ? (
          <div>
            <Button type="button" variant="contained" onClick={() => window.print()}>
              {translate(messages, 'creditNotes.print.print')}
            </Button>
          </div>
        ) : null}
      </div>
      {state === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : state.status !== 'ok' ? (
        <div
          className="flex flex-wrap items-center gap-3"
          data-print="hide"
          data-testid="credit-note-print-unavailable"
        >
          <p className="text-body text-text-secondary" role="alert">
            {translate(messages, 'creditNotes.print.unavailable')}
          </p>
          <Button type="button" variant="outlined" onClick={() => void note.reload()}>
            {translate(messages, 'creditNotes.print.retry')}
          </Button>
        </div>
      ) : (
        <CreditNoteDocument locale={locale} messages={messages} note={state.data} />
      )}
    </>
  );
}

/**
 * A translated sentence whose `{name}` placeholders are filled with nodes, each
 * isolated by the caller, so a number or a date in the other script cannot
 * reorder the words around it. A placeholder with no value is left as written.
 */
function fill(template: string, values: Readonly<Record<string, ReactNode>>): ReactNode {
  const parts = template.split(/\{([a-zA-Z]+)\}/);
  return parts.map((part, index) =>
    index % 2 === 1 ? <span key={index}>{part in values ? values[part] : `{${part}}`}</span> : part
  );
}

/** A labelled figure on the copy. */
function Pair({
  label,
  children,
  testId,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div>
      <dt className="inline text-text-muted">{label} </dt>
      <dd className="inline" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/**
 * The paper itself. Exported for the tests; the screen reaches it only through
 * the panel above, once the note has been read.
 */
export function CreditNoteDocument({
  locale,
  messages,
  note,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly note: CreditNoteDetail;
}) {
  const named = (value: string | null) =>
    value === null ? (
      <span className="text-text-muted">
        {translate(messages, 'creditNotes.detail.nameNotShown')}
      </span>
    ) : (
      <bdi>{value}</bdi>
    );
  const number = note.invoice?.invoiceNumber ?? null;
  const requested = <When value={note.requestedAt} locale={locale} />;
  const reference =
    number !== null
      ? fill(translate(messages, 'creditNotes.print.reference'), {
          invoice: (
            <bdi className="font-mono" dir="ltr">
              {number}
            </bdi>
          ),
          requested,
        })
      : fill(translate(messages, 'creditNotes.print.referenceNoInvoice'), { requested });
  const decision =
    note.approvalState === 'approved'
      ? {
          byKey: 'creditNotes.detail.approvedBy' as const,
          atKey: 'creditNotes.detail.approvedAt' as const,
          by: note.approvedByName,
          at: note.approvedAt,
        }
      : note.approvalState === 'rejected'
        ? {
            byKey: 'creditNotes.detail.rejectedBy' as const,
            atKey: 'creditNotes.detail.rejectedAt' as const,
            by: note.decidedByName,
            at: note.decidedAt,
          }
        : note.approvalState === 'withdrawn'
          ? {
              byKey: 'creditNotes.detail.withdrawnBy' as const,
              atKey: 'creditNotes.detail.withdrawnAt' as const,
              by: note.decidedByName,
              at: note.decidedAt,
            }
          : null;
  const returned = note.sourceReturn;

  return (
    <PrintDocument
      title={translate(messages, 'creditNotes.print.title')}
      // No credit-note number exists: the copy repeats the same reference its
      // header already composes from the credited invoice and the request time.
      reference={reference}
      header={
        <dl className="grid gap-1">
          <Pair
            label={translate(messages, 'creditNotes.print.referenceLabel')}
            testId="credit-note-print-reference"
          >
            {reference}
          </Pair>
          <Pair label={translate(messages, 'creditNotes.detail.state')}>
            {translateDynamic(messages, `creditNotes.state.${note.approvalState}`)}
          </Pair>
        </dl>
      }
      footer={<p>{translate(messages, 'creditNotes.print.noNumber')}</p>}
    >
      <dl className="grid gap-2">
        <Pair
          label={translate(messages, 'creditNotes.detail.invoice')}
          testId="credit-note-print-invoice"
        >
          {note.invoice === null ? (
            <span className="text-text-muted">
              {translate(messages, 'creditNotes.detail.invoiceUnavailable')}
            </span>
          ) : (
            <>
              {number !== null ? (
                <bdi className="font-mono" dir="ltr">
                  {number}
                </bdi>
              ) : null}{' '}
              <span className="text-text-muted">
                {translate(
                  messages,
                  note.invoice.saleKind === 'counter_sale'
                    ? 'creditNotes.detail.counterSale'
                    : 'creditNotes.detail.workOrderInvoice'
                )}
              </span>
            </>
          )}
        </Pair>
        <Pair
          label={translate(messages, 'creditNotes.print.customer')}
          testId="credit-note-print-customer"
        >
          {note.invoice === null || note.invoice.payerName === null ? (
            <span className="text-text-muted">
              {translate(messages, 'creditNotes.detail.customerNotShown')}
            </span>
          ) : (
            <bdi>{note.invoice.payerName}</bdi>
          )}
        </Pair>
        <Pair
          label={translate(messages, 'creditNotes.detail.amount')}
          testId="credit-note-print-amount"
        >
          <strong>
            <Money money={note.amount} locale={locale} />
          </strong>
        </Pair>
        <Pair label={translate(messages, 'creditNotes.detail.reason')}>
          <bdi>{note.reason}</bdi>
        </Pair>
        <Pair label={translate(messages, 'creditNotes.detail.requestedBy')}>
          {named(note.requestedByName)}
        </Pair>
        <Pair label={translate(messages, 'creditNotes.detail.requestedAt')}>
          <When value={note.requestedAt} locale={locale} />
        </Pair>
        {decision === null ? (
          <Pair label={translate(messages, 'creditNotes.detail.approvedAt')}>
            {translate(messages, 'creditNotes.detail.notApproved')}
          </Pair>
        ) : (
          <>
            <Pair label={translate(messages, decision.byKey)} testId="credit-note-print-decided-by">
              {named(decision.by)}
            </Pair>
            <Pair label={translate(messages, decision.atKey)}>
              {decision.at === null ? (
                <span className="text-text-muted">
                  {translate(messages, 'creditNotes.print.dateNotRecorded')}
                </span>
              ) : (
                <When value={decision.at} locale={locale} />
              )}
            </Pair>
          </>
        )}
        {note.approvalState === 'rejected' && note.decisionReason !== null ? (
          <Pair label={translate(messages, 'creditNotes.detail.rejectionReason')}>
            <bdi>{note.decisionReason}</bdi>
          </Pair>
        ) : null}
        <Pair
          label={translate(messages, 'creditNotes.detail.source')}
          testId="credit-note-print-source"
        >
          {returned === null ? (
            translate(messages, 'creditNotes.detail.sourceByHand')
          ) : (
            <>
              {translate(messages, 'creditNotes.detail.sourceReturn')}
              {': '}
              {returned.itemCode !== null ? (
                <bdi className="font-mono" dir="ltr">
                  {returned.itemCode}
                </bdi>
              ) : null}{' '}
              {returned.itemName !== null ? <bdi>{returned.itemName}</bdi> : null}{' '}
              <span className="text-text-muted">
                {translate(messages, 'creditNotes.detail.returnedQuantity')}{' '}
                <bdi className="font-mono" dir="ltr">
                  {returned.quantity}
                </bdi>
                {', '}
                {translate(messages, 'creditNotes.detail.returnReceivedAt')}{' '}
                <When value={returned.receivedAt} locale={locale} />
              </span>
            </>
          )}
        </Pair>
      </dl>
    </PrintDocument>
  );
}
