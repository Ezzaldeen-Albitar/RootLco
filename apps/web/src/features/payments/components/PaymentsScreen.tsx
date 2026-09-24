'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { InvoicePicker } from '@/features/billing/components/InvoicePicker';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { InvoiceListEntry, Outstanding } from '@/features/billing/billing-contract';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { formatDateTime } from '@/lib/format';

import {
  allocatePayment,
  listPaymentMethods,
  listReceipts,
  readOutstanding,
  readReceipt,
  recordPayment,
  type ReceiptCriteria,
} from '../api';
import {
  PAGE_SIZE,
  RECEIPT_STATUSES,
  type Allocation,
  type PaymentMethod,
  type Receipt,
  type ReceiptDetail,
  type ReceiptStatus,
  type RecordedReceipt,
} from '../payments-contract';
import { ReceiptDocument } from './ReceiptDocument';
import {
  CURRENCY,
  Identifier,
  Money,
  OutcomeNote,
  PRIMARY_BUTTON,
  ReceiptStatusBadge,
  SECONDARY_BUTTON,
  UUID,
  isPayableAmount,
  withoutKey,
} from './shared';

/**
 * Payments and receipts (P1-30, `W7`): the payment form (FE-016), partial
 * payment (FE-017), the receipt (FE-018) and the printable copy (FE-021).
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
 * a version conflict: neither write is version-guarded.
 *
 * ## Nothing here is reversible, and the screen says so first
 *
 * The allocation table takes inserts only and no route undoes a row, so the
 * allocate form states that before it is used rather than after.
 *
 * ## What the reads do not carry is said, not filled in
 *
 * No receipt read publishes a payer NAME, a cashier, or a note; an allocation
 * names its invoice by identifier and never by number. The screen shows the
 * identifiers it is given and says why there is no name, rather than reading a
 * customer the plan does not name or leaving a blank that looks like an error.
 *
 * ## What the operator ENTERS is found by name
 *
 * The payer is chosen among customers and the invoice among the branch's
 * invoices, each through a search the server answers (Owner directive,
 * `P1-32-PRE-OD-UX`); no box on this screen asks for a reference. Without the
 * code a search needs, the picker says so and the submit it would feed is held,
 * described by that sentence.
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
  /** `crm.customer.read` — whether a payer can be found by name. */
  readonly canReadCustomers?: boolean;
  /** `sal.invoice.manage` — whether the branch's invoices can be searched. */
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

  return (
    <div className="flex flex-col gap-6">
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
          onAllocated={(allocation, open) => {
            setBalance({ invoiceId: allocation.invoiceId, state: open });
            changed({
              key: 'payments.allocate.applied',
              reference: allocation.invoiceId,
            });
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
  const [methods, setMethods] = useState<ReadState<{ items: readonly PaymentMethod[] }> | null>(
    null
  );

  useEffect(() => {
    let live = true;
    void listPaymentMethods().then((state) => {
      if (live) setMethods(state);
    });
    return () => {
      live = false;
    };
  }, []);

  const recordable = useMemo(
    () => (methods?.status === 'ok' ? methods.data.items.filter((m) => m.recordable) : []),
    [methods]
  );

  return (
    <section
      aria-label={translate(messages, 'payments.record.heading')}
      className="rounded-md border border-border bg-surface p-4"
      data-print="hide"
    >
      <h2 className="text-section-title">{translate(messages, 'payments.record.heading')}</h2>
      {methods === null ? (
        <p className="mt-2 text-body text-text-secondary">
          {translate(messages, 'payments.methods.loading')}
        </p>
      ) : methods.status !== 'ok' ? (
        <p role="alert" className="mt-2 text-body text-error">
          {translate(messages, 'payments.methods.refused')}{' '}
          {methods.correlationId ? <Identifier value={methods.correlationId} /> : null}
        </p>
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
      draft.amount.trim().length > 0
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
  const payerUnavailableId = useId();

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

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'payments.record.formLabel')}
      className="mt-3 grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        if (!UUID.test(draft.paymentMethodId))
          found['paymentMethodId'] = 'payments.common.required';
        if (payer === null) found['payerPartnerId'] = 'payments.record.payerRequired';
        if (!CURRENCY.test(draft.currency.trim().toUpperCase()))
          found['currency'] = 'payments.common.currencyFormat';
        if (!isPayableAmount(draft.amount)) found['amount'] = 'payments.common.amountFormat';
        setErrors(found);
        if (Object.keys(found).length > 0 || payer === null) {
          setAttempt((n) => n + 1);
          return;
        }
        setBusy(true);
        void recordPayment(
          {
            companyId: target.companyId,
            branchId: target.branchId,
            paymentMethodId: draft.paymentMethodId,
            payerPartnerId: payer.id,
            currency: draft.currency.trim().toUpperCase(),
            amount: draft.amount.trim(),
          },
          attemptKey
        ).then((result) => {
          setOutcome(result.state);
          notifyActionResult(result.state, messages);
          if (result.state.status === 'success' && result.created) {
            // `replayed` is the SERVER's word. A transport replay returns the
            // stored body, whose flag is the one first written, so the screen
            // never infers a repeat from the fact that it reused its key.
            onRecorded(result.created, result.created.replayed);
            return;
          }
          if (Object.keys(result.state.fieldErrors ?? {}).length > 0) setAttempt((n) => n + 1);
          setBusy(false);
        });
      }}
    >
      <SelectField
        label={translate(messages, 'payments.record.method')}
        required
        value={draft.paymentMethodId}
        onChange={(event) => {
          setDraft((d) => ({ ...d, paymentMethodId: event.target.value }));
          clearError('paymentMethodId');
        }}
        options={methods.map((method) => ({
          value: method.id,
          label: `${method.displayName} — ${translateDynamic(messages, `payments.kind.${method.kind}`)}`,
        }))}
        error={errorFor('paymentMethodId')}
      />
      <div className="sm:col-span-2">
        <CustomerPicker
          messages={messages}
          locale={locale}
          label={translate(messages, 'payments.record.payer')}
          value={payer}
          onChange={(next) => {
            setPayer(next);
            if (next !== null) clearError('payerPartnerId');
          }}
          canSearch={canReadCustomers}
          error={errorFor('payerPartnerId')}
          unavailableId={payerUnavailableId}
          testId="payments-payer-picker"
        />
      </div>
      <TextField
        label={translate(messages, 'payments.record.currency')}
        required
        spellCheck={false}
        dir="ltr"
        value={draft.currency}
        onChange={(event) => {
          setDraft((d) => ({ ...d, currency: event.target.value }));
          clearError('currency');
        }}
        error={errorFor('currency')}
      />
      <TextField
        label={translate(messages, 'payments.record.amount')}
        description={translate(messages, 'payments.record.amountHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={draft.amount}
        onChange={(event) => {
          setDraft((d) => ({ ...d, amount: event.target.value }));
          clearError('amount');
        }}
        error={errorFor('amount')}
      />
      <div className="sm:col-span-2">
        <p className="text-body text-text-secondary">
          {translate(messages, 'payments.record.explain')}
        </p>
        <button
          type="submit"
          className={`${PRIMARY_BUTTON} mt-2`}
          // Without the customer read no payer can be chosen, so the submit is
          // held and described by the sentence that says why.
          disabled={busy || !canReadCustomers}
          aria-describedby={canReadCustomers ? undefined : payerUnavailableId}
        >
          {translate(messages, 'payments.record.submit')}
        </button>
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The receipts of the branch
 * ------------------------------------------------------------------ */

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
  const [criteria, setCriteria] = useState<ReceiptCriteria>({
    payerPartnerId: null,
    status: null,
    invoiceId: initialInvoiceId,
  });
  /*
   * The filters, as CHOSEN rather than typed (Owner directive,
   * `P1-32-PRE-OD-UX`): a payer found among customers, an invoice found among
   * the branch's invoices. An invoice named in the address stays the filter
   * until the operator removes it, and is described rather than printed.
   */
  const [draft, setDraft] = useState<{
    readonly payer: ChosenCustomer | null;
    readonly status: string;
    readonly invoice: InvoiceListEntry | null;
    readonly fromAddress: string | null;
  }>({ payer: null, status: '', invoice: null, fromAddress: initialInvoiceId });

  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listReceipts(target, criteria, request, cursor),
    [target, criteria]
  );
  const table = useServerTable<Receipt>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: PAGE_SIZE },
    // The filters live in this panel, not in the table request, so they must be
    // named here or applying one changes the loader and re-reads nothing
    // (`P1-26-F-019`). The target is in the panel's key, not in this string.
    loadKey: `${criteria.payerPartnerId ?? ''}:${criteria.status ?? ''}:${criteria.invoiceId ?? ''}:${epoch}`,
  });

  const columns = useMemo<readonly Column<Receipt>[]>(
    () => [
      {
        id: 'reference',
        headerKey: 'payments.list.reference',
        cell: (row) => (
          <button
            type="button"
            className="text-primary underline"
            onClick={() => onSelect(row.id)}
            aria-current={row.id === selected ? 'true' : undefined}
          >
            {row.reference}
          </button>
        ),
      },
      {
        id: 'receivedAt',
        headerKey: 'payments.list.receivedAt',
        cell: (row) => formatDateTime(row.receivedAt, locale),
      },
      {
        id: 'payer',
        headerKey: 'payments.list.payer',
        cell: (row) => <Identifier value={row.payerPartnerId} />,
      },
      {
        id: 'method',
        headerKey: 'payments.list.method',
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
        cell: (row) => <Money money={row.money} locale={locale} />,
      },
      {
        id: 'open',
        headerKey: 'payments.list.unapplied',
        cell: (row) => <Money money={row.unallocated} locale={locale} />,
      },
      {
        id: 'status',
        headerKey: 'payments.list.status',
        cell: (row) => <ReceiptStatusBadge messages={messages} status={row.status} />,
      },
    ],
    [locale, messages, onSelect, selected]
  );

  return (
    <section
      aria-label={translate(messages, 'payments.list.heading')}
      className="rounded-md border border-border bg-surface p-4"
      data-print="hide"
    >
      <h2 className="text-section-title">{translate(messages, 'payments.list.heading')}</h2>
      <form
        aria-label={translate(messages, 'payments.list.filtersLabel')}
        className="mt-3 grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setCriteria({
            payerPartnerId: draft.payer?.id ?? null,
            status: draft.status ? (draft.status as ReceiptStatus) : null,
            invoiceId: draft.invoice?.id ?? draft.fromAddress,
          });
        }}
      >
        <CustomerPicker
          messages={messages}
          locale={locale}
          label={translate(messages, 'payments.list.payerFilter')}
          value={draft.payer}
          onChange={(payer) => setDraft((d) => ({ ...d, payer }))}
          canSearch={canReadCustomers}
          testId="payments-payer-filter"
        />
        <SelectField
          label={translate(messages, 'payments.list.statusFilter')}
          value={draft.status}
          onChange={(event) => setDraft((d) => ({ ...d, status: event.target.value }))}
          options={RECEIPT_STATUSES.map((status) => ({
            value: status,
            label: translateDynamic(messages, `payments.status.${status}`),
          }))}
          placeholder={translate(messages, 'payments.list.anyStatus')}
        />
        {draft.fromAddress !== null && draft.invoice === null ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-text-primary">
              {translate(messages, 'payments.list.invoiceFilter')}
            </span>
            <p className="text-body text-text-secondary">
              {translate(messages, 'payments.list.invoiceFromAddress')}
            </p>
            <div>
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={() => setDraft((d) => ({ ...d, fromAddress: null }))}
              >
                {translate(messages, 'invoices.picker.change')}
              </button>
            </div>
          </div>
        ) : (
          <InvoicePicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'payments.list.invoiceFilter')}
            target={target}
            value={draft.invoice}
            onChange={(invoice) => setDraft((d) => ({ ...d, invoice }))}
            canSearch={canListInvoices}
            testId="payments-invoice-filter"
          />
        )}
        <div className="sm:col-span-3">
          <button type="submit" className={SECONDARY_BUTTON}>
            {translate(messages, 'payments.list.apply')}
          </button>
        </div>
      </form>
      <p className="mt-2 text-caption text-text-muted">
        {translate(messages, 'payments.list.noDateFilter')}
      </p>
      <div className="mt-3 flex min-h-0 flex-col gap-2">
        <DataTable<Receipt>
          messages={messages}
          columns={columns}
          rowId={(row) => row.id}
          request={table.request}
          response={table.response}
          status={table.status}
          onRequestChange={table.setRequest}
          onRetry={table.refresh}
          correlationId={table.correlationId}
          caption={translate(messages, 'payments.list.caption')}
          suppressEmptyState
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

