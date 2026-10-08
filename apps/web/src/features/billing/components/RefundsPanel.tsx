'use client';

/**
 * The refunds of one invoice (ADR-023 D2, part 2, P1-32-PRE-OD-FD2B), on the
 * invoice screen.
 *
 * When an approved credit note exceeded what the invoice still owed, the customer
 * is owed the difference back — a refund obligation. Nothing pays it automatically.
 * This panel is where it is paid back, in three separate steps:
 *
 *  1. a payment recorder (`sal.payment.record`) ASKS for a refund — the amount, the
 *     payment method and the reason — of an obligation that is still open and has no
 *     request waiting;
 *  2. a DIFFERENT person holding `sal.refund.approve` approves it, or rejects it with
 *     a reason; the person who asked may withdraw it while it waits;
 *  3. once it is approved, a payment recorder RECORDS THE PAYOUT — the reference and
 *     the day the money was paid back, by the approved method — exactly once.
 *
 * Every figure is the server's: what each obligation is, what has been paid out on
 * it and what is still owed. The amount box is compared, digit by digit, with what
 * is still owed (`compareMoney`) and nothing is added or subtracted here. Each step
 * is offered only to a holder of its code in the invoice's branch, and the server
 * holds every rule again; a refusal is said in its own words.
 *
 * Accounting — refund accounts, ledger postings, cash or bank movement, tax — is not
 * part of this; nothing here pays money, and no refund voucher is printed.
 */

import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { DateField } from '@/components/forms/mui/DateField';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import { listPaymentMethods } from '@/features/payments/api';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import { useReread } from '@/lib/api/use-reread';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { compareMoney, fitsMinorUnit, formatMoney } from '@/lib/money';

import {
  approveRefund,
  executeRefund,
  listRefundObligations,
  listRefundRequests,
  rejectRefund,
  requestRefund,
  withdrawRefund,
  type CreateOutcome,
} from '../api';
import {
  BILLING_PERMISSIONS,
  CREDIT_AMOUNT,
  MAX_PAYOUT_REFERENCE,
  MAX_REFUND_REASON,
  type RefundObligation,
  type RefundRequest,
  type RefundRequestEcho,
} from '../billing-contract';
import { Money, OutcomeNote, When } from './shared';

/** The invoice the panel belongs to, as the screen holds it. */
export interface RefundInvoice {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
}

const LIVE = new Set(['pending', 'approved']);

