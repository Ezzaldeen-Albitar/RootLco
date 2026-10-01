'use client';

import { useId, useState } from 'react';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { parseMoneyInput, type MoneyProblem } from '@/lib/money';
import { FormTextField } from './FormTextField';
import type { MuiFieldBaseProps } from './field-wiring';

/**
 * The decimal-money control on Material UI — `MoneyField`'s contract, kept.
 *
 * What the operator types stays a STRING from the keystroke to the request
 * body: the raw text is held, reported upward while typing (with whether it
 * parses), and on blur the CANONICAL form is reported — the fraction padded with
 * characters (`parseMoneyInput`). No value on this path is ever a JavaScript
 * number — see `src/lib/money.ts`. A problem found on blur is shown in the
 * catalogue's words until the next keystroke; the caller's own error, when
 * given, wins.
 *
 * The box keeps showing what the operator typed. The canonical form carries the
 * storage scale (four places), not the currency's: replacing a typed `25.000`
 * JOD with `25.0000` showed a figure written the way no other screen writes JOD,
 * and after a refusal it put a number in the box the operator never typed
 * (finance checkpoint, DF-6). The parent holds and sends the canonical string.
 *
 * The box is text with a decimal keypad, never `type="number"`, and reads left
 * to right in both languages. The currency is its ISO code at the logical end of
 * the box, and it is part of the field's description, so it is announced with
 * the field: `$` alone is ambiguous across a dozen currencies.
 *
 * One difference from `MoneyField`, deliberate: a value the CALLER sets later —
 * a form reset after a discarded branch switch — replaces the text shown. The
 * older control seeded its text once and could go on showing an amount its form
 * no longer held.
 */

const PROBLEM_KEY: Record<MoneyProblem, keyof Messages> = {
  empty: 'money.error.empty',
  'not-decimal': 'money.error.notDecimal',
  'too-many-decimals': 'money.error.tooManyDecimals',
  'too-many-digits': 'money.error.tooManyDigits',
  'negative-zero': 'money.error.negativeZero',
};

export interface FormMoneyFieldProps extends MuiFieldBaseProps {
  readonly messages: Messages;
  readonly currency: string;
  /** Canonical decimal string, or empty. */
  readonly value: string;
  readonly onChange: (canonicalOrRaw: string, valid: boolean) => void;
}

export function FormMoneyField({
  messages,
  currency,
  value,
  onChange,
  error,
  required,
  describedBy,
  onEdit,
  ...rest
}: FormMoneyFieldProps) {
  const currencyId = `${useId()}-currency`;
  const [raw, setRaw] = useState(value);
  const [reported, setReported] = useState(value);
  const [localProblem, setLocalProblem] = useState<MoneyProblem | null>(null);

  // A value the caller set, not one this control reported: show it. Adjusted
  // during render, React's shape for "reset state when a prop changes".
  if (value !== reported) {
    setReported(value);
    setRaw(value);
    setLocalProblem(null);
  }

  const report = (next: string, valid: boolean) => {
    setReported(next);
    onChange(next, valid);
  };

  const shownError =
    error ?? (localProblem ? translate(messages, PROBLEM_KEY[localProblem]) : undefined);

  return (
    <FormTextField
      {...rest}
      value={raw}
      error={shownError}
      required={required}
      describedBy={[currencyId, describedBy].filter(Boolean).join(' ')}
      inputMode="decimal"
      dir="ltr"
      autoComplete="off"
      endAdornment={<span id={currencyId}>{currency}</span>}
      onEdit={onEdit}
      onChange={(next) => {
        setRaw(next);
        setLocalProblem(null);
        // Raw while typing; the parent decides when to trust it.
        report(next, parseMoneyInput(next).ok);
      }}
      onBlur={() => {
        if (raw.trim() === '' && !required) {
          setLocalProblem(null);
          report('', true);
          return;
        }
        const result = parseMoneyInput(raw);
        if (result.ok && result.canonical) {
          // The typed text stays in the box; the canonical string goes up.
          setLocalProblem(null);
          report(result.canonical, true);
        } else {
          setLocalProblem(result.problem ?? 'not-decimal');
          report(raw, false);
        }
      }}
    />
  );
}
