'use client';

import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { FieldHelper, useFieldWiring, type MuiFieldBaseProps } from './field-wiring';

/**
 * A yes-or-no answer on Material UI — `CheckboxField`'s contract, kept.
 *
 * The native checkbox is the control (Material draws its own mark over it and
 * keeps the input in the tree), so the label names it through the wrapping
 * `<label>`, a keyboard Space toggles it, and `useFocusFirstInvalid` can land on
 * it. The wiring is `field-wiring`'s: `aria-invalid` only while there is an
 * error and absent otherwise, the description then the error in
 * `aria-describedby`, the error an alert drawn with a shape as well as a colour,
 * and `onEdit` run before the new value is reported so a complaint is withdrawn
 * the moment the answer changes.
 *
 * No native `required`: a checkbox that must be ticked is the caller's rule,
 * refused as a field error like any other.
 */
export interface FormCheckboxFieldProps extends Omit<MuiFieldBaseProps, 'required' | 'readOnly'> {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function FormCheckboxField({
  label,
  name,
  description,
  error,
  disabled,
  describedBy,
  onEdit,
  testId,
  checked,
  onChange,
}: FormCheckboxFieldProps) {
  const wiring = useFieldWiring(description, error, describedBy);

  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <FormControlLabel
        label={label}
        disabled={disabled}
        control={
          <Checkbox
            id={wiring.controlId}
            name={name}
            checked={checked}
            onChange={(event) => {
              onEdit?.();
              onChange(event.target.checked);
            }}
            slotProps={{
              input: {
                'aria-invalid': wiring.invalid || undefined,
                'aria-describedby': wiring.describedBy,
                'aria-errormessage': wiring.errorId,
              } as Record<string, unknown>,
            }}
          />
        }
      />
      {description || error ? (
        <div className="ms-8 text-supporting">
          <FieldHelper description={description} error={error} wiring={wiring} />
        </div>
      ) : null}
    </div>
  );
}
