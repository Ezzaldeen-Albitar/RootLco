'use client';

/**
 * Raising a credit note against an issued invoice (`sal.credit-note-create`).
 *
 * Before this form a credit note could be raised by one route only — a
 * customer return of a counter-sale part — and an ordinary invoice could not be
 * credited from any screen at all. The operation existed; nothing sent it.
 *
 * ## Two ways in, one form
 *
 * On the credit-notes screen the invoice is FOUND with the invoice picker, in
 * the working branch, narrowed to the invoices that can still be credited —
 * issued, with money still open, as the server decides (`allocatable`). On an
 * invoice's own screen the invoice is already known and the form is offered
 * only while money is still open on it, so there is nothing to find.
 *
 * ## What the form does and does not decide
 *
 * The amount is checked for shape before it is sent — a decimal string, more
 * than zero, at most four decimals — because that is what the route accepts and
 * a refusal the form can predict should not cost a round trip. Whether the
 * amount fits what is still open is the SERVER's answer, taken under the
 * invoice lock, and a refusal of it is filed under the amount. No arithmetic is
 * done here.
 *
 * ## Born pending
 *
 * A raised note credits nothing. A second person approves it on the
 * credit-notes screen, and the person who raised it never can.
 */

import { useState } from 'react';

import { TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';

import { requestCreditNote } from '../api';
import {
  CREDIT_AMOUNT,
  MAX_REASON,
  type CreditNoteEcho,
  type InvoiceListEntry,
  type MoneyView,
} from '../billing-contract';
import { InvoicePicker } from './InvoicePicker';
import { Money, OutcomeNote, PRIMARY_BUTTON } from './shared';

/** The invoice a form is raised against when the screen already holds it. */
export interface KnownInvoice {
  readonly id: string;
  /** What the server says is still open, shown beside the amount. */
  readonly open: MoneyView | null;
}

type Source =
  | { readonly kind: 'known'; readonly invoice: KnownInvoice }
  | {
      readonly kind: 'find';
      readonly target: { readonly companyId: string; readonly branchId: string };
      /** `sal.invoice.manage` — the invoice list the picker reads declares it. */
      readonly canSearchInvoices: boolean;
    };

export function CreditNoteRequestForm({
  locale,
  messages,
  source,
  onRequested,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly source: Source;
  readonly onRequested: (echo: CreditNoteEcho) => void;
}) {
  const [picked, setPicked] = useState<InvoiceListEntry | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // ONE transport key per opened form, kept across a refusal or a lost answer so
  // that pressing again replays rather than raising a second note.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Unsaved work, declared to the shell: a branch switch asks before it drops
  // a half-written credit. The picker declares its own choice.
  useUnsavedGuard(amount.trim().length > 0 || reason.trim().length > 0);

  const formRef = useFocusFirstInvalid({
    status: 'invalid',
    fieldErrors: { ...(outcome?.fieldErrors ?? {}), ...errors },
    attempt,
  });

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  /** A correction clears the complaint about THAT field, and only that one. */
  const corrected = (name: string) => {
    if (errors[name] !== undefined) {
      setErrors((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
    if (outcome?.fieldErrors?.[name] !== undefined) {
      const rest = { ...outcome.fieldErrors };
      delete rest[name];
      setOutcome({ ...outcome, fieldErrors: rest });
    }
  };

  const invoiceId = source.kind === 'known' ? source.invoice.id : (picked?.id ?? null);
  const open = source.kind === 'known' ? source.invoice.open : (picked?.outstanding ?? null);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (invoiceId === null) found['invoiceId'] = 'field.required';
    const typed = amount.trim();
    if (typed.length === 0) found['amount'] = 'field.required';
    else if (!CREDIT_AMOUNT.test(typed) || !/[1-9]/.test(typed)) {
      found['amount'] = 'creditNotes.request.amountFormat';
    }
    const why = reason.trim();
    if (why.length === 0) found['reason'] = 'field.required';
    else if (why.length > MAX_REASON) found['reason'] = 'creditNotes.request.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0 || invoiceId === null) {
      setOutcome(null);
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    const result = await requestCreditNote(invoiceId, { amount: typed, reason: why }, attemptKey);
    setBusy(false);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      setPicked(null);
      setAmount('');
      setReason('');
      setAttemptKey(crypto.randomUUID());
      onRequested(result.created);
      return;
    }
    setOutcome(result.state);
    if (Object.keys(result.state.fieldErrors ?? {}).length > 0) setAttempt((n) => n + 1);
  };

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="credit-note-request-heading"
      className="flex flex-col gap-3"
    >
      <h3 id="credit-note-request-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'creditNotes.request.heading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'creditNotes.request.explain')}
      </p>
      {source.kind === 'find' ? (
        <div className="flex flex-col gap-1.5">
          <InvoicePicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'creditNotes.request.invoice')}
            target={source.target}
            allocatable
            value={picked}
            onChange={(next) => {
              setPicked(next);
              corrected('invoiceId');
              corrected('amount');
            }}
            canSearch={source.canSearchInvoices}
            error={errorFor('invoiceId')}
            testId="credit-note-invoice-picker"
          />
          <p className="text-caption text-text-muted">
            {translate(messages, 'creditNotes.request.invoiceHelp')}
          </p>
        </div>
      ) : null}
      {open !== null ? (
        <p className="text-body">
          <span className="text-text-muted">{translate(messages, 'creditNotes.request.open')}</span>{' '}
          <Money money={open} locale={locale} />
        </p>
      ) : null}
      <div className="sm:max-w-xs">
        <TextField
          label={translate(messages, 'creditNotes.request.amount')}
          description={translate(messages, 'creditNotes.request.amountHelp')}
          required
          inputMode="decimal"
          autoComplete="off"
          dir="ltr"
          name="amount"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            corrected('amount');
          }}
          error={errorFor('amount')}
        />
      </div>
      <TextAreaField
        label={translate(messages, 'creditNotes.request.reason')}
        required
        rows={2}
        name="reason"
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          corrected('reason');
        }}
        error={errorFor('reason')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'creditNotes.request.submit')}
        </button>
      </div>
    </form>
  );
}
