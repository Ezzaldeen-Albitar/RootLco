'use client';

import type { ReactNode } from 'react';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import {
  FieldHelper,
  controlAttributes,
  useFieldWiring,
  type MuiFieldBaseProps,
} from './field-wiring';

/**
 * A text field on Material UI with the `FieldFrame` contract (`field-wiring`).
 *
 * Adornments sit at the logical START and END of the box, so a right-to-left
 * page puts the end adornment on the left with nothing to override. An
 * adornment that means something (a unit, a currency code) should be passed
 * with an id through `describedBy` so it is announced with the field.
 */
export interface FormTextFieldProps extends MuiFieldBaseProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: (() => void) | undefined;
  readonly placeholder?: string | undefined;
  readonly maxLength?: number | undefined;
  readonly autoComplete?: string | undefined;
  readonly type?: 'text' | 'email' | 'tel' | 'search' | 'url';
  readonly inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email' | 'search' | 'url';
  /** `ltr` for a value that reads left to right in every language (a code, a number). */
  readonly dir?: 'ltr' | 'rtl' | 'auto' | undefined;
  readonly multiline?: boolean;
  readonly rows?: number;
  readonly startAdornment?: ReactNode;
  readonly endAdornment?: ReactNode;
  /** Takes focus when mounted — for the one box a dialog opens to be filled in. */
  readonly autoFocus?: boolean;
}

export function FormTextField({
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
  onBlur,
  placeholder,
  maxLength,
  autoComplete,
  type = 'text',
  inputMode,
  dir,
  multiline = false,
  rows,
  startAdornment,
  endAdornment,
  autoFocus = false,
}: FormTextFieldProps) {
  const wiring = useFieldWiring(description, error, describedBy);

  return (
    <TextField
      id={wiring.controlId}
      label={label}
      name={name}
      value={value}
      type={type}
      required={required}
      disabled={disabled}
      error={wiring.invalid}
      placeholder={placeholder}
      autoComplete={autoComplete}
      multiline={multiline}
      autoFocus={autoFocus}
      {...(rows === undefined ? {} : { rows })}
      onChange={(event) => {
        onEdit?.();
        onChange(event.target.value);
      }}
      onBlur={onBlur}
      helperText={<FieldHelper description={description} error={error} wiring={wiring} />}
      data-testid={testId}
      slotProps={{
        input: {
          readOnly,
          startAdornment: startAdornment ? (
            <InputAdornment position="start">{startAdornment}</InputAdornment>
          ) : undefined,
          endAdornment: endAdornment ? (
            <InputAdornment position="end">{endAdornment}</InputAdornment>
          ) : undefined,
        },
        htmlInput: {
          maxLength,
          inputMode,
          dir,
          ...controlAttributes(wiring, required),
        },
        formHelperText: { component: 'div' },
      }}
    />
  );
}
