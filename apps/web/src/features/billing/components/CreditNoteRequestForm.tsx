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
 * the working branch, narrowed to the issued invoices with money still open, as
 * the server decides (`allocatable`). On an invoice's own screen the invoice is
 * already known and the form is offered while the server says it can still be
 * credited — even once it is paid (ADR-023 D2) — so there is nothing to find. A
 * paid invoice is therefore credited from its own screen.
 *
 * ## What the form does and does not decide
 *
 * The amount is checked for shape before it is sent — a decimal string, more
 * than zero, at most four decimals — because that is what the route accepts and
 * a refusal the form can predict should not cost a round trip. It is checked
 * against the minor unit the server published for the invoice's currency
 * (`fitsMinorUnit`), so an amount finer than the currency's smallest coin is
 * refused on the box rather than by the route. It is also
 * compared, digit by digit (`compareMoney`), with what the server says the invoice
 * can still be CREDITED — its total less the credit notes already approved (Owner
 * decision D2, ADR-023, P1-32-PRE-OD-FD2B) — and an amount above that is refused
 * here. It is not capped at what is still owed: since D2 a paid invoice can be
 * credited, and the part of a credit above what is still owed becomes a refund
 * owed to the customer once approved — never paid back automatically. The form
 * says so beside both figures, and says it again when the amount typed is above
 * what is still owed, which is a comparison of two of the server's strings and
 * not a subtraction.
 *
 * What the form does NOT show is "creditable minus the credit notes still pending
 * on this invoice". No read states that sum, and computing it here would mean
 * paging the pending notes and ADDING money in the browser — a second money
 * engine. So the form shows the figures the server states and says, beside them,
 * that pending notes may reduce what can be approved. Whether the amount still
 * fits when it is approved is the SERVER's answer, taken under the invoice lock,
 * and a refusal of it is filed under the amount. No arithmetic is done here.
 *
 * ## Born pending
 *
 * A raised note credits nothing. A second person approves it on the
 * credit-notes screen, and the person who raised it never can.
 *
 * ## On the shared Material UI wrappers
 *
 * Since the sales and finance slice (ADR-022): the invoice is found with the
 * Material combobox, the amount is a money field in the invoice's currency
 * (a string throughout, canonicalised on leaving the box), and the reason a
 * multi-line text field. A refusal marks its field, keeps what was typed and
 * puts the cursor on the first field to fix; correcting a field withdraws its
 * complaint.
 */

import { useState } from 'react';
import Button from '@mui/material/Button';

import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';

import { compareMoney, fitsMinorUnit } from '@/lib/money';

import { requestCreditNote } from '../api';
import {
  CREDIT_AMOUNT,
  MAX_REASON,
  type CreditNoteEcho,
  type InvoiceListEntry,
  type MoneyView,
} from '../billing-contract';
import { InvoicePicker } from './InvoicePicker';
import { Money, OutcomeNote } from './shared';

