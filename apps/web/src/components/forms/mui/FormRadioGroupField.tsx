'use client';

import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { FieldHelper, useFieldWiring, type MuiFieldBaseProps } from './field-wiring';

/**
 * One answer from a short, closed list, on Material UI — `RadioGroupField`'s
 * contract, kept.
 *
 * Material's `RadioGroup` is a `radiogroup` of native radios, so the group
 * label is announced when focus arrives and the arrow keys move between the
 * answers (in reading order, right to left in Arabic). The group is named by
 * its legend; a required group carries the decorative asterisk and
 * `aria-required`, never the native `required`. `aria-invalid` is on the group
 * only while there is an error, described by the description then the error,
 * which is the shared alert — so `useFocusFirstInvalid` lands on the group and
 * enters its chosen (or first) radio. `onEdit` runs before the new answer is
 * reported (`useClearOnCorrect`).
 *
 * An option may carry a sentence of its own, drawn under its label and part of
 * the radio's name, so what the answer MEANS is read with it.
 */
export interface FormRadioOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string | undefined;
}

export interface FormRadioGroupFieldProps extends Omit<MuiFieldBaseProps, 'readOnly'> {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly FormRadioOption[];
}

export function FormRadioGroupField({
  label,
  name,
  description,
  error,
  required,
  disabled,
  describedBy,
  onEdit,
  testId,
  value,
  onChange,
  options,
}: FormRadioGroupFieldProps) {
  const wiring = useFieldWiring(description, error, describedBy);
  const legendId = `${wiring.controlId}-legend`;

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span id={legendId} className="text-label font-medium text-text-primary">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-1 text-error">
            *
          </span>
        ) : null}
      </span>
      <RadioGroup
        name={name ?? wiring.controlId}
        value={value}
        onChange={(event) => {
          onEdit?.();
          onChange(event.target.value);
        }}
        aria-labelledby={legendId}
        aria-describedby={wiring.describedBy}
        aria-errormessage={wiring.errorId}
        aria-invalid={wiring.invalid || undefined}
        aria-required={required || undefined}
        // `data-invalid` as well, so a refused form's cursor is moved INTO the
        // group (`useFocusFirstInvalid` enters the first focusable radio).
        data-invalid={wiring.invalid ? 'true' : undefined}
        className="flex flex-col gap-1"
      >
        {options.map((option) => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            disabled={disabled}
            control={<Radio />}
            label={
              <span className="flex flex-col">
                <span className="text-body text-text-primary">{option.label}</span>
                {option.description ? (
                  <span className="text-supporting text-text-muted">{option.description}</span>
                ) : null}
              </span>
            }
          />
        ))}
      </RadioGroup>
      {description || error ? (
        <div className="text-supporting">
          <FieldHelper description={description} error={error} wiring={wiring} />
        </div>
      ) : null}
    </div>
  );
}
