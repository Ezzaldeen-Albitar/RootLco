'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/primitives/Icon';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import {
  createCompanyAction,
  createIndividualAction,
  type CreationState,
} from '../creation-actions';
import {
  CREATABLE_LIFECYCLE_STATUSES,
  MAX_COMPANY_NAME,
  MAX_PERSON_NAME,
} from '../creation-contract';

/**
 * Translation by a key this file cannot know at compile time.
 *
 * `translate` takes `keyof Messages`, which is right and catches a typo in every
 * literal. A key that arrives from a Server Action's `messageKey`, or from a
 * field-error map, is a `string` — so it is widened here, once, rather than at
 * six call sites. The missing-key CI check is what still covers it.
 */
function dynamic(messages: Messages, key: string): string {
  return translate(messages, key as keyof Messages);
}

/**
 * Create an individual or company customer (`FE-004`, `FE-005`) and show the
 * duplicate warning the creation produces (`FE-003`).
 *
 * ## The duplicate warning is a RESULT, not a pre-check
 *
 * There is no operation that answers "does this name already exist?" without
 * writing. `crm.duplicate-scan` is a POST that records candidate rows and emits
 * a `privileged` audit record, so calling it on a keystroke — or on blur, or on
 * a "check" button — would fill the audit trail with scans nobody asked for.
 *
 * What the contract publishes is `possibleDuplicates` on the **creation
 * response**. So the warning appears after the record exists, and says so. The
 * alternative — a form that looks like it checks and does not — is worse than no
 * check at all, because it is a promise.
 *
 * The other half of the duplicate story is upstream: the create action is
 * offered from the search screen only after a search returned nothing, so an
 * operator arrives here having already looked.
 *
 * ## `lifecycleStatus` offers two values, not five
 *
 * Creation accepts `prospect` and `active` only. The search filter offers all
 * five because a customer can *reach* the others; it cannot be *born* there. A
 * form offering the search vocabulary would 422 on three of its five options.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly kind: 'individual' | 'company';
}

const INITIAL: CreationState = { status: 'idle' };

export function CustomerCreateScreen({ locale, messages, kind }: Props) {
  const [state, action, pending] = useActionState(
    kind === 'individual' ? createIndividualAction : createCompanyAction,
    INITIAL
  );

  /**
   * The fields are CONTROLLED, and that is not a style choice.
   *
   * React resets an uncontrolled form after a Server Action completes. So a
   * transport failure — a timeout, a 503, a rate limit — would clear everything
   * the operator had typed and ask them to retype a customer's name for a fault
   * that was not theirs. Holding the values here survives every failure.
   *
   * The alternative is echoing the submitted values back through the action
   * state, which is the documented React pattern but sends a person's name to
   * the server and back purely to redraw a form.
   */
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (name: string) => (value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  if (state.status === 'success' && state.created) {
    return <CreationOutcome locale={locale} messages={messages} state={state} />;
  }

  return (
    <form action={action} className="flex max-w-content flex-col gap-4">
      {/*
        `role="alert"` and `key` on the attempt: submitting the same wrong value
        twice produces an identical state object, React sees no change, and the
        second failure is announced to nobody.
      */}
      {state.status !== 'idle' ? (
        <p
          key={state.attempt}
          role="alert"
          className="rounded-md border border-error bg-surface px-3 py-2 text-body text-error"
        >
          {dynamic(messages, state.messageKey ?? 'form.formError')}
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
            name="familyName"
            value={values['familyName'] ?? ''}
            onValueChange={set('familyName')}
            labelKey="crm.customers.create.familyName"
            messages={messages}
            maxLength={MAX_PERSON_NAME}
            required
            error={state.fieldErrors?.['familyName']}
          />
          <TextField
            name="preferredLocale"
            value={values['preferredLocale'] ?? ''}
            onValueChange={set('preferredLocale')}
            labelKey="crm.customers.create.preferredLocale"
            hintKey="crm.customers.create.preferredLocaleHint"
            messages={messages}
            maxLength={10}
            error={state.fieldErrors?.['preferredLocale']}
          />
        </>
      ) : (
        <>
          <TextField
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
          htmlFor="crm-create-lifecycle"
        >
          {translate(messages, 'crm.customers.create.lifecycleStatus')}
        </label>
        <select
          id="crm-create-lifecycle"
          name="lifecycleStatus"
          defaultValue="prospect"
          className="rounded-md border border-border bg-surface px-3 py-2 text-body"
        >
          {/* Two options, because creation accepts two. */}
          {CREATABLE_LIFECYCLE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {translate(messages, `crm.lifecycle.${value}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-primary px-4 py-2 text-body font-medium text-on-brand disabled:opacity-60"
        >
          {translate(messages, pending ? 'form.saving' : 'form.submit')}
        </button>
        <Link
          href={`/${locale}/crm/customers`}
          className="rounded-md border border-border px-4 py-2 text-body text-text-secondary"
        >
          {translate(messages, 'form.cancel')}
        </Link>
      </div>
    </form>
  );
}

/**
 * What the operator sees after a successful creation.
 *
 * The success is stated first and unambiguously, because the duplicate list
 * below it could otherwise read as a rejection. The record exists; the list is
 * advice about what to do next.
 */
function CreationOutcome({
  locale,
  messages,
  state,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: CreationState;
}) {
  const created = state.created;
  if (!created) return null;
  const duplicates = created.possibleDuplicates;

  return (
    <div className="flex max-w-content flex-col gap-4">
      <p
        role="status"
        className="rounded-md border border-success bg-surface px-3 py-2 text-body text-text-primary"
      >
        {translate(messages, 'crm.customers.create.created')}{' '}
        {created.displayNumber ? (
          <code className="font-mono text-caption">{created.displayNumber}</code>
        ) : (
          // Not an error. A tenant without a provisioned customer-number
          // sequence gets a customer with no number yet, and the backend calls
          // that a supported state.
          <span className="text-caption text-text-muted">
            {translate(messages, 'crm.customers.create.noNumberYet')}
          </span>
        )}
      </p>

      {duplicates.length > 0 ? (
        <section
          aria-labelledby="crm-duplicates-heading"
          className="rounded-md border border-warning bg-surface p-4"
        >
          <h2
            id="crm-duplicates-heading"
            className="flex items-center gap-2 text-section-title font-semibold text-text-primary"
          >
            <span className="text-warning">
              <Icon name="reports" size={20} />
            </span>
            {translate(messages, 'crm.customers.create.duplicatesTitle')}
          </h2>
          {/* Stated plainly, because the heading alone could read as a refusal. */}
          <p className="mt-1 text-body text-text-secondary">
            {translate(messages, 'crm.customers.create.duplicatesBody')}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {duplicates.map((match) => (
              <li key={match.id}>
                <Link
                  href={`/${locale}/crm/customers/${match.id}`}
                  className="text-link underline-offset-2 hover:underline"
                >
                  {match.displayName}
                </Link>
                {match.displayNumber ? (
                  <code className="ms-2 font-mono text-caption text-text-secondary">
                    {match.displayNumber}
                  </code>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/${locale}/crm/customers/${created.customerId}`}
          className="rounded-md bg-brand-primary px-4 py-2 text-body font-medium text-on-brand"
        >
          {translate(messages, 'crm.customers.create.openCreated')}
        </Link>
        <Link
          href={`/${locale}/crm/customers`}
          className="rounded-md border border-border px-4 py-2 text-body text-text-secondary"
        >
          {translate(messages, 'crm.customers.create.backToSearch')}
        </Link>
      </div>
    </div>
  );
}

function TextField({
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
  const id = `crm-create-${name}`;
  const hintId = hintKey ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-caption font-medium text-text-secondary" htmlFor={id}>
        {dynamic(messages, labelKey)}
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
        // `aria-invalid` and a described error, rather than a red border alone —
        // a colour is not an announcement.
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="rounded-md border border-border bg-surface px-3 py-2 text-body"
      />
      {hintKey ? (
        <span id={hintId} className="text-caption text-text-muted">
          {dynamic(messages, hintKey)}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-caption text-error">
          {dynamic(messages, error)}
        </span>
      ) : null}
    </div>
  );
}
