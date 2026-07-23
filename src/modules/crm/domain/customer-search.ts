/**
 * CRM customer search — domain contract (Phase 1-16, FR-CRM-001).
 *
 * Pure decision-making only: this file decides *what* a customer search is
 * allowed to filter on and *how* the result is ordered. It touches no database
 * (the boundary checker forbids `domain/` from importing `@/server/db`) and no
 * request. The application service passes it validated values; the repository
 * turns the contract into SQL.
 *
 * Privacy posture (NFR-PRV-001): the searchable surface is a closed allow-list.
 * A caller may match on the customer's own display number (an exact,
 * non-sensitive business key), on a normalised prefix of the display name, and
 * on two controlled discriminators (party type and lifecycle status). Sensitive
 * identifiers — national id, date of birth, raw contact values — are never a
 * search input and are never projected by this contract. Widening the surface is
 * a visible change to this allow-list, reviewed on its own merits.
 */
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

/** A validated, already-normalised search request handed to the repository. */
export interface CustomerSearchFilter {
  /**
   * Normalised name prefix (via `crm.normalize_name` semantics), or null. The
   * repository matches it as a **prefix**, never a leading-wildcard substring, so
   * the query stays bounded and cannot be turned into a full-table scan.
   */
  readonly namePrefix: string | null;
  /** Exact customer display number, or null. */
  readonly customerNumber: string | null;
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
}

/** Raw (edge-validated) inputs before domain normalisation. */
export interface CustomerSearchInput {
  readonly name?: string | undefined;
  readonly customerNumber?: string | undefined;
  readonly partyType?: CustomerPartyType | undefined;
  readonly lifecycleStatus?: CustomerLifecycleStatus | undefined;
}

/**
 * Normalises a free-text name fragment to the same rules the frozen SQL
 * `crm.normalize_name` applies to stored names: NFC is assumed upstream, then
 * casefold and collapse internal whitespace, trim. Kept deliberately in step with
 * the database function so a prefix computed here lines up with a stored value;
 * the repository still calls the SQL function on the column side so the two can
 * never silently diverge on a single row.
 */
export function normalizeNameFragment(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Turns edge-validated input into the closed filter contract. Empty/whitespace
 * fragments collapse to null (an empty search is a listing, not an error).
 */
export function toCustomerSearchFilter(input: CustomerSearchInput): CustomerSearchFilter {
  const name = input.name ? normalizeNameFragment(input.name) : '';
  return {
    namePrefix: name.length > 0 ? name : null,
    customerNumber: input.customerNumber?.trim() ? input.customerNumber.trim() : null,
    partyType: input.partyType ?? null,
    lifecycleStatus: input.lifecycleStatus ?? null,
  };
}
