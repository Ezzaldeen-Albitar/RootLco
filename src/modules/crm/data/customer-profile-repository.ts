/**
 * CRM customer profile-component repository (Phase 1-16, P1-16-BE-004…007).
 *
 * Contacts, addresses, preferences, and consents. Every statement stamps
 * `tenant_id` and `created_by` from the resolved context, and every one is
 * scoped by `partner_id` taken from the route path — a caller-supplied parent
 * never reaches SQL.
 *
 * `requireLiveCustomer()` is the gate all four writes pass through first. The
 * composite FKs `(tenant_id, partner_id)` would already refuse a cross-tenant
 * parent, but a foreign-key violation is a 500-shaped accident; resolving the
 * customer first turns "not yours" and "does not exist" into the *same* 404, so
 * the endpoint cannot be used to test whether a customer id exists in another
 * tenant.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type {
  CommunicationPurpose,
  ConsentKind,
  ContactChannel,
  NormalizedAddress,
  NormalizedContactPoint,
  RecordableConsentStatus,
} from '../domain/customer-profile';

export interface PreferenceInput {
  readonly channel: ContactChannel;
  readonly purpose: CommunicationPurpose;
  readonly preferred: boolean;
  readonly preferredLocale: string | null;
}

export interface ConsentInput {
  readonly consentKind: ConsentKind;
  readonly channel: ContactChannel;
  readonly purpose: CommunicationPurpose;
  readonly status: RecordableConsentStatus;
  readonly source: string | null;
  readonly contactPointId: string | null;
}

export class CustomerProfileRepository extends Repository {
  protected readonly module = 'crm';

  /**
   * Resolves a live, non-merged customer in the caller's tenant.
   *
   * Returns `null` for absent, soft-deleted, merged-away, and other-tenant —
   * four situations the caller must not be able to tell apart.
   */
  async findLiveCustomer(db: DbHandle, customerId: string): Promise<{ id: string } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT id FROM crm.business_partners
        WHERE tenant_id = $1 AND id = $2
          AND deleted_at IS NULL AND merged_into_id IS NULL`,
      [context.principal.tenantId, customerId]
    );
    return result.rows[0] ?? null;
  }

  async insertContactPoint(
    db: DbHandle,
    customerId: string,
    input: NormalizedContactPoint
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.contact_points
         (tenant_id, partner_id, channel, normalized_value, raw_value, label, is_primary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        customerId,
        input.channel,
        input.normalizedValue,
        input.rawValue,
        input.label,
        input.isPrimary,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Demotes the current primary for one `(customer, channel)`.
   *
   * `uq_contact_points_primary_active` allows exactly one, so promoting a new
   * primary without demoting the old one would raise a unique violation. Doing
   * it in the same transaction makes "make this the primary" a single atomic
   * intention rather than two steps a caller could half-complete.
   */
  async demotePrimaryContact(
    db: DbHandle,
    customerId: string,
    channel: ContactChannel
  ): Promise<void> {
    const context = this.assertContext(db);
    await this.run(
      db,
      `UPDATE crm.contact_points
          SET is_primary = false
        WHERE tenant_id = $1 AND partner_id = $2 AND channel = $3
          AND is_primary AND deleted_at IS NULL`,
      [context.principal.tenantId, customerId, channel]
    );
  }

  async insertAddress(
    db: DbHandle,
    customerId: string,
    input: NormalizedAddress
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.addresses
         (tenant_id, partner_id, address_type, line1, line2, city, region,
          postal_code, country_code, is_primary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        context.principal.tenantId,
        customerId,
        input.addressType,
        input.line1,
        input.line2 ?? null,
        input.city ?? null,
        input.region ?? null,
        input.postalCode ?? null,
        input.countryCode,
        input.isPrimary,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  async demotePrimaryAddress(db: DbHandle, customerId: string, addressType: string): Promise<void> {
    const context = this.assertContext(db);
    await this.run(
      db,
      `UPDATE crm.addresses
          SET is_primary = false
        WHERE tenant_id = $1 AND partner_id = $2 AND address_type = $3
          AND is_primary AND deleted_at IS NULL`,
      [context.principal.tenantId, customerId, addressType]
    );
  }

  /**
   * Sets one preference, keyed by `(customer, channel, purpose)`.
   *
   * An upsert rather than insert-or-fail: `uq_communication_preferences_dims`
   * makes the dimension tuple the identity of the preference, so "prefer email
   * for reminders" is a *state*, not an event log. Returns the previous value
   * so the audit record can carry a real before/after.
   */
  async upsertPreference(
    db: DbHandle,
    customerId: string,
    input: PreferenceInput
  ): Promise<{ id: string; previouslyPreferred: boolean | null }> {
    const context = this.assertContext(db);
    const existing = await this.run<{ preferred: boolean }>(
      db,
      `SELECT preferred FROM crm.communication_preferences
        WHERE tenant_id = $1 AND partner_id = $2 AND channel = $3 AND purpose = $4`,
      [context.principal.tenantId, customerId, input.channel, input.purpose]
    );

    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.communication_preferences
         (tenant_id, partner_id, channel, purpose, preferred, preferred_locale, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT uq_communication_preferences_dims
       DO UPDATE SET preferred = EXCLUDED.preferred,
                     preferred_locale = EXCLUDED.preferred_locale
       RETURNING id`,
      [
        context.principal.tenantId,
        customerId,
        input.channel,
        input.purpose,
        input.preferred,
        input.preferredLocale,
        context.principal.userId,
      ]
    );
    return {
      id: result.rows[0]?.id ?? '',
      previouslyPreferred: existing.rows[0]?.preferred ?? null,
    };
  }

  /**
   * Appends one consent record.
   *
   * `effective_at` is `now()` and `recorded_by` is server-stamped by
   * `crm.guard_consent_insert()` — neither is accepted from the caller, so a
   * request cannot back-date a grant to defeat a later withdrawal, nor attribute
   * a consent decision to someone else.
   */
  async insertConsent(
    db: DbHandle,
    customerId: string,
    input: ConsentInput
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.consent_history
         (tenant_id, partner_id, consent_kind, contact_point_id, channel, purpose,
          status, source, effective_at, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
       RETURNING id`,
      [
        context.principal.tenantId,
        customerId,
        input.consentKind,
        input.contactPointId,
        input.channel,
        input.purpose,
        input.status,
        input.source,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Most recent consent for the dimension tuple, or `null` if never recorded. */
  async currentConsentStatus(
    db: DbHandle,
    customerId: string,
    input: { consentKind: string; channel: string; purpose: string }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ status: string }>(
      db,
      `SELECT status FROM crm.consent_history
        WHERE tenant_id = $1 AND partner_id = $2 AND consent_kind = $3
          AND channel = $4 AND purpose = $5
        ORDER BY effective_at DESC, created_at DESC
        LIMIT 1`,
      [context.principal.tenantId, customerId, input.consentKind, input.channel, input.purpose]
    );
    return result.rows[0]?.status ?? null;
  }
}
