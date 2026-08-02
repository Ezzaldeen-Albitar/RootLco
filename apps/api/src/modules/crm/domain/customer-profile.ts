/**
 * CRM customer profile components — domain contract (Phase 1-16, FR-CRM-002,
 * FR-CRM-004, P1-16-BE-004…007).
 *
 * Contacts, addresses, preferences, and consents are all *children of one
 * customer*. The rule that matters most for all four is the same, and it is
 * structural rather than a validation nicety:
 *
 * ## The parent comes from the path, never from the body
 *
 * Every route in this group is nested under `/customers/{customerId}`. The
 * customer id is read from the path and the body schemas are `.strict()`, so a
 * request carrying `partnerId` or `tenantId` is refused outright rather than
 * silently ignored. That closes re-parenting — attaching a contact, address,
 * preference, or consent to a customer other than the one addressed — as a
 * shape, not as a check someone has to remember to write per handler.
 *
 * ## A preference is not consent
 *
 * `crm.communication_preferences` records how a customer would *like* to be
 * contacted; `crm.consent_history` records whether the tenant is *allowed* to.
 * The database says so in its own table comment, and the split is preserved
 * here: setting a preference never writes consent history, and recording
 * consent never rewrites a preference. Collapsing the two would let an
 * operational convenience silently manufacture a legal permission.
 */
import { normalizeEmail, normalizePhone } from '@/modules/shared-services';

/** Values `ck_contact_points_channel` accepts. */
export const CONTACT_CHANNELS = ['phone', 'mobile', 'email', 'other'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** Values `ck_addresses_type` accepts. */
export const ADDRESS_TYPES = ['billing', 'service', 'registered', 'other'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

/** Values `ck_communication_preferences_purpose` accepts. */
export const COMMUNICATION_PURPOSES = ['transactional', 'marketing', 'reminder'] as const;
export type CommunicationPurpose = (typeof COMMUNICATION_PURPOSES)[number];

/** Values `ck_consent_history_kind` accepts. */
export const CONSENT_KINDS = ['privacy', 'marketing'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/**
 * Consent statuses a **caller** may record.
 *
 * `expired` is deliberately absent: expiry is something that happens to a
 * consent with the passage of time, not something an operator asserts. Allowing
 * it here would let a caller retire a live consent by relabelling it instead of
 * withdrawing it, losing the distinction between "the customer said no" and
 * "the permission lapsed".
 */
export const RECORDABLE_CONSENT_STATUSES = ['granted', 'withdrawn'] as const;
export type RecordableConsentStatus = (typeof RECORDABLE_CONSENT_STATUSES)[number];

/** Local part, `@`, dotted domain. Deliberately permissive — see `toContactPoint`. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const MAX_CONTACT_VALUE = 254;
export const MAX_ADDRESS_LINE = 200;
export const MAX_LABEL = 60;

/** Raised for a rule the edge schema cannot express. Mirrors customer-creation. */
export class CustomerProfileError extends Error {
  constructor(
    readonly path: string,
    readonly rule: string,
    message: string
  ) {
    super(message);
    this.name = 'CustomerProfileError';
  }
}

export interface ContactPointInput {
  readonly channel: ContactChannel;
  readonly value: string;
  readonly label?: string | null | undefined;
  readonly isPrimary?: boolean | undefined;
}

export interface NormalizedContactPoint {
  readonly channel: ContactChannel;
  /** What the database matches and de-duplicates on. */
  readonly normalizedValue: string;
  /** What the customer actually gave us, preserved for display. */
  readonly rawValue: string;
  readonly label: string | null;
  readonly isPrimary: boolean;
}

/**
 * Normalises a contact value with the **same** functions the rest of the
 * platform uses (P1-15 `shared-services` domain), so a phone number stored by
 * CRM and one matched by a search elsewhere cannot disagree about what "the
 * same number" means.
 */
export function toContactPoint(input: ContactPointInput): NormalizedContactPoint {
  const raw = input.value.trim();
  if (raw === '') {
    throw new CustomerProfileError('body.value', 'blank', 'Contact value must not be blank');
  }

  let normalized: string | null;
  if (input.channel === 'email') {
    // `normalizeEmail` lower-cases and trims; it deliberately does **not**
    // validate, because it is also used for lookup keys where refusing an odd
    // value would hide a row rather than protect anything. A contact channel is
    // different: it is something the workshop will actually try to send to, so
    // the shape check belongs here. Kept minimal on purpose — a local part, an
    // `@`, and a dotted domain. Anything stricter starts rejecting addresses
    // that genuinely deliver.
    normalized = normalizeEmail(raw);
    if (normalized === null || !EMAIL_SHAPE.test(normalized)) {
      throw new CustomerProfileError('body.value', 'invalid_email', 'Value is not a usable email');
    }
  } else if (input.channel === 'phone' || input.channel === 'mobile') {
    const result = normalizePhone(raw);
    if (result.normalized === null) {
      throw new CustomerProfileError(
        'body.value',
        'invalid_phone',
        'Value contains no usable phone digits'
      );
    }
    // `plausible: false` is advice, not a refusal — a short internal extension
    // is a real contact value even though it is not a dialable number.
    normalized = result.normalized;
  } else {
    normalized = raw.toLowerCase();
  }

  return {
    channel: input.channel,
    normalizedValue: normalized,
    rawValue: raw,
    label: input.label === undefined || input.label === null ? null : input.label.trim() || null,
    isPrimary: input.isPrimary ?? false,
  };
}

export interface AddressInput {
  readonly addressType: AddressType;
  readonly line1: string;
  readonly line2?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly region?: string | null | undefined;
  readonly postalCode?: string | null | undefined;
  /** ISO-3166-1 alpha-2. Format-only: no country reference table exists yet. */
  readonly countryCode?: string | null | undefined;
  readonly isPrimary?: boolean | undefined;
}

export interface NormalizedAddress extends Omit<AddressInput, 'countryCode' | 'isPrimary'> {
  readonly line1: string;
  readonly countryCode: string | null;
  readonly isPrimary: boolean;
}

export function toAddress(input: AddressInput): NormalizedAddress {
  const line1 = input.line1.trim();
  if (line1 === '') {
    throw new CustomerProfileError('body.line1', 'blank', 'First address line must not be blank');
  }
  const countryCode =
    input.countryCode === undefined || input.countryCode === null
      ? null
      : input.countryCode.trim().toUpperCase();
  if (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode)) {
    // Mirrors `ck_addresses_country_format`, refused here so the caller gets an
    // explained 422 rather than a constraint violation.
    throw new CustomerProfileError(
      'body.countryCode',
      'invalid_country_code',
      'Country code must be two letters (ISO-3166-1 alpha-2)'
    );
  }
  return {
    ...input,
    line1,
    countryCode,
    isPrimary: input.isPrimary ?? false,
  };
}
