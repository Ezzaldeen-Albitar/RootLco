/**
 * Quotation vocabulary and lifecycle rules (Phase 1-20, P1-20-BE-007…012).
 *
 * Every constant is transcribed from a CHECK constraint or a guard on the frozen
 * `quo` schema. The database is the enforcement point; these mirrors exist so the
 * application refuses with a named error and a readable message instead of
 * letting a trigger raise from four layers down.
 *
 * ## The one thing to understand about this schema
 *
 * **A decision is recorded against an ITEM, not against a revision.**
 * `quo.record_item_decision` takes a `quotation_item_id`, and
 * `uq_approval_decisions_item` makes one decision per
 * `(tenant, company, branch, revision, item)` terminal. The revision-level
 * outcome — "was this quotation accepted?" — is therefore **derived** from its
 * items, never stored as a second source of truth.
 *
 * The phase prose describes a revision-level `:decide`. That endpoint cannot
 * exist as described without inventing a storage location the schema does not
 * have, so it is modelled as a per-item decision with a derived roll-up.
 */

export class QuotationRuleError extends Error {
  public override readonly name = 'QuotationRuleError';
}

/** `ck_quotations_status`. */
export const QUOTATION_STATES = Object.freeze([
  'draft',
  'active',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const);
export type QuotationState = (typeof QUOTATION_STATES)[number];

/**
 * `ck_quotation_revisions_status`.
 *
 * `quo.guard_quotation_revision_freeze` fixes the graph: `draft` may become
 * anything; `issued` may become only `superseded`, `rejected`, or `expired`; and
 * those three are terminal.
 */
export const REVISION_STATES = Object.freeze([
  'draft',
  'issued',
  'superseded',
  'rejected',
  'expired',
] as const);
export type RevisionState = (typeof REVISION_STATES)[number];

/** The three terminal revision states, from the freeze guard. */
export const TERMINAL_REVISION_STATES = Object.freeze([
  'superseded',
  'rejected',
  'expired',
] as const);

/** `ck_approval_decisions_decision`. Note: `rejected`, NOT `declined`. */
export const DECISIONS = Object.freeze(['approved', 'rejected'] as const);
export type Decision = (typeof DECISIONS)[number];

/** `ck_approval_decisions_channel`. */
export const DECISION_CHANNELS = Object.freeze([
  'in_person',
  'phone',
  'portal',
  'email',
  'system',
] as const);
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

/** `ck_approval_evidence_kind`. */
export const EVIDENCE_KINDS = Object.freeze(['document', 'verbal', 'portal', 'email'] as const);
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** `ck_quotation_items_kind`. */
export const ITEM_KINDS = Object.freeze(['service', 'part'] as const);
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Column widths, so a caller gets a 422 rather than a driver truncation. */
export const MAX_ITEM_DESCRIPTION = 2000;
export const MAX_REFERENCE_NOTE = 2000;
export const MAX_STATUS_REASON = 2000;
/** A bounded line count, so one request cannot build an unbounded revision. */
export const MAX_ITEMS_PER_REVISION = 200;

/**
 * `ck_approval_evidence_document`: `evidence_kind = 'document'` **iff**
 * `document_version_id IS NOT NULL`.
 *
 * Both directions matter. A `document` evidence row with no document proves
 * nothing, and a non-`document` row that carries one is a mislabelled
 * attachment.
 */
export function assertEvidenceShape(kind: string, documentVersionId: string | null): void {
  const isDocument = kind === 'document';
  if (isDocument && documentVersionId === null) {
    throw new QuotationRuleError('Evidence of kind "document" requires a document version');
  }
  if (!isDocument && documentVersionId !== null) {
    throw new QuotationRuleError(`Evidence of kind "${kind}" must not carry a document version`);
  }
}

/**
 * Whether a revision may still accept item edits.
 *
 * `quo.guard_quotation_item` refuses ANY insert, update, or delete of an item
 * whose parent revision is not `draft`. That is what makes an issued revision an
 * immutable commercial snapshot.
 */
export function assertRevisionEditable(status: string): void {
  if (status !== 'draft') {
    throw new QuotationRuleError(
      `This revision is ${status}; only a draft revision's items may be changed`
    );
  }
}

/**
 * Whether a revision is terminal.
 *
 * Used to refuse a decision or a re-issue early. The database refuses too, but a
 * caller deserves to know which state blocked them.
 */
export function isTerminalRevision(status: string): boolean {
  return (TERMINAL_REVISION_STATES as readonly string[]).includes(status);
}

/**
 * Whether an issued revision has expired at `now`.
 *
 * `expires_at` is nullable — a revision with no expiry never expires. Expiry is
 * evaluated against **server** time; a client-supplied "now" would let a caller
 * approve a lapsed quotation by claiming an earlier clock.
 */
export function hasExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/**
 * Folds per-item decisions into the quotation-level outcome.
 *
 * The roll-up rule, and why each branch is what it is:
 *
 *  - **any item rejected → `rejected`.** A customer who refuses one line has not
 *    accepted the quotation as presented. Treating a partial rejection as an
 *    acceptance would authorize work the customer declined.
 *  - **every item approved → `accepted`.**
 *  - **otherwise → `null`**, meaning "still awaiting decisions"; the quotation
 *    stays `active`.
 *
 * A revision with no items cannot be issued (`quo.issue_revision` refuses zero
 * items), so `itemCount === 0` here would mean the caller passed the wrong
 * revision — it returns `null` rather than claiming a vacuous acceptance.
 */
export function rollUpDecisions(input: {
  itemCount: number;
  approvedCount: number;
  rejectedCount: number;
}): 'accepted' | 'rejected' | null {
  if (input.itemCount === 0) return null;
  if (input.rejectedCount > 0) return 'rejected';
  if (input.approvedCount === input.itemCount) return 'accepted';
  return null;
}
