/**
 * CRM customer search — domain contract (Phase 1-16, FR-CRM-001; widened P1-32).
 *
 * Pure decision-making only: this file decides *what* a customer search is
 * allowed to filter on and *how* the result is ordered. It touches no database
 * (the boundary checker forbids `domain/` from importing `@/server/db`) and no
 * request. The application service passes it validated values; the repository
 * turns the contract into SQL.
 *
 * Privacy posture (NFR-PRV-001): the searchable surface is a closed allow-list.
 * A caller may match on the customer's own display number (an exact,
 * non-sensitive business key), on a folded fragment of the display name, on a
 * phone number, on a single free-text fragment that tries all three, and on two
 * controlled discriminators (party type and lifecycle status). Sensitive
 * identifiers — national id, date of birth — are never a search input and are
 * never projected. Widening the surface is a visible change to this allow-list.
 *
 * ## What P1-32 added, and the two rules that keep it bounded
 *
 * The Owner directive asked that a receptionist be able to find a customer the
 * way the customer identifies themselves: by phone, and by typing part of a name
 * rather than its first letters. Three things changed.
 *
 *  1. **Folding.** The name fragment is folded by the same rule the column side
 *     is (`shared.fold_search_text` / `foldSearchText`): tashkeel and tatweel
 *     removed, the alef forms collapsed, Arabic-Indic digits folded to ASCII. A
 *     name typed on an Arabic keyboard and the same name typed on a Latin one
 *     now produce one key.
 *  2. **Contains, not prefix.** `name` and `q` match a substring. That is only
 *     defensible because pg_trgm is installed and a GIN trigram index answers it
 *     — the fragment is still length-bounded and the page is still clamped, so
 *     the work is bounded above by the same limit as every other list.
 *  3. **Phone.** Matched against `crm.contact_points`, never against a free-text
 *     column. An exact normalized match always counts; a SUFFIX match counts
 *     only from `MIN_PHONE_SUFFIX` digits up, because a shorter tail matches too
 *     many people to be a lookup and would turn a search box into an enumeration
 *     tool.
 *
 * The projected phone is MASKED to its last four digits unless the caller holds
 * `iam.sensitive.view`. Four digits is what a person confirms out loud when they
 * are asked to identify themselves, so it is enough to choose the right row and
 * not enough to harvest a contact list from a result page.
 */
import { foldSearchText, normalizePhoneDigits } from '@/shared/text/normalization';

/** The two party kinds `crm.business_partners.party_type` permits. */
export const CUSTOMER_PARTY_TYPES = ['individual', 'organization'] as const;
export type CustomerPartyType = (typeof CUSTOMER_PARTY_TYPES)[number];

/** The lifecycle vocabulary `crm.business_partners.lifecycle_status` permits. */
export const CUSTOMER_LIFECYCLE_STATUSES = [
  'prospect',
  'active',
  'inactive',
  'blocked',
  'merged',
] as const;
export type CustomerLifecycleStatus = (typeof CUSTOMER_LIFECYCLE_STATUSES)[number];

/**
 * Deterministic, index-aligned ordering: newest first, id as the tie-breaker so
 * two partners created in the same instant cannot straddle a page edge. Bound to
 * a stable contract key so a cursor issued here can never be replayed against a
 * different ordering.
 */
export const CUSTOMER_SEARCH_ORDERING = {
  key: 'crm.business_partners:created_at_desc',
  direction: 'desc',
} as const;

/**
 * The maximum length of a free-text name fragment. Longer inputs are a payload,
 * not a query, and are rejected at the edge (the route's Zod schema mirrors this
 * bound). Kept here too so the domain rule is testable without the HTTP layer.
 */
export const MAX_NAME_FRAGMENT = 80;

/** The maximum length of a phone fragment. Longer than any dialled number. */
export const MAX_PHONE_FRAGMENT = 32;

/**
 * The shortest phone tail that may be matched as a SUFFIX.
 *
 * Below this a tail is not a lookup: four digits are shared by thousands of
 * numbers, so a shorter fragment would return a page of unrelated people and
 * make the search box an enumeration tool. Seven is also the width of the
 * database index key (`ix_contact_points_phone_tail`), so the two move together.
 */
export const MIN_PHONE_SUFFIX = 7;

/**
 * The shortest free-text fragment accepted.
 *
 * A one-character fragment matches nearly every row, so the page it returns says
 * nothing; it is refused at the edge rather than answered badly.
 */
export const MIN_SEARCH_FRAGMENT = 2;

/** How many trailing digits of a phone number survive masking. */
export const PHONE_VISIBLE_DIGITS = 4;

/** The character a masked digit is replaced with. */
export const PHONE_MASK_CHARACTER = '*';

/** A validated, already-normalised search request handed to the repository. */
export interface CustomerSearchFilter {
  /**
   * Folded name fragment, LIKE-escaped, or null. The repository matches it as a
   * CONTAINS over `crm.normalize_name(display_name)`, which is the expression
   * `ix_business_partners_name_folded_trgm` indexes.
   */
  readonly nameFragment: string | null;
  /** Exact customer display number, or null. */
  readonly customerNumber: string | null;
  /**
   * The caller's phone fragment reduced to ASCII digits (no leading `+`), or
   * null when none was supplied. An empty string is kept rather than collapsed
   * to null: a caller who sent `?phone=` asked a question with no answer, and the
   * honest reply is an empty page rather than the tenant's whole first page.
   */
  readonly phoneDigits: string | null;
  /** Whether `phoneDigits` is long enough to be matched as a suffix. */
  readonly phoneSuffixEligible: boolean;
  /** Folded, LIKE-escaped free-text fragment, or null. */
  readonly freeText: string | null;
  /** The free-text fragment reduced to digits, for its phone arm. Empty when it held none. */
  readonly freeTextDigits: string;
  /** Whether `freeTextDigits` is long enough to be matched as a phone suffix. */
  readonly freeTextPhoneEligible: boolean;
  /** The free-text fragment trimmed but not folded, for the exact customer-number arm. */
  readonly freeTextRaw: string;
  readonly partyType: CustomerPartyType | null;
  readonly lifecycleStatus: CustomerLifecycleStatus | null;
}

