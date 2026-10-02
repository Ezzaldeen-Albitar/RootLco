'use client';

import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';

import {
  THIRD_PARTY_REASON_MAX,
  THIRD_PARTY_REFERENCE_MAX,
  THIRD_PARTY_RELATIONSHIPS,
  type ThirdPartyRelationship,
} from '../payments-contract';

/**
 * A third-party payer (Owner decision D14, ADR-023).
 *
 * A receipt is applied to its payer's own invoices. When the chosen invoice's
 * customer is somebody else, the allocate form says so in plain words, and the
 * server refuses the allocation (`allocation_payer_mismatch`) unless it is an
 * explicit third-party payment — an insurer or an employer paying for the
 * customer. Only a holder of `sal.payment.third_party` is offered that: the box
 * "This is a third-party payment", then who the payer is to the customer (a fixed
 * list), the authorisation reference and the reason. Everyone else is told why
 * the invoice cannot take the money from this receipt.
 *
 * Nothing changes hands, and the screen says that too: the invoice stays its
 * customer's, the receipt stays its payer's, and anything left on the receipt
 * stays with the payer. Every view of a third-party allocation reads "Paid by
 * <payer> (<relationship>) for <customer>" with the authorisation reference.
 *
 * All four fields are on the shared Material UI wrappers (ADR-022), so each
 * refusal is a red field with its sentence beside it, announced, focused first
 * when it is the first, kept as typed, and cleared once corrected.
 */

/** What the operator has entered for a third-party payment. */
export interface ThirdPartyDraft {
  readonly chosen: boolean;
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly reason: string;
}

export const EMPTY_THIRD_PARTY: ThirdPartyDraft = Object.freeze({
  chosen: false,
  relationship: '',
  authorisationReference: '',
  reason: '',
});

/** Whether anything was entered — unsaved work the guard protects. */
export function thirdPartyDraftTouched(draft: ThirdPartyDraft): boolean {
  return (
    draft.chosen ||
    draft.relationship !== '' ||
    draft.authorisationReference.trim().length > 0 ||
    draft.reason.trim().length > 0
  );
}

/** Characters as the server counts them: code points, not UTF-16 units. */
const characters = (text: string): number => Array.from(text).length;

/**
 * The server's own rules for a third-party statement, checked before anything is
 * sent, each as the field's sentence (`form.violation.<rule>`). 'other' must say
 * in the reason who the payer is to the customer, and is told so in those words.
 */
export function thirdPartyFieldErrors(draft: ThirdPartyDraft): Record<string, string> {
  const found: Record<string, string> = {};
  if (!(THIRD_PARTY_RELATIONSHIPS as readonly string[]).includes(draft.relationship)) {
    found['relationship'] = 'form.violation.third_party_relationship_invalid';
  }
  const reference = draft.authorisationReference.trim();
  if (reference === '' || characters(reference) > THIRD_PARTY_REFERENCE_MAX) {
    found['authorisationReference'] = 'form.violation.third_party_authorisation_reference_required';
  }
  const reason = draft.reason.trim();
  if (reason === '' && draft.relationship === 'other') {
    found['reason'] = 'form.violation.third_party_other_unexplained';
  } else if (reason === '' || characters(reason) > THIRD_PARTY_REASON_MAX) {
    found['reason'] = 'form.violation.third_party_reason_required';
  }
  return found;
}

/** The statement the request carries, trimmed as the server stores it. */
export function thirdPartyBody(draft: ThirdPartyDraft): {
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly reason: string;
} {
  return {
    relationship: draft.relationship,
    authorisationReference: draft.authorisationReference.trim(),
    reason: draft.reason.trim(),
  };
}

/** A relationship code in words; a code outside the list reads as "Other". */
export function relationshipLabel(messages: Messages, code: string): string {
  const known = (THIRD_PARTY_RELATIONSHIPS as readonly string[]).includes(code)
    ? (code as ThirdPartyRelationship)
    : 'other';
  return translateDynamic(messages, `payments.thirdParty.relationship.${known}`);
}

/**
 * The plain explanation when the chosen invoice is someone else's, and — for a
 * caller who may not make a third-party payment — why it cannot take this money.
 */
export function OtherCustomerNotice({
  messages,
  canMakeThirdParty,
}: {
  readonly messages: Messages;
  readonly canMakeThirdParty: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-border bg-surface-subtle p-3"
      data-testid="payments-third-party-notice"
    >
      <p className="text-body text-text-primary">
        {translate(messages, 'payments.thirdParty.otherCustomer')}
      </p>
      <p className="text-body text-text-secondary">
        {translate(
          messages,
          canMakeThirdParty ? 'payments.thirdParty.mayRecord' : 'payments.thirdParty.blocked'
        )}
      </p>
    </div>
  );
}

