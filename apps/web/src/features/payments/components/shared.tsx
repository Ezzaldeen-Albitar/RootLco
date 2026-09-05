'use client';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';

import type { MoneyView, ReceiptStatus } from '../payments-contract';

/**
 * Pieces the payment screen shares (P1-30, `W7`).
 *
 * Money is rendered through `formatMoney` and nothing else: the server's
 * string, with its currency, formatted for the locale. Nothing here subtracts,
 * sums or compares two amounts — a receipt's remainder is a figure the database
 * computed and this application repeats.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The boundary both payment routes declare: unsigned, ≤14 integer digits, ≤4 decimals. */
export const DECIMAL = /^\d{1,14}(\.\d{1,4})?$/;

/**
 * Well-formed AND greater than zero, which is what the forms promise and what
 * the server enforces (`CHECK > 0` on every payment instrument). Decided by
 * reading the string — no amount is parsed into a number here.
 */
export function isPayableAmount(value: string): boolean {
  const trimmed = value.trim();
  return DECIMAL.test(trimmed) && /[1-9]/.test(trimmed);
}

/** ISO-4217 alphabetic, as both routes demand it. */
export const CURRENCY = /^[A-Z]{3}$/;

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

/** An identifier the reads publish and no read resolves to a name. */
export function Identifier({ value }: { readonly value: string }) {
  return (
    <code className="font-mono text-caption" dir="ltr">
      {value}
    </code>
  );
}

export function ReceiptStatusBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: ReceiptStatus;
}) {
  const label = translateDynamic(messages, `payments.status.${status}`);
  if (status === 'allocated') {
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
