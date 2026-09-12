'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SelectField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

import { generateWarranty, listWarrantyPolicies, type WarrantyWriteState } from '../warranty-api';
import {
  ISSUABLE_POLICY_STATUS,
  WARRANTY_ELIGIBLE_DELIVERY_STATUS,
  WARRANTY_ERROR_CODES,
} from '../warranty-contract';
import type { WarrantyPolicySummary } from '../warranty-contract';
import { PRIMARY_BUTTON, Section } from './shared';

/**
 * The issue surface (P1-31, FE-008): generate a warranty from a completed handover.
 *
 * It lives in the warranty feature and is rendered by the delivery screen, because
 * the operation is a subresource of the delivery and the operator is standing on the
 * handover when they need it. Putting the control here keeps the warranty vocabulary,
 * the warranty adapter and the warranty refusals in one place.
 *
 * ## Two conditions, and only one of them is this screen's
 *
 * The control is drawn only for a caller holding `wty.warranty.issue` — the code the
 * operation declares, and not the code that reads a warranty. That is an affordance:
 * a button whose only outcome is a denial teaches an operator to ignore denials.
 *
 * The second condition is the handover's stage. `wty.guard_warranty_record_coherence`
 * refuses an INSERT whose delivery is not `delivered`, and every term is dated from
 * the handover moment, so before then there is nothing to date a warranty from. The
 * value is MIRRORED from the delivery status vocabulary rather than invented, and it
 * decides only whether the button is enabled. The server decides again, and when it
 * refuses, its refusal — not a sentence composed here — is what the operator is told.
 *
 * ## No warranty TERM is chosen here, and the one choice there is comes from a list
 *
 * Duration, distance limit, covered scope and the effective window are all operator
 * configuration resolved server-side from the coverage effective at the handover
 * date. The only thing a caller may name is a policy, and it is PICKED from
 * `wty.warranty-policy-list` rather than typed: an operator has no way to discover a
 * policy identifier, and a field that can only be filled by guessing is a field that
 * is always left empty. Leaving it unchosen stays meaningful — that is what makes the
 * company's single active policy resolve — so the picker carries an explicit "the
 * plan already in use" option rather than being required.
 *
 * The list is asked for the ISSUABLE state only, and narrowed to the handover's own
 * company: the read is tenant-scoped and answers for every company the caller reaches,
 * and offering a plan from another company, or an archived one, is offering a choice
 * whose only outcome is a refusal.
 *
 * ## The picker is an affordance, and its absence is never a dead end
 *
 * It is requested only when the page resolved `wty.warranty.read`, which the issue
 * code does not imply. When the code is absent, when the read is refused, or when the
 * company has no active plan, the form still submits — with no policy named, which is
 * exactly the request that resolves the single active one — and says which of those it
 * is rather than showing an empty control.
 *
 * ## A refusal that means something specific says so
 *
 * Four causes change what the operator does next — the vehicle is already covered,
 * nothing is configured to issue against, the handover is not complete, and the
 * authority was not held — and all four arrive as a bare conflict, a bare validation
 * failure or a bare denial. The catalogue code is what tells them apart. Every other
 * outcome keeps the shared wording; inventing a sentence per code would claim
 * knowledge the problem document does not carry.
 */
