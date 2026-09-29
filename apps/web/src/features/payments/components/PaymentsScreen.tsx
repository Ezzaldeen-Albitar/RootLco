'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';

import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { MuiReadFailureState } from '@/components/states/MuiStates';
import { InvoicePicker } from '@/features/billing/components/InvoicePicker';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { InvoiceListEntry, Outstanding } from '@/features/billing/billing-contract';
import type { ReadState } from '@/lib/api/read-operation';
import { useReread } from '@/lib/api/use-reread';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { formatMoney } from '@/lib/money';

import {
  allocatePayment,
  listPaymentMethods,
  listReceipts,
  readOutstanding,
  readReceipt,
  readReceiptPayer,
  recordPayment,
  type ReceiptCriteria,
} from '../api';
import {
  PAGE_SIZE,
  RECEIPT_STATUSES,
  type Allocation,
  type PaymentMethod,
  type ReceiptDetail,
  type ReceiptListEntry,
  type ReceiptStatus,
  type RecordedReceipt,
} from '../payments-contract';
import { ReceiptDocument, type ReceiptPayerName } from './ReceiptDocument';
import {
  CURRENCY,
  Identifier,
  Money,
  OutcomeNote,
  ReceiptStatusBadge,
  UUID,
  When,
  isPayableAmount,
  withoutKey,
} from './shared';

/**
 * Payments and receipts (P1-30, `W7`): the payment form (FE-016), partial
 * payment (FE-017), the receipt (FE-018) and the printable copy (FE-021). On
 * the shared Material UI wrappers since the sales and finance slice (ADR-022):
 * the receipts are `OperationalGrid` rows walked with the route's cursor, the
 * state filter is `FilterToolbar`'s chips, the payer and the invoice are found
 * with the shared comboboxes, amounts are money fields, applying money asks
 * first (`ConfirmDialog`), and every read that fails is the Material state.
 *
 * ## Every read is addressed to ONE branch
 *
 * `sal.receipt-list` makes `companyId` and `branchId` required and treats them
 * as the read's target, because the row-level union of a caller's grants is
 * permission-blind: an optional pair would let finance view in one branch read
 * another branch's cash. The pair is chosen once, in the target panel, and
 * re-authorized server-side on every read, so nothing is requested until a
 * branch is named.
 *
 * ## Taking money and applying it are separate acts
 *
 * A receipt cannot name an invoice: the record body carries no invoice at all.
 * Money is recorded first and allocated second, so a partial payment is the
 * ordinary case and not an exception. An allocation is refused when it exceeds
 * either the receipt's remainder or the invoice's open balance — both figures
 * the database recomputes under row locks — and that refusal is a bound, never
 * a version conflict: neither write is version-guarded, and the screen never
 * tells the operator the record "moved on" for it.
 *
 * ## Nothing here is reversible, and the screen says so first
 *
 * The allocation table takes inserts only and no route undoes a row, so the
 * allocate form states that before it is used, and asks once more — naming the
 * amount and the invoice — before it sends.
 *
 * ## Names, not references
 *
 * The payer is named: `sal.receipt-list` carries the payer's name beside the id
 * for a caller who may read customers (browser QA row 5.6b), and the open
 * receipt asks the list for its own payer. Without the customer read the name
 * is withheld by the server and the screen says it is not shown — it never
 * prints the payer's reference. An allocation still names its invoice by
 * reference: no receipt read publishes an invoice number.
 *
 * ## What the operator ENTERS is found by name
 *
 * The payer is chosen among customers and the invoice among the branch's
 * invoices, each through a search the server answers (Owner directive,
 * `P1-32-PRE-OD-UX`). The invoice search needs `sal.finance.view`, which every
 * caller of this page holds, so it is always offered.
 *
 * The payer search needs `crm.customer.read`, and recording a payment does NOT:
 * `sal.payment-record` declares `sal.payment.record` and `sal.finance.view`
 * only. So a recorder without the customer read is not held — that would take
 * away a payment the server accepts from them. For that caller alone the form
 * keeps the one box it had before, a pasted payer reference, labelled as the
 * fallback it is, checked for shape before it is sent, and explained in the
 * same sentence that says how to choose by name instead. It is never the
 * ordinary path: with the customer read there is no box at all.
 *
 * The receipt list's payer filter is the same case. `sal.receipt-list` accepts
 * `payerPartnerId` with `sal.finance.view` alone, and before the pickers the
 * filter was a typed box; so a finance viewer without the customer read keeps a
 * labelled, shape-checked payer reference there too. It is a list filter, so it
 * is never counted as unsaved work.
 *
 * ## Recording needs a method this tenant owns
 *
 * The method list is gated by the RECORDING authority, not by finance view, and
 * every platform row arrives `recordable: false` — a receipt's foreign key pairs
 * the tenant with the method and a platform row has no tenant, so no receipt can
 * ever cite one. No route creates a tenant method, so an organisation with none
 * provisioned can read receipts and record nothing; the form says exactly that
 * instead of offering a choice the server would refuse.
 */

interface Target {
  readonly companyId: string;
  readonly branchId: string;
}

/** What a write said, held ABOVE the panels it makes remount. */
interface WriteNotice {
  readonly key: string;
  readonly reference?: string;
}

/**
 * What the invoice still owes after an allocation (FE-019).
 *
 * The allocation echo does not carry it, so it is read separately — and it is
 * held HERE, above the panels the same write remounts, for the reason the
 * notice is: state inside the form that triggered the write dies with it.
 */
interface InvoiceBalance {
  readonly invoiceId: string;
  readonly state: ReadState<Outstanding>;
}

