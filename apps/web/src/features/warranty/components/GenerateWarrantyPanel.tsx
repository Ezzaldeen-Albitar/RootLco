'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

import { generateWarranty, type WarrantyWriteState } from '../warranty-api';
import { WARRANTY_ELIGIBLE_DELIVERY_STATUS, WARRANTY_ERROR_CODES } from '../warranty-contract';
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
 * ## Nothing about the warranty is chosen here
 *
 * Duration, distance limit, covered scope and the effective window are all operator
 * configuration resolved server-side from the coverage effective at the handover
 * date. The only thing a caller may name is a policy, and it is named only when the
 * operator types one: omitting it is what makes the company's single active policy
 * resolve, and a company with none or with several is a configuration error the
 * screen reports rather than guesses its way past.
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
  deliveryStatus,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly deliveryId: string;
  /** The handover's stage, as the delivery read published it. */
  readonly deliveryStatus: string;
}) {
  const [policyId, setPolicyId] = useState('');
  const [state, setState] = useState<WarrantyWriteState | null>(null);
  const [sending, setSending] = useState(false);

  const handedOver = deliveryStatus === WARRANTY_ELIGIBLE_DELIVERY_STATUS;
  const created = state?.created ?? null;

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
        <label className="flex flex-col gap-1 text-caption text-text-muted">
          {translate(messages, 'warranty.generate.policyField')}
          <input
            type="text"
            dir="ltr"
            spellCheck={false}
            className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-body text-text-primary"
            value={policyId}
            onChange={(event) => setPolicyId(event.target.value)}
          />
        </label>
        <p className="text-caption text-text-muted">
          {translate(messages, 'warranty.generate.policyHelp')}
        </p>

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
