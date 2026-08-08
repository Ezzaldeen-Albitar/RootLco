/**
 * CRM customer READ service (P1-16 remediation, `P1-27-INT-001`).
 *
 * Nine reads: the customer itself and its eight components. Every one of them
 * makes the same opening move as the write services — resolve the customer under
 * the caller's tenant, or `ERR-RES-001` — so an id belonging to another tenant, a
 * soft-deleted customer, a merged-away customer, and an id that never existed all
 * produce the identical 404.
 *
 * ## Why the parent lookup is not skipped for the component lists
 *
 * It would be tempting: the component queries already carry `tenant_id` and
 * `partner_id` predicates, so a foreign customer's contacts return zero rows
 * anyway. But "zero rows" and "not your customer" are different answers, and the
 * difference is readable. A caller probing ids would see an empty list for a
 * customer that exists in another tenant and an empty list for one that does not
 * exist — indistinguishable, which is fine — but a *populated* list is only
 * possible for a customer they may see, and an empty 200 tells them the id was at
 * least well-formed and reachable. Making every component read 404 on an
 * unresolvable parent removes the distinction entirely, and costs one indexed
 * lookup.
 *
 * ## No audit records
 *
 * `auditClass: 'none'`, matching every other CRM read. The platform audits
 * `security`-class reads only where the data itself is gated behind
 * `iam.sensitive.view` and *who looked* is the fact worth keeping — the `wo`
 * additional-work description is the precedent. None of these nine reads is that:
 * the CRM tables carry plain tenant-scoped SELECT policies. `shared.notes` is the
 * one exception and it protects itself in the policy rather than needing a read
 * record here.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  ADDRESS_ORDERING,
  ALERT_ORDERING,
  CONSENT_ORDERING,
  CONTACT_ORDERING,
  NOTE_ORDERING,
  PREFERENCE_ORDERING,
  RESTRICTION_ORDERING,
  TAG_ORDERING,
  type AddressEntry,
  type AlertEntry,
  type ConsentEntry,
  type ContactPointEntry,
  type CustomerDetailRow,
  type CustomerDisplayIdentity,
  type CustomerReadRepository,
  type NoteEntry,
  type PreferenceEntry,
  type RestrictionEntry,
  type TagEntry,
} from '../data/customer-read-repository';
import { CUSTOMER_NOTE_ENTITY_TYPE } from '../domain/customer-governance';

/** Already-validated `?cursor=&limit=` input. */
export interface ListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * A note page, plus whether the caller is seeing all of them.
 *
 * `sel_notes_tenant` hides `restricted` and `secret` notes from a caller without
 * `iam.sensitive.view`, and hides them *silently* — the list is simply shorter.
 * A screen that cannot tell the difference between "there are three notes" and
 * "there are three notes you may see" will state the first and be wrong.
 *
 * The flag says whether the caller holds the capability. It deliberately does NOT
 * say how many notes were withheld: that count is itself information about
 * restricted material, and a screen only needs to know whether to caveat itself.
 */
export interface NotePage extends Page<NoteEntry> {
  readonly includesRestricted: boolean;
}

export class CustomerReadService extends ApplicationService {
  protected readonly module = 'crm';

  constructor(private readonly reads: CustomerReadRepository) {
    super();
  }

  /** The customer profile header. 404 for absent, deleted, merged, other-tenant. */
  async readCustomer(db: DbHandle, customerId: string): Promise<CustomerDetailRow> {
    const customer = await this.reads.findCustomerDetail(db, customerId);
    if (!customer) {
      throw new AppFailure('ERR-RES-001', { message: 'Customer was not found' });
    }
    return customer;
  }

  /**
   * Display identity for a set of partner ids — the CRM module's answer to
   * "who is this?" for a module that legitimately holds partner ids and must not
   * show them (`P1-27-INT-025`).
   *
   * Exposed on the module's PUBLIC surface so the vehicle module can compose it
   * rather than reaching into `crm.business_partners` with its own SQL. No `veh`
   * repository touches a CRM table today, and adding the first cross-schema join
   * inside a bug fix would set a precedent that outlives the fix.
   *
   * Unlike `readCustomer` this does NOT throw for an id it cannot resolve. A
   * relationship may reference a partner the caller cannot see, and that is a
   * sentence for the screen to say, not a request to fail. Unresolved ids are
   * absent from the map.
   */
  async resolveDisplayIdentities(
    db: DbHandle,
    partnerIds: readonly string[]
  ): Promise<ReadonlyMap<string, CustomerDisplayIdentity>> {
    return this.reads.findDisplayIdentities(db, partnerIds);
  }

  async listContacts(
    db: DbHandle,
    customerId: string,
    query: ListQuery
  ): Promise<Page<ContactPointEntry>> {
    await this.requireCustomer(db, customerId);
    return this.reads.listContacts(db, customerId, pageRequest(CONTACT_ORDERING, query));
  }

  async listAddresses(
    db: DbHandle,
    customerId: string,
    query: ListQuery
  ): Promise<Page<AddressEntry>> {
    await this.requireCustomer(db, customerId);
    return this.reads.listAddresses(db, customerId, pageRequest(ADDRESS_ORDERING, query));
  }

  async listPreferences(
    db: DbHandle,
    customerId: string,
    query: ListQuery
  ): Promise<Page<PreferenceEntry>> {
    await this.requireCustomer(db, customerId);
    return this.reads.listPreferences(db, customerId, pageRequest(PREFERENCE_ORDERING, query));
  }

  async listConsents(
    db: DbHandle,
    customerId: string,
    query: ListQuery
  ): Promise<Page<ConsentEntry>> {
    await this.requireCustomer(db, customerId);
    return this.reads.listConsents(db, customerId, pageRequest(CONSENT_ORDERING, query));
  }

  async listNotes(db: DbHandle, customerId: string, query: ListQuery): Promise<NotePage> {
    await this.requireCustomer(db, customerId);
    const page = await this.reads.listNotes(
      db,
      customerId,
      CUSTOMER_NOTE_ENTITY_TYPE,
      pageRequest(NOTE_ORDERING, query)
    );
    return { ...page, includesRestricted: await this.reads.mayViewSensitiveNotes(db) };
  }

  async listAlerts(db: DbHandle, customerId: string, query: ListQuery): Promise<Page<AlertEntry>> {
    await this.requireCustomer(db, customerId);
    return this.reads.listAlerts(db, customerId, pageRequest(ALERT_ORDERING, query));
  }

  async listTags(db: DbHandle, customerId: string, query: ListQuery): Promise<Page<TagEntry>> {
    await this.requireCustomer(db, customerId);
    return this.reads.listTags(db, customerId, pageRequest(TAG_ORDERING, query));
  }

  async listRestrictions(
    db: DbHandle,
    customerId: string,
    query: ListQuery
  ): Promise<Page<RestrictionEntry>> {
    await this.requireCustomer(db, customerId);
    return this.reads.listRestrictions(db, customerId, pageRequest(RESTRICTION_ORDERING, query));
  }

  /** 404 for absent, deleted, merged, and other-tenant alike. */
  private async requireCustomer(db: DbHandle, customerId: string): Promise<void> {
    const found = await this.reads.requireLiveCustomer(db, customerId);
    if (!found) {
      throw new AppFailure('ERR-RES-001', { message: 'Customer was not found' });
    }
  }
}