/**
 * "This is a third-party payment", and once chosen, who the payer is to the
 * customer, the authorisation reference and the reason. Offered only to a holder
 * of `sal.payment.third_party`; the caller decides that.
 */
export function ThirdPartyFields({
  messages,
  draft,
  onChange,
  errorFor,
  onEdit,
}: {
  readonly messages: Messages;
  readonly draft: ThirdPartyDraft;
  readonly onChange: (next: ThirdPartyDraft) => void;
  /** The field's own error, already worded. */
  readonly errorFor: (name: string) => string | undefined;
  /** Clears a corrected field's error. */
  readonly onEdit: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="payments-third-party">
      <FormCheckboxField
        label={translate(messages, 'payments.thirdParty.option')}
        name="thirdParty"
        description={translate(messages, 'payments.thirdParty.optionHelp')}
        checked={draft.chosen}
        onEdit={() => onEdit('thirdParty')}
        onChange={(checked) => onChange({ ...draft, chosen: checked })}
        error={errorFor('thirdParty')}
        testId="payments-third-party-option"
      />
      {draft.chosen ? (
        <>
          <FormSelectField
            label={translate(messages, 'payments.thirdParty.relationship')}
            name="relationship"
            required
            placeholder={translate(messages, 'payments.thirdParty.relationshipPlaceholder')}
            options={THIRD_PARTY_RELATIONSHIPS.map((code) => ({
              value: code,
              label: relationshipLabel(messages, code),
            }))}
            value={draft.relationship}
            onEdit={() => onEdit('relationship')}
            onChange={(next) => {
              onEdit('relationship');
              // A relationship chosen after an 'other' refusal re-words the reason.
              onEdit('reason');
              onChange({ ...draft, relationship: next });
            }}
            error={errorFor('relationship')}
            testId="payments-third-party-relationship"
          />
          <FormTextField
            label={translate(messages, 'payments.thirdParty.reference')}
            name="authorisationReference"
            description={translate(messages, 'payments.thirdParty.referenceHelp')}
            required
            autoComplete="off"
            maxLength={THIRD_PARTY_REFERENCE_MAX}
            value={draft.authorisationReference}
            onEdit={() => onEdit('authorisationReference')}
            onChange={(next) => onChange({ ...draft, authorisationReference: next })}
            error={errorFor('authorisationReference')}
            testId="payments-third-party-reference"
          />
          <FormTextField
            label={translate(messages, 'payments.thirdParty.reason')}
            name="reason"
            description={translate(
              messages,
              draft.relationship === 'other'
                ? 'payments.thirdParty.reasonHelpOther'
                : 'payments.thirdParty.reasonHelp'
            )}
            required
            multiline
            rows={3}
            maxLength={THIRD_PARTY_REASON_MAX}
            value={draft.reason}
            onEdit={() => onEdit('reason')}
            onChange={(next) => onChange({ ...draft, reason: next })}
            error={errorFor('reason')}
            testId="payments-third-party-reason"
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * "Paid by <payer> (<relationship>) for <customer>", with the authorisation
 * reference — on the receipt, its printed copy and the invoice. A name withheld
 * from this reader is said as withheld, never replaced by a reference.
 */
export function PaidByLine({
  messages,
  payerName,
  customerName,
  relationship,
  authorisationReference,
  testId = 'third-party-paid-by',
}: {
  readonly messages: Messages;
  /** Who paid, by name; `null` when it is not shown to this reader. */
  readonly payerName: string | null;
  /** Whose invoice it is, by name; `null` when it is not shown to this reader. */
  readonly customerName: string | null;
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly testId?: string;
}) {
  return (
    <span className="flex flex-col gap-0.5 text-caption text-text-secondary" data-testid={testId}>
      <span>
        {formatMessage(translate(messages, 'payments.thirdParty.paidBy'), {
          payer: payerName ?? translate(messages, 'payments.thirdParty.payerNotShown'),
          relationship: relationshipLabel(messages, relationship),
          customer: customerName ?? translate(messages, 'payments.thirdParty.customerNotShown'),
        })}
      </span>
      <span>
        {translate(messages, 'payments.thirdParty.authorisation')}{' '}
        <bdi className="font-mono" dir="auto">
          {authorisationReference}
        </bdi>
      </span>
    </span>
  );
}
