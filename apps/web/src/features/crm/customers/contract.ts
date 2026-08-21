/**
 * The CRM customer-search contract.
 *
 * Moved to `@/lib/customers/directory-contract` in the P1-27 D1 remediation:
 * `features/vehicles` needs to choose a customer for ownership transfer
 * (`FE-021`) and relationship linking (`FE-025`), and no feature may import
 * another feature. Same move, same reason, as `lib/api/read-operation.ts`.
 *
 * This file re-exports so no CRM screen changed. It is not a second authority —
 * it holds no definition of its own.
 */
export {
  LIFECYCLE_STATUSES,
  MAX_CUSTOMER_NUMBER_LENGTH,
  MAX_NAME_LENGTH,
  PARTY_TYPES,
  isEmptyCriteria,
  normalizeCriteria,
  toPartyIdentity,
  type CustomerSearchCriteria,
  type CustomerSearchHit,
  type LifecycleStatus,
  type PartyType,
} from '@/lib/customers/directory-contract';