export function RefundsPanel({
  locale,
  messages,
  invoice,
  currentUserId,
  canRequest,
  canDecide,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly invoice: RefundInvoice;
  /** The signed-in person, to know whose request a pending one is; `null` when unknown. */
  readonly currentUserId: string | null;
  /** `sal.payment.record` in the session — asking, withdrawing and recording the payout. */
  readonly canRequest: boolean;
  /** `sal.refund.approve` in the session — approving and rejecting somebody else's request. */
  readonly canDecide: boolean;
  /** A step landed: the screen reads the invoice's balance again. */
  readonly onChanged: (noticeKey: string) => void;
}) {
  // The session's codes are the tenant-wide union, so each step is offered only
  // when the code is held in THIS invoice's branch, as the credit-note decision is.
  const { permitsInBranch } = useWorkingContext();
  const mayRequest =
    canRequest && permitsInBranch(BILLING_PERMISSIONS.paymentRecord, invoice.branchId);
  const mayDecide =
    canDecide && permitsInBranch(BILLING_PERMISSIONS.refundApprove, invoice.branchId);

  const target = useMemo(
    () => ({ companyId: invoice.companyId, branchId: invoice.branchId }),
    [invoice.companyId, invoice.branchId]
  );
  const readObligations = useCallback(
    () => listRefundObligations(target, { invoiceId: invoice.id }),
    [target, invoice.id]
  );
  const readRequests = useCallback(
    () => listRefundRequests(target, { invoiceId: invoice.id }),
    [target, invoice.id]
  );
  const obligations = useReread(readObligations);
  const requests = useReread(readRequests);
  const methods = useReread(mayRequest ? listPaymentMethods : null);

  const [notice, setNotice] = useState<string | null>(null);

  const changed = async (noticeKey: string) => {
    setNotice(noticeKey);
    await Promise.all([obligations.reload(), requests.reload()]);
    onChanged(noticeKey);
  };

  const obligationState = obligations.value;
  const requestState = requests.value;

  return (
    <section
      aria-labelledby="invoice-refunds-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
      data-print="hide"
      data-testid="invoice-refunds"
    >
      <h2 id="invoice-refunds-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'refunds.panel.heading')}
      </h2>
      <p className="text-caption text-text-muted">{translate(messages, 'refunds.panel.explain')}</p>
      {notice === null ? null : (
        <p role="status" className="text-body">
          {translateDynamic(messages, notice)}
        </p>
      )}
      {obligationState === null || requestState === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : obligationState.status !== 'ok' || requestState.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={
            obligationState.status !== 'ok'
              ? obligationState.status
              : requestState.status === 'ok'
                ? 'error'
                : requestState.status
          }
          correlationId={
            obligationState.status !== 'ok'
              ? obligationState.correlationId
              : requestState.status !== 'ok'
                ? requestState.correlationId
                : null
          }
          descriptionKey="refunds.panel.unavailable"
          onRetry={() => {
            void obligations.reload();
            void requests.reload();
          }}
        />
      ) : obligationState.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">{translate(messages, 'refunds.panel.none')}</p>
      ) : (
        <>
          {obligationState.data.items.map((obligation) => (
            <ObligationCard
              key={obligation.id}
              locale={locale}
              messages={messages}
              obligation={obligation}
              live={
                requestState.data.items.find(
                  (request) => request.obligationId === obligation.id && LIVE.has(request.state)
                ) ?? null
              }
              methods={
                methods.value?.status === 'ok'
                  ? methods.value.data.items
                      .filter((method) => method.recordable && method.status === 'active')
                      .map((method) => ({ id: method.id, displayName: method.displayName }))
                  : []
              }
              currentUserId={currentUserId}
              mayRequest={mayRequest}
              mayDecide={mayDecide}
              onChanged={changed}
            />
          ))}
          <RefundHistory
            locale={locale}
            messages={messages}
            requests={requestState.data.items}
            currentUserId={currentUserId}
          />
        </>
      )}
    </section>
  );
}