/** The invoice a form is raised against when the screen already holds it. */
export interface KnownInvoice {
  readonly id: string;
  /** What the server says is still open, shown beside the amount. */
  readonly open: MoneyView | null;
  /**
   * What the server says the invoice can still be credited (ADR-023 D2) — the cap.
   * `null` from a server that does not state it, when the open amount is the cap.
   */
  readonly creditable: MoneyView | null;
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
  // a half-written credit. The picker declares its own choice. A confirmed
  // discard empties the draft here too: on an invoice's own page nothing is
  // keyed on the branch, so the form would otherwise keep what the question
  // said would be lost. The next draft is a new request, with a new key.
  useUnsavedGuard(amount.trim().length > 0 || reason.trim().length > 0, () => {
    setAmount('');
    setReason('');
    setErrors({});
    setOutcome(null);
    setAttemptKey(crypto.randomUUID());
  });

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
  // The cap is what the invoice can still be credited, as the server states it; a
  // server that does not state it leaves the open amount as the cap.
  const statedCreditable =
    source.kind === 'known' ? source.invoice.creditable : (picked?.creditable ?? null);
  const creditable = statedCreditable ?? open;
  const currency = open?.currency ?? creditable?.currency ?? picked?.currency ?? null;
  const typedAmount = amount.trim();
  // Above what is still owed but within what can be credited: the rest becomes a
  // refund owed to the customer once approved. Two server strings compared, digit
  // by digit; nothing is subtracted.
  const aboveOwed =
    open !== null &&
    CREDIT_AMOUNT.test(typedAmount) &&
    compareMoney(typedAmount, open.amount) > 0 &&
    (creditable === null || compareMoney(typedAmount, creditable.amount) <= 0);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (invoiceId === null) found['invoiceId'] = 'field.required';
    const typed = amount.trim();
    if (typed.length === 0) found['amount'] = 'field.required';
    else if (!CREDIT_AMOUNT.test(typed) || !/[1-9]/.test(typed)) {
      found['amount'] = 'creditNotes.request.amountFormat';
    } else if (open !== null && !fitsMinorUnit(typed, open.minorUnit)) {
      // No finer than the invoice's currency is written: the minor unit is the one
      // the balance read published for it (`shared.currencies`, Owner decision D1),
      // so the box says so before anything is sent, in the server's own words.
      found['amount'] = 'form.violation.minor_unit_scale';
    } else if (creditable !== null && compareMoney(typed, creditable.amount) > 0) {
      // Never above what the server says can still be credited (D2). Pending notes
      // can lower the ceiling further; that is the server's answer at approval, not
      // a sum made here.
      found['amount'] = 'creditNotes.request.aboveCreditable';
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
    try {
      let result: Awaited<ReturnType<typeof requestCreditNote>>;
      try {
        result = await requestCreditNote(invoiceId, { amount: typed, reason: why }, attemptKey);
      } catch {
        // No answer came back: what was typed stays, and so does the key, so
        // pressing again replays rather than raising a second note.
        setOutcome(unreachable(1));
        return;
      }
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
    } finally {
      setBusy(false);
    }
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
            material
          />
          <p className="text-caption text-text-muted">
            {translate(messages, 'creditNotes.request.invoiceHelp')}
          </p>
        </div>
      ) : null}
      {open !== null ? (
        <div className="flex flex-col gap-1">
          <p className="text-body">
            <span className="text-text-muted">
              {translate(messages, 'creditNotes.request.open')}
            </span>{' '}
            <Money money={open} locale={locale} />
          </p>
          {statedCreditable !== null ? (
            <p className="text-body">
              <span className="text-text-muted">
                {translate(messages, 'creditNotes.request.creditable')}
              </span>{' '}
              <Money money={statedCreditable} locale={locale} />
            </p>
          ) : null}
          <p className="text-caption text-text-muted">
            {translate(messages, 'creditNotes.request.aboveOwedBecomesRefund')}
          </p>
          <p className="text-caption text-text-muted">
            {translate(messages, 'creditNotes.request.pendingMayReduce')}
          </p>
        </div>
      ) : null}
      <div className="sm:max-w-xs">
        <FormMoneyField
          messages={messages}
          label={translate(messages, 'creditNotes.request.amount')}
          description={translate(messages, 'creditNotes.request.amountHelp')}
          required
          name="amount"
          currency={currency ?? '—'}
          value={amount}
          onEdit={() => corrected('amount')}
          onChange={(next) => setAmount(next)}
          error={errorFor('amount')}
        />
      </div>
      {aboveOwed ? (
        <p role="status" className="text-caption text-text-primary">
          {translate(messages, 'creditNotes.request.partBecomesRefund')}
        </p>
      ) : null}
      <FormTextField
        label={translate(messages, 'creditNotes.request.reason')}
        required
        multiline
        rows={2}
        name="reason"
        value={reason}
        onEdit={() => corrected('reason')}
        onChange={setReason}
        error={errorFor('reason')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
          {translate(messages, 'creditNotes.request.submit')}
        </Button>
      </div>
    </form>
  );
}
