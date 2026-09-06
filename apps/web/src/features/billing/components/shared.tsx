'use client';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';

import type { InvoiceStatus, MoneyView } from '../billing-contract';

/**
 * Pieces the invoice screen shares (P1-30, `W6`).
 *
 * Money is rendered through `formatMoney` and nothing else: the server's
 * string, with its currency, formatted for the locale. An amount the caller
 * may not see is `null` on the wire and renders as "not available", never as
 * a figure.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard';

/** A money figure, as the server stated it, with its ISO code. */
export function Money({ money, locale }: { readonly money: MoneyView; readonly locale: Locale }) {
  return (
    <span className="font-mono" dir="ltr">
      {formatMoney({ amount: money.amount, currency: money.currency }, locale)}
    </span>
  );
}

/** A bare preview figure labelled by the document's currency. */
export function Figure({
  amount,
  currency,
  locale,
}: {
  readonly amount: string;
  readonly currency: string;
  readonly locale: Locale;
}) {
  return (
    <span className="font-mono" dir="ltr">
      {formatMoney({ amount, currency }, locale)}
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