/** One obligation: what is owed, what was paid back, and the next step on it. */
function ObligationCard({
  locale,
  messages,
  obligation,
  live,
  methods,
  currentUserId,
  mayRequest,
  mayDecide,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly obligation: RefundObligation;
  readonly live: RefundRequest | null;
  readonly methods: readonly { readonly id: string; readonly displayName: string }[];
  readonly currentUserId: string | null;
  readonly mayRequest: boolean;
  readonly mayDecide: boolean;
  readonly onChanged: (noticeKey: string) => Promise<void>;
}) {
  const open = obligation.state === 'open';
  return (
    <article
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="refund-obligation"
    >
      <dl className="grid gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-muted">{translate(messages, 'refunds.owed')}</dt>
          <dd>
            <Money money={obligation.amount} locale={locale} />
          </dd>
        </div>
        {obligation.paidOut ? (
          <div>
            <dt className="text-caption text-text-muted">
              {translate(messages, 'refunds.paidOut')}
            </dt>
            <dd data-testid="refund-paid-out">
              <Money money={obligation.paidOut} locale={locale} />
            </dd>
          </div>
        ) : null}
        {obligation.stillOwed ? (
          <div>
            <dt className="text-caption text-text-muted">
              {translate(messages, 'refunds.stillOwed')}
            </dt>
            <dd data-testid="refund-still-owed">
              <Money money={obligation.stillOwed} locale={locale} />
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="text-caption text-text-muted">
        {translateDynamic(messages, `refunds.obligationState.${obligation.state}`)}
      </p>
      {live !== null ? (
        <LiveRequest
          locale={locale}
          messages={messages}
          request={live}
          currentUserId={currentUserId}
          mayRequest={mayRequest}
          mayDecide={mayDecide}
          onChanged={onChanged}
        />
      ) : open && mayRequest ? (
        <RequestForm
          locale={locale}
          messages={messages}
          obligation={obligation}
          methods={methods}
          onChanged={onChanged}
        />
      ) : null}
    </article>
  );
}

/** Asking for a refund of an open obligation: amount, method and reason. */
function RequestForm({
  locale,
  messages,
  obligation,
  methods,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly obligation: RefundObligation;
  readonly methods: readonly { readonly id: string; readonly displayName: string }[];
  readonly onChanged: (noticeKey: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [busy, setBusy] = useState(false);
  // One transport key per opened form: pressing again after a lost answer replays.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const cap = obligation.stillOwed ?? obligation.amount;

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };
  const corrected = (name: string) => {
    if (errors[name] === undefined) return;
    const next = { ...errors };
    delete next[name];
    setErrors(next);
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const typed = amount.trim();
    if (typed.length === 0) found['amount'] = 'field.required';
    else if (!CREDIT_AMOUNT.test(typed) || !/[1-9]/.test(typed)) {
      found['amount'] = 'refunds.request.amountFormat';
    } else if (!fitsMinorUnit(typed, cap.minorUnit)) {
      found['amount'] = 'form.violation.minor_unit_scale';
    } else if (compareMoney(typed, cap.amount) > 0) {
      found['amount'] = 'form.violation.refund_exceeds_obligation';
    }
    if (method === '') found['paymentMethodId'] = 'field.required';
    const why = reason.trim();
    if (why.length === 0) found['reason'] = 'field.required';
    else if (why.length > MAX_REFUND_REASON) found['reason'] = 'refunds.request.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setOutcome(null);
      return;
    }
    setBusy(true);
    try {
      let result: CreateOutcome<RefundRequestEcho>;
      try {
        result = await requestRefund(
          obligation.id,
          { amount: typed, paymentMethodId: method, reason: why },
          attemptKey
        );
      } catch {
        setOutcome(unreachable(1));
        return;
      }
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success' && result.created) {
        setOutcome(null);
        setAmount('');
        setReason('');
        setAttemptKey(crypto.randomUUID());
        await onChanged('refunds.request.recorded');
        return;
      }
      setOutcome(result.state);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      aria-label={translate(messages, 'refunds.request.heading')}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="text-body font-medium">{translate(messages, 'refunds.request.heading')}</h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'refunds.request.explain')}
      </p>
      <div className="sm:max-w-xs">
        <FormMoneyField
          messages={messages}
          label={translate(messages, 'refunds.request.amount')}
          description={formatMessage(translate(messages, 'refunds.request.amountHelp'), {
            owed: formatMoney(cap, locale),
          })}
          required
          name="amount"
          currency={cap.currency}
          value={amount}
          onEdit={() => corrected('amount')}
          onChange={setAmount}
          error={errorFor('amount')}
        />
      </div>
      <FormSelectField
        label={translate(messages, 'refunds.request.method')}
        name="paymentMethodId"
        required
        value={method}
        placeholder={translate(messages, 'refunds.request.methodPlaceholder')}
        options={methods.map((one) => ({ value: one.id, label: one.displayName }))}
        onEdit={() => corrected('paymentMethodId')}
        onChange={setMethod}
        error={errorFor('paymentMethodId')}
      />
      <FormTextField
        label={translate(messages, 'refunds.request.reason')}
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
          {translate(messages, 'refunds.request.submit')}
        </Button>
      </div>
    </form>
  );
}

type Step = 'approve' | 'reject' | 'withdraw';

