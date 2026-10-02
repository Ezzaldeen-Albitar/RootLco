'use client';

import { useMemo, useState } from 'react';
import Button from '@mui/material/Button';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import { useReread } from '@/lib/api/use-reread';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { fitsMinorUnit, formatMoney } from '@/lib/money';

import {
  approveReceiptReversal,
  listPaymentMethods,
  recordReplacementReceipt,
  rejectReceiptReversal,
  requestReceiptReversal,
  withdrawReceiptReversal,
  type CreateOutcome,
} from '../api';
import {
  REVERSAL_REASON_MAX,
  type PaymentMethod,
  type ReceiptDetail,
  type ReceiptLink,
  type ReceiptReversalDetail,
  type ReceiptReversalEcho,
  type RecordedReceipt,
} from '../payments-contract';
import type { ReceiptPayerName } from './ReceiptDocument';
import { CURRENCY, OutcomeNote, UUID, When, isPayableAmount, withoutKey } from './shared';

/**
 * The reversal of a receipt and its replacement (ADR-023 D4), on the receipt
 * panel. On the shared Material UI wrappers: the reason is asked by
 * `ReasonDialog`, the consequential steps by `ConfirmDialog`, and the replacement
 * is the record form's own fields.
 *
 * ## Who is offered what
 *
 *  - A payment recorder (`sal.payment.record`) may ask for a receipt that is not
 *    reversed and has no reversal waiting to be reversed — the WHOLE receipt; the
 *    request is the reason and nothing else.
 *  - While a request waits, the panel says so and the allocation form is closed
 *    with the same explanation. The person who asked may withdraw it; somebody
 *    else holding `sal.reversal.approve` may approve it, or reject it with a
 *    reason; anybody else is told it waits for such a person.
 *  - A decided request shows its decision — who and when, by NAME, or "not shown"
 *    for a reader who may not read users; never an id — and offers nothing more.
 *  - After an approval, a payment recorder may record the replacement receipt,
 *    with the payer and the currency prefilled. The two receipts are linked both
 *    ways, by their numbers.
 *
 * ## Versions
 *
 * The request sends the RECEIPT's version and each decision the REVERSAL's, as
 * the receipt read published them, held by `useEditBaseline` so a refresh that
 * arrives while a dialog is open is adopted only once nothing is in progress. A
 * conflict — the receipt or the reversal moved on since it was read — is said in
 * words with "Load the latest version" beside it, and nothing is sent again
 * until the latest version is loaded.
 */

type Decision = 'request' | 'approve' | 'reject' | 'withdraw';

