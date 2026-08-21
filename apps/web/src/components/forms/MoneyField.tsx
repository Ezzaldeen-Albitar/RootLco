'use client';

import { useState } from 'react';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { parseMoneyInput, type MoneyProblem } from '@/lib/money';
import { FieldFrame, controlClass } from './Field';

/**
 * The decimal-money control.
 *
 * What an operator types stays a STRING from the keystroke to the request body.
 * The control holds the raw text, canonicalises it on blur by padding the
 * fraction with characters, and reports the canonical string upward. No value on
 * this path is ever a JavaScript number — see `src/lib/money.ts` for why.
 *
 * The currency is shown as an ISO code beside the input rather than as a symbol.
 * A multi-company tenant can hold JOD and USD in the same table, and `$` is
 * ambiguous across at least a dozen currencies.
 */

const PROBLEM_KEY: Record<MoneyProblem, string> = {
  empty: 'money.error.empty',
  'not-decimal': 'money.error.notDecimal',
  'too-many-decimals': 'money.error.tooManyDecimals',
  'too-many-digits': 'money.error.tooManyDigits',
  'negative-zero': 'money.error.negativeZero',
};

export interface MoneyFieldProps {
  readonly messages: Messages;
  readonly label: string;
  readonly currency: string;
  /** Canonical decimal string, or empty. */
  readonly value: string;
  readonly onChange: (canonicalOrRaw: string, valid: boolean) => void;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly name?: string | undefined;
}

export function MoneyField({
  messages,
  label,
  currency,
  value,
  onChange,
  description,
  error,
  required,
  disabled,
  readOnly,
  name,
}: MoneyFieldProps) {
  const [raw, setRaw] = useState(value);
  const [localProblem, setLocalProblem] = useState<MoneyProblem | null>(null);

  const shownError =
    error ??
    (localProblem ? translate(messages, PROBLEM_KEY[localProblem] as keyof Messages) : undefined);

  return (
    <FieldFrame label={label} description={description} error={shownError} required={required}>
      {({ controlId, describedBy, invalid, errorId }) => (
        <div className="flex items-stretch gap-2">
          <input
            id={controlId}
            name={name}
            // `inputMode="decimal"` gives a numeric keypad on a tablet WITHOUT
            // making this `type="number"`. A number input silently accepts
            // exponent notation, drops leading zeros, and hands back a value the
            // browser has already coerced — none of which is acceptable here.
            type="text"
            inputMode="decimal"
            autoComplete="off"
            dir="ltr"
            value={raw}
            disabled={disabled}
            readOnly={readOnly}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-errormessage={errorId}
            aria-required={required || undefined}
            onChange={(event) => {
              const next = event.target.value;
              setRaw(next);
              setLocalProblem(null);
              // Report raw while typing; the parent decides when to trust it.
              onChange(next, parseMoneyInput(next).ok);
            }}
            onBlur={() => {
              if (raw.trim() === '' && !required) {
                setLocalProblem(null);
                onChange('', true);
                return;
              }
              const result = parseMoneyInput(raw);
              if (result.ok && result.canonical) {
                setRaw(result.canonical);
                setLocalProblem(null);
                onChange(result.canonical, true);
              } else {
                setLocalProblem(result.problem ?? 'not-decimal');
                onChange(raw, false);
              }
            }}
            // Always LTR: a decimal amount reads left-to-right in Arabic too,
            // and letting the field inherit RTL puts the minus sign on the wrong
            // end and reverses the digit groups as the operator types.
            className={`${controlClass(invalid)} text-start tabular-nums`}
          />
          <span
            className="inline-flex shrink-0 items-center rounded-md border border-border bg-surface-subtle px-3 text-supporting font-medium text-text-secondary"
            // The code is part of the value's meaning, so it is announced with
            // the field rather than hidden as decoration.
          >
            {currency}
          </span>
        </div>
      )}
    </FieldFrame>
  );
}