export function GenerateWarrantyPanel({
  locale,
  messages,
  deliveryId,
  deliveryCompanyId,
  deliveryStatus,
  canReadPolicies = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
  /** The company the handover belongs to. The picker offers this company's plans only. */
  readonly deliveryCompanyId: string;
  /** The handover's stage, as the delivery read published it. */
  readonly deliveryStatus: string;
  /**
   * `wty.warranty.read` — whether the plans are asked for at all.
   *
   * Defaulted to false rather than assumed from the issue code: the two are separate
   * codes and P-7 minted the read one precisely so they could not be collapsed. A
   * caller who holds only the issue code gets the form without the picker, which is
   * the request that resolves the company's single active plan.
   */
  readonly canReadPolicies?: boolean;
}) {
  const [policyId, setPolicyId] = useState('');
  const [state, setState] = useState<WarrantyWriteState | null>(null);
  const [sending, setSending] = useState(false);
  const [policies, setPolicies] = useState<readonly WarrantyPolicySummary[] | null>(null);
  const [policiesRefused, setPoliciesRefused] = useState(false);

  useEffect(() => {
    if (!canReadPolicies) return;
    let live = true;
    void listWarrantyPolicies({ status: ISSUABLE_POLICY_STATUS }).then((result) => {
      if (!live) return;
      if (result.status === 'ok') setPolicies(result.data.policies.items);
      else setPoliciesRefused(true);
    });
    return () => {
      live = false;
    };
  }, [canReadPolicies]);

  const handedOver = deliveryStatus === WARRANTY_ELIGIBLE_DELIVERY_STATUS;
  const created = state?.created ?? null;

  // The list answers for every company the caller reaches, so the handover's own
  // company is applied here. A plan from another company would be refused, and a
  // control that offers it teaches an operator to ignore refusals.
  const choices = (policies ?? []).filter((policy) => policy.companyId === deliveryCompanyId);
  // An empty set is not a picker: with no plan to choose, the operator is told what
  // will happen instead of being shown a control with nothing in it.
  const offered = policies !== null && choices.length > 0;

  return (
    <Section
      headingId="warranty-generate-heading"
      titleKey="warranty.generate.heading"
      messages={messages}
      description={translate(messages, 'warranty.generate.explain')}
    >
      {handedOver ? null : (
        <p className="mb-3 text-body text-text-secondary">
          {translate(messages, 'warranty.generate.notHandedOver')}
        </p>
      )}

      <form
        aria-label={translate(messages, 'warranty.generate.formLabel')}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (sending || created) return;
          setSending(true);
          const chosen = policyId.trim();
          void generateWarranty(deliveryId, chosen.length === 0 ? {} : { policyId: chosen }).then(
            (outcome) => {
              setState(outcome);
              setSending(false);
            }
          );
        }}
      >
        {offered ? (
          <SelectField
            label={translate(messages, 'warranty.generate.policyField')}
            description={translate(messages, 'warranty.generate.policyHelp')}
            value={policyId}
            onChange={(event) => setPolicyId(event.target.value)}
            options={choices.map((policy) => ({
              value: policy.id,
              label: `${policy.policyCode} — ${policy.name}`,
            }))}
            placeholder={translate(messages, 'warranty.generate.policyPlaceholder')}
          />
        ) : (
          <p className="text-caption text-text-muted">
            {translate(
              messages,
              policiesRefused
                ? 'warranty.generate.policiesRefused'
                : 'warranty.generate.policyNotOffered'
            )}
          </p>
        )}

        <div>
          <button
            type="submit"
            className={PRIMARY_BUTTON}
            disabled={!handedOver || sending || created !== null}
          >
            {translate(messages, 'warranty.generate.submit')}
          </button>
        </div>
      </form>

      {created ? (
        <p role="status" className="mt-3 text-body text-text-primary">
          {translate(messages, 'warranty.generate.done')}{' '}
          <Link
            href={`/${locale}/warranty/${created.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'warranty.generate.openRecord')}
          </Link>
        </p>
      ) : null}

      {state && state.status !== 'success' ? (
        <p role="alert" className="mt-3 text-body text-error">
          {translateDynamic(messages, refusalKeyFor(state))}
          {state.correlationId ? (
            <>
              {' '}
              <span className="text-caption text-text-muted">
                {translate(messages, 'state.correlationId')}{' '}
                <code className="font-mono" dir="ltr">
                  {state.correlationId}
                </code>
              </span>
            </>
          ) : null}
        </p>
      ) : null}
    </Section>
  );
}

/**
 * The sentence a refused generation is reported with.
 *
 * Read off the catalogue code the problem document carried, and only for the four
 * causes the backend genuinely distinguishes. Anything else falls back to the shared
 * wording the rest of the product uses for a failed action.
 */
function refusalKeyFor(state: WarrantyWriteState): string {
  if (state.code === WARRANTY_ERROR_CODES.alreadyCovered) {
    return 'warranty.generate.refusedAlreadyCovered';
  }
  if (state.code === WARRANTY_ERROR_CODES.notConfigured) {
    return 'warranty.generate.refusedNotConfigured';
  }
  if (state.code === WARRANTY_ERROR_CODES.refused) return 'warranty.generate.refusedPrecondition';
  if (state.code === WARRANTY_ERROR_CODES.denied) return 'warranty.generate.refusedDenied';
  if (state.code === WARRANTY_ERROR_CODES.alreadyRecorded) {
    return 'warranty.generate.refusedAlreadyRecorded';
  }
  return state.messageKey ?? 'action.failed';
}
