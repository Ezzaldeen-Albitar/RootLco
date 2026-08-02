'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * The field wrapper every control shares.
 *
 * ## Why one wrapper rather than per-control markup
 *
 * The accessible name, the description and the error must be WIRED to the
 * control — `htmlFor`, `aria-describedby`, `aria-invalid`, `aria-errormessage`.
 * Each of those is one attribute, each is easy to forget on one control out of
 * fourteen, and the failure is silent: the field looks correct and a screen
 * reader announces an unlabelled edit box with no error.
 *
 * Doing it once means a new control cannot be added wrong, only added.
 */

export interface FieldFrameProps {
  readonly label: string;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean | undefined;
  readonly optionalHint?: string | undefined;
  readonly children: (ids: FieldIds) => ReactNode;
}

export interface FieldIds {
  readonly controlId: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly errorId: string | undefined;
}

export function FieldFrame({
  label,
  description,
  error,
  required = false,
  optionalHint,
  children,
}: FieldFrameProps) {
  const base = useId();
  const controlId = `${base}-control`;
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  // Order matters: the description is context, the error is the correction, and
  // a screen reader reads them in the order listed here.
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-label font-medium text-text-primary">
        {label}
        {required ? (
          <>
            {/*
              The asterisk is decorative — `aria-required` on the control is what
              conveys the requirement. Announcing "star" before every required
              field is noise, and a colour-only marker would fail 1.4.1.
            */}
            <span aria-hidden="true" className="ms-1 text-error">
              *
            </span>
          </>
        ) : optionalHint ? (
          <span className="ms-2 font-normal text-text-muted">{optionalHint}</span>
        ) : null}
      </label>

      {description ? (
        <p id={descriptionId} className="text-supporting text-text-muted">
          {description}
        </p>
      ) : null}

      {children({ controlId, describedBy, invalid: Boolean(error), errorId })}

      {error ? (
        // `role="alert"` so a validation failure that appears after submit is
        // announced without the user having to go looking for it.
        <p id={errorId} role="alert" className="text-supporting text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-md border bg-surface px-3 py-2 text-body text-text-primary transition-colors duration-fast ease-standard placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-disabled';

export function controlClass(invalid: boolean, extra = ''): string {
  return [CONTROL_BASE, invalid ? 'border-error' : 'border-border', extra]
    .filter(Boolean)
    .join(' ');
}

// --- controls ----------------------------------------------------------------

type BaseFieldProps = Omit<FieldFrameProps, 'children'>;

type InputProps = BaseFieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required'> & {
    readonly leadingIcon?: ReactNode | undefined;
    readonly trailingIcon?: ReactNode | undefined;
    readonly loading?: boolean | undefined;
  };

export function TextField({
  label,
  description,
  error,
  required,
  optionalHint,
  leadingIcon,
  trailingIcon,
  loading,
  ...input
}: InputProps) {
  return (
    <FieldFrame
      label={label}
      description={description}
      error={error}
      required={required}
      optionalHint={optionalHint}
    >
      {({ controlId, describedBy, invalid, errorId }) => (
        <div className="relative flex items-center">
          {leadingIcon ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute start-3 text-text-muted"
            >
              {leadingIcon}
            </span>
          ) : null}
          <input
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-errormessage={errorId}
            aria-required={required || undefined}
            aria-busy={loading || undefined}
            className={controlClass(
              invalid,
              [leadingIcon ? 'ps-9' : '', trailingIcon || loading ? 'pe-9' : '']
                .filter(Boolean)
                .join(' ')
            )}
            {...input}
          />
          {trailingIcon || loading ? (
            <span aria-hidden="true" className="pointer-events-none absolute end-3 text-text-muted">
              {loading ? <Spinner /> : trailingIcon}
            </span>
          ) : null}
        </div>
      )}
    </FieldFrame>
  );
}

export function TextAreaField({
  label,
  description,
  error,
  required,
  optionalHint,
  ...textarea
}: BaseFieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'required'>) {
  return (
    <FieldFrame
      label={label}
      description={description}
      error={error}
      required={required}
      optionalHint={optionalHint}
    >
      {({ controlId, describedBy, invalid, errorId }) => (
        <textarea
          id={controlId}
          rows={4}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-errormessage={errorId}
          aria-required={required || undefined}
          className={controlClass(invalid, 'resize-y')}
          {...textarea}
        />
      )}
    </FieldFrame>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export function SelectField({
  label,
  description,
  error,
  required,
  optionalHint,
  options,
  placeholder,
  ...select
}: BaseFieldProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'required'> & {
    readonly options: readonly SelectOption[];
    readonly placeholder?: string | undefined;
  }) {
  return (
    <FieldFrame
      label={label}
      description={description}
      error={error}
      required={required}
      optionalHint={optionalHint}
    >
      {({ controlId, describedBy, invalid, errorId }) => (
        <select
          id={controlId}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-errormessage={errorId}
          aria-required={required || undefined}
          className={controlClass(invalid)}
          {...select}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

export function CheckboxField({
  label,
  description,
  error,
  ...input
}: Omit<BaseFieldProps, 'required' | 'optionalHint'> &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>) {
  const base = useId();
  const controlId = `${base}-control`;
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <input
          id={controlId}
          type="checkbox"
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 h-4 w-4 rounded-sm border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          {...input}
        />
        <label htmlFor={controlId} className="text-body text-text-primary">
          {label}
        </label>
      </div>
      {description ? (
        <p id={descriptionId} className="ms-6 text-supporting text-text-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="ms-6 text-supporting text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface RadioOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export function RadioGroupField({
  label,
  description,
  error,
  required,
  name,
  value,
  onChange,
  options,
}: BaseFieldProps & {
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly RadioOption[];
}) {
  const base = useId();
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;

  return (
    // A radio group is a `radiogroup`, not a stack of inputs with a heading.
    // Without the role the group label is not announced when focus arrives.
    <fieldset
      role="radiogroup"
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
      className="flex flex-col gap-1.5"
    >
      <legend className="text-label font-medium text-text-primary">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-1 text-error">
            *
          </span>
        ) : null}
      </legend>
      {description ? (
        <p id={descriptionId} className="text-supporting text-text-muted">
          {description}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const id = `${base}-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              />
              <label htmlFor={id} className="text-body text-text-primary">
                {option.label}
                {option.description ? (
                  <span className="block text-supporting text-text-muted">
                    {option.description}
                  </span>
                ) : null}
              </label>
            </div>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-supporting text-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  );
}
