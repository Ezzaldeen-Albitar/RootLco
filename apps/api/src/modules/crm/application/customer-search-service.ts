/**
 * CRM customer search — application service (Phase 1-16, FR-CRM-001).
 *
 * The use case, one call deep: turn edge-validated inputs into the closed domain
 * filter, resolve the page request against the frozen ordering contract, and ask
 * the repository. It opens no transaction (a read runs on the pipeline-provided
 * read handle), and the operation's permission (`crm.customer.read`) was already
 * enforced by the request pipeline before this method runs.
 *
 * One extra question is asked here (P1-32): whether the caller additionally holds
 * `iam.sensitive.view`, which decides whether the projected phone number is
 * masked. It is NOT an operation permission — a caller without it still gets the
 * page, with the phone masked to its last four digits — so it cannot be declared
 * on the operation and has to be evaluated inside the use case.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  CUSTOMER_SEARCH_ORDERING,
  toCustomerSearchFilter,
  type CustomerSearchHit,
  type CustomerSearchInput,
} from '../domain/customer-search';
import type { CustomerSearchRepository } from '../data/customer-search-repository';

export type { CustomerSearchHit, CustomerSearchInput } from '../domain/customer-search';

export class CustomerSearchService extends ApplicationService {
  protected readonly module = 'crm';

  constructor(private readonly customers: CustomerSearchRepository) {
    super();
  }

  async search(
    db: DbHandle,
    input: CustomerSearchInput,
    pageInput: { cursor?: string | undefined; limit?: number | undefined }
  ): Promise<Page<CustomerSearchHit>> {
    const filter = toCustomerSearchFilter(input);
    const page = pageRequest(CUSTOMER_SEARCH_ORDERING, pageInput);
    // Asked ONCE per request, not once per row: the answer is a property of the
    // caller, and asking it inside the projection would run one authorization
    // query per hit for a value that cannot change between them.
    const unmaskedPhone = await this.customers.mayViewContactDetail(db);
    return this.customers.search(db, page, filter, unmaskedPhone);
  }
}
