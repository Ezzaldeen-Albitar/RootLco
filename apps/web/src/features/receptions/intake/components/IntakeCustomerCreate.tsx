'use client';

import { useActionState, useId, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/primitives/Icon';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import {
  createCompanyAction,
  createIndividualAction,
  type CreationState,
} from '@/features/crm/customers/creation-actions';
import {
  CREATABLE_LIFECYCLE_STATUSES,
  MAX_COMPANY_NAME,
  MAX_PERSON_NAME,
} from '@/features/crm/customers/creation-contract';
import type { ChosenCustomer } from './WalkInIntakeScreen';

/**
 * Creating a customer INSIDE the intake flow (`P1-28-FE-006`).
 *
 * The operations are the CRM ones — `crm.individual-create` and
 * `crm.company-create`, called through the P1-27 actions rather than through
 * a second adapter, so the idempotency handling, the field-error catalogue
 * keys and the duplicate advisory all arrive exactly as the CRM create screen
 * gets them. What differs is what happens AFTER: the CRM screen navigates to
 * the new profile; the intake flow keeps the new customer as its answer and
 * moves on to the vehicle.
 *
 * ## The duplicate guard is a RESULT, exactly as the CRM contract publishes it
 *
 * There is no pre-submit duplicate check anywhere on the platform —
 * `crm.duplicate-scan` is a privileged audited WRITE and must never be fired
 * to populate a screen. What the creation response carries is
 * `possibleDuplicates`: live customers already holding the same normalised
 * name, created-anyway being the contract's own words. So the outcome panel
 * states the creation plainly FIRST (the advisory below it could otherwise
 * read as a rejection), then offers a real decision: continue with the record
 * that now exists, or continue with one of the existing customers instead —
 * which is the decision a reception desk actually faces when the person at
 * the counter may already be in the book.
 *
 * ## Controlled fields, uncontrolled-remounted select
 *
 * The text fields are controlled so a transport failure cannot discard a
 * typed name; the status select carries the `key` + `defaultValue` +
 * `onChange` shape because a controlled select loses to React's post-action
 * `form.reset()` — measured and recorded at `CustomerCreateScreen.tsx`, and
 * inventoried by `tests/form-reset-class.test.ts`.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly kind: 'individual' | 'company';
  readonly onChosen: (customer: ChosenCustomer) => void;
  readonly onBack: () => void;
}

const INITIAL: CreationState = { status: 'idle' };

export function IntakeCustomerCreate({ locale, messages, kind, onChosen, onBack }: Props) {
  const formId = useId();
  const [state, action, pending] = useActionState(
    kind === 'individual' ? createIndividualAction : createCompanyAction,
    INITIAL
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (name: string) => (value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  if (state.status === 'success' && state.created) {
    const created = state.created;
    // The operator's own words, because the creation response deliberately
    // does not echo the name back.
    const displayName =
      kind === 'individual'
        ? `${(values['givenName'] ?? '').trim()} ${(values['familyName'] ?? '').trim()}`.trim()
        : (values['legalName'] ?? '').trim();

    return (
      <div className="flex flex-col gap-3">
        <p
          role="status"
          className="rounded-md border border-success bg-surface px-3 py-2 text-body text-text-primary"
        >
          {translate(messages, 'crm.customers.create.created')}{' '}
          {created.displayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {created.displayNumber}
            </code>
          ) : (
            // Not an error: a workshop without a provisioned numbering
            // sequence gets a customer with no number yet.
            <span className="text-caption text-text-muted">
              {translate(messages, 'crm.customers.create.noNumberYet')}
            </span>
          )}
        </p>

        {created.possibleDuplicates.length > 0 ? (
          <section
            aria-labelledby={`${formId}-duplicates`}
            className="rounded-md border border-warning bg-surface p-3"
          >
            <h3
              id={`${formId}-duplicates`}
              className="flex items-center gap-2 text-body font-semibold text-text-primary"
            >
              <span aria-hidden="true" className="text-warning">
                <Icon name="reports" size={18} />
              </span>
              {translate(messages, 'crm.customers.create.duplicatesTitle')}
            </h3>
            <p className="mt-1 text-caption text-text-secondary">
              {translate(messages, 'receptions.intake.customer.duplicatesBody')}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {created.possibleDuplicates.map((match) => (
                <li key={match.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-body text-text-primary">{match.displayName}</span>
                  {match.displayNumber ? (
                    <code className="font-mono text-caption text-text-secondary" dir="ltr">
                      {match.displayNumber}
                    </code>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      onChosen({
                        id: match.id,
                        displayName: match.displayName,
                        displayNumber: match.displayNumber,
                        // A duplicate row carries no party type, and inventing
                        // one would label a company an individual.
                        partyType: null,
                      })
                    }
                    className="rounded-md border border-border px-2 py-1 text-caption text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    {translate(messages, 'receptions.intake.customer.useExisting')}
                  </button>
                  <Link
                    href={`/${locale}/crm/customers/${match.id}`}
                    className="text-caption text-primary underline-offset-2 hover:underline"
                  >
                    {translate(messages, 'crm.customers.search.open')}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div>
          <button
            type="button"
            onClick={() =>
              onChosen({
                id: created.customerId,
                displayName,
                displayNumber: created.displayNumber,
                partyType: created.partyType,
              })
            }
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary"
          >
            {translate(messages, 'receptions.intake.customer.continueCreated')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      {state.status !== 'idle' ? (
        <p
          key={state.attempt}
          role="alert"
          className="rounded-md border border-error bg-surface px-3 py-2 text-body text-error"
        >
          {translateDynamic(messages, state.messageKey ?? 'form.formError')}
          {state.correlationId ? (
            <span className="ms-2 text-caption text-text-muted">
              {translate(messages, 'state.correlationId')}{' '}
              <code className="font-mono">{state.correlationId}</code>
            </span>
          ) : null}
        </p>
      ) : null}

      {kind === 'individual' ? (
        <>
          <TextField
            formId={formId}
            name="givenName"
            value={values['givenName'] ?? ''}
            onValueChange={set('givenName')}
            labelKey="crm.customers.create.givenName"
            messages={messages}
            maxLength={MAX_PERSON_NAME}
            required
            error={state.fieldErrors?.['givenName']}
          />
          <TextField
            formId={formId}
            name="familyName"
            value={values['familyName'] ?? ''}
            onValueChange={set('familyName')}
            labelKey="crm.customers.create.familyName"
            messages={messages}
            maxLength={MAX_PERSON_NAME}
            required
            error={state.fieldErrors?.['familyName']}
          />
        </>
      ) : (
        <>
          <TextField
            formId={formId}
            name="legalName"
            value={values['legalName'] ?? ''}
            onValueChange={set('legalName')}
            labelKey="crm.customers.create.legalName"
            messages={messages}
            maxLength={MAX_COMPANY_NAME}
            required
            error={state.fieldErrors?.['legalName']}
          />
          <TextField
            formId={formId}
            name="tradeName"
            value={values['tradeName'] ?? ''}
            onValueChange={set('tradeName')}
            labelKey="crm.customers.create.tradeName"
            hintKey="crm.customers.create.tradeNameHint"
            messages={messages}
            maxLength={MAX_COMPANY_NAME}
            error={state.fieldErrors?.['tradeName']}
          />
        </>
      )}

      <div className="flex flex-col gap-1">
        <label
          className="text-caption font-medium text-text-secondary"
          htmlFor={`${formId}-lifecycle`}
        >
          {translate(messages, 'crm.customers.create.lifecycleStatus')}
        </label>
        {/* `key` + `defaultValue` + `onChange` — the reset-safe shape. See the
            module note and `tests/form-reset-class.test.ts`. */}
        <select
          key={`lifecycle-${state.attempt ?? 0}`}
          id={`${formId}-lifecycle`}
          name="lifecycleStatus"
          defaultValue={values['lifecycleStatus'] ?? 'prospect'}
          onChange={(event) => set('lifecycleStatus')(event.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-body"
        >
          {/* Two options, because creation accepts two: a customer can REACH
              the other statuses; it cannot be born there. */}
          {CREATABLE_LIFECYCLE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {translateDynamic(messages, `crm.lifecycle.${value}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60"
        >
          {translate(messages, pending ? 'form.saving' : 'form.submit')}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-4 py-2 text-body text-text-secondary"
        >
          {translate(messages, 'receptions.intake.customer.backToSearch')}
        </button>
      </div>
    </form>
  );
}

function TextField({
  formId,
  name,
  labelKey,
  hintKey,
  messages,
  maxLength,
  required,
  error,
  value,
  onValueChange,
}: {
  readonly formId: string;
  readonly name: string;
  readonly labelKey: string;
  readonly hintKey?: string;
  readonly messages: Messages;
  readonly maxLength: number;
  readonly required?: boolean;
  readonly error?: string | undefined;
  readonly value: string;
  readonly onValueChange: (next: string) => void;
}) {
  const id = `${formId}-${name}`;
  const hintId = hintKey ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-caption font-medium text-text-secondary" htmlFor={id}>
        {translateDynamic(messages, labelKey)}
        {required ? null : (
          <span className="ms-1 text-text-muted">{translate(messages, 'field.optional')}</span>
        )}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        maxLength={maxLength}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="rounded-md border border-border bg-surface px-3 py-2 text-body"
      />
      {hintKey ? (
        <span id={hintId} className="text-caption text-text-muted">
          {translateDynamic(messages, hintKey)}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-caption text-error">
          {translateDynamic(messages, error)}
        </span>
      ) : null}
    </div>
  );
}
