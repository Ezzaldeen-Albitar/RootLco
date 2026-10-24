'use client';

import { useActionState, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { Icon } from '@/components/primitives/Icon';
import { FailureExplanation } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
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
 * **There is no upstream half any more, and this paragraph used to claim there
 * was.** It read: "the create action is offered from the search screen only
 * after a search returned nothing, so an operator arrives here having already
 * looked." That was true when written and was falsified by the Owner-acceptance
 * remediation, which closed the defect "Customer Search has no clear Add
 * Customer action" by putting `CustomerCreateActions` in the page header
 * unconditionally (`app/[locale]/(dashboard)/crm/customers/page.tsx:72-79`).
 * The empty-result placement in `CustomerSearchScreen` is now the second site,
 * not the only one.
 *
 * So an operator can reach this form without having searched at all, and the
 * warning below is the ONLY duplicate signal in the flow. That is a deliberate
 * trade the remediation made — an unreachable create action was the worse
 * defect — but it is post-hoc by construction and the record should say so
 * rather than describe a pre-check that no longer happens.
 *
 * ## `lifecycleStatus` offers two values, not five
 *
 * Creation accepts `prospect` and `active` only. The search filter offers all
 * five because a customer can *reach* the others; it cannot be *born* there. A
 * form offering the search vocabulary would 422 on three of its five options.
 *
 * ## On the Material UI wrappers (`P1-32-PRE-OD-CRM1A`, ADR-022)
 *
 * Presentation only: the same field names, bounds, actions and requests as
 * before. `FormTextField` and `FormSelectField` carry the `FieldFrame` contract
 * (`components/forms/mui/field-wiring.tsx`), which marks a required box with
 * `aria-required` and never with the native `required` — so an empty name is
 * not stopped by the browser but by the Server Action's own schema, which
 * refuses it with `field.required` before any request is made.
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

  /*
   * The two shared refusal behaviours (browser QA part 7, rows 6.3 and 6.5).
   *
   * A refused save left the cursor on the submit button — or, after Enter, on
   * the box it was pressed in while a DIFFERENT box was the one refused — and a
   * corrected name went on saying "This field is required." until the next
   * submission. `useFocusFirstInvalid` moves the cursor to the first control
   * the refusal marked; `useClearOnCorrect` retires a complaint the moment the
   * value it was about changes.
   */
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);
  const set = (name: string) => (value: string) =>
    setValues((current) => ({ ...current, [name]: value }));
  const edited = (name: string) => () => corrections.noteEdited(name);

  // Every value in `fieldErrors` is a catalogue key, translated here.
  const fieldError = (name: string): string | undefined => {
    const key = corrections.errorFor(name);
    return key === undefined ? undefined : translateDynamic(messages, key);
  };
  const optional = (labelKey: string) =>
    `${translateDynamic(messages, labelKey)} ${translate(messages, 'field.optional')}`;

  /*
   * The chosen status, written back AFTER React's reset of the form — see the
   * `NEW-FE-01` note at the status select below for why the remount alone is
   * not enough on the Material select. A layout effect runs after the reset in
   * the same commit and before paint, and it writes the DOM only, never state,
   * so nothing re-renders and nothing flickers.
   */
  const lifecycle = values['lifecycleStatus'] ?? 'prospect';
  useLayoutEffect(() => {
    const select = formRef.current?.elements.namedItem('lifecycleStatus');
    if (select instanceof HTMLSelectElement && select.value !== lifecycle) {
      select.value = lifecycle;
    }
  }, [formRef, lifecycle, state.attempt]);

  if (state.status === 'success' && state.created) {
    return <CreationOutcome locale={locale} messages={messages} state={state} />;
  }

  return (
    <form ref={formRef} action={action} className="flex max-w-content flex-col gap-4">
      {/*
        `role="alert"` and `key` on the attempt: submitting the same wrong value
        twice produces an identical state object, React sees no change, and the
        second failure is announced to nobody.

        An inline `Alert` rather than `MuiFormFeedback`, because that banner
        draws nothing for a state without a `messageKey` — and `fromFailure`
        returns a caller's cancellation with none (`lib/forms/action-result.ts`).
        This banner has always said `form.formError` for that case instead.
      */}
      {state.status !== 'idle' ? (
        <Alert
          key={state.attempt}
          severity="error"
          variant="outlined"
          role="alert"
          className="w-full"
        >
          <p>
            {translateWithValues(
              messages,
              state.messageKey ?? 'form.formError',
              state.messageValues
            )}
            <FailureExplanation
              messages={messages}
              messageKey={state.messageKey ?? 'form.formError'}
            />
          </p>
          {state.correlationId ? (
            <p className="mt-1 text-caption text-text-muted">
              {translate(messages, 'state.correlationId')}{' '}
              <code className="font-mono text-text-secondary">{state.correlationId}</code>
            </p>
          ) : null}
        </Alert>
      ) : null}

      {kind === 'individual' ? (
        <>
          <FormTextField
            name="givenName"
            label={translate(messages, 'crm.customers.create.givenName')}
            value={values['givenName'] ?? ''}
            onEdit={edited('givenName')}
            onChange={set('givenName')}
            maxLength={MAX_PERSON_NAME}
            required
            error={fieldError('givenName')}
          />
          <FormTextField
            name="familyName"
            label={translate(messages, 'crm.customers.create.familyName')}
            value={values['familyName'] ?? ''}
            onEdit={edited('familyName')}
            onChange={set('familyName')}
            maxLength={MAX_PERSON_NAME}
            required
            error={fieldError('familyName')}
          />
          {/* Individual only: a company carries no preferred language here. */}
          <FormTextField
            name="preferredLocale"
            label={optional('crm.customers.create.preferredLocale')}
            description={translate(messages, 'crm.customers.create.preferredLocaleHint')}
            value={values['preferredLocale'] ?? ''}
            onEdit={edited('preferredLocale')}
            onChange={set('preferredLocale')}
            maxLength={10}
            error={fieldError('preferredLocale')}
          />
        </>
      ) : (
        <>
          <FormTextField
            name="legalName"
            label={translate(messages, 'crm.customers.create.legalName')}
            value={values['legalName'] ?? ''}
            onEdit={edited('legalName')}
            onChange={set('legalName')}
            maxLength={MAX_COMPANY_NAME}
            required
            error={fieldError('legalName')}
          />
          <FormTextField
            name="tradeName"
            label={optional('crm.customers.create.tradeName')}
            description={translate(messages, 'crm.customers.create.tradeNameHint')}
            value={values['tradeName'] ?? ''}
            onEdit={edited('tradeName')}
            onChange={set('tradeName')}
            maxLength={MAX_COMPANY_NAME}
            error={fieldError('tradeName')}
          />
        </>
      )}

      <div className="flex flex-col gap-1">
        {/*
          Three parts, and none of them is optional. Written out because the
          obvious one-line fix looks complete, is not, and passes review.

          This carried `defaultValue="prospect"` with no `onChange`, eight lines
          beneath a docblock asserting that every field here is controlled
          precisely so a transport failure cannot discard what the operator
          chose. An adversarial recheck of this task's own PASS found it.

          Failure mode: pick "Active", submit, hit a timeout or a 503, and the
          three NAMES survive while the status silently reverts to "Prospect" —
          the one field whose reversion leaves no visible trace, because unlike a
          name it does not read as something you typed. Correct the name,
          resubmit, and the customer is created a prospect. Changing it
          afterwards needs the separate governance status screen.

          Making it a controlled `value={…}` field, which is what the docblock
          above describes and what `RecordForm` does, DID NOT FIX IT. Measured
          with a temporary probe rendering the state next to the field:

              after select   state=active   dom=active
              after submit   state=active   dom=prospect

          React resets the form DOM once the Server Action settles. On the render
          that follows, the `value` prop is `active` before and after, so the
          reconciler sees no change and never writes the DOM back: the reset wins
          and the element silently disagrees with the state that drives it.

          So the native select shipped here was:
            - `onChange` records the choice in `values`, which is what the rest
              of this form already relies on;
            - `key` on the attempt counter remounts the element after each
              submission, because only a mount re-reads the initial value;
            - `defaultValue` — NOT `value` — seeds that mount from state, and is
              also what `form.reset()` restores to, so the reset now lands on the
              operator's choice instead of overriding it.

          On Material UI (`P1-32-PRE-OD-CRM1A`) the third part is not available:
          `FormSelectField` is controlled by type and takes no `defaultValue`.
          The key alone was measured NOT to be enough — React 19 runs the reset
          at the end of the commit that also mounts the new element, so a
          mount seeded through `value` (which never sets `defaultSelected`) is
          reset to the first option, "Prospect", in the same commit. So `onChange`
          and the `key` stay, and the layout effect above the early return
          writes the held choice back after the reset, before paint.

          The same hole exists wherever a `<select>` sits in a `<form action={…}>`.
          `components/forms/RecordForm.tsx` is not visibly affected only because
          its default is the empty placeholder, which is also where the reset
          lands — the two coincide, so nothing shows. Raised as `NEW-FE-01`
          rather than changed blind here.
        */}
        <FormSelectField
          key={`lifecycle-${state.attempt ?? 0}`}
          label={translate(messages, 'crm.customers.create.lifecycleStatus')}
          name="lifecycleStatus"
          value={values['lifecycleStatus'] ?? 'prospect'}
          onEdit={edited('lifecycleStatus')}
          onChange={set('lifecycleStatus')}
          // Two options, because creation accepts two.
          options={CREATABLE_LIFECYCLE_STATUSES.map((value) => ({
            value,
            label: translateDynamic(messages, `crm.lifecycle.${value}`),
          }))}
          error={fieldError('lifecycleStatus')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="contained"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {translate(messages, pending ? 'form.saving' : 'form.submit')}
        </Button>
        <Button component={Link} href={`/${locale}/crm/customers`} variant="outlined">
          {translate(messages, 'form.cancel')}
        </Button>
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
                  className="text-primary underline-offset-2 hover:underline"
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
        <Button
          component={Link}
          href={`/${locale}/crm/customers/${created.customerId}`}
          variant="contained"
        >
          {translate(messages, 'crm.customers.create.openCreated')}
        </Button>
        <Button component={Link} href={`/${locale}/crm/customers`} variant="outlined">
          {translate(messages, 'crm.customers.create.backToSearch')}
        </Button>
      </div>
    </div>
  );
}
