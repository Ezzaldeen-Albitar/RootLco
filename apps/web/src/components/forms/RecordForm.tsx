'use client';

import { useActionState, useId, useState, type ReactNode } from 'react';
import { invalid, type ActionState } from '@/lib/forms/action-result';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

/**
 * The "record something against this record" form, written once.
 *
 * Writes that differ only in their fields would otherwise be one hand-built form
 * each, and each one a chance to drop the behaviour that is easy to lose and
 * expensive to lose: **entered values survive a failure**.
 *
 * React resets an uncontrolled form once a Server Action completes. That means a
 * timeout, a 500 or a rate-limit answer silently empties the form and asks the
 * operator to retype a 500-character restriction reason for a fault that was not
 * theirs. Every field here is controlled, so a failed attempt leaves the text
 * exactly where it was. This is the same defect `FE-004` hit and it is the
 * reason this component exists rather than a `<form>` per section.
 *
 * The form clears on SUCCESS only, and only then because the record is now
 * stored and the next entry is a different one.
 *
 * ## Why it lives here and not under a feature
 *
 * It began under `features/crm/customers/components/`, where six customer
 * component writes used it. The vehicle profile then needed the same five
 * behaviours for plate, odometer, ownership, electric-drive and relationship
 * writes — and a feature may never import another feature
 * (`lib/api/read-operation.ts:12-18`). The three options there are stated as:
 * import across features, which would say the vehicles feature depends on CRM
 * and it does not; copy it, which forks the failure-preservation logic; or move
 * it somewhere neutral. This is the third. The CRM path re-exports from here, so
 * no CRM screen changed and there is exactly one copy.
 */

export type FieldKind = 'text' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date';

export interface FieldSpec {
  readonly name: string;
  readonly kind: FieldKind;
  readonly labelKey: string;
  readonly required?: boolean;
  readonly maxLength?: number;
  /** `select` only — the vocabulary, and the key prefix its labels live under. */
  readonly options?: readonly string[];
  readonly optionKeyPrefix?: string;
  /** Rendered under the field. Use for a constraint the operator cannot see. */
  readonly hintKey?: string;
  /**
   * `number` only. Passed straight to the input.
   *
   * Deliberately NOT used to pre-validate against the contract's own bounds: the
   * server is the authority and a client bound that disagreed with it would
   * refuse a value the server would have accepted, with no error the operator
   * could act on. These exist to make the control usable (a spinner step, a
   * non-negative floor), not to duplicate validation.
   */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number | 'any';
}

interface Props {
  readonly messages: Messages;
  readonly fields: readonly FieldSpec[];
  readonly action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  readonly submitKey: string;
  readonly titleKey: string;
  /** Called after a successful write so the section can re-read its list. */
  readonly onRecorded?: () => void;
  /**
   * Starting values, for a form that EDITS rather than appends.
   *
   * Required by any operation whose semantics are "set (create or replace)":
   * every field is sent every time and an omitted one is cleared, so a blank
   * form would silently erase the fields the operator did not touch. The EV
   * profile write is exactly that shape.
   */
  readonly initialValues?: Record<string, string>;
  /**
   * Whether a success empties the form. Default `true`.
   *
   * Appending a note, a plate or a reading should clear — the record is stored
   * and the next entry is a different one. REPLACING a profile should not: what
   * was just saved is now the current state, and blanking it would show the
   * operator an empty form for a profile that exists.
   */
  readonly clearOnSuccess?: boolean;
  /**
   * A control the `FieldSpec` list cannot express, rendered inside the form and
   * above the fields.
   *
   * The customer selector is the case this exists for: choosing a customer is a
   * search, a result list and a chosen-state, and it submits its value through a
   * hidden input the surrounding `<form>` picks up like any other field. Adding
   * a `'party'` field kind instead would make this generic form import a domain
   * component, and the next such control would add a second kind.
   *
   * Whatever it renders must not be a `<form>` — nesting one is invalid HTML and
   * the browser drops the inner element, taking its submit handler with it.
   *
   * Receives the current `ActionState` so the caller can render its own control's
   * error beside it. `RecordForm` cannot place that error itself: the control is
   * not in `fields`, so there is no label to put it under.
   */
  readonly prelude?: (state: ActionState) => ReactNode;
  /**
   * Blocks submission with a field error instead of sending. For a control in
   * `prelude`, whose value `required` on an input cannot police.
   *
   * Returns field errors, or `null` to proceed. Runs BEFORE the action, so an
   * incomplete form costs no rate-limit slot and the operator is told instantly.
   */
  readonly guard?: () => Record<string, string> | null;
}

const EMPTY: ActionState = { status: 'idle' };