function ReceiptPanel({
  locale,
  messages,
  receiptId,
  initialInvoiceId,
  canAllocate,
  canListInvoices,
  onAllocated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receiptId: string;
  readonly initialInvoiceId: string | null;
  readonly canAllocate: boolean;
  readonly canListInvoices: boolean;
  readonly onAllocated: (allocation: Allocation, open: ReadState<Outstanding>) => void;
}) {
  const [state, setState] = useState<ReadState<ReceiptDetail> | null>(null);

  useEffect(() => {
    let live = true;
    void readReceipt(receiptId).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [receiptId]);

  if (state === null) {
    return (
      <section
        aria-label={translate(messages, 'payments.receipt.heading')}
        className="rounded-md border border-border bg-surface p-4"
      >
        <p className="text-body text-text-secondary">
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
        <p role="alert" className="text-body text-error">
          {translate(
            messages,
            state.status === 'not-found'
              ? 'payments.receipt.notFound'
              : state.status === 'denied'
                ? 'payments.receipt.denied'
                : 'payments.receipt.unavailable'
          )}
          {state.correlationId ? (
            <>
              {' '}
              <Identifier value={state.correlationId} />
            </>
          ) : null}
        </p>
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
          <Row label={translate(messages, 'payments.receipt.reference')}>{receipt.reference}</Row>
          <Row label={translate(messages, 'payments.receipt.status')}>
            <ReceiptStatusBadge messages={messages} status={receipt.status} />
          </Row>
          <Row label={translate(messages, 'payments.receipt.receivedAt')}>
            {formatDateTime(receipt.receivedAt, locale)}
          </Row>
          <Row label={translate(messages, 'payments.receipt.payer')}>
            <Identifier value={receipt.payerPartnerId} />
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
                  {formatDateTime(allocation.allocatedAt, locale)}
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

      <PrintPanel locale={locale} messages={messages} receipt={receipt} />
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
  readonly onAllocated: (allocation: Allocation, open: ReadState<Outstanding>) => void;
}) {
  // One transport key per opened form, as on the record form.
  const [attemptKey] = useState(() => crypto.randomUUID());
  /*
   * The invoice is FOUND among the receipt's own branch's issued invoices and
   * chosen by its number and payer (Owner directive, `P1-32-PRE-OD-UX`); it used
   * to be a box asking for an invoice reference. One reached from an invoice
   * arrives named in the address and stays the choice until it is changed.
   */
  const [invoice, setInvoice] = useState<InvoiceListEntry | null>(null);
  const [fromAddress, setFromAddress] = useState<string | null>(initialInvoiceId);
  const [amount, setAmount] = useState('');
  // A branch switch closes the previous branch's receipt, and this form with it.
  // The picker declares a chosen invoice itself.
  useUnsavedGuard(amount.trim().length > 0);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useFocusFirstInvalid({
    status: 'invalid',
    fieldErrors: { ...(outcome?.fieldErrors ?? {}), ...errors },
    attempt,
  });
  const invoiceUnavailableId = useId();
  const invoiceId = invoice?.id ?? fromAddress;
  const blocked = invoiceId === null && !canListInvoices;

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

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'payments.allocate.formLabel')}
      className="mt-4 grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        if (invoiceId === null) found['invoiceId'] = 'payments.allocate.invoiceRequired';
        if (!isPayableAmount(amount)) found['amount'] = 'payments.common.amountFormat';
        setErrors(found);
        if (Object.keys(found).length > 0 || invoiceId === null) {
          setAttempt((n) => n + 1);
          return;
        }
        setBusy(true);
        void allocatePayment(
          receipt.id,
          {
            invoiceId,
            amount: amount.trim(),
            // The receipt's own currency: the route compares the declared code
            // against the receipt AND the invoice, and refuses any disagreement.
            currency: receipt.money.currency,
          },
          attemptKey
        ).then(async (result) => {
          setOutcome(result.state);
          notifyActionResult(result.state, messages);
          if (result.state.status === 'success' && result.created) {
            // The allocation echo carries the RECEIPT's new remainder but not
            // the invoice's balance, so the invoice is read for it — and the
            // answer is handed UP, because reporting it re-reads this panel.
            const open = await readOutstanding(invoiceId);
            onAllocated(result.created, open);
            return;
          }
          if (Object.keys(result.state.fieldErrors ?? {}).length > 0) setAttempt((n) => n + 1);
          setBusy(false);
        });
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
                    <button
                      type="button"
                      className={SECONDARY_BUTTON}
                      onClick={() => setFromAddress(null)}
                    >
                      {translate(messages, 'invoices.picker.change')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <InvoicePicker
                messages={messages}
                locale={locale}
                label={translate(messages, 'payments.allocate.invoice')}
                target={{ companyId: receipt.companyId, branchId: receipt.branchId }}
                status="issued"
                value={invoice}
                onChange={(next) => {
                  setInvoice(next);
                  if (next !== null) clearError('invoiceId');
                }}
                canSearch={canListInvoices}
                error={errorFor('invoiceId')}
                unavailableId={invoiceUnavailableId}
                testId="payments-invoice-picker"
              />
            )}
            <p className="mt-1 text-caption text-text-muted">
              {translate(messages, 'payments.allocate.invoiceHelp')}
            </p>
          </div>
          <TextField
            label={`${translate(messages, 'payments.allocate.amount')} (${receipt.money.currency})`}
            description={translate(messages, 'payments.allocate.amountHelp')}
            required
            spellCheck={false}
            dir="ltr"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              clearError('amount');
            }}
            error={errorFor('amount')}
          />
          <div className="sm:col-span-2">
            <button
              type="submit"
              className={`${PRIMARY_BUTTON}`}
              disabled={busy || blocked}
              aria-describedby={blocked ? invoiceUnavailableId : undefined}
            >
              {translate(messages, 'payments.allocate.submit')}
            </button>
            <OutcomeNote messages={messages} outcome={outcome} />
          </div>
        </>
      )}
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
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label={translate(messages, 'payments.print.heading')}
      className="rounded-md border border-border bg-surface p-4"
    >
      <div data-print="hide">
        <h2 className="text-section-title">{translate(messages, 'payments.print.heading')}</h2>
        <p className="mt-1 text-body text-text-secondary">
          {translate(messages, 'payments.print.explain')}
        </p>
        <button
          type="button"
          className={`${SECONDARY_BUTTON} mt-2`}
          aria-expanded={open}
          aria-controls="payments-print"
          onClick={() => setOpen((was) => !was)}
        >
          {translate(messages, open ? 'payments.print.close' : 'payments.print.open')}
        </button>
      </div>
      {open ? (
        <div className="mt-4" id="payments-print">
          <ReceiptDocument locale={locale} messages={messages} receipt={receipt} />
        </div>
      ) : null}
    </section>
  );
}
