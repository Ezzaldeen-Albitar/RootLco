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
 * ## Nine writes, five DIFFERENT permissions
 *
 * There is no blanket "customer write" capability. A role that may add a note
 * very often may not impose a restriction, and the interface has to reflect
 * that per section rather than showing nine controls and failing eight of them
 * after the operator has typed. The authoritative mapping is
 * `WRITE_PERMISSIONS` at the foot of this file; see its own note for why it
 * covers nine surfaces rather than the six it shipped with.
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
import { CRM_PERMISSIONS, holds } from '../permissions';

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

/**
 * `ck_business_partners_lifecycle_status`, minus the merge-only terminal.
 *
 * `merged` is absent because a merge is not a status somebody assigns: it is the
 * outcome of the merge operation, which writes `merged_into_id` and the status
 * together under its own permission. Offering it here would send a value the
 * route's `.strict()` enum rejects.
 */
export const SETTABLE_LIFECYCLE_STATES = ['prospect', 'active', 'inactive', 'blocked'] as const;
export type SettableLifecycleState = (typeof SETTABLE_LIFECYCLE_STATES)[number];

/**
 * Which lifecycle moves an operator may make from each state.
 *
 * A mirror of `LIFECYCLE_TRANSITIONS` in
 * `apps/api/src/modules/crm/domain/customer-governance.ts` — the server is the
 * authority and refuses an illegal move; this exists so the form offers only the
 * moves that can succeed, rather than a full list of four and a 422 for two of
 * them. Nothing leaves `merged`: a merged-away customer is history, and
 * re-activating one would resurrect a duplicate the tenant deliberately retired.
 */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly SettableLifecycleState[]>> =
  Object.freeze({
    prospect: ['active', 'inactive'],
    active: ['inactive', 'blocked'],
    inactive: ['active', 'blocked'],
    blocked: ['active', 'inactive'],
    merged: [],
  });

/** The legal targets from a current state; empty for an unknown or merged one. */
export function allowedTransitions(from: string): readonly SettableLifecycleState[] {
  return LIFECYCLE_TRANSITIONS[from] ?? [];
}

/**
 * Whether a move needs a confirmation step.
 *
 * Blocking is the one transition that stops the workshop serving a real
 * customer, so it is the one that gets a second look. The others are ordinary
 * bookkeeping and a confirmation on each would train an operator to click
 * through the one that matters.
 */
export function isConsequentialTransition(to: string): boolean {
  return to === 'blocked';
}

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

/**
 * The permission each customer write requires, exactly as the route registers
 * it — verified against `docs/phase-1/phase-1-24/evidence/operation-register.json`
 * rather than against the prose above it, and asserted against the catalogue by
 * `apps/web/tests/crm-governance-writes.test.ts`.
 *
 * ## This table described the truth and changed nothing
 *
 * It shipped covering six writes and had **no consumer outside its own test**.
 * The profile screen rendered eight of its nine write forms unconditionally, so
 * an operator holding only `crm.customer.read` was shown a full set of controls
 * — add a contact, record a consent decision, impose a restriction — every one
 * of which answered 403 after they had finished typing. The table said which
 * permission each needed and nothing consulted it.
 *
 * A table of truth nobody reads is worse than no table: it makes the gate look
 * present in review. `permittedWrites` is now the only way to produce the gate,
 * and `WriteKind` is exhaustive, so a write surface added without a permission
 * does not compile.
 *
 * `contact` and `address` are here because `crm.contact-add` and
 * `crm.address-add` need `crm.customer.profile.write` — the same code as
 * preferences, which is exactly why they were easy to forget. `status` is here
 * because folding the one write that WAS gated into the same authority removes
 * the special case rather than adding one.
 *
 * **Visibility only.** The Backend authorizes every call regardless of what this
 * file says, and its denial is the one that means anything.
 */
export const WRITE_PERMISSIONS = {
  contact: CRM_PERMISSIONS.profileWrite,
  address: CRM_PERMISSIONS.profileWrite,
  preference: CRM_PERMISSIONS.profileWrite,
  consent: CRM_PERMISSIONS.consentWrite,
  note: CRM_PERMISSIONS.noteWrite,
  alert: CRM_PERMISSIONS.governanceManage,
  tag: CRM_PERMISSIONS.governanceManage,
  restriction: CRM_PERMISSIONS.restrictionManage,
  status: CRM_PERMISSIONS.governanceManage,
} as const;
export type WriteKind = keyof typeof WRITE_PERMISSIONS;

/** Which customer writes this session may attempt, by kind. */
export type WritePermits = Readonly<Record<WriteKind, boolean>>;

/**
 * Resolves the session's permissions into one verdict per write surface.
 *
 * Built by walking `WRITE_PERMISSIONS`, never by listing the kinds again — a
 * second list would be the thing that drifts, and the drift would be silent in
 * the direction of showing a control that cannot work.
 */
export function permittedWrites(permissions: readonly string[]): WritePermits {
  const entries = Object.entries(WRITE_PERMISSIONS) as readonly (readonly [WriteKind, string])[];
  return Object.freeze(
    Object.fromEntries(entries.map(([kind, code]) => [kind, holds(permissions, code)]))
  ) as WritePermits;
}

/** Nothing permitted — the shape a caller starts from, and the safe default. */
export const NO_WRITES: WritePermits = permittedWrites([]);

/*
 * The six client-side validators that used to live here are gone, and the
 * `*Input` interfaces with them (`P1-27-FE-013`).
 *
 * `validateNote`, `validateAlert`, `validateRestriction`, `validateTag`,
 * `validatePreference` and `validateConsent` — plus the `validateText` and
 * `optionalText` helpers underneath them — mirrored the route schemas and were
 * called by NOTHING. A search of `apps/web/src` returned, for each of them,
 * exactly one reference: its own definition. Their tests were the only
 * consumers, which is why the coverage they were credited with would have
 * passed with the write features deleted.
 *
 * They were not merely unused, they contradicted a decision already recorded a
 * few files away. `components/forms/RecordForm.tsx` says of the numeric bounds
 * it does NOT enforce: "the server is the authority and a client bound that
 * disagreed with it would refuse a value the server would have accepted, with
 * no error the operator could act on." That reasoning applies with equal force
 * to a second copy of every length bound, and this file was that copy.
 *
 * Validation happens once, in the Zod schema each Server Action owns, and comes
 * back as per-field catalogue keys that `RecordForm` renders beside the field.
 * Since `P1-27-FE-004` those keys are guaranteed translatable, so the round trip
 * costs an operator a correct message rather than an English one.
 *
 * Deleting rather than wiring is deliberate. Wiring would have been a behaviour
 * change — instant client-side feedback where there has never been any — chosen
 * at remediation time and reviewed by nobody. Deleting is behaviour-preserving:
 * no operator sees any difference, because no operator ever reached this code.
 *
 * The bound CONSTANTS above stay. They are imported by `governance-actions.ts`
 * for the real schemas, which is the one authority.
 */
