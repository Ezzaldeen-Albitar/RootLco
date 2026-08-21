'use client';

import { useActionState, useState } from 'react';
import { MatchExplanation } from '@/components/duplicates/MatchExplanation';
import type { ActionState } from '@/lib/forms/action-result';
import { customerMatchReasons } from '@/lib/duplicates/explanations';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { reviewDuplicateAction } from '../identity-api';
import {
  CUSTOMER_CONFIDENCE_BANDS,
  MAX_MERGE_REASON,
  MIN_MERGE_REASON,
  formatMatchScore,
  pairMembers,
  type DuplicateCandidate,
} from '../identity-contract';

/**
 * The decision panel for one duplicate candidate (`FE-016`).
 *
 * ## One decision is offered here, and it is dismissal
 *
 * `crm.duplicate-review` accepts exactly `dismissed`, behind
 * `crm.customer.duplicate.review`. That is the whole decision surface this
 * screen has.
 *
 * ## There is NO merge affordance, and its absence is the design
 *
 * `crm.customer-merge` exists in the contract and this phase does not call it.
 * `P1-OD-017` — duplicate and merge rules — is an **open Owner decision**, and
 * the phase's canonical plan states the requirement precisely: the merge
 * affordance must be *absent*, "not disabled-with-a-tooltip, and the screen
 * states that merge rules are pending a decision. A disabled button implies the
 * capability exists and the user lacks permission, which is a different and
 * false statement."
 *
 * An earlier revision of this file shipped a working merge form with a survivor
 * selector and an approval-reference field. That was a defect against §13 and
 * against this phase's own plan, and it is recorded in `findings.md`. What the
 * plan permits — candidate comparison, `matchBasis` evidence, and dismissal — is
 * all still here.
 */

const EMPTY: ActionState = { status: 'idle' };

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly candidate: DuplicateCandidate;
  readonly onClose: () => void;
  readonly onDecided: () => void;
}

export function DuplicateDecisionPanel({ locale, messages, candidate, onClose, onDecided }: Props) {
  const [a, b] = pairMembers(candidate);
  const score = formatMatchScore(candidate.matchScore);

  return (
    <section
      aria-labelledby="crm-duplicate-decision-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="crm-duplicate-decision-heading"
          className="text-section-title font-medium text-text-primary"
        >
          {translate(messages, 'crm.duplicates.decideHeading')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-caption text-text-secondary underline"
        >
          {translate(messages, 'action.close')}
        </button>
      </div>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'crm.duplicates.score')}
          </dt>
          <dd className="text-body text-text-primary" dir="ltr">
            {/* Raw when the shape is unexpected. `numeric` arrives as a string
                because it does not fit a float, and this number decides whether
                two real customers are combined — a guess is not acceptable. */}
            {score ?? candidate.matchScore}
          </dd>
        </div>
        {[a, b].map((member, index) => (
          <div key={member.id}>
            <dt className="text-caption text-text-secondary">
              {translate(
                messages,
                index === 0 ? 'crm.duplicates.memberA' : 'crm.duplicates.memberB'
              )}
            </dt>
            <dd className="text-body text-text-primary">
              {member.name ?? (
                <span className="text-text-muted">
                  {translate(messages, 'crm.duplicates.nameUnavailable')}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <MatchExplanation
        locale={locale}
        messages={messages}
        score={candidate.matchScore}
        bands={CUSTOMER_CONFIDENCE_BANDS}
        reasonKeys={customerMatchReasons(candidate.matchBasis)}
      />

      <DismissForm
        messages={messages}
        candidateId={candidate.id}
        onDecided={onDecided}
        locale={locale}
      />

      {/* NO merge affordance. `P1-OD-017` (duplicate and merge rules) is OPEN,
          and the canonical plan is explicit that the affordance must be
          ABSENT rather than disabled-with-a-tooltip: a disabled button says
          "this capability exists and you lack permission", which is a
          different and false statement.

          An earlier revision of this file shipped a working merge form. That
          was a defect — recorded in findings.md — and this is what replaces it
          until the Owner resolves the decision. */}
      <p
        className="rounded-md border border-border p-3 text-body text-text-secondary"
        lang={locale}
      >
        {translate(messages, 'crm.duplicates.mergePendingDecision')}
        <code className="ms-2 font-mono text-caption" dir="ltr">
          P1-OD-017
        </code>
      </p>
    </section>
  );
}

function DismissForm({
  messages,
  candidateId,
  onDecided,
  locale,
}: {
  readonly messages: Messages;
  readonly candidateId: string;
  readonly onDecided: () => void;
  readonly locale: Locale;
}) {
  const [reason, setReason] = useState('');
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    const result = await reviewDuplicateAction(candidateId, previous, form);
    if (result.status === 'success') {
      setReason('');
      onDecided();
    }
    return result;
  }, EMPTY);

  return (
    <form action={submit} className="rounded-md border border-border p-3">
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'crm.duplicates.dismissHeading')}
      </h3>
      <p className="mt-1 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'crm.duplicates.dismissHint')}
      </p>

      {/* The only decision this operation accepts. Sent as a hidden field rather
          than offered as a choice, because a select with one option is a control
          that cannot be used and reads as a control that is broken. */}
      <input type="hidden" name="decision" value="dismissed" />

      <label htmlFor="duplicate-reason" className="mt-3 block text-caption text-text-secondary">
        {translate(messages, 'crm.customers.restrictions.reason')}
        <span aria-hidden="true" className="ms-1 text-error">
          *
        </span>
      </label>
      <textarea
        id="duplicate-reason"
        name="reason"
        // Controlled: a transport failure must not silently discard the
        // reviewer's reasoning and ask them to write it again.
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
        minLength={MIN_MERGE_REASON}
        maxLength={MAX_MERGE_REASON}
        rows={3}
        aria-invalid={state.fieldErrors?.reason ? true : undefined}
        aria-describedby={state.fieldErrors?.reason ? 'duplicate-reason-error' : undefined}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
      />
      {state.fieldErrors?.reason ? (
        <p id="duplicate-reason-error" role="alert" className="mt-1 text-caption text-error">
          {translateDynamic(messages, state.fieldErrors.reason)}
        </p>
      ) : null}

      <Outcome messages={messages} state={state} />

      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-md border border-border px-4 py-2 text-body text-text-primary disabled:opacity-60"
      >
        {pending
          ? translate(messages, 'form.pending')
          : translate(messages, 'crm.duplicates.dismiss')}
      </button>
    </form>
  );
}

function Outcome({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: ActionState;
}) {
  if (state.status === 'idle' || state.status === 'invalid' || !state.messageKey) return null;
  const failed = state.status !== 'success';
  return (
    <p
      role={failed ? 'alert' : 'status'}
      className={`mt-2 text-body ${failed ? 'text-error' : 'text-success'}`}
    >
      {translateDynamic(messages, state.messageKey)}
      {state.correlationId ? (
        <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
      ) : null}
    </p>
  );
}