export function RecordForm({
  messages,
  fields,
  action,
  submitKey,
  titleKey,
  onRecorded,
  initialValues,
  clearOnSuccess = true,
  prelude,
  guard,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(initialValues ?? {});
  // Per-instance, because the vehicle profile renders more than one of these on
  // one screen. The id used to be `record-${field.name}`, which is stable and
  // therefore duplicated across instances — two `id="record-effectiveDate"`
  // labels on one page point a screen reader and a click at whichever the
  // browser happened to match first.
  const instance = useId();
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    // Before the action, so a form missing its `prelude` control never spends a
    // rate-limit slot on a request the server would answer 422.
    const blocked = guard?.();
    if (blocked) return invalid(blocked, (previous.attempt ?? 0) + 1);
    const result = await action(previous, form);
    if (result.status === 'success') {
      // Cleared only here, and only for an append. On any failure the
      // operator's text stays put either way.
      if (clearOnSuccess) setValues({});
      onRecorded?.();
    }
    return result;
  }, EMPTY);

  const set = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  return (
    <form action={submit} className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-section-title font-medium text-text-primary">
        {translateDynamic(messages, titleKey)}
      </h3>

      {prelude ? <div className="mb-3">{prelude(state)}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `${instance}-${field.name}`;
          const errorKey = state.fieldErrors?.[field.name];
          const describedBy =
            [errorKey ? `${id}-error` : null, field.hintKey ? `${id}-hint` : null]
              .filter(Boolean)
              .join(' ') || undefined;

          return (
            <div
              key={field.name}
              className={field.kind === 'textarea' ? 'sm:col-span-2' : undefined}
            >
              <label htmlFor={id} className="block text-caption text-text-secondary">
                {translateDynamic(messages, field.labelKey)}
                {field.required ? (
                  <span aria-hidden="true" className="ms-1 text-error">
                    *
                  </span>
                ) : null}
              </label>

              {field.kind === 'select' ? (
                /*
                 * `key` + `defaultValue`, NOT a plain controlled `value`
                 * (`NEW-FE-01`).
                 *
                 * This was `value={values[field.name] ?? ''}` and the docblock
                 * above claims entered values survive a failure. For every TEXT
                 * field that is true. For a select it was not, and the reason it
                 * was invisible is that the reset target and the default
                 * COINCIDED: both are the empty placeholder, so a form nobody
                 * had touched looked identical either way.
                 *
                 * Pick a real option, submit, hit a 503, and the choice reverted
                 * to the placeholder while the text beside it survived. Eleven
                 * P1-27 write surfaces render through this component.
                 *
                 * React resets the form DOM once the Server Action settles, and
                 * on the render that follows the `value` prop is unchanged — so
                 * the reconciler writes nothing and the reset wins. `key` on the
                 * attempt forces a remount; `defaultValue` seeds that mount from
                 * state AND is what `form.reset()` restores to. `onChange` was
                 * already correct and stays.
                 *
                 * Found by rendering this component directly for the first time.
                 * It was predicted when the identical defect was fixed on the
                 * customer-creation form and recorded as `NEW-FE-01` rather than
                 * changed blind; this is that follow-up, now with a test.
                 */
                <select
                  key={`${field.name}-${state.attempt ?? 0}`}
                  id={id}
                  name={field.name}
                  defaultValue={values[field.name] ?? ''}
                  onChange={(event) => set(field.name, event.target.value)}
                  required={field.required}
                  aria-invalid={errorKey ? true : undefined}
                  aria-describedby={describedBy}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
                >
                  <option value="">{translate(messages, 'form.select.placeholder')}</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {translateDynamic(messages, `${field.optionKeyPrefix ?? ''}${option}`)}
                    </option>
                  ))}
                </select>
              ) : field.kind === 'checkbox' ? (
                <input
                  id={id}
                  name={field.name}
                  type="checkbox"
                  // A checkbox is ABSENT from FormData when unchecked. The action
                  // reads presence, not a string — `"false"` would fail a strict
                  // boolean field as a 422.
                  checked={values[field.name] === 'on'}
                  onChange={(event) => set(field.name, event.target.checked ? 'on' : '')}
                  aria-describedby={describedBy}
                  className="mt-2 size-4 accent-primary"
                />
              ) : field.kind === 'textarea' ? (
                <textarea
                  id={id}
                  name={field.name}
                  value={values[field.name] ?? ''}
                  onChange={(event) => set(field.name, event.target.value)}
                  required={field.required}
                  maxLength={field.maxLength}
                  rows={4}
                  aria-invalid={errorKey ? true : undefined}
                  aria-describedby={describedBy}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
                />
              ) : (
                <input
                  id={id}
                  name={field.name}
                  // `number` and `date` render as themselves; everything else is
                  // text. A `date` input yields `YYYY-MM-DD`, which is what the
                  // `date`-typed request fields expect — and it never carries a
                  // time or a zone, so a calendar day cannot shift.
                  type={
                    field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'
                  }
                  value={values[field.name] ?? ''}
                  onChange={(event) => set(field.name, event.target.value)}
                  required={field.required}
                  {...(field.kind === 'number'
                    ? {
                        ...(field.min === undefined ? {} : { min: field.min }),
                        ...(field.max === undefined ? {} : { max: field.max }),
                        ...(field.step === undefined ? {} : { step: field.step }),
                      }
                    : { maxLength: field.maxLength })}
                  aria-invalid={errorKey ? true : undefined}
                  aria-describedby={describedBy}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
                />
              )}

              {field.hintKey ? (
                <p id={`${id}-hint`} className="mt-1 text-caption text-text-muted">
                  {translateDynamic(messages, field.hintKey)}
                </p>
              ) : null}
              {errorKey ? (
                <p id={`${id}-error`} role="alert" className="mt-1 text-caption text-error">
                  {translateDynamic(messages, errorKey)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-text-inverse disabled:opacity-60"
        >
          {pending ? translate(messages, 'form.pending') : translateDynamic(messages, submitKey)}
        </button>

        {state.status === 'success' ? (
          <p role="status" className="text-body text-success">
            {translateDynamic(messages, state.messageKey ?? '')}
          </p>
        ) : null}

        {state.status !== 'idle' && state.status !== 'success' && state.messageKey ? (
          <p role="alert" className="text-body text-error">
            {translateDynamic(messages, state.messageKey)}
            {state.correlationId ? (
              // The reference an operator can quote. Without it a support call
              // starts with "something went wrong at some point today".
              <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
            ) : null}
          </p>
        ) : null}
      </div>
    </form>
  );
}
