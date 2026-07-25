/**
 * CRM customer profile components — application service (Phase 1-16,
 * P1-16-BE-004…007).
 *
 * Contacts, addresses, preferences, and consents. All four share one opening
 * move — resolve the customer under the caller's tenant, or 404 — and one
 * closing move: an audit record inside the caller's transaction.
 *
 * ## Why every method starts with the same lookup
 *
 * The path carries a customer id a caller chose. Resolving it against the
 * tenant before writing anything is what makes the group safe against IDOR: an
 * id belonging to another tenant, a soft-deleted customer, and an id that never
 * existed all produce the identical `ERR-RES-001`, so the endpoints answer
 * "no" without answering "…but it exists somewhere".
 *
 * ## Consent is the only one that emits an event
 *
 * Adding a phone number is CRM's business. A consent decision is not: it changes
 * what the *whole platform* may do to that customer, so notification and
 * marketing consumers have to hear about it. Contacts, addresses, and
 * preferences stay audited-but-silent rather than manufacturing events nobody
 * subscribes to.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type {
  ConsentInput,
  CustomerProfileRepository,
  PreferenceInput,
} from '../data/customer-profile-repository';
import {
  CustomerProfileError,
  toAddress,
  toContactPoint,
  type AddressInput,
  type ContactPointInput,
} from '../domain/customer-profile';

export interface ProfileComponentCreated {
  readonly id: string;
  readonly customerId: string;
}

export interface ConsentRecorded extends ProfileComponentCreated {
  readonly status: string;
  /** What the effective consent was before this record. `null` if never set. */
  readonly previousStatus: string | null;
}

export class CustomerProfileService extends ApplicationService {
  protected readonly module = 'crm';

  constructor(private readonly profiles: CustomerProfileRepository) {
    super();
  }

  async addContactPoint(
    db: DbHandle,
    customerId: string,
    input: ContactPointInput
  ): Promise<ProfileComponentCreated> {
    await this.requireCustomer(db, customerId);
    const contact = this.normalizeOrFail(() => toContactPoint(input));

    if (contact.isPrimary) {
      await this.profiles.demotePrimaryContact(db, customerId, contact.channel);
    }
    const id = await this.profiles.insertContactPoint(db, customerId, contact);
    if (!id) {
      throw new AppFailure('ERR-IAM-001', { message: 'Contact creation was refused by policy' });
    }

    await appendAudit(db, {
      action: 'crm.customer.contact_added',
      entityType: 'crm.contact_point',
      entityId: id,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        { field: 'channel', classification: 'public', value: contact.channel },
        // The contact value itself is personal data and is not copied into the
        // audit trail; the record points at the row that holds it.
        { field: 'is_primary', classification: 'public', value: String(contact.isPrimary) },
      ],
    });
    return { id, customerId };
  }

  async addAddress(
    db: DbHandle,
    customerId: string,
    input: AddressInput
  ): Promise<ProfileComponentCreated> {
    await this.requireCustomer(db, customerId);
    const address = this.normalizeOrFail(() => toAddress(input));

    if (address.isPrimary) {
      await this.profiles.demotePrimaryAddress(db, customerId, address.addressType);
    }
    const id = await this.profiles.insertAddress(db, customerId, address);
    if (!id) {
      throw new AppFailure('ERR-IAM-001', { message: 'Address creation was refused by policy' });
    }

    await appendAudit(db, {
      action: 'crm.customer.address_added',
      entityType: 'crm.address',
      entityId: id,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        { field: 'address_type', classification: 'public', value: address.addressType },
        { field: 'country_code', classification: 'public', value: address.countryCode },
      ],
    });
    return { id, customerId };
  }

  async setPreference(
    db: DbHandle,
    customerId: string,
    input: PreferenceInput
  ): Promise<ProfileComponentCreated> {
    await this.requireCustomer(db, customerId);

    let result: { id: string; previouslyPreferred: boolean | null };
    try {
      result = await this.profiles.upsertPreference(db, customerId, input);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'Preferred locale is not a registered platform language',
          safeDetails: {
            violations: [{ path: 'body.preferredLocale', rule: 'unknown_reference' }],
          },
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'crm.customer.preference_changed',
      entityType: 'crm.communication_preference',
      entityId: result.id,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        { field: 'channel', classification: 'public', value: input.channel },
        { field: 'purpose', classification: 'public', value: input.purpose },
        {
          field: 'preferred',
          classification: 'public',
          previousValue:
            result.previouslyPreferred === null ? null : String(result.previouslyPreferred),
          value: String(input.preferred),
        },
      ],
    });
    return { id: result.id, customerId };
  }

  async recordConsent(
    db: DbHandle,
    customerId: string,
    input: ConsentInput
  ): Promise<ConsentRecorded> {
    await this.requireCustomer(db, customerId);

    // Read the prior effective status *before* appending, so the audit record
    // and the event both carry a truthful transition rather than a bare "now
    // granted" that a reader cannot interpret.
    const previousStatus = await this.profiles.currentConsentStatus(db, customerId, {
      consentKind: input.consentKind,
      channel: input.channel,
      purpose: input.purpose,
    });

    let id: string | null;
    try {
      id = await this.profiles.insertConsent(db, customerId, input);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        // The only caller-supplied reference is the contact point, and its FK is
        // `(tenant_id, partner_id, id)` — so a contact belonging to a different
        // customer fails here rather than being silently attached.
        throw new AppFailure('ERR-VAL-001', {
          message: 'Contact point does not belong to this customer',
          safeDetails: { violations: [{ path: 'body.contactPointId', rule: 'not_owned' }] },
        });
      }
      throw error;
    }
    if (!id) {
      throw new AppFailure('ERR-IAM-001', { message: 'Consent record was refused by policy' });
    }

    await appendAudit(db, {
      action: 'crm.customer.consent_changed',
      entityType: 'crm.consent_history',
      entityId: id,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        { field: 'consent_kind', classification: 'public', value: input.consentKind },
        { field: 'channel', classification: 'public', value: input.channel },
        { field: 'purpose', classification: 'public', value: input.purpose },
        {
          field: 'status',
          classification: 'public',
          previousValue: previousStatus,
          value: input.status,
        },
      ],
    });

    await publishEvent(db, {
      eventType: 'consent.changed',
      aggregateId: customerId,
      aggregateVersion: 1,
      producer: 'crm.customer-profile-service',
      payload: {
        customerId,
        consentKind: input.consentKind,
        channel: input.channel,
        purpose: input.purpose,
        status: input.status,
        previousStatus,
      },
      // The consent row id, not the customer id: two decisions about the same
      // dimension tuple are distinct events and must both be delivered.
      eventKey: `consent.changed:${id}`,
    });

    return { id, customerId, status: input.status, previousStatus };
  }

  /** 404 for absent, deleted, merged, and other-tenant alike. */
  private async requireCustomer(db: DbHandle, customerId: string): Promise<void> {
    const found = await this.profiles.findLiveCustomer(db, customerId);
    if (!found) {
      throw new AppFailure('ERR-RES-001', { message: 'Customer was not found' });
    }
  }

  private normalizeOrFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof CustomerProfileError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
