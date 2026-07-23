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
import { CustomerSearchService } from './application/customer-search-service';
import { CustomerCreationService } from './application/customer-creation-service';

export type { CustomerSearchHit, CustomerSearchInput } from './application/customer-search-service';
export type { CreatedCustomer } from './application/customer-creation-service';
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
    };
  },
});
