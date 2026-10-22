'use client';

import TextField from '@mui/material/TextField';
import {
  FieldHelper,
  controlAttributes,
  useFieldWiring,
  type MuiFieldBaseProps,
} from './field-wiring';

/**
 * A closed vocabulary on Material UI — `SelectField`'s contract, kept.
 *
 * NATIVE options (`select` + `native`), not Material's menu. The native control
 * keeps what `SelectField` relies on: `<optgroup>` headings that are announced
 * and cannot be chosen, the platform's own keyboard and phone pickers, a real
 * `<select>` in the form's data, and one focusable element that carries
 * `aria-invalid` — so `useFocusFirstInvalid` lands on it. Material's menu
 * select renders a button-like element and a hidden input instead, and would
 * have to re-earn each of those.
 */
/**
 * One choice: the value sent and the words shown. The same shape as the older
 * `SelectField`'s `SelectOption`, declared here so a screen on Material UI needs
 * nothing from `components/forms/Field` (`P1-32-PRE-OD-INV1B`); the two are
 * interchangeable, so no caller had to change.
 */
export interface FormSelectOption {
  readonly value: string;
  readonly label: string;
}

/** Choices under a heading that is not itself a choice (an `<optgroup>`). */
export interface FormSelectOptionGroup {
  readonly label: string;
  readonly options: readonly FormSelectOption[];
}

export interface FormSelectFieldProps extends MuiFieldBaseProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options?: readonly FormSelectOption[];
  /** Rendered after `options`, each as an `<optgroup>`. */
  readonly groups?: readonly FormSelectOptionGroup[];
  /** An empty first option, for "nothing chosen yet". */
  readonly placeholder?: string | undefined;
}

export function FormSelectField({
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
  options = [],
  groups = [],
  placeholder,
}: FormSelectFieldProps) {
  const wiring = useFieldWiring(description, error, describedBy);

  return (
    <TextField
      select
      id={wiring.controlId}
      label={label}
      name={name}
      value={value}
      required={required}
      disabled={disabled || readOnly}
      error={wiring.invalid}
      onChange={(event) => {
        onEdit?.();
        onChange(event.target.value);
      }}
      helperText={<FieldHelper description={description} error={error} wiring={wiring} />}
      data-testid={testId}
      slotProps={{
        select: { native: true },
        // A native select always shows its first option, so the label never
        // sits over a value.
        inputLabel: { shrink: true },
        htmlInput: controlAttributes(wiring, required),
        formHelperText: { component: 'div' },
      }}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </TextField>
  );
}
