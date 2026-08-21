/**
 * `crm` module — public surface (Phase 1-16).
 *
 * The ONLY legal import path for this module (ADR-001): the boundary checker and
 * the ESLint rule both reject `@/modules/crm/<anything>`. It exports behaviour
 * (composed services) and types/contract constants — never repositories, pools,
 * or SQL.
 */
import { composeModule } from '@/server/layering';
import { sharedServicesModule } from '@/modules/shared-services';
import { CustomerSearchRepository } from './data/customer-search-repository';
import { CustomerRepository } from './data/customer-repository';
import { CustomerProfileRepository } from './data/customer-profile-repository';
import { CustomerGovernanceRepository } from './data/customer-governance-repository';
import { CustomerIdentityRepository } from './data/customer-identity-repository';
import { CustomerReadRepository } from './data/customer-read-repository';
import { CustomerSearchService } from './application/customer-search-service';
import { CustomerCreationService } from './application/customer-creation-service';
import { CustomerProfileService } from './application/customer-profile-service';
import { CustomerGovernanceService } from './application/customer-governance-service';
import { CustomerIdentityService } from './application/customer-identity-service';
import { CustomerReadService } from './application/customer-read-service';

export type { CustomerSearchHit, CustomerSearchInput } from './application/customer-search-service';
export type { ListQuery, NotePage } from './application/customer-read-service';
export type {
  AddressEntry,
  AlertEntry,
  ConsentEntry,
  ContactPointEntry,
  CustomerDetailRow,
  CustomerVehicleEntry,
  NoteEntry,
  PreferenceEntry,
  RestrictionEntry,
  TagEntry,
} from './data/customer-read-repository';
export type { CreatedCustomer } from './application/customer-creation-service';
export type {
  ConsentRecorded,
  ProfileComponentCreated,
} from './application/customer-profile-service';
export {
  ADDRESS_TYPES,
  COMMUNICATION_PURPOSES,
  CONSENT_KINDS,
  CONTACT_CHANNELS,
  MAX_ADDRESS_LINE,
  MAX_CONTACT_VALUE,
  MAX_LABEL,
  RECORDABLE_CONSENT_STATUSES,
  type AddressType,
  type CommunicationPurpose,
  type ConsentKind,
  type ContactChannel,
  type RecordableConsentStatus,
} from './domain/customer-profile';
export type {
  GovernanceRecordCreated,
  LifecycleChanged,
  RestrictionImposed,
  TagAssigned,
} from './application/customer-governance-service';
export {
  ALERT_SEVERITIES,
  ALERT_TYPES,
  CUSTOMER_NOTE_ENTITY_TYPE,
  LIFECYCLE_TRANSITIONS,
  MAX_ALERT_MESSAGE,
  MAX_NOTE_BODY,
  MAX_REASON,
  MAX_SEGMENT_CODE,
  MIN_REASON,
  NOTE_CLASSIFICATIONS,
  NOTE_VISIBILITIES,
  RESTRICTION_TYPES,
  SETTABLE_LIFECYCLE_STATES,
  type AlertSeverity,
  type AlertType,
  type NoteClassification,
  type NoteVisibility,
  type RestrictionType,
  type SettableLifecycleState,
} from './domain/customer-governance';
export type {
  MergeResult,
  ReviewResult,
  ScanResult,
  VehicleLinkResult,
} from './application/customer-identity-service';
export type { DuplicateCandidateEntry } from './data/customer-identity-repository';
export {
  CANDIDATE_THRESHOLD,
  DUPLICATE_DECISIONS,
  DUPLICATE_STATUSES,
  MATCH_SIGNALS,
  TIMELINE_EVENT_TYPES,
  VEHICLE_RELATIONSHIP_ROLES,
  type DuplicateDecision,
  type DuplicateStatus,
  type TimelineEventType,
  type VehicleRelationshipRole,
} from './domain/customer-identity';
export {
  CUSTOMER_PARTY_TYPES,
  CUSTOMER_LIFECYCLE_STATUSES,
  MAX_NAME_FRAGMENT,
  type CustomerPartyType,
  type CustomerLifecycleStatus,
} from './domain/customer-search';
export {
  CREATABLE_LIFECYCLE_STATUSES,
  MAX_PERSON_NAME,
  MAX_COMPANY_NAME,
  type CreatableLifecycleStatus,
} from './domain/customer-creation';

/**
 * Composition root: constructs the module's services once per process.
 *
 * Customer numbering is borrowed from the shared-services module through its
 * public surface (`@/modules/shared-services`) — CRM does not own a sequence
 * implementation, and re-implementing one would give the platform two ways to
 * allocate a number that could drift apart.
 */
export const crmModule = composeModule({
  module: 'crm',
  create: () => {
    const customers = new CustomerRepository();
    return {
      customerSearch: new CustomerSearchService(new CustomerSearchRepository()),
      customerCreation: new CustomerCreationService(customers, sharedServicesModule().numbers),
      customerProfile: new CustomerProfileService(new CustomerProfileRepository()),
      customerGovernance: new CustomerGovernanceService(new CustomerGovernanceRepository()),
      customerIdentity: new CustomerIdentityService(new CustomerIdentityRepository()),
      customerRead: new CustomerReadService(new CustomerReadRepository()),
    };
  },
});
