/**
 * The customer component WRITES (`FE-009`…`FE-014`).
 *
 * Every value here was read out of the owning route module's Zod schema and the
 * domain constants it imports, because **the published OpenAPI document cannot
 * be used for this**: it describes 238 operations, 152 of them mutations, and
 * publishes a `requestBody` for none of them (`P1-27-INT-004`). It remains the
 * authority for the one thing the client derives from it — which operations are
 * `idempotent: true` — and that stays generated and drift-checked.
 *
 * ## Six writes, six DIFFERENT permissions
 *
 * There is no blanket "customer write" capability. A role that may add a note
 * very often may not impose a restriction, and the interface has to reflect
 * that per section rather than showing six controls and failing five of them
 * after the operator has typed.
 *
 * | operation                | permission                        |
 * | ------------------------ | --------------------------------- |
 * | `crm.preference-set`     | `crm.customer.profile.write`      |
 * | `crm.consent-record`     | `crm.customer.consent.write`      |
 * | `crm.note-add`           | `crm.customer.note.write`         |
 * | `crm.alert-raise`        | `crm.customer.governance.manage`  |
 * | `crm.tag-assign`         | `crm.customer.governance.manage`  |
 * | `crm.restriction-impose` | `crm.customer.restriction.manage` |
 *
 * Hiding a control the caller cannot use is a courtesy, never the enforcement.
 * The Backend authorizes every call regardless of what this file says.
 *
 * ## All six are `idempotent: true`
 *
 * Including `crm.preference-set`, which is a **PUT** — one of the nine non-POST
 * idempotent operations that answered `400 ERR-INT-002` on every attempt before
 * `P1-27-INT-003`. The key comes from the shared contract-derived authority, so
 * these writes are the first real exercise of that fix.
 */

