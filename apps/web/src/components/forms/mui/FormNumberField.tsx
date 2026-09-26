'use client';

import { FormTextField } from './FormTextField';
import type { MuiFieldBaseProps } from './field-wiring';

/**
 * A number, kept as the text the operator typed — ADR-022 PR1.
 *
 * Not `type="number"`, for the reasons `MoneyField` records: a number input
 * silently accepts exponent notation, drops leading zeros and hands back a
 * value the browser has already coerced. So the box is text with a numeric
 * keypad (`inputMode`), the value reported is the STRING typed, and the server
 * — which is the authority on the bounds — decides whether it is acceptable. No
 * bound is enforced here: a client bound that disagreed with the server would
 * refuse a value the server accepts, with no error the operator could act on.
 *
 * Arabic-Indic digits are not rewritten on the client. The field reads left to
 * right in both languages (`dir="ltr"`), so the sign and the digit groups stay
 * where the operator put them.
 *
 * A unit, when given, is drawn at the logical end of the box and is part of the
 * field's description, so it is announced with it.
 */
export interface FormNumberFieldProps extends MuiFieldBaseProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: (() => void) | undefined;
  /** Whole numbers only — a keypad without a decimal separator. */
  readonly integer?: boolean;
  /** The unit, as words or a code: "km", "hours". */
  readonly unit?: string | undefined;
  readonly unitId?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly maxLength?: number | undefined;
}

export function FormNumberField({
  integer = false,
  unit,
  unitId,
  describedBy,
  ...rest
}: FormNumberFieldProps) {
  const unitReference = unit && unitId ? unitId : undefined;
  return (
    <FormTextField
      {...rest}
      describedBy={[describedBy, unitReference].filter(Boolean).join(' ') || undefined}
      inputMode={integer ? 'numeric' : 'decimal'}
      dir="ltr"
      autoComplete="off"
      endAdornment={unit ? <span id={unitId}>{unit}</span> : undefined}
    />
  );
}
