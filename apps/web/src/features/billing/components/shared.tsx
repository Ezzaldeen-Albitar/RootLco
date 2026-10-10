'use client';

import { regexes } from 'zod';

import { directionOf, type Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';

import type { InvoiceStatus, MoneyView, ThirdPartyPayment } from '../billing-contract';
import type { PayerName } from './InvoiceDocument';

/**
 * Pieces the invoice screen shares (P1-30, `W6`).
 *
 * Money is rendered through `formatMoney` and nothing else: the server's
 * string, with its currency, formatted for the locale. An amount the caller
 * may not see is `null` on the wire and renders as "not available", never as
 * a figure.
 */

/**
 * An identifier exactly as the server's `z.string().uuid()` accepts it — zod's own
 * pattern, not a copy: an RFC 9562 version digit (1-8) and variant (8, 9, a or b),
 * or the all-zero and all-f identifiers zod also admits. A looser 8-4-4-4-12 hex
 * check passed values the route then refused, so the box said nothing and the
 * submit failed on the server instead.
 */
export const UUID = regexes.uuid();

/**
 * A moment, in the reader's language AND the reader's direction.
 *
 * The Arabic date format carries right-to-left marks between its parts, so a
 * formatted Arabic moment boxed as left to right is re-ordered by the browser:
 * on the printed invoice the issue line read "/2026/09، 9:37 م24", the day
 * jumped to the end (checkpoint browser QA, OBS-3). The moment is isolated
 * (`<bdi>`) in the direction of the language it was formatted in, so it reads
 * in order in both languages, on screen and on paper.
 */
export function When({ value, locale }: { readonly value: string; readonly locale: Locale }) {
  return <bdi dir={directionOf(locale)}>{formatDateTime(value, locale)}</bdi>;
}

/**
 * A money figure, as the server stated it, with its ISO code — written with the
 * minor unit the server published for its currency, never re-derived here.
 */
export function Money({ money, locale }: { readonly money: MoneyView; readonly locale: Locale }) {
  return (
    <span className="font-mono" dir="ltr">
      {formatMoney(money, locale)}
    </span>
  );
}

/**
 * A bare preview figure labelled by the document's currency, written with the
 * minor unit the preview published for that currency (Owner decision D1).
 */
export function Figure({
  amount,
  currency,
  minorUnit,
  locale,
}: {
  readonly amount: string;
  readonly currency: string;
  readonly minorUnit?: number | undefined;
  readonly locale: Locale;
}) {
  return (
    <span className="font-mono" dir="ltr">
      {formatMoney({ amount, currency, minorUnit }, locale)}
    </span>
  );
}

/** What stands where an amount would be when the caller may not see it. */
export function Unavailable({ messages }: { readonly messages: Messages }) {
  return (
    <span className="text-text-muted">{translate(messages, 'invoices.money.unavailable')}</span>
  );
}

export function InvoiceStatusBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: InvoiceStatus;
}) {
  const label = translateDynamic(messages, `invoices.status.${status}`);
  if (status === 'issued') {
    return (
      <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-medium text-on-primary">
        {label}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-border px-2 py-0.5 text-caption text-text-secondary">
      {label}
    </span>
  );
}

/** A failed outcome beside the form that caused it, with its reference. */
export function OutcomeNote({
  messages,
  outcome,
}: {
  readonly messages: Messages;
  readonly outcome: ActionState | null;
}) {
  if (!outcome || outcome.status === 'idle' || outcome.status === 'success') return null;
  const key = outcome.messageKey ?? 'action.failed';
  return (
    <p role="alert" className="text-body text-error">
      {translateDynamic(messages, key)}
      {outcome.correlationId ? (
        <>
          {' '}
          <span className="text-caption text-text-muted">
            {translate(messages, 'state.correlationId')}{' '}
            <code className="font-mono" dir="ltr">
              {outcome.correlationId}
            </code>
          </span>
        </>
      ) : null}
    </p>
  );
}

/** The fixed vocabulary of a third-party payer's relationship (ADR-023 D14), mirrored. */
const THIRD_PARTY_RELATIONSHIP_CODES = ['insurer', 'employer', 'other'] as const;

/**
 * The part of what was paid that somebody other than the customer paid, as an
 * explicit third-party payment (Owner decision D14, ADR-023): each reads "Paid by
 * <payer> (<relationship>) for <customer>", with the authorisation reference, the
 * receipt by its number and the amount. The invoice stays its customer's; a name
 * this reader may not see is said as not shown, never replaced by a reference.
 *
 * One rendering for every place an invoice's settlement is shown — the work-order
 * invoice's balance panel, the counter sale's panel and both printed copies
 * (finance QA fixes D: the counter sale and the paper used to leave it out,
 * though the balance read carried it). Every value is the server's
 * (`settlement.thirdPartyPayments`); `customer` is who the invoice bills, named
 * only for a reader the screen could name them to.
 */
export function ThirdPartyPaymentItems({
  locale,
  messages,
  payments,
  truncated,
  customer,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly payments: readonly ThirdPartyPayment[];
  readonly truncated: boolean;
  readonly customer: PayerName;
}) {
  const customerName =
    customer.kind === 'named'
      ? customer.name
      : translate(messages, 'invoices.thirdParty.customerNotShown');
  return (
    <>
      <ul className="flex flex-col gap-2">
        {payments.map((payment) => {
          const relationship = (THIRD_PARTY_RELATIONSHIP_CODES as readonly string[]).includes(
            payment.relationship
          )
            ? payment.relationship
            : 'other';
          return (
            <li
              key={`${payment.receipt.id}-${payment.allocatedAt}`}
              className="flex flex-col gap-0.5 rounded-md border border-border p-2"
              data-testid="invoice-third-party-payment"
            >
              <span>
                {formatMessage(translate(messages, 'invoices.thirdParty.paidBy'), {
                  payer:
                    payment.payerName ?? translate(messages, 'invoices.thirdParty.payerNotShown'),
                  relationship: translateDynamic(
                    messages,
                    `invoices.thirdParty.relationship.${relationship}`
                  ),
                  customer: customerName,
                })}
              </span>
              <span className="text-caption text-text-secondary">
                {translate(messages, 'invoices.thirdParty.authorisation')}{' '}
                <bdi className="font-mono" dir="auto">
                  {payment.authorisationReference}
                </bdi>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
                {translate(messages, 'invoices.thirdParty.receipt')}{' '}
                <bdi className="font-mono" dir="ltr">
                  {payment.receipt.reference}
                </bdi>
                <Money money={payment.money} locale={locale} />
              </span>
            </li>
          );
        })}
      </ul>
      {truncated ? (
        <p className="mt-1 text-caption text-text-muted">
          {translate(messages, 'invoices.thirdParty.truncated')}
        </p>
      ) : null}
    </>
  );
}
