'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import Button from '@mui/material/Button';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { Icon } from '@/components/primitives/Icon';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { unreachable } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
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
 * ## On the Material UI wrappers (ADR-022)
 *
 * The form is a Server Action form (`useActionState`), so the actions receive
 * the form's own data and nothing here assembles a request body. The text
 * fields are controlled, so a refusal keeps every name typed; the status select
 * is controlled too and is REMOUNTED on every settle (`key` on the attempt), so
 * the reset React applies after an action cannot strand it on a stale option —
 * the shape `tests/form-reset-class.test.ts` inventories for the native select.
 * A refusal marks its field (red, the sentence beside it, `aria-invalid`),
 * moves the cursor to the first, and is withdrawn once that field is edited.
 * Typed details are unsaved work: leaving the page or changing branch asks
 * first, and a confirmed discard empties the form. A create whose answer never
 * arrives is said as that, with the entries kept.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly kind: 'individual' | 'company';
  readonly onChosen: (customer: ChosenCustomer) => void;
  readonly onBack: () => void;
}

const INITIAL: CreationState = { status: 'idle' };
const DEFAULT_LIFECYCLE = 'prospect';

export function IntakeCustomerCreate({ locale, messages, kind, onChosen, onBack }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState(
    async (previous: CreationState, form: FormData): Promise<CreationState> => {
      try {
        return kind === 'individual'
          ? await createIndividualAction(previous, form)
          : await createCompanyAction(previous, form);
      } catch {
        // No answer came back: said as that, every entry kept.
        return unreachable((previous.attempt ?? 0) + 1);
      }
    },
    INITIAL
  );
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);
  const set = (name: string) => (value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const created = state.status === 'success' ? (state.created ?? null) : null;
  const typed = Object.entries(values).some(
    ([name, value]) =>
      value.trim() !== '' && !(name === 'lifecycleStatus' && value === DEFAULT_LIFECYCLE)
  );
  useUnsavedGuard(created === null && typed, () => {
    setValues({});
  });

  const fieldError = (name: string): string | undefined => {
    const key = corrections.errorFor(name);
    return key === undefined ? undefined : translateDynamic(messages, key);
  };

  if (created !== null) {
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
            aria-labelledby="intake-customer-duplicates"
            className="rounded-md border border-warning bg-surface p-3"
          >
            <h3
              id="intake-customer-duplicates"
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
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
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
                  >
                    {translate(messages, 'receptions.intake.customer.useExisting')}
                    <span className="sr-only"> {match.displayName}</span>
                  </Button>
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
          <Button
            type="button"
            variant="contained"
            onClick={() =>
              onChosen({
                id: created.customerId,
                displayName,
                displayNumber: created.displayNumber,
                partyType: created.partyType,
              })
            }
          >
            {translate(messages, 'receptions.intake.customer.continueCreated')}
          </Button>
        </div>
      </div>
    );
  }

  const field = (
    name: string,
    labelKey: string,
    maxLength: number,
    options: { readonly required?: boolean; readonly hintKey?: string } = {}
  ) => (
    <FormTextField
      label={translateDynamic(messages, labelKey)}
      name={name}
      required={options.required}
      description={options.hintKey ? translateDynamic(messages, options.hintKey) : undefined}
      value={values[name] ?? ''}
      maxLength={maxLength}
      onEdit={() => corrections.noteEdited(name)}
      onChange={set(name)}
      error={fieldError(name)}
    />
  );

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-3">
      <FormFeedback state={state} messages={messages} />

      {kind === 'individual' ? (
        <>
          {field('givenName', 'crm.customers.create.givenName', MAX_PERSON_NAME, {
            required: true,
          })}
          {field('familyName', 'crm.customers.create.familyName', MAX_PERSON_NAME, {
            required: true,
          })}
        </>
      ) : (
        <>
          {field('legalName', 'crm.customers.create.legalName', MAX_COMPANY_NAME, {
            required: true,
          })}
          {field('tradeName', 'crm.customers.create.tradeName', MAX_COMPANY_NAME, {
            hintKey: 'crm.customers.create.tradeNameHint',
          })}
        </>
      )}

      <FormSelectField
        // Remounted on every settle, so the reset after an action never leaves
        // the select showing an option other than the one held here.
        key={`lifecycle-${state.attempt ?? 0}`}
        label={translate(messages, 'crm.customers.create.lifecycleStatus')}
        name="lifecycleStatus"
        value={values['lifecycleStatus'] ?? DEFAULT_LIFECYCLE}
        onEdit={() => corrections.noteEdited('lifecycleStatus')}
        onChange={set('lifecycleStatus')}
        // Two options, because creation accepts two: a customer can REACH the
        // other statuses; it cannot be born there.
        options={CREATABLE_LIFECYCLE_STATUSES.map((value) => ({
          value,
          label: translateDynamic(messages, `crm.lifecycle.${value}`),
        }))}
        error={fieldError('lifecycleStatus')}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="contained"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {translate(messages, pending ? 'form.saving' : 'form.submit')}
        </Button>
        <Button type="button" variant="outlined" onClick={onBack}>
          {translate(messages, 'receptions.intake.customer.backToSearch')}
        </Button>
      </div>
    </form>
  );
}
