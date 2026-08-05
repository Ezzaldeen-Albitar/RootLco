/**
 * Customer timeline (`FE-015`) and duplicate/merge review (`FE-016`).
 *
 * Read out of `apps/api/src/modules/crm/data/customer-identity-repository.ts`,
 * `apps/api/src/modules/crm/domain/customer-identity.ts` and the three route
 * modules that publish these operations.
 *
 * ## The three operations behind "merge review" are not one screen's worth
 *
 * | operation              | method | path                                    | permission                     |
 * | ---------------------- | ------ | --------------------------------------- | ------------------------------ |
 * | `crm.duplicate-list`   | GET    | `/customer-duplicates`                  | `crm.customer.duplicate.review` |
 * | `crm.duplicate-review` | POST   | `/customer-duplicates/{id}/review`      | `crm.customer.duplicate.review` |
 * | `crm.customer-merge`   | POST   | `/customers/{customerId}/merge`         | **`crm.customer.merge`**       |
 *
 * **Reviewing and merging are different capabilities**, and the interface must
 * not present them as two buttons on one control. A reviewer who may dismiss a
 * false pair very often may not be trusted to destroy one of two customer
 * records.
 */

/** `crm.duplicate_candidates.status`. */
export const DUPLICATE_STATUSES = ['open', 'dismissed', 'merged'] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

/**
 * What a reviewer may actually decide: **dismiss, and nothing else.**
 *
 * `merged` is a status a candidate reaches, not a decision this endpoint
 * accepts — the merge is `crm.customer-merge`, a different operation behind a
 * different permission. A review screen offering "Merge" as a second decision
 * on this endpoint would send a value the `.strict()` enum rejects, and would
 * imply the reviewer's capability covers something it does not.
 */
export const DUPLICATE_DECISIONS = ['dismissed'] as const;
export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number];

/** `crm.timeline_events.event_type` — `text` with a CHECK, not an enum. */
export const TIMELINE_EVENT_TYPES = [
  'lifecycle_changed',
  'commercial_changed',
  'consent_changed',
  'blocked',
  'unblocked',
  'alert_raised',
  'merged',
  'communication_logged',
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/** `HistoryEntry.kind` — a closed union in the repository's own TypeScript. */
export const HISTORY_KINDS = ['status', 'consent', 'block', 'merge'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export const MIN_MERGE_REASON = 10;
export const MAX_MERGE_REASON = 500;
export const MAX_APPROVAL_REF = 120;

export interface TimelineEntry {
  readonly id: string;
  readonly eventType: string;
  /** `char_length(title) <= 200`, never blank. */
  readonly title: string;
  readonly occurredAt: string;
  readonly actorId: string | null;
}

export interface HistoryEntry {
  readonly kind: HistoryKind;
  readonly id: string;
  readonly occurredAt: string;
  readonly summary: string;
}

/**
 * One duplicate candidate pair.
 *
 * `matchScore` is **`numeric`, and it stays a string.** node-postgres decodes
 * `numeric` to a string precisely because it does not fit a JavaScript float,
 * and the repository's own docblock says it is "never narrowed to a float".
 * Calling `parseFloat` here to render a percentage would reintroduce exactly
 * the precision loss the string representation exists to prevent — and this
 * number decides whether two real customer records get combined.
 *
 * `matchBasis` is `jsonb` and is safe to display **by schema, not by review**:
 * `ck_duplicate_candidates_basis` calls `crm.jsonb_no_raw_value_keys`, which
 * rejects a `value`/`raw`/`national_id`/`tax`/`registration`/`date_of_birth`
 * key at any depth. So it can only carry which signals fired and how heavily,
 * never the personal data that produced them.
 */
export interface DuplicateCandidate {
  readonly id: string;
  readonly partnerIdA: string;
  readonly displayNameA: string | null;
  readonly partnerIdB: string;
  readonly displayNameB: string | null;
  readonly matchScore: string;
  readonly matchBasis: unknown;
  readonly status: string;
  readonly detectedAt: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
}

/**
 * Formats a `numeric` match score for display **without parsing it**.
 *
 * The score is a decimal string such as `"0.875"`. Rendering it as a percentage
 * is presentation, so it is done on the string: take the digits after the
 * point, pad or cut to two, and read the result. No `parseFloat`, no `Number`,
 * no arithmetic — the value that reaches the screen is derived from the exact
 * characters the database sent.
 *
 * Returns `null` for anything that is not a plain decimal, so an unexpected
 * representation is shown raw rather than rendered as a confident wrong number.
 */
export function formatMatchScore(score: string): string | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(score.trim());
  if (!match) return null;

  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';

  // A score is a 0..1 ratio. Anything else is not a shape this understands.
  if (whole !== '0' && whole !== '1') return null;
  if (whole === '1' && /[1-9]/.test(fraction)) return null;
  if (whole === '1') return '100%';

  // Percent = the first two fractional digits, with the third rounded in by
  // string comparison rather than by float arithmetic.
  const digits = (fraction + '000').slice(0, 3);
  const tens = Number(digits.slice(0, 2));
  const roundUp = Number(digits[2]) >= 5;
  const percent = Math.min(100, tens + (roundUp ? 1 : 0));
  return `${percent}%`;
}

/**
 * Whether a candidate can still be acted on.
 *
 * Only `open` candidates are actionable. A dismissed or merged pair is a
 * historical record, and offering a decision control on one would let a
 * reviewer re-decide something already settled — the backend refuses, but the
 * control should never have been there.
 */
export function isActionable(candidate: DuplicateCandidate): boolean {
  return candidate.status === 'open';
}

/**
 * The two customers in a candidate pair, as a stable ordered pair.
 *
 * A/B is the order the detector recorded and carries no meaning — neither is
 * "the duplicate". Presenting one as the original and the other as the copy
 * would invent a fact and nudge a reviewer toward destroying the wrong record.
 */
export function pairMembers(
  candidate: DuplicateCandidate
): readonly [{ id: string; name: string | null }, { id: string; name: string | null }] {
  return [
    { id: candidate.partnerIdA, name: candidate.displayNameA },
    { id: candidate.partnerIdB, name: candidate.displayNameB },
  ];
}

/**
 * There is deliberately no `MergeInput` and no `validateMerge` here.
 *
 * `P1-OD-017` is an open Owner decision and the canonical plan requires the
 * merge affordance to be **absent**. A validator with no call site is one edit
 * away from a form, so it is removed rather than left in place — the contract
 * facts about `crm.customer-merge` stay documented at the top of this file,
 * which is where a future wave should start when the decision is resolved.
 */

export function validateReviewReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return 'field.required';
  if (trimmed.length < MIN_MERGE_REASON) return 'field.tooShort';
  if (trimmed.length > MAX_MERGE_REASON) return 'field.tooLong';
  return null;
}
