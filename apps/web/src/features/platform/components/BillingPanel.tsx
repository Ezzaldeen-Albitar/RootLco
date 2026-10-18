'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { ZonedDateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { FormDialog } from '@/features/administration/shared/components/FormDialog';
import { MuiFormFeedback } from '@/features/authentication/components/MuiFormFeedback';
import type { Locale } from '@/i18n/config';
import { formatMessage, translate, translateDynamic, type Messages } from '@/i18n/get-messages';
import { formatDate, formatInteger, intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { recordChargeAction, recordReceiptAction, voidChargeAction } from '../actions';
import {
  CHARGE_STATUSES,
  type SubscriptionReceipt,
  type OrganizationSubscription,
  type SubscriptionCharge,
} from '../types';
import { ConsoleReasonDialog, ConsoleSection, useUnfinishedDays } from './console-parts';
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
 * The charges are a Material table over the page the server read — the shape
 * the tenant screens use for a short list whose cells hold more than a line. A
 * charge's payments are every one listed in its cell, whole, as they were
 * written before, and a description or a void reason wraps rather than being
 * cut. The table draws no pager of its own: the page is the server's, reached by
 * the two links below it, exactly as before.
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
  const t = (key: string) => translateDynamic(messages, key);
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const voiding = useConsoleAction(messages);
  const money = (amount: string, currency: string) =>
    formatMoney({ amount, currency }, intlLocale(locale));

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

      {charges.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          descriptionKey={
            status.length > 0 ? 'platform.billing.noneWithStatus' : 'platform.billing.none'
          }
          testId="platform-billing-empty"
        />
      ) : (
        <TableContainer
          className="rounded-lg border border-border-subtle"
          data-testid="platform-charges-table"
        >
          <Table size="small">
            <caption className="sr-only">{t('platform.billing.title')}</caption>
            <TableHead>
              <TableRow>
                <TableCell scope="col">{t('platform.billing.due')}</TableCell>
                <TableCell scope="col">{t('platform.billing.description')}</TableCell>
                <TableCell scope="col" align="right">
                  {t('platform.billing.amount')}
                </TableCell>
                <TableCell scope="col">{t('platform.billing.status')}</TableCell>
                <TableCell scope="col">{t('platform.billing.received')}</TableCell>
                <TableCell scope="col" align="right">
                  {t('platform.billing.outstanding')}
                </TableCell>
                <TableCell scope="col">
                  <span className="sr-only">{t('platform.actions')}</span>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {charges.map((charge) => {
                // Two charges may share a description; the day each falls due
                // tells them apart, for a screen reader as for the eye.
                const about = `${charge.description}, ${formatDate(charge.dueOn, locale)}`;
                return (
                  <TableRow key={charge.id} data-testid="platform-charge" className="align-top">
                    <TableCell className="whitespace-nowrap">
                      {formatDate(charge.dueOn, locale)}
                    </TableCell>
                    <TableCell className="break-words">
                      <bdi>{charge.description}</bdi>
                      {charge.voidReason ? (
                        <span className="block text-caption text-text-muted">
                          <bdi>{charge.voidReason}</bdi>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell align="right" className="whitespace-nowrap tabular-nums">
                      {money(charge.amount, charge.currencyCode)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={charge.status} messages={messages} />
                    </TableCell>
                    <TableCell>
                      {charge.receipts.length === 0 ? (
                        <span className="text-text-muted">{t('platform.billing.noReceipts')}</span>
                      ) : (
                        <ul className="flex flex-col gap-1" data-testid="platform-receipts">
                          {charge.receipts.map((receipt) => (
                            <li
                              key={receipt.id}
                              data-testid="platform-receipt"
                              className="break-words text-caption text-text-secondary"
                            >
                              {receiptLine(receipt, locale)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell align="right" className="whitespace-nowrap tabular-nums">
                      <span data-testid="platform-outstanding">
                        {money(charge.outstanding, charge.currencyCode)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {canManage && charge.status === 'open' ? (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            type="button"
                            size="small"
                            onClick={() => setPending({ type: 'receipt', charge })}
                          >
                            {t('platform.billing.recordReceipt')}
                            <span className="sr-only"> {about}</span>
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            onClick={() => {
                              voiding.reset();
                              setPending({ type: 'void', charge });
                            }}
                          >
                            {t('platform.billing.void')}
                            <span className="sr-only"> {about}</span>
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

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
