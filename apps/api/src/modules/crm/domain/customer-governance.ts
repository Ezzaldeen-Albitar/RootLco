/**
 * CRM customer governance records — domain contract (Phase 1-16,
 * P1-16-BE-008…012).
 *
 * Notes, alerts, tags, lifecycle status, and restrictions. What ties these five
 * together is that each one changes how the *rest of the workshop* will treat a
 * customer, so each carries an accountability requirement the profile
 * components do not.
 *
 * ## A reason is mandatory where the record constrains someone
 *
 * `crm.partner_status_history.reason` and `crm.customer_restrictions.reason` are
 * both `NOT NULL` with a not-blank check. That is not paperwork: a blocked
 * customer standing at the counter is a person somebody has to be able to
 * explain the decision to. The schemas below require a substantive reason for
 * exactly the operations that restrict — status changes and restrictions — and
 * do not demand one for a tag, which restricts nothing.
 *
 * ## The lifecycle is a graph, not a free assignment
 *
 * `ck_partner_status_history_state_change` refuses a no-op, and the states are
 * closed. `LIFECYCLE_TRANSITIONS` adds the part the database cannot express:
 * which moves are *meaningful*. `merged` is absent from every target because a
 * merge is not a status somebody sets — it is the outcome of the merge
 * operation, which writes `merged_into_id` and the status together under its own
 * permission.
 */

/** `ck_business_partners_lifecycle_status`, minus the merge-only terminal. */
export const SETTABLE_LIFECYCLE_STATES = ['prospect', 'active', 'inactive', 'blocked'] as const;
export type SettableLifecycleState = (typeof SETTABLE_LIFECYCLE_STATES)[number];

/**
 * Which lifecycle moves an operator may make.
 *
 * `merged` is reachable only through the merge operation, and nothing leaves it:
 * a merged-away customer is history, and re-activating one would resurrect a
 * duplicate the tenant deliberately retired.
 */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly SettableLifecycleState[]>> =
  Object.freeze({
    prospect: ['active', 'inactive'],
    active: ['inactive', 'blocked'],
    inactive: ['active', 'blocked'],
    blocked: ['active', 'inactive'],
    merged: [],
  });

/** `ck_customer_alerts_type` / `ck_customer_alerts_severity`. */
export const ALERT_TYPES = ['operational', 'financial', 'safety', 'other'] as const;
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** `ck_customer_restrictions_type`. */
export const RESTRICTION_TYPES = [
  'no_credit',
  'prepay_only',
  'no_service',
  'contact_restriction',
  'other',
] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

/** `ck_notes_classification` / `ck_notes_visibility`. */
export const NOTE_CLASSIFICATIONS = ['public', 'internal', 'restricted', 'secret'] as const;
export const NOTE_VISIBILITIES = ['internal', 'customer_visible'] as const;
export type NoteClassification = (typeof NOTE_CLASSIFICATIONS)[number];
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

/** `entity_type` the DBCR-P1-16-001 note policies gate on. Exact, not a prefix. */
export const CUSTOMER_NOTE_ENTITY_TYPE = 'crm.business_partners';

export const MAX_NOTE_BODY = 10_000;
export const MAX_ALERT_MESSAGE = 1_000;
export const MIN_REASON = 10;
export const MAX_REASON = 500;
export const MAX_SEGMENT_CODE = 62;

export class CustomerGovernanceError extends Error {
  constructor(
    readonly path: string,
    readonly rule: string,
    message: string
  ) {
    super(message);
    this.name = 'CustomerGovernanceError';
  }
}

/**
 * A reason that would actually explain the decision to the person it affects.
 *
 * The length floor is deliberate. `btrim(reason) <> ''` in the database stops
 * an empty string but happily accepts `"x"`, which satisfies the letter of "a
 * reason was recorded" while defeating its entire purpose.
 */
export function requireReason(raw: string, path: string): string {
  const reason = raw.trim().replace(/\s+/g, ' ');
  if (reason.length < MIN_REASON) {
    throw new CustomerGovernanceError(
      path,
      'reason_too_short',
      `Reason must be at least ${MIN_REASON} characters and explain the decision`
    );
  }
  return reason;
}

/**
 * Checks a lifecycle move against the transition graph.
 *
 * A no-op is refused separately from an illegal move: "already active" and
 * "cannot go from merged to active" are different situations for the caller,
 * and collapsing them would make the first look like a rule violation.
 */
export function assertLifecycleTransition(from: string, to: SettableLifecycleState): void {
  if (from === to) {
    throw new CustomerGovernanceError(
      'body.lifecycleStatus',
      'no_op_transition',
      `Customer is already ${to}`
    );
  }
  const allowed = LIFECYCLE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new CustomerGovernanceError(
      'body.lifecycleStatus',
      'illegal_transition',
      `A customer cannot move from ${from} to ${to}`
    );
  }
}

/** Normalises a segment (tag) code to `ck_customer_segments_code_format`. */
export function normalizeSegmentCode(raw: string): string {
  const code = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!/^[a-z][a-z0-9_]{1,61}$/.test(code)) {
    throw new CustomerGovernanceError(
      'body.segmentCode',
      'invalid_segment_code',
      'Segment code must start with a letter and contain only letters, digits, and underscores'
    );
  }
  return code;
}
