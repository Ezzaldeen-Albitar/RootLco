'use client';

import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import {
  FieldHelper,
  controlAttributes,
  useFieldWiring,
  type MuiFieldBaseProps,
} from './field-wiring';

/**
 * A password box on Material UI — `PasswordField`'s contract, kept.
 *
 * The wiring is `field-wiring`'s (the label names the box, `aria-invalid` only
 * while there is an error, the description then the error in
 * `aria-describedby`, `onEdit` before the new value is reported). What this
 * adds is the reveal control, and every detail `PasswordField` documents for it
 * is kept:
 *
 *   - **Inside the field**, as Material's end adornment — the logical end, so a
 *     right-to-left page puts it on the left with nothing to override. The
 *     Product Owner rejected a control beneath the box at acceptance.
 *   - **`type="button"`**, so revealing a password never submits the form.
 *   - **The input element is not replaced**: only its `type` changes, so the
 *     value survives the toggle.
 *   - **`autoComplete` is unchanged by the toggle**; rewriting it on reveal stops
 *     a password manager filling the form.
 *   - **The accessible name follows the state** and `aria-pressed` carries it,
 *     with `aria-controls` naming the box; `data-testid="password-reveal-toggle"`
 *     is the hook the browser smoke and the DOM suites already use.
 *
 * Controlled by the caller like every wrapper in this folder: whether a refused
 * submit keeps or clears a password is the CALLER's product decision, recorded
 * per call site in `form-reset-class.test.ts` (`CLEARS_ON_REFUSAL`).
 */
export interface FormPasswordFieldProps extends MuiFieldBaseProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: 'current-password' | 'new-password';
  /** Accessible name while the password is hidden, e.g. "Show password". */
  readonly showLabel: string;
  /** Accessible name while the password is visible, e.g. "Hide password". */
  readonly hideLabel: string;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
}

export function FormPasswordField({
  label,
  name,
  description,
  error,
  required,
  disabled,
  readOnly,
  describedBy,
  onEdit,
  testId,
  value,
  onChange,
  autoComplete,
  showLabel,
  hideLabel,
  minLength,
  maxLength,
}: FormPasswordFieldProps) {
  const wiring = useFieldWiring(description, error, describedBy);
  const [revealed, setRevealed] = useState(false);
  const toggleName = revealed ? hideLabel : showLabel;

  return (
    <TextField
      id={wiring.controlId}
      label={label}
      name={name}
      value={value}
      type={revealed ? 'text' : 'password'}
      required={required}
      disabled={disabled}
      error={wiring.invalid}
      autoComplete={autoComplete}
      onChange={(event) => {
        onEdit?.();
        onChange(event.target.value);
      }}
      helperText={<FieldHelper description={description} error={error} wiring={wiring} />}
      data-testid={testId}
      slotProps={{
        input: {
          readOnly,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                type="button"
                onClick={() => setRevealed((current) => !current)}
                aria-pressed={revealed}
                aria-controls={wiring.controlId}
                aria-label={toggleName}
                title={toggleName}
                disabled={disabled}
                edge="end"
                data-testid="password-reveal-toggle"
              >
                <PasswordRevealIcon revealed={revealed} />
              </IconButton>
            </InputAdornment>
          ),
        },
        htmlInput: {
          minLength,
          maxLength,
          // A password is never a word: no spelling marks, no "corrections".
          spellCheck: false,
          ...controlAttributes(wiring, required),
        },
        formHelperText: { component: 'div' },
      }}
    />
  );
}

/**
 * The eye glyph, the same drawing `PasswordField` uses. `aria-hidden`, because
 * the accessible name lives on the button; the struck-through eye means
 * "hidden", the state the control moves TO.
 */
function PasswordRevealIcon({ revealed }: { readonly revealed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <path d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" />
      {revealed ? null : <path d="M4.2 4.2 19.8 19.8" />}
    </svg>
  );
}
