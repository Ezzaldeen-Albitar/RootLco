'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import {
  OperationalGrid,
  TwoLineCell,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { ZonedDateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { useReducedMotion } from '@/components/ui-foundation/use-reduced-motion';
import { FormDialog } from '@/features/administration/shared/components/FormDialog';
import { MuiFormFeedback } from '@/features/authentication/components/MuiFormFeedback';
import type { Locale } from '@/i18n/config';
import { formatMessage, translate, translateDynamic, type Messages } from '@/i18n/get-messages';
import { formatDate, formatInteger, intlLocale } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';
import { recordChargeAction, recordReceiptAction, voidChargeAction } from '../actions';
import {
  CHARGE_STATUSES,
  type SubscriptionReceipt,
  type OrganizationSubscription,
  type SubscriptionCharge,
} from '../types';
import { ConsoleReasonDialog, ConsoleSection, useSettledTable } from './console-parts';
import { SECTION_HINT, StatusBadge } from './ui';
import { useConsoleAction } from './use-console-action';
import { useStateRefusal } from '@/lib/forms/use-local-refusal';

/**
 * The billing panel of an organisation (P1-32-PRE-067).
 *
 * Charges, the receipts against each, and what is still outstanding — every
 * figure as the server computed it. Amounts are typed through the money field,
 * which keeps them as canonical decimal strings; nothing here adds, subtracts or
 * converts money. Nothing is totalled across charges either: two charges in two
 * currencies have no sum, and the platform-wide figures that DO add up are the
 * overview's, one row per currency.
 *
 * Two sentences the panel owes its reader (P1-32-PRE-OD-CONSOLE-004):
 *
 *   - **What this commercial model is.** Every charge and every payment here is
 *     entered by the Platform Owner (D-OD-04). No payment provider exists in this
 *     repository, nothing is collected from a card, and no subscription renews
 *     and bills itself. A panel headed "Billing" with a "Record payment" button
 *     and no such statement reads as the front end of a system that takes money.
 *   - **What the table actually holds.** The page is one of the server's pages.
 *     When the server says more charges exist behind it, the panel says so,
 *     because an outstanding column read as the whole account when it is one
 *     page of it is a wrong number rather than a missing one.
 *
 * ## Reaching the rest of them (P1-32-PRE-OD-CONSOLE-006)
 *
 * Saying that more charges exist is only half an answer while there is no way to
 * open them. `platform.charge-list` pages by cursor and filters by status, and
 * both are now driven from the address: the filter and the page are read by the
 * server component above, so a link is a real address an operator can keep, and
 * the read still happens on the server. Changing the filter returns to the first
 * page rather than carrying a cursor from the previous set, which belonged to a
 * different ordering of a different set of rows.
 *
 * ## On Material UI (ADR-022, P1-32-PRE-OD-WP06B)
 *
 * The charges are the operational grid over the page the server read. The grid
 * draws no pager of its own: the page is the server's, reached by the two links
 * below it, exactly as before. A row holds two lines, so a charge's payments are
 * summarised in their cell — the first as it was written before, then how many
 * more there are — and **View payments** opens every one of them, whole, in a
 * drawer that reads nothing: the charge in hand already carries them.
 *
 * The three forms are the shared form dialog with the Material fields, and what
 * each sends is unchanged. The due date and the received date are day pickers on
 * UTC, the clock the console's other days are read on: the console has no
 * working branch to take another from. A day only partly typed, or one that is
 * not a day, holds no day; sent as it stood it would have reached the server as
 * an empty date, so the form refuses it on its own box before anything is sent.
 */

type Pending =
  | { readonly type: 'charge' }
  | { readonly type: 'receipt'; readonly charge: SubscriptionCharge }
  | { readonly type: 'void'; readonly charge: SubscriptionCharge };

/** The clock the two day pickers are drawn on. See the note above. */
const BILLING_DAY_ZONE = 'UTC';

/**
 * The address of this organisation's detail page, carrying the billing filter
 * and the page the operator asked for.
 *
 * Both parameters are the panel's own — `chargeStatus` and `chargeCursor` —
 * because the page they land on holds more than the charges. An empty filter or
 * a null cursor is left out rather than written as an empty value, so the first
 * unfiltered page is the bare address it was before this existed.
 */
export function billingHref(
  locale: Locale,
  tenantId: string,
  page: { readonly status: string; readonly cursor: string | null }
): string {
  const search = new URLSearchParams();
  if (page.status.length > 0) search.set('chargeStatus', page.status);
  if (page.cursor !== null && page.cursor.length > 0) search.set('chargeCursor', page.cursor);
  const rendered = search.toString();
  return `/${locale}/platform/organizations/${tenantId}${rendered.length > 0 ? `?${rendered}` : ''}`;
}

/** One payment, in the words it was written in before: amount · day · method · reference. */
function receiptLine(receipt: SubscriptionReceipt, locale: Locale): string {
  const amount = formatMoney(
    { amount: receipt.amount, currency: receipt.currencyCode },
    intlLocale(locale)
  );
  return `${amount} · ${formatDate(receipt.receivedOn, locale)} · ${receipt.method}${
    receipt.reference ? ` · ${receipt.reference}` : ''
  }`;
}

export function BillingPanel({
  locale,
  messages,
  tenantId,
  charges,
  hasMore,
  nextCursor = null,
  status = '',
  paged = false,
  subscriptions,
  canManage,
  defaultCurrency,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly tenantId: string;
  readonly charges: readonly SubscriptionCharge[];
  /** The server's own end-of-set signal for the page above. */
  readonly hasMore: boolean;
  /** The server's cursor for the page after this one, or null at the end. */
  readonly nextCursor?: string | null;
  /** The status filter in force, or the empty string for every status. */
  readonly status?: string;
  /** Whether this page was reached by a cursor rather than being the first. */
  readonly paged?: boolean;
  readonly subscriptions: readonly OrganizationSubscription[];
  readonly canManage: boolean;
  readonly defaultCurrency: string;
}) {
  const t = useCallback((key: string) => translateDynamic(messages, key), [messages]);
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [viewing, setViewing] = useState<SubscriptionCharge | null>(null);
  const voiding = useConsoleAction(messages);
  const table = useSettledTable(charges);

  const columns = useMemo<readonly OperationalColumn<SubscriptionCharge>[]>(() => {
    const money = (amount: string, currency: string) =>
      formatMoney({ amount, currency }, intlLocale(locale));
    return [
      {
        id: 'due',
        headerKey: 'platform.billing.due',
        minChars: 14,
        cell: (charge) => formatDate(charge.dueOn, locale),
      },
      {
        id: 'description',
        headerKey: 'platform.billing.description',
        flex: 2,
        cell: (charge) => (
          <TwoLineCell
            primary={<bdi>{charge.description}</bdi>}
            secondary={charge.voidReason ? <bdi>{charge.voidReason}</bdi> : null}
            testId="platform-charge"
          />
        ),
      },
      {
        id: 'amount',
        headerKey: 'platform.billing.amount',
        numeric: true,
        minChars: 16,
        cell: (charge) => money(charge.amount, charge.currencyCode),
      },
      {
        id: 'status',
        headerKey: 'platform.billing.status',
        cell: (charge) => <StatusBadge status={charge.status} messages={messages} />,
      },
      {
        id: 'received',
        headerKey: 'platform.billing.received',
        flex: 2,
        minChars: 24,
        cell: (charge) => {
          const [first] = charge.receipts;
          if (first === undefined) {
            return <span className="text-text-muted">{t('platform.billing.noReceipts')}</span>;
          }
          const further = charge.receipts.length - 1;
          return (
            <TwoLineCell
              primary={receiptLine(first, locale)}
              secondary={
                further > 0
                  ? formatMessage(t('platform.billing.moreReceipts'), {
                      count: formatInteger(further, locale),
                    })
                  : null
              }
              testId="platform-receipts"
            />
          );
        },
      },
      {
        id: 'outstanding',
        headerKey: 'platform.billing.outstanding',
        numeric: true,
        minChars: 16,
        cell: (charge) => (
          <span data-testid="platform-outstanding">
            {money(charge.outstanding, charge.currencyCode)}
          </span>
        ),
      },
    ];
  }, [locale, messages, t]);

  const rowActions = useCallback(
    (charge: SubscriptionCharge): readonly RowAction[] => {
      // Two charges may share a description; the day each falls due tells them apart.
      const about = `${charge.description}, ${formatDate(charge.dueOn, locale)}`;
      const actions: RowAction[] = [];
      if (charge.receipts.length > 0) {
        actions.push({
          kind: 'button',
          label: t('platform.billing.viewReceipts'),
          about,
          onClick: () => setViewing(charge),
        });
      }
      if (canManage && charge.status === 'open') {
        actions.push(
          {
            kind: 'button',
            label: t('platform.billing.recordReceipt'),
            about,
            onClick: () => setPending({ type: 'receipt', charge }),
          },
          {
            kind: 'button',
            label: t('platform.billing.void'),
            about,
            onClick: () => {
              voiding.reset();
              setPending({ type: 'void', charge });
            },
          }
        );
      }
      return actions;
    },
    [canManage, locale, t, voiding]
  );

  return (
    <ConsoleSection
      title={t('platform.billing.title')}
      actions={
        canManage ? (
          <Button type="button" variant="outlined" onClick={() => setPending({ type: 'charge' })}>
            {t('platform.billing.recordCharge')}
          </Button>
        ) : null
      }
    >
      <p data-testid="platform-billing-model" className={SECTION_HINT}>
        {t('platform.billing.recordedNote')}
      </p>

      <div className="w-full max-w-xs">
        <FormSelectField
          name="chargeStatus"
          label={t('platform.billing.filterStatus')}
          placeholder={t('platform.billing.allStatuses')}
          value={status}
          options={CHARGE_STATUSES.map((value) => ({
            value,
            label: t(`platform.status.${value}`),
          }))}
          onChange={(chosen) =>
            router.push(billingHref(locale, tenantId, { status: chosen, cursor: null }))
          }
        />
      </div>

      <OperationalGrid<SubscriptionCharge>
        messages={messages}
        locale={locale}
        label={t('platform.billing.title')}
        columns={columns}
        rowId={(charge) => charge.id}
        table={table}
        rowActions={rowActions}
        // The panel's own sentence when the page holds no charge, below.
        suppressEmptyState
        // The page is the server's; the two links below reach the others.
        unpaged
        testId="platform-charges-grid"
      />
      {charges.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          descriptionKey={
            status.length > 0 ? 'platform.billing.noneWithStatus' : 'platform.billing.none'
          }
          testId="platform-billing-empty"
        />
      ) : null}

      {hasMore ? (
        <p data-testid="platform-billing-more" className="text-caption text-text-muted">
          {formatMessage(translate(messages, 'platform.billing.morePages'), {
            count: formatInteger(charges.length, locale),
          })}
        </p>
      ) : null}

      {/*
       * The pager the server was already able to answer. `platform.charge-list`
       * pages by cursor, which is forward-only: there is a next page and there
       * is the beginning, and no third link is offered because none could be
       * honoured. Both are ordinary links, so they work on their own address and
       * survive a reload — the page they lead to is read on the server.
       */}
      {paged || (hasMore && nextCursor !== null) ? (
        <nav
          data-testid="platform-billing-pager"
          aria-label={t('platform.billing.pager')}
          className="flex flex-wrap gap-2"
        >
          {paged ? (
            <Button
              component={Link}
              data-testid="platform-billing-first"
              variant="outlined"
              size="small"
              href={billingHref(locale, tenantId, { status, cursor: null })}
            >
              {t('platform.billing.firstPage')}
            </Button>
          ) : null}
          {hasMore && nextCursor !== null ? (
            <Button
              component={Link}
              data-testid="platform-billing-next"
              variant="outlined"
              size="small"
              href={billingHref(locale, tenantId, { status, cursor: nextCursor })}
            >
              {t('platform.billing.nextPage')}
            </Button>
          ) : null}
        </nav>
      ) : null}

      {viewing ? (
        <ReceiptsDrawer
          key={viewing.id}
          locale={locale}
          messages={messages}
          charge={viewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {pending?.type === 'charge' ? (
        <ChargeDialog
          messages={messages}
          tenantId={tenantId}
          subscriptions={subscriptions}
          defaultCurrency={defaultCurrency}
          onClose={() => setPending(null)}
        />
      ) : null}
      {pending?.type === 'receipt' ? (
        <ReceiptDialog
          locale={locale}
          messages={messages}
          tenantId={tenantId}
          charge={pending.charge}
          onClose={() => setPending(null)}
        />
      ) : null}
      {pending?.type === 'void' ? (
        <ConsoleReasonDialog
          destructive
          messages={messages}
          pending={voiding.pending}
          title={t('platform.billing.voidTitle')}
          description={t('platform.billing.voidBody')}
          confirmLabel={t('platform.billing.void')}
          reasonLabel={t('platform.reason')}
          error={
            voiding.state.status !== 'idle' && voiding.state.status !== 'success'
              ? t(voiding.state.messageKey ?? 'action.failed')
              : undefined
          }
          onCancel={() => setPending(null)}
          onConfirm={(reason) => {
            const { charge } = pending;
            voiding.run(
              () => voidChargeAction(tenantId, charge.id, reason),
              () => setPending(null)
            );
          }}
          testId="platform-void-dialog"
        />
      ) : null}
    </ConsoleSection>
  );
}

/**
 * Every payment recorded against one charge, whole, in the words the panel
 * wrote them in before. It reads nothing: the charge in hand carries them.
 *
 * Material's drawer keeps Tab inside while it is open and returns focus to the
 * button that opened it; Escape and Close both close it.
 */
function ReceiptsDrawer({
  locale,
  messages,
  charge,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly charge: SubscriptionCharge;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const reducedMotion = useReducedMotion();
  return (
    <Drawer
      open
      anchor="right"
      onClose={onClose}
      {...(reducedMotion ? { transitionDuration: 0 } : {})}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          className: 'w-full max-w-md',
          'data-testid': 'platform-receipts-detail',
        } as Record<string, unknown>,
      }}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="text-section-title font-medium text-text-primary">
              {translate(messages, 'platform.billing.received')}
            </h2>
            <p className="break-words text-supporting text-text-secondary">
              <bdi>{charge.description}</bdi>
            </p>
          </div>
          <Button type="button" variant="outlined" size="small" onClick={onClose} autoFocus>
            {translate(messages, 'overlay.close')}
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {charge.receipts.map((receipt) => (
            <li
              key={receipt.id}
              data-testid="platform-receipt"
              className="break-words text-body text-text-primary"
            >
              {receiptLine(receipt, locale)}
            </li>
          ))}
        </ul>
      </div>
    </Drawer>
  );
}

/**
 * What a day picker found wrong, as this form's own refusal: a day only partly
 * typed or one that is not a day is refused on its box, before anything is sent.
 */
function useUnfinishedDays(state: ActionState) {
  const [unfinished, setUnfinished] = useState<{
    readonly errors: Readonly<Record<string, string>>;
    readonly attempts: number;
  }>({ errors: {}, attempts: 0 });
  const attempt = (state.attempt ?? 0) + unfinished.attempts;
  const refusal: ActionState =
    Object.keys(unfinished.errors).length > 0
      ? { status: 'invalid', fieldErrors: unfinished.errors, attempt }
      : { ...state, attempt };
  /** Records the days not finished; answers whether the submission must stop. */
  const refuse = (problems: Readonly<Record<string, DayProblem>>): boolean => {
    const errors: Record<string, string> = {};
    for (const [field, problem] of Object.entries(problems)) {
      if (problem !== null) errors[field] = 'platform.error.date';
    }
    const refused = Object.keys(errors).length > 0;
    setUnfinished((previous) => ({
      errors,
      attempts: previous.attempts + (refused ? 1 : 0),
    }));
    return refused;
  };
  return { refusal, refuse };
}

function ChargeDialog({
  messages,
  tenantId,
  subscriptions,
  defaultCurrency,
  onClose,
}: {
  readonly messages: Messages;
  readonly tenantId: string;
  readonly subscriptions: readonly OrganizationSubscription[];
  readonly defaultCurrency: string;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState(defaultCurrency);
  const [dueOn, setDueOn] = useState('');
  const [dueProblem, setDueProblem] = useState<DayProblem>(null);
  const [description, setDescription] = useState('');
  const [subscriptionId, setSubscriptionId] = useState('');
  const { refusal, refuse } = useUnfinishedDays(action.state);
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3). A day box changes when its
  // day does or when what the picker finds wrong with it does.
  const { errors, formRef } = useStateRefusal(refusal, {
    amount,
    currencyCode,
    dueOn: `${dueOn}#${dueProblem ?? ''}`,
    description,
    subscriptionId,
  });
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);

  const submit = () => {
    if (refuse({ dueOn: dueProblem })) return;
    action.run(
      () =>
        recordChargeAction(tenantId, {
          amount,
          currencyCode: currencyCode.trim().toUpperCase(),
          dueOn,
          description,
          ...(subscriptionId ? { subscriptionId } : {}),
        }),
      onClose
    );
  };

  return (
    <FormDialog
      messages={messages}
      title={t('platform.billing.recordCharge')}
      submitLabel={t('platform.save')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={submit}
      formRef={formRef}
      testId="platform-charge-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <FormTextField
        name="currencyCode"
        label={t('platform.billing.currency')}
        required
        maxLength={3}
        dir="ltr"
        spellCheck={false}
        autoFocus
        value={currencyCode}
        onChange={setCurrencyCode}
        error={error('currencyCode')}
      />
      <FormMoneyField
        name="amount"
        messages={messages}
        label={t('platform.billing.amount')}
        currency={currencyCode.trim().toUpperCase()}
        required
        value={amount}
        onChange={(value) => setAmount(value)}
        error={error('amount')}
      />
      <ZonedDateField
        name="dueOn"
        timezone={BILLING_DAY_ZONE}
        label={t('platform.billing.due')}
        required
        value={dueOn}
        onChange={setDueOn}
        onProblem={setDueProblem}
        error={error('dueOn')}
        testId="platform-charge-due"
      />
      <FormTextField
        name="description"
        label={t('platform.billing.description')}
        required
        value={description}
        onChange={setDescription}
        error={error('description')}
      />
      {subscriptions.length > 0 ? (
        <FormSelectField
          name="subscriptionId"
          label={t('platform.billing.subscription')}
          value={subscriptionId}
          placeholder={t('platform.billing.noSubscriptionLink')}
          onChange={setSubscriptionId}
          options={subscriptions.map((entry) => ({
            value: entry.id,
            label: `${entry.planName} (${entry.effectiveFrom.slice(0, 10)})`,
          }))}
          error={error('subscriptionId')}
        />
      ) : null}
    </FormDialog>
  );
}

function ReceiptDialog({
  locale,
  messages,
  tenantId,
  charge,
  onClose,
}: {
  readonly messages: Messages;
  readonly tenantId: string;
  readonly charge: SubscriptionCharge;
  readonly onClose: () => void;
  readonly locale: Locale;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [receivedProblem, setReceivedProblem] = useState<DayProblem>(null);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const { refusal, refuse } = useUnfinishedDays(action.state);
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors, formRef } = useStateRefusal(refusal, {
    amount,
    receivedOn: `${receivedOn}#${receivedProblem ?? ''}`,
    method,
    reference,
    notes,
  });
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);

  const submit = () => {
    if (refuse({ receivedOn: receivedProblem })) return;
    action.run(
      () =>
        recordReceiptAction(tenantId, {
          chargeId: charge.id,
          amount,
          currencyCode: charge.currencyCode,
          receivedOn,
          method,
          ...(reference.trim() ? { reference } : {}),
          ...(notes.trim() ? { notes } : {}),
        }),
      onClose
    );
  };

  return (
    <FormDialog
      messages={messages}
      title={t('platform.billing.recordReceipt')}
      description={charge.description}
      submitLabel={t('platform.save')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={submit}
      formRef={formRef}
      testId="platform-receipt-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <FormMoneyField
        name="amount"
        messages={messages}
        label={t('platform.billing.amount')}
        description={`${t('platform.billing.outstanding')}: ${formatMoney({ amount: charge.outstanding, currency: charge.currencyCode }, intlLocale(locale))}`}
        currency={charge.currencyCode}
        required
        value={amount}
        onChange={(value) => setAmount(value)}
        error={error('amount')}
      />
      <ZonedDateField
        name="receivedOn"
        timezone={BILLING_DAY_ZONE}
        label={t('platform.billing.receivedOn')}
        required
        value={receivedOn}
        onChange={setReceivedOn}
        onProblem={setReceivedProblem}
        error={error('receivedOn')}
        testId="platform-receipt-received"
      />
      <FormTextField
        name="method"
        label={t('platform.billing.method')}
        required
        value={method}
        onChange={setMethod}
        error={error('method')}
      />
      <FormTextField
        name="reference"
        label={t('platform.billing.reference')}
        value={reference}
        onChange={setReference}
        error={error('reference')}
      />
      <FormTextField
        name="notes"
        multiline
        rows={3}
        label={t('platform.billing.notes')}
        value={notes}
        onChange={setNotes}
        error={error('notes')}
      />
    </FormDialog>
  );
}