/** A person on the reversal, by name, or said not to be shown. */
function PersonName({
  messages,
  name,
}: {
  readonly messages: Messages;
  readonly name: string | null;
}) {
  if (name !== null) return <bdi>{name}</bdi>;
  return (
    <span className="text-text-muted">{translate(messages, 'payments.reversal.nameNotShown')}</span>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

export function ReversalSection({
  locale,
  messages,
  receipt,
  currentUserId,
  canRequest,
  canDecide,
  onChanged,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  /** The signed-in person, to know whose request a pending reversal is. */
  readonly currentUserId: string | null;
  /** `sal.payment.record` — asking for a reversal, and withdrawing your own. */
  readonly canRequest: boolean;
  /** `sal.reversal.approve` — approving or rejecting somebody else's request. */
  readonly canDecide: boolean;
  /** A step landed: the screen reads the receipt and the list again. */
  readonly onChanged: (noticeKey: string) => void;
  /** Reads the receipt again, for the conflict's way out. */
  readonly onReload: () => Promise<void>;
}) {
  const reversal = receipt.reversal ?? null;
  const requestable =
    canRequest &&
    receipt.status !== 'reversed' &&
    (reversal === null || !pendingOrApproved(reversal.state));

  return (
    <section
      aria-label={translate(messages, 'payments.reversal.heading')}
      className="mt-4 flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="payments-reversal"
    >
      <h3 className="text-section-title">{translate(messages, 'payments.reversal.heading')}</h3>
      {reversal !== null ? (
        <ReversalFacts locale={locale} messages={messages} reversal={reversal} />
      ) : null}
      {reversal !== null && reversal.state === 'pending' ? (
        <PendingReversal
          key={`${reversal.id}-${reversal.recordVersion}`}
          locale={locale}
          messages={messages}
          receipt={receipt}
          reversal={reversal}
          currentUserId={currentUserId}
          canDecide={canDecide}
          onChanged={onChanged}
          onReload={onReload}
        />
      ) : requestable ? (
        <RequestReversal
          key={`request-${receipt.recordVersion}`}
          locale={locale}
          messages={messages}
          receipt={receipt}
          onChanged={onChanged}
          onReload={onReload}
        />
      ) : null}
    </section>
  );
}

const pendingOrApproved = (state: string): boolean => state === 'pending' || state === 'approved';

/** The reversal as stored: its state, the people on it by name, the dates and the reasons. */
function ReversalFacts({
  locale,
  messages,
  reversal,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reversal: ReceiptReversalDetail;
}) {
  return (
    <>
      {reversal.state === 'pending' ? (
        <p
          role="status"
          className="text-body text-text-primary"
          data-testid="payments-reversal-pending"
        >
          {translate(messages, 'payments.reversal.pendingBanner')}
        </p>
      ) : reversal.state === 'approved' ? (
        <p className="text-body text-text-primary">
          {translate(messages, 'payments.reversal.reversedNote')}
        </p>
      ) : (
        <p className="text-body text-text-secondary">
          {translate(messages, 'payments.reversal.lastRequest')}
        </p>
      )}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label={translate(messages, 'payments.reversal.status')}>
          {translateDynamic(messages, `payments.reversal.state.${reversal.state}`)}
        </Fact>
        <Fact label={translate(messages, 'payments.reversal.requestedBy')}>
          <PersonName messages={messages} name={reversal.requestedByName} />
        </Fact>
        <Fact label={translate(messages, 'payments.reversal.requestedAt')}>
          <When value={reversal.requestedAt} locale={locale} />
        </Fact>
        {reversal.decidedAt !== null ? (
          <>
            <Fact label={translate(messages, 'payments.reversal.decidedBy')}>
              <PersonName messages={messages} name={reversal.decidedByName} />
            </Fact>
            <Fact label={translate(messages, 'payments.reversal.decidedAt')}>
              <When value={reversal.decidedAt} locale={locale} />
            </Fact>
          </>
        ) : null}
        <Fact label={translate(messages, 'payments.reversal.reasonGiven')}>
          <bdi>{reversal.reason}</bdi>
        </Fact>
        {reversal.state === 'rejected' && reversal.decisionReason !== null ? (
          <Fact label={translate(messages, 'payments.reversal.rejectionReason')}>
            <bdi>{reversal.decisionReason}</bdi>
          </Fact>
        ) : null}
      </dl>
    </>
  );
}

/**
 * What a step's answer does to the panel, shared by the request and the three
 * decisions. `settle` returns the notice to hand onward when the step landed and
 * `null` otherwise; a refusal of the reason stays on the reason box with the
 * typed text kept; a version conflict offers the latest version.
 */
function useStep(messages: Messages) {
  const [asking, setAsking] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [stale, setStale] = useState(false);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  const settle = (
    decision: Decision,
    result: CreateOutcome<ReceiptReversalEcho> | null
  ): string | null => {
    if (result === null) {
      setAsking(null);
      setOutcome(unreachable(1));
      return null;
    }
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setAsking(null);
      setOutcome(null);
      setReasonError(undefined);
      return result.state.messageKey ?? 'payments.reversal.requested';
    }
    const reasonRefusal = result.state.fieldErrors?.['reason'];
    if ((decision === 'request' || decision === 'reject') && reasonRefusal !== undefined) {
      setReasonError(translateDynamic(messages, reasonRefusal));
      return null;
    }
    setAsking(null);
    setOutcome(result.state);
    if (
      result.state.status === 'conflict' &&
      result.state.messageKey === 'payments.reversal.conflict'
    ) {
      setStale(true);
    }
    return null;
  };

  const open = (decision: Decision) => {
    setOutcome(null);
    setReasonError(undefined);
    setAsking(decision);
  };

  return {
    asking,
    setAsking,
    busy,
    setBusy,
    outcome,
    setOutcome,
    stale,
    setStale,
    reasonError,
    settle,
    open,
  };
}

/** The conflict's way out, under the panel's outcome line. */
function StaleNote({
  messages,
  step,
  onLoadLatest,
}: {
  readonly messages: Messages;
  readonly step: ReturnType<typeof useStep>;
  readonly onLoadLatest: () => void;
}) {
  return (
    <>
      <OutcomeNote messages={messages} outcome={step.outcome} />
      {step.stale ? (
        <div>
          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={step.busy}
            aria-busy={step.busy || undefined}
            onClick={onLoadLatest}
            data-testid="payments-reversal-load-latest"
          >
            {translate(messages, 'form.loadLatest')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** A payment recorder asks for the WHOLE receipt to be reversed, stating why. */
function RequestReversal({
  locale,
  messages,
  receipt,
  onChanged,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  readonly onChanged: (noticeKey: string) => void;
  readonly onReload: () => Promise<void>;
}) {
  // The RECEIPT's version, as its detail read published it.
  const baseline = useEditBaseline<null>({ stored: null, storedVersion: receipt.recordVersion });
  const step = useStep(messages);

  const request = async (reason: string) => {
    step.setBusy(true);
    try {
      const result = await requestReceiptReversal(receipt.id, { reason }, baseline.version).catch(
        () => null
      );
      const notice = step.settle('request', result);
      if (notice !== null) onChanged(notice);
    } finally {
      step.setBusy(false);
    }
  };

  const loadLatest = async () => {
    step.setBusy(true);
    try {
      await onReload();
      baseline.discard();
      step.setStale(false);
      step.setOutcome(null);
    } finally {
      step.setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-text-muted">
        {translate(messages, 'payments.reversal.explain')}
      </p>
      <div>
        <Button
          type="button"
          variant="outlined"
          color="error"
          disabled={step.busy || step.stale}
          aria-busy={step.busy || undefined}
          onClick={() => step.open('request')}
        >
          {translate(messages, 'payments.reversal.request')}
        </Button>
      </div>
      <StaleNote messages={messages} step={step} onLoadLatest={() => void loadLatest()} />
      <ReasonDialog
        open={step.asking === 'request'}
        messages={messages}
        title={translate(messages, 'payments.reversal.requestTitle')}
        description={formatMessage(translate(messages, 'payments.reversal.requestExplain'), {
          amount: formatMoney(receipt.money, locale),
        })}
        confirmLabel={translate(messages, 'payments.reversal.request')}
        reasonLabel={translate(messages, 'payments.reversal.reason')}
        reasonError={step.reasonError}
        maxLength={REVERSAL_REASON_MAX}
        destructive
        pending={step.busy}
        onCancel={() => step.setAsking(null)}
        onConfirm={(reason) => void request(reason)}
        testId="payments-reversal-request-dialog"
      />
    </div>
  );
}

/**
 * A pending reversal: the requester may withdraw it; somebody else holding the
 * approval code may approve or reject it; anybody else is told it waits.
 */
function PendingReversal({
  locale,
  messages,
  receipt,
  reversal,
  currentUserId,
  canDecide,
  onChanged,
  onReload,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  readonly reversal: ReceiptReversalDetail;
  readonly currentUserId: string | null;
  readonly canDecide: boolean;
  readonly onChanged: (noticeKey: string) => void;
  readonly onReload: () => Promise<void>;
}) {
  // The REVERSAL's version, as the receipt's detail read published it.
  const baseline = useEditBaseline<null>({ stored: null, storedVersion: reversal.recordVersion });
  const step = useStep(messages);
  const own = currentUserId !== null && reversal.requestedBy === currentUserId;
  const decides = !own && canDecide;
  const amount = formatMoney(receipt.money, locale);

  const approve = async () => {
    step.setBusy(true);
    try {
      const result = await approveReceiptReversal(reversal.id).catch(() => null);
      const notice = step.settle('approve', result);
      if (notice !== null) onChanged(notice);
    } finally {
      step.setBusy(false);
    }
  };
  const reject = async (reason: string) => {
    step.setBusy(true);
    try {
      const result = await rejectReceiptReversal(reversal.id, { reason }, baseline.version).catch(
        () => null
      );
      const notice = step.settle('reject', result);
      if (notice !== null) onChanged(notice);
    } finally {
      step.setBusy(false);
    }
  };
  const withdraw = async () => {
    step.setBusy(true);
    try {
      const result = await withdrawReceiptReversal(reversal.id, baseline.version).catch(() => null);
      const notice = step.settle('withdraw', result);
      if (notice !== null) onChanged(notice);
    } finally {
      step.setBusy(false);
    }
  };
  const loadLatest = async () => {
    step.setBusy(true);
    try {
      await onReload();
      baseline.discard();
      step.setStale(false);
      step.setOutcome(null);
    } finally {
      step.setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {own ? (
        <>
          <p className="text-body text-text-secondary">
            {translate(messages, 'payments.reversal.ownRequest')}
          </p>
          <div>
            <Button
              type="button"
              variant="outlined"
              color="error"
              disabled={step.busy || step.stale}
              aria-busy={step.busy || undefined}
              onClick={() => step.open('withdraw')}
            >
              {translate(messages, 'payments.reversal.withdraw')}
            </Button>
          </div>
        </>
      ) : decides ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="contained"
            disabled={step.busy || step.stale}
            aria-busy={step.busy || undefined}
            onClick={() => step.open('approve')}
          >
            {translate(messages, 'payments.reversal.approve')}
          </Button>
          <Button
            type="button"
            variant="outlined"
            color="error"
            disabled={step.busy || step.stale}
            aria-busy={step.busy || undefined}
            onClick={() => step.open('reject')}
          >
            {translate(messages, 'payments.reversal.reject')}
          </Button>
        </div>
      ) : (
        <p className="text-body text-text-secondary" data-testid="payments-reversal-cannot-decide">
          {translate(messages, 'payments.reversal.cannotDecide')}
        </p>
      )}
      <StaleNote messages={messages} step={step} onLoadLatest={() => void loadLatest()} />
      <ConfirmDialog
        open={step.asking === 'approve' && decides}
        messages={messages}
        title={translate(messages, 'payments.reversal.approveTitle')}
        description={formatMessage(translate(messages, 'payments.reversal.approveExplain'), {
          amount,
        })}
        confirmLabel={translate(messages, 'payments.reversal.approve')}
        destructive
        pending={step.busy}
        onCancel={() => step.setAsking(null)}
        onConfirm={() => void approve()}
        testId="payments-reversal-approve-dialog"
      />
      <ConfirmDialog
        open={step.asking === 'withdraw' && own}
        messages={messages}
        title={translate(messages, 'payments.reversal.withdrawTitle')}
        description={translate(messages, 'payments.reversal.withdrawExplain')}
        confirmLabel={translate(messages, 'payments.reversal.withdraw')}
        destructive
        pending={step.busy}
        onCancel={() => step.setAsking(null)}
        onConfirm={() => void withdraw()}
        testId="payments-reversal-withdraw-dialog"
      />
      <ReasonDialog
        open={step.asking === 'reject' && decides}
        messages={messages}
        title={translate(messages, 'payments.reversal.rejectTitle')}
        description={formatMessage(translate(messages, 'payments.reversal.rejectExplain'), {
          amount,
        })}
        confirmLabel={translate(messages, 'payments.reversal.reject')}
        reasonLabel={translate(messages, 'payments.reversal.reason')}
        reasonError={step.reasonError}
        maxLength={REVERSAL_REASON_MAX}
        destructive
        pending={step.busy}
        onCancel={() => step.setAsking(null)}
        onConfirm={(reason) => void reject(reason)}
        testId="payments-reversal-reject-dialog"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The replacement link, both ways
 * ------------------------------------------------------------------ */

/** The receipt this one replaces, and the one that replaces it — by number. */
export function ReplacementLinks({
  messages,
  receipt,
  onOpen,
}: {
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  readonly onOpen: (receiptId: string) => void;
}) {
  const links: {
    readonly key: 'payments.replacement.replaces' | 'payments.replacement.replacedBy';
    readonly link: ReceiptLink;
  }[] = [];
  if (receipt.replaces)
    links.push({ key: 'payments.replacement.replaces', link: receipt.replaces });
  if (receipt.replacedBy) {
    links.push({ key: 'payments.replacement.replacedBy', link: receipt.replacedBy });
  }
  if (links.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-2" data-testid="payments-replacement-links">
      {links.map(({ key, link }) => (
        <li key={key} className="flex flex-wrap items-center gap-2 text-body">
          <span className="text-text-secondary">{translate(messages, key)}</span>
          <span className="font-mono" dir="ltr">
            {link.reference}
          </span>
          <Button type="button" variant="outlined" size="small" onClick={() => onOpen(link.id)}>
            {translate(messages, 'payments.replacement.openLinked')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Recording the replacement
 * ------------------------------------------------------------------ */

/**
 * "Record replacement receipt" on a receipt whose reversal was approved and that
 * no receipt replaces yet. The payer and the currency are prefilled from the
 * reversed receipt and may be changed — a wrong payer may be exactly what the
 * reversal corrected — and the amount is entered. Every rule of an ordinary
 * receipt applies on the server.
 */
export function ReplacementPanel({
  locale,
  messages,
  receipt,
  payer,
  canReadCustomers,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  readonly payer: ReceiptPayerName;
  readonly canReadCustomers: boolean;
  readonly onRecorded: (receipt: RecordedReceipt) => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <section
      aria-label={translate(messages, 'payments.replacement.heading')}
      className="mt-4 flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="payments-replacement"
    >
      <h3 className="text-section-title">{translate(messages, 'payments.replacement.heading')}</h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'payments.replacement.explain')}
      </p>
      {opened ? (
        <ReplacementForm
          locale={locale}
          messages={messages}
          receipt={receipt}
          payer={payer}
          canReadCustomers={canReadCustomers}
          onCancel={() => setOpened(false)}
          onRecorded={onRecorded}
        />
      ) : (
        <div>
          <Button type="button" variant="contained" onClick={() => setOpened(true)}>
            {translate(messages, 'payments.replacement.open')}
          </Button>
        </div>
      )}
    </section>
  );
}

function ReplacementForm({
  locale,
  messages,
  receipt,
  payer,
  canReadCustomers,
  onCancel,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  readonly payer: ReceiptPayerName;
  readonly canReadCustomers: boolean;
  readonly onCancel: () => void;
  readonly onRecorded: (receipt: RecordedReceipt) => void;
}) {
  const methods = useReread<{ items: readonly PaymentMethod[] }>(listPaymentMethods);
  const recordable = useMemo(
    () =>
      methods.value?.status === 'ok' ? methods.value.data.items.filter((m) => m.recordable) : [],
    [methods.value]
  );
  // ONE transport key for this opened form, as on the record form.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [methodId, setMethodId] = useState(receipt.method?.id ?? '');
  const [currency, setCurrency] = useState(receipt.money.currency);
  const [amount, setAmount] = useState('');
  // The reversed receipt's payer, prefilled; a reader who may search customers may choose another.
  const prefilled: ChosenCustomer | null =
    payer.kind === 'named'
      ? { id: receipt.payerPartnerId, displayName: payer.name, displayNumber: null }
      : null;
  const [chosen, setChosen] = useState<ChosenCustomer | null>(prefilled);
  const payerPartnerId = canReadCustomers ? (chosen?.id ?? null) : receipt.payerPartnerId;
  useUnsavedGuard(amount.trim().length > 0 || currency !== receipt.money.currency);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useFocusFirstInvalid({
    status: 'invalid',
    fieldErrors: { ...(outcome?.fieldErrors ?? {}), ...errors },
    attempt,
  });

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };
  const clearError = (name: string) => {
    setErrors((previous) => withoutKey(previous, name));
    setOutcome((previous) =>
      previous?.fieldErrors?.[name]
        ? { ...previous, fieldErrors: withoutKey(previous.fieldErrors, name) }
        : previous
    );
  };

  const currencyCode = currency.trim().toUpperCase();
  const selectedMethod = recordable.find((method) => method.id === methodId);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!UUID.test(methodId) || selectedMethod === undefined) {
      found['paymentMethodId'] = 'payments.common.required';
    }
    if (payerPartnerId === null) found['payerPartnerId'] = 'payments.record.payerRequired';
    if (!CURRENCY.test(currencyCode)) found['currency'] = 'payments.common.currencyFormat';
    if (!isPayableAmount(amount)) found['amount'] = 'payments.common.amountFormat';
    else if (
      currencyCode === receipt.money.currency &&
      !fitsMinorUnit(amount, receipt.money.minorUnit)
    ) {
      found['amount'] = 'form.violation.minor_unit_scale';
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || payerPartnerId === null) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    let recorded = false;
    try {
      let result: Awaited<ReturnType<typeof recordReplacementReceipt>>;
      try {
        result = await recordReplacementReceipt(
          receipt.id,
          {
            paymentMethodId: methodId,
            payerPartnerId,
            currency: currencyCode,
            amount: amount.trim(),
          },
          attemptKey
        );
      } catch {
        setOutcome(unreachable(1));
        return;
      }
      setOutcome(result.state);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success' && result.created) {
        recorded = true;
        onRecorded(result.created);
        return;
      }
      if (Object.keys(result.state.fieldErrors ?? {}).length > 0) setAttempt((n) => n + 1);
    } finally {
      if (!recorded) setBusy(false);
    }
  };

  if (methods.value === null) {
    return (
      <p role="status" className="text-body text-text-secondary">
        {translate(messages, 'payments.methods.loading')}
      </p>
    );
  }
  if (methods.value.status !== 'ok') {
    return (
      <MuiReadFailureState
        messages={messages}
        locale={locale}
        status={methods.value.status}
        correlationId={methods.value.correlationId}
        descriptionKey="payments.methods.refused"
        onRetry={() => void methods.reload()}
      />
    );
  }
  if (recordable.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'payments.methods.noneRecordable')}
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'payments.replacement.heading')}
      className="grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormSelectField
        label={translate(messages, 'payments.record.method')}
        required
        value={methodId}
        onChange={(next) => {
          setMethodId(next);
          clearError('paymentMethodId');
        }}
        options={recordable.map((method) => ({
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
            value={chosen}
            onChange={(next) => {
              setChosen(next);
              if (next !== null) clearError('payerPartnerId');
            }}
            canSearch
            countsAsUnsaved={false}
            error={errorFor('payerPartnerId')}
            testId="payments-replacement-payer"
            material
          />
        ) : (
          <p className="text-body text-text-secondary">
            {translate(messages, 'payments.replacement.payerKept')}
          </p>
        )}
      </div>
      <FormTextField
        label={translate(messages, 'payments.record.currency')}
        required
        autoComplete="off"
        dir="ltr"
        maxLength={3}
        value={currency}
        onChange={(next) => {
          setCurrency(next);
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
        value={amount}
        onEdit={() => clearError('amount')}
        onChange={(next) => setAmount(next)}
        error={errorFor('amount')}
      />
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
          {translate(messages, 'payments.replacement.submit')}
        </Button>
        <Button type="button" variant="outlined" disabled={busy} onClick={onCancel}>
          {translate(messages, 'payments.replacement.cancel')}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
    </form>
  );
}
