'use client';

import { useActionState, useState } from 'react';
import type { ActionState } from '@/lib/forms/action-result';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

/**
 * The "record something against this customer" form, written once.
 *
 * The six component writes differ only in their fields, so six hand-built forms
 * would be six chances to drop the one behaviour that is easy to lose and
 * expensive to lose: **entered values survive a failure**.
 *
 * React resets an uncontrolled form once a Server Action completes. That means a
 * timeout, a 500 or a rate-limit answer silently empties the form and asks the
 * operator to retype a 500-character restriction reason for a fault that was not
 * theirs. Every field here is controlled, so a failed attempt leaves the text
 * exactly where it was. This is the same defect `FE-004` hit and it is the
 * reason this component exists rather than a `<form>` per section.
 *
 * The form clears on SUCCESS only, and only then because the record is now on
 * the customer and the next entry is a different one.
 */

export type FieldKind = 'text' | 'textarea' | 'select' | 'checkbox';

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
}

interface Props {
  readonly messages: Messages;
  readonly fields: readonly FieldSpec[];
  readonly action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  readonly submitKey: string;
  readonly titleKey: string;
  /** Called after a successful write so the section can re-read its list. */
  readonly onRecorded?: () => void;
}

const EMPTY: ActionState = { status: 'idle' };

export function RecordForm({ messages, fields, action, submitKey, titleKey, onRecorded }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    const result = await action(previous, form);
    if (result.status === 'success') {
      // Cleared only here. On any failure the operator's text stays put.
      setValues({});
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

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `record-${field.name}`;
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
                  <span aria-hidden="true" className="ms-1 text-status-danger">
                    *
                  </span>
                ) : null}
              </label>

              {field.kind === 'select' ? (
                <select
                  id={id}
                  name={field.name}
                  value={values[field.name] ?? ''}
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
                  className="mt-2 size-4 accent-brand-primary"
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
                  type="text"
                  value={values[field.name] ?? ''}
                  onChange={(event) => set(field.name, event.target.value)}
                  required={field.required}
                  maxLength={field.maxLength}
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
                <p id={`${id}-error`} role="alert" className="mt-1 text-caption text-status-danger">
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
          className="rounded-md bg-brand-primary px-4 py-2 text-body font-medium text-text-inverse disabled:opacity-60"
        >
          {pending ? translate(messages, 'form.pending') : translateDynamic(messages, submitKey)}
        </button>

        {state.status === 'success' ? (
          <p role="status" className="text-body text-status-success">
            {translateDynamic(messages, state.messageKey ?? '')}
          </p>
        ) : null}

        {state.status !== 'idle' && state.status !== 'success' && state.messageKey ? (
          <p role="alert" className="text-body text-status-danger">
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
