/**
 * The CRM customer profile and its component reads (`FE-006`…`FE-014`).
 *
 * Every field below was read out of
 * `apps/api/src/modules/crm/data/customer-read-repository.ts`, which this phase's
 * own Backend remediation added (`P1-27-INT-001`, PR #192). Nothing here is
 * inferred.
 *
 * ## The operations
 *
 * | operation               | method | path                                | permission          |
 * | ----------------------- | ------ | ----------------------------------- | ------------------- |
 * | `crm.customer-read`     | GET    | `/customers/{id}`                   | `crm.customer.read` |
 * | `crm.contact-list`      | GET    | `/customers/{id}/contacts`          | `crm.customer.read` |
 * | `crm.address-list`      | GET    | `/customers/{id}/addresses`         | `crm.customer.read` |
 * | `crm.preference-list`   | GET    | `/customers/{id}/preferences`       | `crm.customer.read` |
 * | `crm.consent-list`      | GET    | `/customers/{id}/consents`          | `crm.customer.read` |
 * | `crm.note-list`         | GET    | `/customers/{id}/notes`             | `crm.customer.read` |
 * | `crm.alert-list`        | GET    | `/customers/{id}/alerts`            | `crm.customer.read` |
 * | `crm.tag-list`          | GET    | `/customers/{id}/tags`              | `crm.customer.read` |
 * | `crm.restriction-list`  | GET    | `/customers/{id}/restrictions`      | `crm.customer.read` |
 * | `crm.customer-timeline` | GET    | `/customers/{id}/timeline`          | `crm.customer.read` |
 *
 * Every one is `auditClass: 'none'`, tenant-scoped, and cursor-paginated except
 * the detail read.
 *
 * ## Four properties the screens must not get wrong
 *
 * **404 is identical for four different truths.** Absent, soft-deleted, merged
 * away, and belonging to another tenant all answer `ERR-RES-001`. That is
 * deliberate — it stops the endpoint being an existence oracle — so the screen
 * must say "not found" and must NOT speculate about which of the four it was.
 *
 * **`recordVersion` is published, and it is the point.** The detail read returns
 * it and the handler emits it as an `ETag`. Before `P1-27-INT-001` no operation
 * published it, so every write was a last-writer-wins race with no way for a
 * client to detect the conflict.
 *
 * **A shorter note list is not a complete one.** `sel_notes_tenant` hides
 * `restricted` and `secret` notes from a caller without `iam.sensitive.view`,
 * and hides them silently. The response carries `includesRestricted` so a screen
 * can caveat itself rather than state a count it cannot support.
 *
 * **Alert severity is `text` with a CHECK, not an enum.** Sorting it
 * alphabetically ranks `info` above `warning`. The backend orders by an explicit
 * rank and the screen must not re-sort by label.
 */

/** `crm.business_partners.party_type`. */
export type PartyType = 'individual' | 'organization';

/** The customer profile header. */
export interface CustomerDetail {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly displayName: string;
  readonly partyType: PartyType;
  readonly lifecycleStatus: string;
  readonly commercialStatus: string;
  /** The optimistic-concurrency token. Sent as `If-Match` on a later write. */
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  /** Individual profile fields; null for an organization. */
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly preferredLocale: string | null;
  /** Company profile fields; null for an individual. */
  readonly legalName: string | null;
  readonly tradeName: string | null;
}

export interface ContactPoint {
  readonly id: string;
  readonly channel: string;
  /** As the operator typed it. `null` when only the normalised form was kept. */
  readonly rawValue: string | null;
  readonly normalizedValue: string;
  readonly label: string | null;
  readonly isPrimary: boolean;
  readonly status: string;
  readonly verifiedAt: string | null;
  readonly createdAt: string;
}

export interface Address {
  readonly id: string;
  readonly addressType: string;
  readonly line1: string;
  readonly line2: string | null;
  /** `crm.addresses` carries it; the POST cannot set it (`P1-16-A-01`). */
  readonly line3: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
  /**
   * **Nullable**, because `crm.addresses.country_code` is and the POST accepts
   * it as optional. It was typed `string` once and corrected in `P1-27-INT-006`
   * — a consumer calling `.toUpperCase()` on it compiled and threw at runtime.
   */
  readonly countryCode: string | null;
  readonly isPrimary: boolean;
  readonly status: string;
  readonly createdAt: string;
}