/** The request waiting on an obligation: its decision, or its payout. */
function LiveRequest({
  locale,
  messages,
  request,
  currentUserId,
  mayRequest,
  mayDecide,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly request: RefundRequest;
  readonly currentUserId: string | null;
  readonly mayRequest: boolean;
  readonly mayDecide: boolean;
  readonly onChanged: (noticeKey: string) => Promise<void>;
}) {
  const [asking, setAsking] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const own = currentUserId !== null && request.requestedBy === currentUserId;
  const pending = request.state === 'pending';

  /** What a step's answer does to the panel: true when it landed and the panel must re-read. */
  const accepted = (result: CreateOutcome<RefundRequestEcho> | null): boolean => {
    setAsking(null);
    if (result === null) {
      setOutcome(unreachable(1));
      return false;
    }
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      return true;
    }
    setOutcome(result.state);
    return false;
  };

  // Each sender re-reads in its own body, right after its own guarded call: the
  // request's version moved, and the list is what publishes the new one.
  const approve = async () => {
    setBusy(true);
    try {
      const result = await approveRefund(request.id, request.recordVersion).catch(() => null);
      if (accepted(result)) await onChanged('refunds.approve.done');
    } finally {
      setBusy(false);
    }
  };
  const reject = async (reason: string) => {
    setBusy(true);
    try {
      const result = await rejectRefund(request.id, { reason }, request.recordVersion).catch(
        () => null
      );
      if (accepted(result)) await onChanged('refunds.reject.done');
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    setBusy(true);
    try {
      const result = await withdrawRefund(request.id, request.recordVersion).catch(() => null);
      if (accepted(result)) await onChanged('refunds.withdraw.done');
    } finally {
      setBusy(false);
    }
  };

  const summary = formatMessage(translate(messages, 'refunds.live.summary'), {
    amount: formatMoney(request.amount, locale),
    method: request.paymentMethod?.displayName ?? translate(messages, 'refunds.methodNotShown'),
  });

  return (
    <div className="flex flex-col gap-2" data-testid="refund-live-request">
      <p className="text-body">
        {translateDynamic(messages, `refunds.live.${request.state}`)} {summary}
      </p>
      <p className="text-caption text-text-muted">
        <bdi>{request.reason}</bdi>
      </p>
      {pending && own ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'refunds.live.ownRequest')}
        </p>
      ) : null}
      {pending && !own && !mayDecide ? (
        <p className="text-caption text-text-muted">{translate(messages, 'refunds.live.waits')}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {pending && !own && mayDecide ? (
          <>
            <Button variant="contained" disabled={busy} onClick={() => setAsking('approve')}>
              {translate(messages, 'refunds.approve.action')}
            </Button>
            <Button variant="outlined" disabled={busy} onClick={() => setAsking('reject')}>
              {translate(messages, 'refunds.reject.action')}
            </Button>
          </>
        ) : null}
        {pending && own && mayRequest ? (
          <Button variant="outlined" disabled={busy} onClick={() => setAsking('withdraw')}>
            {translate(messages, 'refunds.withdraw.action')}
          </Button>
        ) : null}
      </div>
      {request.state === 'approved' ? (
        mayRequest ? (
          <PayoutForm messages={messages} request={request} onChanged={onChanged} />
        ) : (
          <p className="text-caption text-text-muted">
            {translate(messages, 'refunds.execute.waits')}
          </p>
        )
      ) : null}
      <OutcomeNote messages={messages} outcome={outcome} />
      <ConfirmDialog
        open={asking === 'approve'}
        title={translate(messages, 'refunds.approve.confirmTitle')}
        description={formatMessage(translate(messages, 'refunds.approve.confirmExplain'), {
          amount: formatMoney(request.amount, locale),
        })}
        confirmLabel={translate(messages, 'refunds.approve.action')}
        messages={messages}
        pending={busy}
        onCancel={() => setAsking(null)}
        onConfirm={() => void approve()}
      />
      <ConfirmDialog
        open={asking === 'withdraw'}
        title={translate(messages, 'refunds.withdraw.confirmTitle')}
        description={translate(messages, 'refunds.withdraw.confirmExplain')}
        confirmLabel={translate(messages, 'refunds.withdraw.action')}
        messages={messages}
        pending={busy}
        onCancel={() => setAsking(null)}
        onConfirm={() => void withdraw()}
      />
      <ReasonDialog
        open={asking === 'reject'}
        title={translate(messages, 'refunds.reject.confirmTitle')}
        description={translate(messages, 'refunds.reject.confirmExplain')}
        confirmLabel={translate(messages, 'refunds.reject.action')}
        reasonLabel={translate(messages, 'refunds.reject.reason')}
        maxLength={MAX_REFUND_REASON}
        messages={messages}
        destructive
        pending={busy}
        onCancel={() => setAsking(null)}
        onConfirm={(reason) => void reject(reason)}
      />
    </div>
  );
}

