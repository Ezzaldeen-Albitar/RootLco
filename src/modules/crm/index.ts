/**
 * `crm` module — public surface (Phase 1-16).
 *
 * The ONLY legal import path for this module (ADR-001): the boundary checker and
 * the ESLint rule both reject `@/modules/crm/<anything>`. It exports behaviour
 * (composed services) and types/contract constants — never repositories, pools,
 * or SQL.
 */
import { composeModule } from '@/server/layering';
import { CustomerSearchRepository } from './data/customer-search-repository';
import { CustomerSearchService } from './application/customer-search-service';

export type { CustomerSearchHit, CustomerSearchInput } from './application/customer-search-service';
export {
  CUSTOMER_PARTY_TYPES,
  CUSTOMER_LIFECYCLE_STATUSES,
  MAX_NAME_FRAGMENT,
  type CustomerPartyType,
  type CustomerLifecycleStatus,
} from './domain/customer-search';

/** Composition root: constructs the module's services once per process. */
export const crmModule = composeModule({
  module: 'crm',
  create: () => ({
    customerSearch: new CustomerSearchService(new CustomerSearchRepository()),
  }),
});