export interface Preference {
  readonly id: string;
  readonly channel: string;
  readonly purpose: string;
  readonly preferred: boolean;
  readonly preferredLocale: string | null;
  /** The column carries it; the PUT cannot set it (`P1-16-A-01`). */
  readonly quietHoursNote: string | null;
  /** What a client puts in `If-Match` on the preferences PUT. */
  readonly recordVersion: number;
  readonly createdAt: string;
}

/**
 * One consent decision.
 *
 * `crm.consent_history` is **append-only**: a withdrawal is a new row, never an
 * edit. The read returns the whole history rather than a collapsed current
 * answer, because the sequence of decisions is what makes a consent defensible.
 *
 * `seq` is `bigint` and stays a **string**. Two decisions written in one
 * transaction share `effective_at` to the microsecond, and `seq` is the only
 * field that says which came second.
 */
export interface Consent {
  readonly id: string;
  readonly consentKind: string;
  readonly channel: string | null;
  readonly purpose: string | null;
  readonly status: string;
  readonly source: string | null;
  readonly effectiveAt: string;
  readonly contactPointId: string | null;
  readonly evidenceDocumentId: string | null;
  readonly recordedBy: string;
  readonly seq: string;
}

export interface Note {
  readonly id: string;
  readonly body: string;
  readonly classification: string;
  readonly visibility: string;
  readonly authorId: string;
  readonly editedAt: string | null;
  readonly createdAt: string;
}

/**
 * One alert in force.
 *
 * `effectiveFrom` and `effectiveTo` are `date` columns read as `::text` — exact
 * days, never shifted by a timezone. `severity` is `text` with a CHECK, so it is
 * ranked by `SEVERITY_RANK` below and never sorted by label.
 */
export interface Alert {
  readonly id: string;
  readonly alertType: string;
  readonly severity: string;
  readonly message: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgedAt: string | null;
}

export interface Tag {
  readonly id: string;
  readonly segmentId: string;
  readonly segmentCode: string;
  readonly name: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly assignedAt: string;
  readonly assignedBy: string;
}

export interface Restriction {
  readonly id: string;
  readonly restrictionType: string;
  readonly reason: string;
  readonly approvalRef: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly imposedBy: string;
}

/**
 * Severity, ranked by meaning rather than by spelling.
 *
 * `crm.customer_alerts.severity` is `text` with a CHECK — `info`, `warning`,
 * `critical` — not an enum. Sorted alphabetically that is critical, info,
 * warning, which ranks **`info` above `warning`**. The Backend already orders by
 * an explicit rank; this exists so a screen that highlights or groups by
 * severity uses the same meaning rather than re-deriving one from the label.
 *
 * An unknown value sorts last rather than first: a severity this build has not
 * heard of must not outrank a `critical` it understands.
 */
export const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
}

/** `crm.contact_points.channel` — the CHECK constraint's vocabulary. */
export const CONTACT_CHANNELS = ['phone', 'mobile', 'email', 'other'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** `crm.addresses.address_type`. */
export const ADDRESS_TYPES = ['billing', 'shipping', 'site', 'other'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

export const MAX_CONTACT_VALUE = 320;
export const MAX_LABEL = 60;
export const MAX_ADDRESS_LINE = 200;

/**
 * Formats an address for display, in the order the fields are published.
 *
 * No country-specific format is invented: the platform serves more than one
 * country and guessing at a local ordering produces an address that is subtly
 * wrong for everyone it was not written for. Empty parts are dropped rather than
 * leaving blank lines.
 *
 * `countryCode` is passed through **as stored**. Upper-casing it would be a
 * presentational guess about a column the backend does not normalise, and doing
 * it unguarded is what `P1-27-INT-006` corrected.
 */
export function addressLines(address: Address): readonly string[] {
  return [
    address.line1,
    address.line2,
    address.line3,
    [address.city, address.region].filter(Boolean).join(', ') || null,
    address.postalCode,
    address.countryCode,
  ].filter((part): part is string => Boolean(part && part.trim()));
}