/** `crm.customer_alerts.alert_type`. */
export const ALERT_TYPES = ['operational', 'financial', 'safety', 'other'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** `crm.customer_alerts.severity` — ranked by `severityRank`, never by label. */
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** `crm.customer_restrictions.restriction_type`. */
export const RESTRICTION_TYPES = [
  'no_credit',
  'prepay_only',
  'no_service',
  'contact_restriction',
  'other',
] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

/** `shared.notes.classification`. Defaults to `internal` when unsent. */
export const NOTE_CLASSIFICATIONS = ['public', 'internal', 'restricted', 'secret'] as const;
export type NoteClassification = (typeof NOTE_CLASSIFICATIONS)[number];

/** `shared.notes.visibility`. Defaults to `internal` when unsent. */
export const NOTE_VISIBILITIES = ['internal', 'customer_visible'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const COMMUNICATION_PURPOSES = ['transactional', 'marketing', 'reminder'] as const;
export type CommunicationPurpose = (typeof COMMUNICATION_PURPOSES)[number];

export const CONSENT_KINDS = ['privacy', 'marketing'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/**
 * The consent statuses a CLIENT may record — two, not the three a consent row
 * can hold.
 *
 * `expired` is reachable in the data and is **not** offered here, because it is
 * a system transition rather than a decision anybody makes. Offering it would
 * let an operator retire a consent by declaring it expired, with none of the
 * evidence that makes a real expiry defensible.
 */
export const RECORDABLE_CONSENT_STATUSES = ['granted', 'withdrawn'] as const;
export type RecordableConsentStatus = (typeof RECORDABLE_CONSENT_STATUSES)[number];

export const MAX_NOTE_BODY = 10_000;
export const MAX_ALERT_MESSAGE = 1_000;
export const MIN_REASON = 10;
export const MAX_REASON = 500;
export const MAX_SEGMENT_CODE = 62;
export const MIN_SEGMENT_CODE = 2;
export const MAX_SEGMENT_NAME = 120;
export const MAX_CONSENT_SOURCE = 200;
export const MAX_APPROVAL_REF = 120;
export const MIN_PREFERRED_LOCALE = 2;
export const MAX_PREFERRED_LOCALE = 10;

/** The permission each write requires, exactly as the route registers it. */
export const WRITE_PERMISSIONS = {
  preference: 'crm.customer.profile.write',
  consent: 'crm.customer.consent.write',
  note: 'crm.customer.note.write',
  alert: 'crm.customer.governance.manage',
  tag: 'crm.customer.governance.manage',
  restriction: 'crm.customer.restriction.manage',
} as const;
export type WriteKind = keyof typeof WRITE_PERMISSIONS;

/** One field-level complaint, keyed by the field it belongs beside. */
export type FieldErrors = Readonly<Record<string, string>>;

/**
 * Validates a bounded free-text field the same way the route's Zod schema does.
 *
 * Length is counted on the TRIMMED value, because the Backend's
 * `btrim(...) <> ''` CHECK constraints mean a field of spaces is empty there
 * however long it looks here. A client that counted the untrimmed length would
 * accept `"   "` for a required reason and be rejected by the database.
 */
export function validateText(
  value: string,
  { min, max, required }: { min: number; max: number; required: boolean }
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return required ? 'required' : null;
  if (trimmed.length < min) return 'tooShort';
  if (trimmed.length > max) return 'tooLong';
  return null;
}

/**
 * Normalises an optional free-text field to what the route accepts.
 *
 * The Zod schemas type these as `.nullable().optional()`, so an empty box means
 * "not provided" and must become `undefined` rather than `''` — a `.strict()`
 * schema with `.min(1)` rejects the empty string outright, turning a blank
 * optional field into a 422 the operator cannot act on.
 */
export function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export interface NoteInput {
  readonly body: string;
  readonly classification?: NoteClassification;
  readonly visibility?: NoteVisibility;
}

export function validateNote(values: Record<string, string>): FieldErrors {
  const errors: Record<string, string> = {};
  const body = validateText(values.body ?? '', { min: 1, max: MAX_NOTE_BODY, required: true });
  if (body) errors.body = body;
  return errors;
}

export interface AlertInput {
  readonly alertType: AlertType;
  readonly severity: AlertSeverity;
  readonly message: string;
}

export function validateAlert(values: Record<string, string>): FieldErrors {
  const errors: Record<string, string> = {};
  const message = validateText(values.message ?? '', {
    min: 1,
    max: MAX_ALERT_MESSAGE,
    required: true,
  });
  if (message) errors.message = message;
  if (!ALERT_TYPES.includes(values.alertType as AlertType)) errors.alertType = 'required';
  if (!ALERT_SEVERITIES.includes(values.severity as AlertSeverity)) errors.severity = 'required';
  return errors;
}

export interface RestrictionInput {
  readonly restrictionType: RestrictionType;
  readonly reason: string;
  readonly approvalRef?: string;
}

export function validateRestriction(values: Record<string, string>): FieldErrors {
  const errors: Record<string, string> = {};
  // `MIN_REASON` is 10, not 1. A restriction stops work being done for a real
  // customer, and "no" is not a reason anybody can act on later.
  const reason = validateText(values.reason ?? '', {
    min: MIN_REASON,
    max: MAX_REASON,
    required: true,
  });
  if (reason) errors.reason = reason;
  if (!RESTRICTION_TYPES.includes(values.restrictionType as RestrictionType)) {
    errors.restrictionType = 'required';
  }
  const ref = validateText(values.approvalRef ?? '', {
    min: 1,
    max: MAX_APPROVAL_REF,
    required: false,
  });
  if (ref) errors.approvalRef = ref;
  return errors;
}

export interface TagInput {
  readonly segmentCode: string;
  readonly name?: string;
}

export function validateTag(values: Record<string, string>): FieldErrors {
  const errors: Record<string, string> = {};
  const code = validateText(values.segmentCode ?? '', {
    min: MIN_SEGMENT_CODE,
    max: MAX_SEGMENT_CODE,
    required: true,
  });
  if (code) errors.segmentCode = code;
  const name = validateText(values.name ?? '', { min: 1, max: MAX_SEGMENT_NAME, required: false });
  if (name) errors.name = name;
  return errors;
}

export interface PreferenceInput {
  readonly channel: string;
  readonly purpose: CommunicationPurpose;
  readonly preferred: boolean;
  readonly preferredLocale?: string | null;
}

export function validatePreference(values: Record<string, string>): FieldErrors {
  const errors: Record<string, string> = {};
  if (!COMMUNICATION_PURPOSES.includes(values.purpose as CommunicationPurpose)) {
    errors.purpose = 'required';
  }
  if (!values.channel) errors.channel = 'required';
  const locale = validateText(values.preferredLocale ?? '', {
    min: MIN_PREFERRED_LOCALE,
    max: MAX_PREFERRED_LOCALE,
    required: false,
  });
  if (locale) errors.preferredLocale = locale;
  return errors;
}

export interface ConsentInput {
  readonly consentKind: ConsentKind;
  readonly channel: string;
  readonly purpose: CommunicationPurpose;
  readonly status: RecordableConsentStatus;
  readonly source?: string;
  readonly contactPointId?: string;
}

export function validateConsent(values: Record<string, string>): FieldErrors {
  const errors: Record<string, string> = {};
  if (!CONSENT_KINDS.includes(values.consentKind as ConsentKind)) errors.consentKind = 'required';
  if (!COMMUNICATION_PURPOSES.includes(values.purpose as CommunicationPurpose)) {
    errors.purpose = 'required';
  }
  if (!RECORDABLE_CONSENT_STATUSES.includes(values.status as RecordableConsentStatus)) {
    errors.status = 'required';
  }
  if (!values.channel) errors.channel = 'required';
  const source = validateText(values.source ?? '', {
    min: 1,
    max: MAX_CONSENT_SOURCE,
    required: false,
  });
  if (source) errors.source = source;
  return errors;
}