export function PaymentsScreen({
  locale,
  messages,
  initialReceiptId,
  initialInvoiceId,
  canRecord,
  canAllocate,
  canReadCustomers = false,
  canListInvoices = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address, when a receipt was named; opens straight onto it. */
  readonly initialReceiptId: string | null;
  /** From the address, when the screen was reached from an invoice; filters and prefills. */
  readonly initialInvoiceId: string | null;
  /** `sal.payment.record` — the record form AND the method list. */
  readonly canRecord: boolean;
  /** `sal.payment.allocate` — applying a receipt to an invoice. */
  readonly canAllocate: boolean;
  /**
   * `org.branch.read`. Accepted so the route did not have to change, and no
   * longer read: the branch is the working context's own named selection.
   */
  readonly canReadBranches?: boolean;
  /** `crm.customer.read` — whether a payer can be found, and is named, by name. */
  readonly canReadCustomers?: boolean;
  /** `sal.finance.view` — whether the branch's invoices can be searched. */
  readonly canListInvoices?: boolean;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(initialReceiptId);
  const [epoch, setEpoch] = useState(0);
  // A write re-reads the list and the receipt by remounting them, which would
  // also discard anything they had to say about the write. What the server
  // said is held HERE, above the remount, so the statement survives the
  // re-read it causes.
  const [notice, setNotice] = useState<WriteNotice | null>(null);
  const [balance, setBalance] = useState<InvoiceBalance | null>(null);

  const changed = useCallback((next: WriteNotice | null) => {
    setNotice(next);
    setEpoch((n) => n + 1);
  }, []);

  /*
   * `data-print-scope`: while the receipt's printable copy is open, printing
   * carries the copy and not the screen around it — the notices, the record
   * form, the receipt list and the allocation panel (the delivery sheet's
   * rule, `styles/print/_index.scss`).
   */
  return (
    <div data-print-scope="document" className="flex flex-col gap-6">
      <TargetPanel
        messages={messages}
        onChosen={(next) => {
          // A receipt belongs to one branch: a DIFFERENT branch must not leave
          // the previous branch's receipt open beside the new list. A receipt
          // named in the address survives the first report, which sets the
          // target for reads that were waiting on it.
          if (target && target.branchId !== next?.branchId) setReceiptId(null);
          setTarget(next);
          setNotice(null);
          setBalance(null);
        }}
      />

      {notice ? (
        <p role="status" className="rounded-md border border-border bg-surface p-3 text-body">
          {translateDynamic(messages, notice.key)}
          {notice.reference ? (
            <>
              {' '}
              <Identifier value={notice.reference} />
            </>
          ) : null}
        </p>
      ) : null}

      {balance ? (
        <p className="rounded-md border border-border bg-surface p-3 text-body">
          {balance.state.status === 'ok' ? (
            <>
              {translate(messages, 'payments.allocate.invoiceOpen')}{' '}
              <Money money={balance.state.data.outstanding} locale={locale} />
            </>
          ) : (
            <>
              {translate(messages, 'payments.allocate.invoiceOpenUnavailable')}
              {balance.state.correlationId ? (
                <>
                  {' '}
                  <Identifier value={balance.state.correlationId} />
                </>
              ) : null}
            </>
          )}
        </p>
      ) : null}

      {target ? (
        <>
          {canRecord ? (
            <RecordPanel
              key={`record-${target.branchId}-${epoch}`}
              locale={locale}
              messages={messages}
              target={target}
              canReadCustomers={canReadCustomers}
              onRecorded={(receipt, replayed) => {
                setReceiptId(receipt.id);
                changed({
                  key: replayed ? 'payments.record.replayed' : 'payments.record.recorded',
                  reference: receipt.reference,
                });
              }}
            />
          ) : (
            <section
              aria-label={translate(messages, 'payments.record.heading')}
              className="rounded-md border border-border bg-surface p-4"
            >
              <h2 className="text-section-title">
                {translate(messages, 'payments.record.heading')}
              </h2>
              <p className="mt-2 text-body text-text-secondary">
                {translate(messages, 'payments.record.needsCode')}
              </p>
            </section>
          )}

          <ReceiptsPanel
            key={`list-${target.companyId}-${target.branchId}`}
            locale={locale}
            messages={messages}
            target={target}
            initialInvoiceId={initialInvoiceId}
            canReadCustomers={canReadCustomers}
            canListInvoices={canListInvoices}
            epoch={epoch}
            selected={receiptId}
            onSelect={(id) => {
              setReceiptId(id);
              setNotice(null);
            }}
          />
        </>
      ) : null}

      {/* The receipt read names its receipt in the PATH and takes no branch
          target, so a receipt named in the address opens without one. */}
      {receiptId ? (
        <ReceiptPanel
          key={`receipt-${receiptId}-${epoch}`}
          locale={locale}
          messages={messages}
          receiptId={receiptId}
          initialInvoiceId={initialInvoiceId}
          canAllocate={canAllocate}
          canListInvoices={canListInvoices}
          canReadCustomers={canReadCustomers}
          onAllocated={(allocation, open, invoiceNumber) => {
            setBalance({ invoiceId: allocation.invoiceId, state: open });
            changed(
              invoiceNumber === null
                ? { key: 'payments.allocate.appliedUnnumbered' }
                : { key: 'payments.allocate.applied', reference: invoiceNumber }
            );
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The target
 * ------------------------------------------------------------------ */

/**
 * The branch the receipts belong to, STATED rather than asked (Owner directive,
 * `P1-32-PRE-OD-UX`).
 *
 * ## What it replaces
 *
 * A form: a branch select when `org.branch-list` answered, two free-text boxes
 * asking for a company reference and a branch reference when it did not, and a
 * submit the operator had to press before the receipts of a branch were read at
 * all. The boxes were offered to exactly the operator whose directory read had
 * been refused — the person with the least to go on.
 *
 * The branch is chosen ONCE, in the header, from the named list
 * `GET /auth/working-context` publishes for this caller. Nothing about the
 * request changed: the pair still travels as the authorization target and the
 * server re-authorizes it on every read and every write.
 *
 * ## Reporting upward rather than reading sideways
 *
 * The screen keeps the target in its own state — it keys its panels on it and
 * passes it to every adapter — so the choice is pushed up through `onChosen`.
 * The effect is guarded by the pair it last reported, so it settles in one pass
 * and cannot loop, and it reports `null` when the selection stops being a
 * single branch: a screen left holding the previous branch would go on reading
 * one workshop's money under another workshop's name.
 */
function TargetPanel({
  messages,
  onChosen,
}: {
  readonly messages: Messages;
  /** `null` while the selection is not a single branch. */
  readonly onChosen: (next: Target | null) => void;
}) {
  const branch = useBranchTarget();
  const chosen = branch.kind === 'ready' ? branch.target : null;
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const key = chosen === null ? '' : `${chosen.companyId}:${chosen.branchId}`;
    if (reported.current === key) return;
    reported.current = key;
    onChosen(chosen);
  }, [chosen, onChosen]);

  return (
    <section
      aria-label={translate(messages, 'payments.target.heading')}
      className="rounded-md border border-border bg-surface p-4"
      data-print="hide"
    >
      <h2 className="text-section-title">{translate(messages, 'payments.target.heading')}</h2>
      <p className="mt-1 text-body text-text-secondary">
        {translate(messages, 'payments.target.explain')}
      </p>
      <div className="mt-3">
        <WorkingBranchField
          messages={messages}
          label={translate(messages, 'payments.common.branchField')}
          testId="payments-branch-target"
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

function RecordPanel({
  locale,
  messages,
  target,
  canReadCustomers,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: Target;
  readonly canReadCustomers: boolean;
  readonly onRecorded: (receipt: RecordedReceipt, replayed: boolean) => void;
}) {
  const methods = useReread<{ items: readonly PaymentMethod[] }>(listPaymentMethods);

  const recordable = useMemo(
    () =>
      methods.value?.status === 'ok' ? methods.value.data.items.filter((m) => m.recordable) : [],
    [methods.value]
  );

  return (
    <section
      aria-label={translate(messages, 'payments.record.heading')}
      className="rounded-md border border-border bg-surface p-4"
      data-print="hide"
    >
      <h2 className="text-section-title">{translate(messages, 'payments.record.heading')}</h2>
      {methods.value === null ? (
        <p role="status" className="mt-2 text-body text-text-secondary">
          {translate(messages, 'payments.methods.loading')}
        </p>
      ) : methods.value.status !== 'ok' ? (
        <div className="mt-2">
          <MuiReadFailureState
            messages={messages}
            locale={locale}
            status={methods.value.status}
            correlationId={methods.value.correlationId}
            descriptionKey="payments.methods.refused"
            onRetry={() => void methods.reload()}
          />
        </div>
      ) : recordable.length === 0 ? (
        <p className="mt-2 text-body text-text-secondary">
          {translate(messages, 'payments.methods.noneRecordable')}
        </p>
      ) : (
        <RecordForm
          locale={locale}
          messages={messages}
          target={target}
          methods={recordable}
          canReadCustomers={canReadCustomers}
          onRecorded={onRecorded}
        />
      )}
    </section>
  );
}

function RecordForm({
  locale,
  messages,
  target,
  methods,
  canReadCustomers,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: Target;
  readonly methods: readonly PaymentMethod[];
  readonly canReadCustomers: boolean;
  readonly onRecorded: (receipt: RecordedReceipt, replayed: boolean) => void;
}) {
  // ONE transport key for this opened form: a retry after a lost answer replays
  // the STORED answer rather than taking the money a second time. A new form
  // gets a new key, because it is a new payment.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState({
    paymentMethodId: methods[0]?.id ?? '',
    currency: '',
    amount: '',
  });
  /*
   * The payer is FOUND among customers and chosen by name (Owner directive,
   * `P1-32-PRE-OD-UX`); it used to be a box asking for a partner reference. The
   * picker declares a chosen payer as unsaved work itself.
   */
  const [payer, setPayer] = useState<ChosenCustomer | null>(null);
  // The fallback for a recorder without the customer read — see the file header.
  const [payerReference, setPayerReference] = useState('');
  /*
   * Unsaved work, declared to the shell. The panel is keyed on the branch, so a
   * switch would drop a half-filled payment and address the next one to a
   * different branch's cash. It asks first; a confirmed switch remounts the
   * form empty. The pre-selected method is a default, not something typed, so
   * only a CHANGE of method counts.
   */
  useUnsavedGuard(
    draft.paymentMethodId !== (methods[0]?.id ?? '') ||
      draft.currency.trim().length > 0 ||
      draft.amount.trim().length > 0 ||
      payerReference.trim().length > 0
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [busy, setBusy] = useState(false);
  // One per refused submit, so the cursor moves to the first field to fix once.
  const [attempt, setAttempt] = useState(0);
  const formRef = useFocusFirstInvalid({
    status: 'invalid',
    fieldErrors: { ...(outcome?.fieldErrors ?? {}), ...errors },
    attempt,
  });

  /** A field's own error, then the server's violation for the same field. */
  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  /** A corrected field stops complaining, whichever side raised the complaint. */
  const clearError = (name: string) => {
    setErrors((previous) => withoutKey(previous, name));
    setOutcome((previous) =>
      previous?.fieldErrors?.[name]
        ? { ...previous, fieldErrors: withoutKey(previous.fieldErrors, name) }
        : previous
    );
  };

  const currencyCode = draft.currency.trim().toUpperCase();

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!UUID.test(draft.paymentMethodId)) found['paymentMethodId'] = 'payments.common.required';
    const payerPartnerId = canReadCustomers ? (payer?.id ?? null) : payerReference.trim();
    if (canReadCustomers && payerPartnerId === null)
      found['payerPartnerId'] = 'payments.record.payerRequired';
    if (!canReadCustomers && !UUID.test(payerReference.trim()))
      found['payerPartnerId'] = 'payments.record.payerReferenceFormat';
    if (!CURRENCY.test(currencyCode)) found['currency'] = 'payments.common.currencyFormat';
    if (!isPayableAmount(draft.amount)) found['amount'] = 'payments.common.amountFormat';
    setErrors(found);
    if (Object.keys(found).length > 0 || payerPartnerId === null) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    let recorded = false;
    try {
      let result: Awaited<ReturnType<typeof recordPayment>>;
      try {
        result = await recordPayment(
          {
            companyId: target.companyId,
            branchId: target.branchId,
            paymentMethodId: draft.paymentMethodId,
            payerPartnerId,
            currency: currencyCode,
            amount: draft.amount.trim(),
          },
          attemptKey
        );
      } catch {
        // No answer came back: what was typed stays, and so does the key, so
        // pressing again replays rather than taking the money twice.
        setOutcome(unreachable(1));
        return;
      }
      setOutcome(result.state);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success' && result.created) {
        // `replayed` is the SERVER's word. A transport replay returns the
        // stored body, whose flag is the one first written, so the screen
        // never infers a repeat from the fact that it reused its key. The
        // screen remounts this form empty; it stays busy until it does.
        recorded = true;
        onRecorded(result.created, result.created.replayed);
        return;
      }
      if (Object.keys(result.state.fieldErrors ?? {}).length > 0) setAttempt((n) => n + 1);
    } finally {
      if (!recorded) setBusy(false);
    }
  };

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'payments.record.formLabel')}
      className="mt-3 grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormSelectField
        label={translate(messages, 'payments.record.method')}
        required
        value={draft.paymentMethodId}
        onChange={(next) => {
          setDraft((d) => ({ ...d, paymentMethodId: next }));
          clearError('paymentMethodId');
        }}
        options={methods.map((method) => ({
          value: method.id,
          label: `${method.displayName} — ${translateDynamic(messages, `payments.kind.${method.kind}`)}`,
        }))}
        error={errorFor('paymentMethodId')}
      />
      <div className="sm:col-span-2">
        {canReadCustomers ? (
          <CustomerPicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'payments.record.payer')}
            value={payer}
            onChange={(next) => {
              setPayer(next);
              if (next !== null) clearError('payerPartnerId');
            }}
            canSearch
            error={errorFor('payerPartnerId')}
            testId="payments-payer-picker"
            material
          />
        ) : (
          <FormTextField
            label={translate(messages, 'payments.record.payerReference')}
            description={translate(messages, 'payments.record.payerReferenceHelp')}
            required
            autoComplete="off"
            dir="ltr"
            value={payerReference}
            onChange={(next) => {
              setPayerReference(next);
              clearError('payerPartnerId');
            }}
            error={errorFor('payerPartnerId')}
          />
        )}
      </div>
      <FormTextField
        label={translate(messages, 'payments.record.currency')}
        required
        autoComplete="off"
        dir="ltr"
        maxLength={3}
        value={draft.currency}
        onChange={(next) => {
          setDraft((d) => ({ ...d, currency: next }));
          clearError('currency');
        }}
        error={errorFor('currency')}
      />
      <FormMoneyField
        messages={messages}
        label={translate(messages, 'payments.record.amount')}
        description={translate(messages, 'payments.record.amountHelp')}
        required
        currency={CURRENCY.test(currencyCode) ? currencyCode : '—'}
        value={draft.amount}
        onEdit={() => clearError('amount')}
        onChange={(next) => setDraft((d) => ({ ...d, amount: next }))}
        error={errorFor('amount')}
      />
      <div className="sm:col-span-2">
        <p className="text-body text-text-secondary">
          {translate(messages, 'payments.record.explain')}
        </p>
        <div className="mt-2">
          <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
            {translate(messages, 'payments.record.submit')}
          </Button>
        </div>
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The receipts of the branch
 * ------------------------------------------------------------------ */

