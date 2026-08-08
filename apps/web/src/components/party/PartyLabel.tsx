import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

/**
 * A customer, named (`P1-27-INT-025`).
 *
 * Three vehicle surfaces hold a CRM partner id and must show a person, not an
 * id: the relationships list, the ownership history, and the customer selector.
 * Each had — or would have had — its own opinion about what to render when the
 * party could not be resolved, and one of those opinions was "print the uuid".
 * So the rule lives in one component.
 *
 * ## The fallback is a sentence, never the id
 *
 * A row may reference a party this caller cannot see: soft-deleted, merged away,
 * or outside their scope. The backend returns `partnerName: null` for exactly
 * that case, and this renders "Customer unavailable". Falling back to the uuid
 * would reintroduce the defect precisely where it is least defensible — the
 * screen would print an internal identifier for the one record the operator has
 * no permission to look at.
 *
 * ## Why the reference and the type are secondary
 *
 * Two customers can share a name; the reference is what disambiguates them, and
 * the type says whether "Al-Rashid" is a person or a company. Both are shown,
 * both are subordinate to the name, and the reference carries `dir="ltr"` so a
 * code like `C-000482` does not reorder inside an Arabic row.
 *
 * ## `null` is not `undefined`
 *
 * All three fields are required and nullable, mirroring the API type. An
 * optional field would let a caller that forgot to resolve type-check cleanly,
 * which is how the uuid reached an Owner acceptance in the first place.
 */
export interface PartyIdentity {
  /** `null` means "not visible to this caller" — say so in words. */
  readonly partnerName: string | null;
  readonly partnerNumber: string | null;
  /** `individual` or `organization`, from `crm.business_partners.party_type`. */
  readonly partnerType: string | null;
}

export function PartyLabel({
  messages,
  party,
  className,
}: {
  readonly messages: Messages;
  readonly party: PartyIdentity;
  readonly className?: string;
}) {
  if (party.partnerName === null) {
    return (
      <span
        data-testid="party-unavailable"
        className={`text-caption text-text-muted ${className ?? ''}`.trim()}
      >
        {translate(messages, 'party.unavailable')}
      </span>
    );
  }

  return (
    <span data-testid="party-label" className={`flex flex-col gap-0.5 ${className ?? ''}`.trim()}>
      <span className="text-body text-text-primary">{party.partnerName}</span>
      {party.partnerNumber !== null || party.partnerType !== null ? (
        <span className="flex flex-wrap items-center gap-x-2 text-caption text-text-muted">
          {party.partnerNumber !== null ? (
            // A customer reference reads left to right in every locale.
            <span dir="ltr">{party.partnerNumber}</span>
          ) : null}
          {party.partnerType !== null ? (
            <span>{translateDynamic(messages, `crm.partyType.${party.partnerType}`)}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
