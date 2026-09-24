'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { MoneyField } from '@/components/forms/MoneyField';
import { Dialog, ReasonConfirmDialog } from '@/components/overlays/Overlays';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import type { Locale } from '@/i18n/config';
import { formatMessage, translate, translateDynamic, type Messages } from '@/i18n/get-messages';
import { formatDate, formatInteger, intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { recordChargeAction, recordReceiptAction, voidChargeAction } from '../actions';
import { CHARGE_STATUSES, type OrganizationSubscription, type SubscriptionCharge } from '../types';
import {
  Cell,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECTION_HINT,
  Section,
  SimpleTable,
  StatusBadge,
} from './ui';
import { useConsoleAction } from './use-console-action';
import { useStateRefusal } from '@/lib/forms/use-local-refusal';

/**
 * The billing panel of an organisation (P1-32-PRE-067).
 *
 * Charges, the receipts against each, and what is still outstanding — every
 * figure as the server computed it. Amounts are typed through `MoneyField`,
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
 */

type Pending =
  | { readonly type: 'charge' }
  | { readonly type: 'receipt'; readonly charge: SubscriptionCharge }
  | { readonly type: 'void'; readonly charge: SubscriptionCharge };

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
    <Section
      title={t('platform.billing.title')}
      actions={
        canManage ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={() => setPending({ type: 'charge' })}
          >
            {t('platform.billing.recordCharge')}
          </button>
        ) : null
      }
    >
      <p data-testid="platform-billing-model" className={`mb-3 ${SECTION_HINT}`}>
        {t('platform.billing.recordedNote')}
      </p>

      <div className="mb-3 max-w-xs">
        <SelectField
          name="chargeStatus"
          label={t('platform.billing.filterStatus')}
          placeholder={t('platform.billing.allStatuses')}
          value={status}
          options={CHARGE_STATUSES.map((value) => ({
            value,
            label: t(`platform.status.${value}`),
          }))}
          onChange={(event) =>
            router.push(billingHref(locale, tenantId, { status: event.target.value, cursor: null }))
          }
        />
      </div>

      <SimpleTable
        caption={t('platform.billing.title')}
        headers={[
          t('platform.billing.due'),
          t('platform.billing.description'),
          t('platform.billing.amount'),
          t('platform.billing.status'),
          t('platform.billing.received'),
          t('platform.billing.outstanding'),
          t('platform.actions'),
        ]}
        empty={
          charges.length === 0
            ? t(status.length > 0 ? 'platform.billing.noneWithStatus' : 'platform.billing.none')
            : null
        }
      >
        {charges.map((charge) => (
          <tr
            key={charge.id}
            data-testid="platform-charge"
            className="border-t border-border-subtle align-top"
          >
            <Cell>{formatDate(charge.dueOn, locale)}</Cell>
            <Cell>
              {charge.description}
              {charge.voidReason ? (
                <span className="block text-caption text-text-muted">{charge.voidReason}</span>
              ) : null}
            </Cell>
            <Cell end>{money(charge.amount, charge.currencyCode)}</Cell>
            <Cell>
              <StatusBadge status={charge.status} messages={messages} />
            </Cell>
            <Cell>
              {charge.receipts.length === 0 ? (
                <span className="text-text-muted">{t('platform.billing.noReceipts')}</span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {charge.receipts.map((receipt) => (
                    <li key={receipt.id} className="text-caption text-text-secondary">
                      <span className="tabular-nums">
                        {money(receipt.amount, receipt.currencyCode)}
                      </span>
                      {' · '}
                      {formatDate(receipt.receivedOn, locale)}
                      {' · '}
                      {receipt.method}
                      {receipt.reference ? ` · ${receipt.reference}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </Cell>
            <Cell end>
              <span data-testid="platform-outstanding">
                {money(charge.outstanding, charge.currencyCode)}
              </span>
            </Cell>
            <Cell>
              {canManage && charge.status === 'open' ? (
                <div className="flex flex-wrap justify-end gap-1">
                  <button
                    type="button"
                    className={SECONDARY_BUTTON}
                    onClick={() => setPending({ type: 'receipt', charge })}
                  >
                    {t('platform.billing.recordReceipt')}
                  </button>
                  <button
                    type="button"
                    className={SECONDARY_BUTTON}
                    onClick={() => {
                      voiding.reset();
                      setPending({ type: 'void', charge });
                    }}
                  >
                    {t('platform.billing.void')}
                  </button>
                </div>
              ) : null}
            </Cell>
          </tr>
        ))}
      </SimpleTable>

      {hasMore ? (
        <p data-testid="platform-billing-more" className="mt-2 text-caption text-text-muted">
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
          className="mt-2 flex flex-wrap gap-2"
        >
          {paged ? (
            <Link
              data-testid="platform-billing-first"
              className={SECONDARY_BUTTON}
              href={billingHref(locale, tenantId, { status, cursor: null })}
            >
              {t('platform.billing.firstPage')}
            </Link>
          ) : null}
          {hasMore && nextCursor !== null ? (
            <Link
              data-testid="platform-billing-next"
              className={SECONDARY_BUTTON}
              href={billingHref(locale, tenantId, { status, cursor: nextCursor })}
            >
              {t('platform.billing.nextPage')}
            </Link>
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
        <ReasonConfirmDialog
          open
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
        />
      ) : null}
    </Section>
  );
}

function DialogButtons({
  messages,
  pending,
  onClose,
}: {
  readonly messages: Messages;
  readonly pending: boolean;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
        {t('overlay.cancel')}
      </button>
      <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
        {pending ? t('overlay.working') : t('platform.save')}
      </button>
    </div>
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
  const [description, setDescription] = useState('');
  const [subscriptionId, setSubscriptionId] = useState('');
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useStateRefusal(action.state, {
    amount,
    currencyCode,
    dueOn,
    description,
    subscriptionId,
  });
  const errors = refusalErrors;
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);

  return (
    <Dialog open onClose={onClose} messages={messages} title={t('platform.billing.recordCharge')}>
      <form
        ref={refusalFormRef}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
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
        }}
      >
        {action.state.status !== 'idle' && action.state.status !== 'success' ? (
          <FormFeedback state={action.state} messages={messages} />
        ) : null}
        <TextField
          name="currencyCode"
          label={t('platform.billing.currency')}
          required
          maxLength={3}
          dir="ltr"
          value={currencyCode}
          onChange={(event) => setCurrencyCode(event.target.value)}
          error={error('currencyCode')}
        />
        <MoneyField
          name="amount"
          messages={messages}
          label={t('platform.billing.amount')}
          currency={currencyCode.trim().toUpperCase()}
          required
          value={amount}
          onChange={(value) => setAmount(value)}
          error={error('amount')}
        />
        <TextField
          name="dueOn"
          type="date"
          label={t('platform.billing.due')}
          required
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
          error={error('dueOn')}
        />
        <TextField
          name="description"
          label={t('platform.billing.description')}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={error('description')}
        />
        {subscriptions.length > 0 ? (
          <SelectField
            name="subscriptionId"
            label={t('platform.billing.subscription')}
            value={subscriptionId}
            placeholder={t('platform.billing.noSubscriptionLink')}
            onChange={(event) => setSubscriptionId(event.target.value)}
            options={subscriptions.map((entry) => ({
              value: entry.id,
              label: `${entry.planName} (${entry.effectiveFrom.slice(0, 10)})`,
            }))}
          />
        ) : null}
        <DialogButtons messages={messages} pending={action.pending} onClose={onClose} />
      </form>
    </Dialog>
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
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useStateRefusal(action.state, {
    amount,
    receivedOn,
    method,
    reference,
    notes,
  });
  const errors = refusalErrors;
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('platform.billing.recordReceipt')}
      description={charge.description}
    >
      <form
        ref={refusalFormRef}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
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
        }}
      >
        {action.state.status !== 'idle' && action.state.status !== 'success' ? (
          <FormFeedback state={action.state} messages={messages} />
        ) : null}
        <MoneyField
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
        <TextField
          name="receivedOn"
          type="date"
          label={t('platform.billing.receivedOn')}
          required
          value={receivedOn}
          onChange={(event) => setReceivedOn(event.target.value)}
          error={error('receivedOn')}
        />
        <TextField
          name="method"
          label={t('platform.billing.method')}
          required
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          error={error('method')}
        />
        <TextField
          name="reference"
          label={t('platform.billing.reference')}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          error={error('reference')}
        />
        <TextAreaField
          name="notes"
          label={t('platform.billing.notes')}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={error('notes')}
        />
        <DialogButtons messages={messages} pending={action.pending} onClose={onClose} />
      </form>
    </Dialog>
  );
}