/** The payer on a receipt row, by name — or said not to be shown, never the reference. */
function PayerCell({
  messages,
  entry,
}: {
  readonly messages: Messages;
  readonly entry: ReceiptListEntry;
}) {
  const name = entry.payer?.displayName ?? null;
  if (name !== null) return <bdi>{name}</bdi>;
  return (
    <span className="text-text-muted">{translate(messages, 'payments.list.payerNotShown')}</span>
  );
}

function ReceiptsPanel({
  locale,
  messages,
  target,
  initialInvoiceId,
  canReadCustomers,
  canListInvoices,
  epoch,
  selected,
  onSelect,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: Target;
  readonly initialInvoiceId: string | null;
  readonly canReadCustomers: boolean;
  readonly canListInvoices: boolean;
  /** Bumped by every write. The list re-reads; it is NOT remounted, because a
   *  remount would throw away the filters and page the operator had chosen. */
  readonly epoch: number;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}) {
  /*
   * The filters, as CHOSEN rather than typed (Owner directive,
   * `P1-32-PRE-OD-UX`): a payer found among customers, an invoice found among
   * the branch's invoices, a state among the chips. Each applies as it is
   * chosen — a new read, the page and cursor reset — and none is unsaved work.
   * An invoice named in the address stays the filter until the operator removes
   * it, and is described rather than printed.
   */
  const [payer, setPayer] = useState<ChosenCustomer | null>(null);
  const [status, setStatus] = useState<'' | ReceiptStatus>('');
  const [invoice, setInvoice] = useState<InvoiceListEntry | null>(null);
  const [fromAddress, setFromAddress] = useState<string | null>(initialInvoiceId);
  // The fallback for a finance viewer without the customer read — see the file
  // header. A list filter: never declared as unsaved work. Applied on request.
  const [payerReference, setPayerReference] = useState('');
  const [appliedReference, setAppliedReference] = useState<string | null>(null);
  const [payerReferenceError, setPayerReferenceError] = useState<string | null>(null);

  const payerPartnerId = canReadCustomers ? (payer?.id ?? null) : appliedReference;
  const invoiceId = invoice?.id ?? fromAddress;
  const criteria = useMemo<ReceiptCriteria>(
    () => ({ payerPartnerId, status: status === '' ? null : status, invoiceId }),
    [payerPartnerId, status, invoiceId]
  );

  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listReceipts(target, criteria, request, cursor),
    [target, criteria]
  );
  const table = useServerTable<ReceiptListEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: PAGE_SIZE },
    // The filters live in this panel, not in the table request, so they must be
    // named here or applying one changes the loader and re-reads nothing
    // (`P1-26-F-019`). The target is in the panel's key, not in this string.
    loadKey: `${criteria.payerPartnerId ?? ''}:${criteria.status ?? ''}:${criteria.invoiceId ?? ''}:${epoch}`,
  });

  const columns = useMemo<readonly OperationalColumn<ReceiptListEntry>[]>(
    () => [
      {
        id: 'reference',
        headerKey: 'payments.list.reference',
        cell: (row) => (
          <span className="font-mono" dir="ltr">
            {row.reference}
          </span>
        ),
      },
      {
        id: 'receivedAt',
        headerKey: 'payments.list.receivedAt',
        flex: 1.2,
        cell: (row) => <When value={row.receivedAt} locale={locale} />,
      },
      {
        id: 'payer',
        headerKey: 'payments.list.payer',
        flex: 1.4,
        cell: (row) => <PayerCell messages={messages} entry={row} />,
      },
      {
        id: 'method',
        headerKey: 'payments.list.method',
        hideBelow: 'md',
        cell: (row) =>
          row.method ? (
            row.method.displayName
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'payments.list.methodGone')}
            </span>
          ),
      },
      {
        id: 'money',
        headerKey: 'payments.list.money',
        numeric: true,
        cell: (row) => <Money money={row.money} locale={locale} />,
      },
      {
        id: 'open',
        headerKey: 'payments.list.unapplied',
        numeric: true,
        cell: (row) => <Money money={row.unallocated} locale={locale} />,
      },
      {
        id: 'status',
        headerKey: 'payments.list.status',
        cell: (row) => <ReceiptStatusBadge messages={messages} status={row.status} />,
      },
    ],
    [locale, messages]
  );

  const rowActions = useCallback(
    (row: ReceiptListEntry): readonly RowAction[] => [
      {
        kind: 'button',
        label: translate(messages, 'payments.list.open'),
        about: row.reference,
        // A choice among the rows: which receipt is open is announced with it.
        pressed: row.id === selected,
        onClick: () => onSelect(row.id),
      },
    ],
    [messages, onSelect, selected]
  );

  return (
    <section
      aria-label={translate(messages, 'payments.list.heading')}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
      data-print="hide"
    >
      <h2 className="text-section-title">{translate(messages, 'payments.list.heading')}</h2>
      <FilterToolbar
        messages={messages}
        label={translate(messages, 'payments.list.filtersLabel')}
        testId="payments-toolbar"
        filters={[
          {
            kind: 'chips',
            key: 'status',
            label: translate(messages, 'payments.list.statusFilter'),
            options: RECEIPT_STATUSES.map((value) => ({
              value,
              label: translateDynamic(messages, `payments.status.${value}`),
            })),
            value: status,
            onChange: (next) => setStatus(next as '' | ReceiptStatus),
          },
        ]}
      />
      <div
        role="group"
        aria-label={translate(messages, 'payments.list.moreFilters')}
        className="grid gap-3 sm:grid-cols-2"
      >
        {canReadCustomers ? (
          <CustomerPicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'payments.list.payerFilter')}
            value={payer}
            onChange={setPayer}
            canSearch
            countsAsUnsaved={false}
            testId="payments-payer-filter"
            material
          />
        ) : (
          <div className="flex flex-col gap-2">
            <FormTextField
              label={translate(messages, 'payments.list.payerReference')}
              description={translate(messages, 'payments.list.payerReferenceHelp')}
              autoComplete="off"
              dir="ltr"
              value={payerReference}
              onChange={(next) => {
                setPayerReference(next);
                setPayerReferenceError(null);
              }}
              error={
                payerReferenceError ? translateDynamic(messages, payerReferenceError) : undefined
              }
            />
            <div>
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={() => {
                  const typed = payerReference.trim();
                  if (typed.length > 0 && !UUID.test(typed)) {
                    // A malformed reference is said on its box, and nothing is
                    // applied: silently dropping it would show every payer's
                    // receipts under a filter the operator believes is narrowing them.
                    setPayerReferenceError('payments.record.payerReferenceFormat');
                    return;
                  }
                  setAppliedReference(typed.length > 0 ? typed : null);
                }}
              >
                {translate(messages, 'payments.list.apply')}
              </Button>
            </div>
          </div>
        )}
        {fromAddress !== null && invoice === null ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-text-primary">
              {translate(messages, 'payments.list.invoiceFilter')}
            </span>
            <p className="text-body text-text-secondary">
              {translate(messages, 'payments.list.invoiceFromAddress')}
            </p>
            <div>
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={() => setFromAddress(null)}
              >
                {translate(messages, 'invoices.picker.change')}
              </Button>
            </div>
          </div>
        ) : (
          <InvoicePicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'payments.list.invoiceFilter')}
            target={target}
            value={invoice}
            onChange={setInvoice}
            canSearch={canListInvoices}
            countsAsUnsaved={false}
            testId="payments-invoice-filter"
            material
          />
        )}
      </div>
      <p className="text-caption text-text-muted">
        {translate(messages, 'payments.list.noDateFilter')}
      </p>
      <div className="flex min-h-0 flex-col gap-2">
        <OperationalGrid<ReceiptListEntry>
          messages={messages}
          locale={locale}
          label={translate(messages, 'payments.list.caption')}
          columns={columns}
          rowId={(row) => row.id}
          table={table}
          rowActions={rowActions}
          suppressEmptyState
          testId="payments-receipts-grid"
        />
        {table.response && table.response.rows.length === 0 ? (
          <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
            {translate(messages, 'payments.list.empty')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * One receipt
 * ------------------------------------------------------------------ */

/**
 * The payer of the open receipt, by name — asked of the receipt list, the one
 * receipt read that names a payer. Only for a caller who may read customers:
 * for anyone else the server withholds the name, so nothing is asked.
 */
function useReceiptPayer(
  receipt: ReceiptDetail | null,
  canReadCustomers: boolean
): ReceiptPayerName {
  const companyId = receipt?.companyId ?? null;
  const branchId = receipt?.branchId ?? null;
  const payerPartnerId = receipt?.payerPartnerId ?? null;
  const [found, setFound] = useState<{
    readonly payerPartnerId: string;
    readonly name: ReceiptPayerName;
  } | null>(null);
  useEffect(() => {
    if (!canReadCustomers || companyId === null || branchId === null || payerPartnerId === null)
      return;
    let live = true;
    void readReceiptPayer({ companyId, branchId }, payerPartnerId)
      .then((payer) => {
        if (!live) return;
        const name = payer?.displayName ?? null;
        setFound({
          payerPartnerId,
          name: name === null ? { kind: 'notShown' } : { kind: 'named', name },
        });
      })
      .catch(() => {
        if (live) setFound({ payerPartnerId, name: { kind: 'notShown' } });
      });
    return () => {
      live = false;
    };
  }, [canReadCustomers, companyId, branchId, payerPartnerId]);
  if (!canReadCustomers || payerPartnerId === null) return { kind: 'notShown' };
  return found !== null && found.payerPartnerId === payerPartnerId
    ? found.name
    : { kind: 'loading' };
}

function PayerText({
  messages,
  payer,
}: {
  readonly messages: Messages;
  readonly payer: ReceiptPayerName;
}) {
  if (payer.kind === 'named') return <bdi>{payer.name}</bdi>;
  return (
    <span className="text-text-muted">
      {translate(
        messages,
        payer.kind === 'loading' ? 'payments.receipt.payerLoading' : 'payments.list.payerNotShown'
      )}
    </span>
  );
}

function ReceiptPanel({
  locale,
  messages,
  receiptId,
  initialInvoiceId,
  canAllocate,
  canListInvoices,
  canReadCustomers,
  onAllocated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receiptId: string;
  readonly initialInvoiceId: string | null;
  readonly canAllocate: boolean;
  readonly canListInvoices: boolean;
  readonly canReadCustomers: boolean;
  readonly onAllocated: (
    allocation: Allocation,
    open: ReadState<Outstanding>,
    invoiceNumber: string | null
  ) => void;
}) {
  const read = useCallback(() => readReceipt(receiptId), [receiptId]);
  const receiptRead = useReread<ReceiptDetail>(read);
  const state = receiptRead.value;
  const payer = useReceiptPayer(state?.status === 'ok' ? state.data : null, canReadCustomers);

  if (state === null) {
    return (
      <section
        aria-label={translate(messages, 'payments.receipt.heading')}
        className="rounded-md border border-border bg-surface p-4"
      >
        <p role="status" className="text-body text-text-secondary">
          {translate(messages, 'payments.receipt.loading')}
        </p>
      </section>
    );
  }

  if (state.status !== 'ok') {
    return (
      <section
        aria-label={translate(messages, 'payments.receipt.heading')}
        className="rounded-md border border-border bg-surface p-4"
      >
        {state.status === 'not-found' ? (
          <p role="alert" className="text-body text-error">
            {translate(messages, 'payments.receipt.notFound')}
          </p>
        ) : (
          <MuiReadFailureState
            messages={messages}
            locale={locale}
            status={state.status}
            correlationId={state.correlationId}
            descriptionKey={
              state.status === 'denied' ? 'payments.receipt.denied' : 'payments.receipt.unavailable'
            }
            onRetry={() => void receiptRead.reload()}
          />
        )}
      </section>
    );
  }

  const receipt = state.data;
  return (
    <>
      <section
        aria-label={translate(messages, 'payments.receipt.heading')}
        className="rounded-md border border-border bg-surface p-4"
        data-print="hide"
      >
        <h2 className="text-section-title">{translate(messages, 'payments.receipt.heading')}</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Row label={translate(messages, 'payments.receipt.reference')}>
            <span className="font-mono" dir="ltr">
              {receipt.reference}
            </span>
          </Row>
          <Row label={translate(messages, 'payments.receipt.status')}>
            <ReceiptStatusBadge messages={messages} status={receipt.status} />
          </Row>
          <Row label={translate(messages, 'payments.receipt.receivedAt')}>
            <When value={receipt.receivedAt} locale={locale} />
          </Row>
          <Row label={translate(messages, 'payments.receipt.payer')}>
            <PayerText messages={messages} payer={payer} />
          </Row>
          <Row label={translate(messages, 'payments.receipt.method')}>
            {receipt.method ? (
              `${receipt.method.displayName} — ${translateDynamic(messages, `payments.kind.${receipt.method.kind}`)}`
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'payments.list.methodGone')}
              </span>
            )}
          </Row>
          <Row label={translate(messages, 'payments.receipt.money')}>
            <Money money={receipt.money} locale={locale} />
          </Row>
          <Row label={translate(messages, 'payments.receipt.unapplied')}>
            <Money money={receipt.unallocated} locale={locale} />
          </Row>
        </dl>
        <p className="mt-2 text-caption text-text-muted">
          {translate(messages, 'payments.receipt.noNames')}
        </p>

        <h3 className="mt-4 text-section-title">
          {translate(messages, 'payments.allocations.heading')}
        </h3>
        {receipt.allocations.length === 0 ? (
          <p className="mt-2 text-body text-text-secondary">
            {translate(messages, 'payments.allocations.none')}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {receipt.allocations.map((allocation) => (
              <li
                key={allocation.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2"
              >
                <Identifier value={allocation.invoiceId} />
                <Money money={allocation.money} locale={locale} />
                <span className="text-caption text-text-muted">
                  <When value={allocation.allocatedAt} locale={locale} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {receipt.allocationsTruncated ? (
          <p className="mt-2 text-body text-text-secondary">
            {translate(messages, 'payments.allocations.truncated')}
          </p>
        ) : null}

        {canAllocate ? (
          <AllocateForm
            locale={locale}
            messages={messages}
            receipt={receipt}
            initialInvoiceId={initialInvoiceId}
            canListInvoices={canListInvoices}
            onAllocated={onAllocated}
          />
        ) : (
          <p className="mt-4 text-body text-text-secondary">
            {translate(messages, 'payments.allocate.needsCode')}
          </p>
        )}
      </section>

      <PrintPanel locale={locale} messages={messages} receipt={receipt} payer={payer} />
    </>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Allocating
 * ------------------------------------------------------------------ */

/**
 * Allocation attempts whose outcome is NOT known, by receipt (P1-32-PRE-OD-FIN, M-09).
 *
 * An allocation cannot be undone, and the answer to one can be lost — the network
 * fails, the server fails, or the request is cancelled after it was sent. The form
 * keeps one transport key while it is open, but a closed and reopened form would
 * mint a new one, and a new key is a new allocation. So an uncertain attempt is
 * remembered here, beyond the form's own life, and a retry of the SAME request —
 * same receipt, same invoice, same amount as typed — is sent under the SAME key:
 * the server then answers with the allocation it already made instead of booking
 * a second one (`sal.payment_allocations.idempotency_key`). A different request is
 * a new allocation and takes the form's own key. A definite answer under the
 * remembered key forgets it. Held in memory only: browser storage is not used on
 * this surface.
 */
const uncertainAllocations = new Map<
  string,
  { readonly key: string; readonly invoiceId: string; readonly amount: string }
>();

/** The answers that do not say whether the allocation was booked. */
const UNCERTAIN_OUTCOMES: ReadonlySet<ActionState['status']> = new Set<ActionState['status']>([
  'unavailable',
  'error',
  'cancelled',
]);

function AllocateForm({
  locale,
  messages,
  receipt,
  initialInvoiceId,
  canListInvoices,
  onAllocated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  readonly initialInvoiceId: string | null;
  readonly canListInvoices: boolean;
  readonly onAllocated: (
    allocation: Allocation,
    open: ReadState<Outstanding>,
    invoiceNumber: string | null
  ) => void;
}) {
  // One transport key per opened form, as on the record form.
  const [attemptKey] = useState(() => crypto.randomUUID());
  /*
   * The invoice is FOUND among the receipt's own branch's invoices that can still
   * take money — issued, or credited with a balance open — and chosen by its
   * number and payer (Owner directive, `P1-32-PRE-OD-UX`); it used
   * to be a box asking for an invoice reference. One reached from an invoice
   * arrives named in the address and stays the choice until it is changed.
   */
  const [invoice, setInvoice] = useState<InvoiceListEntry | null>(null);
  const [fromAddress, setFromAddress] = useState<string | null>(initialInvoiceId);
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // A branch switch closes the previous branch's receipt, and this form with it.
  // The picker declares a chosen invoice itself. A receipt named in the address
  // is not closed by the FIRST choice of a branch, so a confirmed discard also
  // empties the amount here rather than relying on the receipt closing.
  useUnsavedGuard(amount.trim().length > 0, () => {
    setAmount('');
    setErrors({});
    setOutcome(null);
  });
  const formRef = useFocusFirstInvalid({
    status: 'invalid',
    fieldErrors: { ...(outcome?.fieldErrors ?? {}), ...errors },
    attempt,
  });
  const invoiceId = invoice?.id ?? fromAddress;

  /** A field's own error, then the server's violation for the same field. */
  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  /** A corrected field stops complaining, whichever side raised the complaint. */
  const clearError = (name: string) => {
    setErrors((previous) => withoutKey(previous, name));
    setOutcome((previous) =>
      previous?.fieldErrors?.[name]
        ? { ...previous, fieldErrors: withoutKey(previous.fieldErrors, name) }
        : previous
    );
  };

  const ask = () => {
    const found: Record<string, string> = {};
    if (invoiceId === null) found['invoiceId'] = 'payments.allocate.invoiceRequired';
    if (!isPayableAmount(amount)) found['amount'] = 'payments.common.amountFormat';
    setErrors(found);
    if (Object.keys(found).length > 0 || invoiceId === null) {
      setAttempt((n) => n + 1);
      return;
    }
    setOutcome(null);
    setAsking(true);
  };

  const allocate = async () => {
    if (invoiceId === null) return;
    setBusy(true);
    let applied = false;
    const typed = amount.trim();
    // The same request as an attempt whose answer was lost goes under ITS key.
    const pending = uncertainAllocations.get(receipt.id);
    const key =
      pending !== undefined && pending.invoiceId === invoiceId && pending.amount === typed
        ? pending.key
        : attemptKey;
    const remember = () => uncertainAllocations.set(receipt.id, { key, invoiceId, amount: typed });
    try {
      let result: Awaited<ReturnType<typeof allocatePayment>>;
      try {
        result = await allocatePayment(
          receipt.id,
          {
            invoiceId,
            amount: typed,
            // The receipt's own currency: the route compares the declared code
            // against the receipt AND the invoice, and refuses any disagreement.
            currency: receipt.money.currency,
          },
          key
        );
      } catch {
        remember();
        setAsking(false);
        setOutcome(unreachable(1));
        return;
      }
      if (UNCERTAIN_OUTCOMES.has(result.state.status)) {
        remember();
      } else if (uncertainAllocations.get(receipt.id)?.key === key) {
        uncertainAllocations.delete(receipt.id);
      }
      setAsking(false);
      setOutcome(result.state);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success' && result.created) {
        // The allocation echo carries the RECEIPT's new remainder but not
        // the invoice's balance, so the invoice is read for it — and the
        // answer is handed UP, because reporting it re-reads this panel. The
        // form stays busy until then.
        applied = true;
        let open: ReadState<Outstanding>;
        try {
          open = await readOutstanding(invoiceId);
        } catch {
          open = { status: 'unavailable', correlationId: null };
        }
        onAllocated(result.created, open, invoice?.invoiceNumber ?? null);
        return;
      }
      // A refused allocation is a BOUND — more than the receipt has left or the
      // invoice still owes — or a refusal the server names; never "moved on".
      if (Object.keys(result.state.fieldErrors ?? {}).length > 0) setAttempt((n) => n + 1);
    } finally {
      if (!applied) setBusy(false);
    }
  };

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'payments.allocate.formLabel')}
      className="mt-4 grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        ask();
      }}
    >
      <h3 className="sm:col-span-2 text-section-title">
        {translate(messages, 'payments.allocate.heading')}
      </h3>
      <p className="sm:col-span-2 text-body text-text-secondary">
        {translate(messages, 'payments.allocate.explain')}
      </p>
      {receipt.status === 'reversed' ? (
        <p className="sm:col-span-2 text-body text-text-secondary">
          {translate(messages, 'payments.allocate.reversed')}
        </p>
      ) : receipt.status === 'allocated' ? (
        <p className="sm:col-span-2 text-body text-text-secondary">
          {translate(messages, 'payments.allocate.nothingLeft')}
        </p>
      ) : (
        <>
          <div className="sm:col-span-2">
            {fromAddress !== null && invoice === null ? (
              <div className="flex flex-col gap-1.5" data-testid="payments-invoice-from-address">
                <span className="text-label font-medium text-text-primary">
                  {translate(messages, 'payments.allocate.invoice')}
                </span>
                <p className="text-body text-text-secondary">
                  {translate(messages, 'payments.allocate.invoiceFromAddress')}
                </p>
                {canListInvoices ? (
                  <div>
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      onClick={() => setFromAddress(null)}
                    >
                      {translate(messages, 'invoices.picker.change')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <InvoicePicker
                messages={messages}
                locale={locale}
                label={translate(messages, 'payments.allocate.invoice')}
                target={{ companyId: receipt.companyId, branchId: receipt.branchId }}
                allocatable
                value={invoice}
                onChange={(next) => {
                  setInvoice(next);
                  if (next !== null) clearError('invoiceId');
                }}
                canSearch={canListInvoices}
                error={errorFor('invoiceId')}
                testId="payments-invoice-picker"
                material
              />
            )}
            <p className="mt-1 text-caption text-text-muted">
              {translate(messages, 'payments.allocate.invoiceHelp')}
            </p>
          </div>
          <FormMoneyField
            messages={messages}
            label={translate(messages, 'payments.allocate.amount')}
            description={translate(messages, 'payments.allocate.amountHelp')}
            required
            currency={receipt.money.currency}
            value={amount}
            onEdit={() => clearError('amount')}
            onChange={(next) => setAmount(next)}
            error={errorFor('amount')}
          />
          <div className="sm:col-span-2">
            <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
              {translate(messages, 'payments.allocate.submit')}
            </Button>
            {asking ? null : <OutcomeNote messages={messages} outcome={outcome} />}
          </div>
        </>
      )}
      <ConfirmDialog
        open={asking}
        messages={messages}
        title={translate(messages, 'payments.allocate.confirmTitle')}
        description={
          // Asked only once the amount was checked, so it is a figure to format.
          asking
            ? formatMessage(
                translate(
                  messages,
                  invoice?.invoiceNumber
                    ? 'payments.allocate.confirmExplain'
                    : 'payments.allocate.confirmExplainUnnumbered'
                ),
                {
                  amount: formatMoney(
                    { amount: amount.trim(), currency: receipt.money.currency },
                    locale
                  ),
                  invoice: invoice?.invoiceNumber ?? '',
                }
              )
            : undefined
        }
        confirmLabel={translate(messages, 'payments.allocate.submit')}
        pending={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => void allocate()}
        testId="payments-allocate-dialog"
      />
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The printable copy (FE-021)
 * ------------------------------------------------------------------ */

function PrintPanel({
  locale,
  messages,
  receipt,
  payer,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  readonly payer: ReceiptPayerName;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label={translate(messages, 'payments.print.heading')}
      className="rounded-md border border-border bg-surface p-4"
    >
      <div data-print="hide" className="flex flex-col gap-2">
        <h2 className="text-section-title">{translate(messages, 'payments.print.heading')}</h2>
        <p className="text-body text-text-secondary">
          {translate(messages, 'payments.print.explain')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outlined"
            aria-expanded={open}
            aria-controls="payments-print"
            onClick={() => setOpen((was) => !was)}
          >
            {translate(messages, open ? 'payments.print.close' : 'payments.print.open')}
          </Button>
          {open ? (
            <Button type="button" variant="contained" onClick={() => window.print()}>
              {translate(messages, 'payments.print.print')}
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mt-4" id="payments-print">
          <ReceiptDocument locale={locale} messages={messages} receipt={receipt} payer={payer} />
        </div>
      ) : null}
    </section>
  );
}
