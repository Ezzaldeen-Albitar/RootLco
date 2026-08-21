/**
 * The CRM customer-search contract, as the backend actually publishes it
 * (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * Written down here because a screen that guesses at a contract produces a
 * request the server rejects, and the rejection arrives as a validation banner
 * naming no field. Everything below was read out of
 * `apps/api/src/app/api/v1/customers/route.ts` and
 * `apps/api/src/modules/crm/domain/customer-search.ts`, not inferred.
 *
 * ## Why this moved out of `features/crm/customers` (P1-27, D1)
 *
 * The same three options as `lib/api/read-operation.ts`, and the same answer.
 * Ownership transfer (`FE-021`) and relationship linking (`FE-025`) both need an
 * operator to *choose a customer*, and both live in `features/vehicles`. Getting
 * that meant importing across features — which would say the vehicle feature
 * depends on the CRM feature, and it does not — or copying the contract, which
 * is the second authority the ownership gate exists to prevent, or moving it
 * here. `features/crm/customers/contract.ts` re-exports, so no CRM screen
 * changed.
 *
 * There is exactly one customer-search authority in this application, and it is
 * this file plus `directory.ts` beside it.
 *
 * ## The searchable surface is a CLOSED allow-list
 *
 * Four fields, and the route's Zod schema is `.strict()` — any other parameter
 * is a 422 before the query runs.
 *
 * | parameter          | semantics                                       |
 * | ------------------ | ----------------------------------------------- |
 * | `name`             | normalised **prefix**, max 80 characters        |
 * | `customerNumber`   | **exact** display number, max 64                |
 * | `partyType`        | `individual` \| `organization`                  |
 * | `lifecycleStatus`  | `prospect`…`merged`                             |
 *
 * Plus `cursor` and `limit` (1–100).
 *
 * ## What is NOT searchable, and must not be offered
 *
 * **Phone and email are not search inputs.** `NFR-PRV-001` makes that a privacy
 * decision rather than an omission: the domain file states that raw contact
 * values "are never a search input and are never projected by this contract",
 * and widening the allow-list is a reviewed change to the backend.
 *
 * A phone or email box on this screen would therefore be a control that cannot
 * work. Offering one and disabling it would be worse — it would advertise a
 * capability the product deliberately does not have.
 *
 * ## There is no sort parameter at all
 *
 * The order is fixed: `(created_at DESC, id DESC)`, bound to the ordering
 * contract key `crm.business_partners:created_at_desc`. Sending `sort` is a 422,
 * so no column in the results table is sortable. That is not a missing feature
 * in this screen; it is the contract.
 *
 * ## There is no total
 *
 * `Page<T>` publishes `{ items, nextCursor, hasMore }` and no count. The table
 * renders Previous/Next without a range, because the last page of a
 * cursor-paginated set is not knowable without walking it.
 *
 * ## The rate limit shapes the UX
 *
 * `expensive-read`: 30 requests per 60 seconds, keyed by operation, tenant and
 * user. Search-as-you-type would spend that in under three seconds of typing, so
 * every surface built on this contract searches on an explicit action and never
 * on a keystroke.
 */

/** `crm.business_partners.party_type`. */
export const PARTY_TYPES = ['individual', 'organization'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

/** `crm.business_partners.lifecycle_status`. */
export const LIFECYCLE_STATUSES = ['prospect', 'active', 'inactive', 'blocked', 'merged'] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/** `MAX_NAME_FRAGMENT` in the domain. Longer is a payload, not a query. */
export const MAX_NAME_LENGTH = 80;
/** The route's own bound on an exact display number. */
export const MAX_CUSTOMER_NUMBER_LENGTH = 64;

/**
 * A safe, non-sensitive projection of a matched customer.
 *
 * Exactly the six fields `CustomerSearchHit` publishes. A results table cannot
 * show a primary contact, an alert indicator or a last-activity date, because
 * this contract carries none of them — and inventing a column that renders
 * blank for every row is worse than not offering it.
 */
export interface CustomerSearchHit {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly displayName: string;
  readonly partyType: PartyType;
  readonly lifecycleStatus: LifecycleStatus;
  readonly createdAt: string;
}

/** What an operator may search on. Every field is optional; all four may combine. */
export interface CustomerSearchCriteria {
  readonly name?: string | undefined;
  readonly customerNumber?: string | undefined;
  readonly partyType?: PartyType | undefined;
  readonly lifecycleStatus?: LifecycleStatus | undefined;
}

/** True when the operator has supplied nothing to search on. */
export function isEmptyCriteria(criteria: CustomerSearchCriteria): boolean {
  return (
    !criteria.name?.trim() &&
    !criteria.customerNumber?.trim() &&
    !criteria.partyType &&
    !criteria.lifecycleStatus
  );
}

/**
 * Trims and drops empty values, so an empty box is "no filter" rather than a
 * filter on the empty string.
 *
 * Over-length input is **truncated rather than sent**. The backend would answer
 * 422, which is correct of it and useless to an operator who pasted a
 * paragraph — the form bounds the field with `maxLength` too, so this is the
 * second line of the same defence rather than the only one.
 */
export function normalizeCriteria(criteria: CustomerSearchCriteria): CustomerSearchCriteria {
  const name = criteria.name?.trim().slice(0, MAX_NAME_LENGTH);
  const customerNumber = criteria.customerNumber?.trim().slice(0, MAX_CUSTOMER_NUMBER_LENGTH);
  return {
    ...(name ? { name } : {}),
    ...(customerNumber ? { customerNumber } : {}),
    ...(criteria.partyType ? { partyType: criteria.partyType } : {}),
    ...(criteria.lifecycleStatus ? { lifecycleStatus: criteria.lifecycleStatus } : {}),
  };
}

/**
 * A customer, as a chooser should label them.
 *
 * The shape `PartyLabel` renders, derived from a search hit. It exists so a
 * selector option and a resolved relationship row read identically — the same
 * customer must not be "Layla Haddad · C-000482 · Individual" in one place and
 * "Haddad, Layla" in the other.
 */
export function toPartyIdentity(hit: CustomerSearchHit): {
  readonly partnerName: string | null;
  readonly partnerNumber: string | null;
  readonly partnerType: string | null;
} {
  return {
    partnerName: hit.displayName,
    partnerNumber: hit.displayNumber,
    partnerType: hit.partyType,
  };
}
