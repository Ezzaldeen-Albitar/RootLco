'use client';

import {
  useId,
  useState,
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

/**
 * A password field whose reveal control lives INSIDE the field.
 *
 * ## Why this is a component and not a prop on `TextField`
 *
 * `TextField`'s `trailingIcon` is `pointer-events-none` — deliberately, because
 * every other trailing glyph is decoration and must not eat a click aimed at the
 * input. A reveal toggle is the opposite: it is a real, focusable, clickable
 * control that owns the end of the field. Making `trailingIcon` interactive to
 * accommodate it would make every decorative icon in the product a click target.
 *
 * ## Why the control is inside the field rather than beneath it
 *
 * The Product Owner rejected the previous arrangement — a text button under the
 * input — at Owner acceptance. A control that sits below the field reads as a
 * separate action on the form rather than as an attribute of the field it
 * belongs to, and on a narrow viewport it is separated from its input by the
 * error message. Inside the field it is where every operator has been taught to
 * look for it.
 *
 * ## The details that are easy to get wrong
 *
 *   - **`type="button"`.** A bare `<button>` inside a form defaults to `submit`.
 *     Revealing a password would submit the sign-in form.
 *   - **The padding does not change.** `pe-11` is applied in BOTH states, so
 *     toggling never reflows the input and the caret does not jump.
 *   - **`end-1`, not `right-1`.** Logical inset, so Arabic RTL puts the control
 *     at the visual left with no `[dir='rtl']` override.
 *   - **The input element is not replaced.** Only its `type` attribute changes,
 *     so React patches the attribute in place and the value survives — a
 *     conditional that rendered two different inputs would clear it.
 *   - **`autoComplete` is unchanged by the toggle.** Rewriting it on reveal is
 *     what stops a password manager filling the form.
 *   - **The accessible name changes with the state**, and `aria-pressed` carries
 *     the state, so a screen reader announces whether the password is currently
 *     visible instead of only naming the action.
 */
export function PasswordField({
  label,
  description,
  error,
  required,
  optionalHint,
  showLabel,
  hideLabel,
  ...input
}: BaseFieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required' | 'type'> & {
    /** Accessible name while the password is hidden, e.g. "Show password". */
    readonly showLabel: string;
    /** Accessible name while the password is visible, e.g. "Hide password". */
    readonly hideLabel: string;
  }) {
  const [revealed, setRevealed] = useState(false);

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
          <input
            id={controlId}
            type={revealed ? 'text' : 'password'}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-errormessage={errorId}
            aria-required={required || undefined}
            // Reserved in both states, so the toggle never moves the text.
            className={controlClass(invalid, 'pe-11')}
            {...input}
          />
          <button
            // Not `submit`. A bare button inside a form submits it, and the
            // whole point of this control is that it does not.
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-pressed={revealed}
            aria-controls={controlId}
            aria-label={revealed ? hideLabel : showLabel}
            title={revealed ? hideLabel : showLabel}
            data-testid="password-reveal-toggle"
            // `absolute end-1`: logical, so RTL needs no override. `tabIndex` is
            // left alone — a button is focusable, and removing it from the tab
            // order would make the control mouse-only.
            className="absolute end-1 flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors duration-fast ease-standard hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <PasswordRevealIcon revealed={revealed} />
          </button>
        </div>
      )}
    </FieldFrame>
  );
}

/**
 * The eye glyph.
 *
 * `aria-hidden`, because the accessible name lives on the button. A `<title>`
 * here would be announced a second time and would produce a tooltip the keyboard
 * cannot reach.
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
      {/* The struck-through eye means "hidden", which is the state the control
          moves TO. Drawn rather than swapped for a second glyph so the two
          states share one shape and the change reads as one thing toggling. */}
      {revealed ? null : <path d="M4.2 4.2 19.8 19.8" />}
    </svg>
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