/** A safe, non-sensitive projection of a matched customer. */
export interface CustomerSearchHit {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly displayName: string;
  readonly partyType: CustomerPartyType;
  readonly lifecycleStatus: CustomerLifecycleStatus;
  readonly createdAt: string;
  /**
   * The customer's primary phone number, masked to its last
   * `PHONE_VISIBLE_DIGITS` digits unless the caller holds `iam.sensitive.view`.
   * Null when the customer has no phone contact point.
   */
  readonly primaryPhone: string | null;
  /** Whether `primaryPhone` was masked. Stated so a screen never has to guess. */
  readonly phoneMasked: boolean;
  /** How many live vehicles this customer currently holds a relationship to. */
  readonly vehicleCount: number;
}

/** Raw (edge-validated) inputs before domain normalisation. */
export interface CustomerSearchInput {
  readonly name?: string | undefined;
  readonly customerNumber?: string | undefined;
  readonly phone?: string | undefined;
  readonly q?: string | undefined;
  readonly partyType?: CustomerPartyType | undefined;
  readonly lifecycleStatus?: CustomerLifecycleStatus | undefined;
}

/**
 * Escapes the LIKE metacharacters so a caller can never inject a wildcard: a
 * `%`, `_` or `\` in the fragment becomes a literal (matched with `ESCAPE '\'`
 * in the repository), and the `%` the repository appends is the ONLY wildcard.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Normalises a free-text name fragment to the same rule the SQL
 * `crm.normalize_name` applies to stored names, then escapes it for LIKE.
 *
 * The repository still calls the SQL function on the COLUMN side, so the two can
 * never silently diverge on a single row; this side exists so the fragment the
 * caller typed is folded identically before it is bound as a parameter.
 */
export function normalizeNameFragment(raw: string): string {
  return escapeLike(foldSearchText(raw) ?? '');
}

/**
 * Reduces a phone fragment to the ASCII digits the stored normalized value is
 * built from. The leading `+` of an E.164 value is dropped, because a caller
 * quoting a number rarely types it and a stored `+` is matched by the suffix arm
 * regardless.
 */
export function normalizePhoneFragment(raw: string): string {
  return (normalizePhoneDigits(raw) ?? '').replace(/^\+/, '');
}

/**
 * Masks a phone number to its last `PHONE_VISIBLE_DIGITS` characters.
 *
 * Every earlier character becomes `PHONE_MASK_CHARACTER`, so the length is
 * preserved and the shape of the number is still recognisable — which is what
 * lets a person confirm "yes, that's mine" without the page carrying a
 * dialable number. A value at or below the visible width is masked ENTIRELY
 * rather than shown: a four-digit contact point would otherwise be published in
 * full by a rule written to hide it.
 */
export function maskPhone(value: string): string {
  if (value.length <= PHONE_VISIBLE_DIGITS) {
    return PHONE_MASK_CHARACTER.repeat(value.length);
  }
  const hidden = value.length - PHONE_VISIBLE_DIGITS;
  return `${PHONE_MASK_CHARACTER.repeat(hidden)}${value.slice(hidden)}`;
}

/**
 * Turns edge-validated input into the closed filter contract.
 *
 * Two different treatments of a blank fragment, and the difference is deliberate.
 *
 *  - A `name` or `q` fragment that folds to nothing collapses to `null`, i.e. no
 *    filter at all. That is the contract this operation has always had ("an empty
 *    search is a listing, not an error"), and it is kept because a CONTAINS match
 *    on an empty fragment would otherwise match every row anyway — the two are
 *    the same answer, and the null says so honestly instead of by accident.
 *  - A `phone` fragment holding no digits is kept as the empty string, which is
 *    an IMPOSSIBLE predicate rather than a dropped one:
 *    `ck_contact_points_normalized_not_blank` guarantees no stored contact point
 *    is blank, so `normalized_value = ''` can never hold. A caller who searched
 *    for a phone number and typed letters must receive an empty page, never the
 *    tenant's first page of customers, which they could not tell apart from a
 *    lookup that matched everything.
 */
export function toCustomerSearchFilter(input: CustomerSearchInput): CustomerSearchFilter {
  const name = input.name === undefined ? '' : normalizeNameFragment(input.name);
  const freeText = input.q === undefined ? '' : normalizeNameFragment(input.q);
  const freeTextRaw = input.q === undefined ? '' : input.q.trim();
  const freeTextDigits = input.q === undefined ? '' : normalizePhoneFragment(input.q);
  const phoneDigits = input.phone === undefined ? null : normalizePhoneFragment(input.phone);
  const customerNumber = input.customerNumber?.trim() ?? '';
  return {
    nameFragment: name === '' ? null : name,
    customerNumber: customerNumber === '' ? null : customerNumber,
    phoneDigits,
    phoneSuffixEligible: phoneDigits !== null && phoneDigits.length >= MIN_PHONE_SUFFIX,
    freeText: freeText === '' ? null : freeText,
    freeTextDigits,
    freeTextPhoneEligible: freeTextDigits.length >= MIN_PHONE_SUFFIX,
    freeTextRaw,
    partyType: input.partyType ?? null,
    lifecycleStatus: input.lifecycleStatus ?? null,
  };
}