/** Recording, once, that an approved refund was paid out. */
function PayoutForm({
  messages,
  request,
  onChanged,
}: {
  readonly messages: Messages;
  readonly request: RefundRequest;
  readonly onChanged: (noticeKey: string) => Promise<void>;
}) {
  const [reference, setReference] = useState('');
  const [day, setDay] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const typed = reference.trim();
    if (typed.length === 0) found['payoutReference'] = 'field.required';
    else if (typed.length > MAX_PAYOUT_REFERENCE) {
      found['payoutReference'] = 'refunds.execute.referenceTooLong';
    }
    if (day === '') found['payoutDate'] = 'field.required';
    setErrors(found);
    if (Object.keys(found).length > 0 || request.paymentMethod === null) {
      setOutcome(null);
      return;
    }
    setBusy(true);
    try {
      let result: CreateOutcome<RefundRequestEcho>;
      try {
        result = await executeRefund(
          request.id,
          {
            paymentMethodId: request.paymentMethod.id,
            payoutReference: typed,
            payoutDate: day,
          },
          request.recordVersion,
          attemptKey
        );
      } catch {
        setOutcome(unreachable(1));
        return;
      }
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success' && result.created) {
        setOutcome(null);
        setReference('');
        setDay('');
        setAttemptKey(crypto.randomUUID());
        await onChanged('refunds.execute.done');
        return;
      }
      setOutcome(result.state);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      aria-label={translate(messages, 'refunds.execute.heading')}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="text-body font-medium">{translate(messages, 'refunds.execute.heading')}</h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'refunds.execute.explain')}
      </p>
      <p className="text-body">
        <span className="text-text-muted">{translate(messages, 'refunds.execute.method')}</span>{' '}
        <bdi>
          {request.paymentMethod?.displayName ?? translate(messages, 'refunds.methodNotShown')}
        </bdi>
      </p>
      <FormTextField
        label={translate(messages, 'refunds.execute.reference')}
        required
        name="payoutReference"
        value={reference}
        onEdit={() => setErrors({ ...errors, payoutReference: '' })}
        onChange={setReference}
        error={errorFor('payoutReference') || undefined}
      />
      <div className="sm:max-w-xs">
        <DateField
          label={translate(messages, 'refunds.execute.date')}
          required
          name="payoutDate"
          value={day}
          onChange={(next) => setDay(next)}
          onEdit={() => setErrors({ ...errors, payoutDate: '' })}
          error={errorFor('payoutDate') || undefined}
        />
      </div>
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
          {translate(messages, 'refunds.execute.submit')}
        </Button>
      </div>
    </form>
  );
}

/** Every request on the invoice, newest first, as the server listed them. */
function RefundHistory({
  locale,
  messages,
  requests,
  currentUserId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly requests: readonly RefundRequest[];
  readonly currentUserId: string | null;
}) {
  if (requests.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-body font-medium">{translate(messages, 'refunds.history.heading')}</h3>
      <ul className="flex flex-col gap-2" data-testid="refund-history">
        {requests.map((request) => (
          <li key={request.id} className="rounded-md border border-border p-2 text-body">
            <span className="font-medium">
              {translateDynamic(messages, `refunds.state.${request.state}`)}
            </span>{' '}
            <Money money={request.amount} locale={locale} />{' '}
            <span className="text-text-muted">
              {request.paymentMethod?.displayName ?? translate(messages, 'refunds.methodNotShown')}
            </span>
            <span className="block text-caption text-text-muted">
              {translate(messages, 'refunds.history.requested')}{' '}
              <When value={request.requestedAt} locale={locale} />
              {currentUserId !== null && request.requestedBy === currentUserId
                ? ` · ${translate(messages, 'refunds.history.byYou')}`
                : ''}
            </span>
            {request.decisionReason !== null ? (
              <span className="block text-caption text-text-muted">
                {translate(messages, 'refunds.history.rejectedBecause')}{' '}
                <bdi>{request.decisionReason}</bdi>
              </span>
            ) : null}
            {request.payoutReference !== null ? (
              <span className="block text-caption text-text-muted">
                {formatMessage(translate(messages, 'refunds.history.paidOut'), {
                  reference: request.payoutReference,
                  day: request.payoutDate ?? '',
                })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
