/**
 * Warranty domain rules (Phase 1-22).
 *
 * ## What this module is, and the one thing it deliberately is not
 *
 * P1-22's scope names **warranty generation**. It does not name claim intake,
 * assessment, adjudication or reimbursement, and this module implements none of
 * them.
 *
 * That is not an omission, it is a resolved conflict. P1-11's forward contract
 * repeatedly assigns "full warranty claim adjudication (P1-OD-024)" to P1-22 — in
 * the schema comment, in `phase-1-11-p1-22-backend-contract.md`, in
 * `phase-1-11-od-linkage.md` and in two warranty contracts. The P1-22 mandate does
 * not. Measured against the deployed DDL, the mandate is the one that matches
 * reality: **there is no warranty-claim table in any schema under any name.** `wty`
 * is exactly five tables, the entire trace of a claim across 119 migrations is one
 * string literal — `'claimed_against'` in two CHECK vocabularies — and `wty`
 * contains **zero monetary columns of any kind**. There is no claim permission, no
 * claim event type and no claim audit action.
 *
 * So a claim has no row to live in, and creating one requires a migration this
 * phase forbids. Recorded as `P1-22-L-01`, and the status below is transcribed
 * complete — including `'claimed_against'` — precisely so that no reader mistakes
 * its absence for an oversight, and no route is ever shaped as if a claim were
 * persistable.
 *
 * ## Nothing about coverage is invented here
 *
 * Duration, odometer limit, covered scope and effective window all come from
 * `wty.warranty_coverage`, which an operator configures. This module hard-codes no
 * duration, no coverage rule and no legal term, and it makes no claim about the
 * legal effect of a warranty record. `wty.issue_warranty` selects the coverage
 * effective at the delivery date and computes the dates; the application's job is
 * to establish the preconditions and to refuse the operation when configuration is
 * missing, not to guess a default.
 */

/**
 * `ck_warranty_records_status` — transcribed complete.
 *
 * `'claimed_against'` is in the vocabulary and this phase never writes it: no
 * operation in P1-22 can move a record into that state, because doing so would
 * assert that a claim exists and there is nowhere for one to exist. See the header.
 */
export const WARRANTY_STATUSES = Object.freeze([
  'issued',
  'active',
  'expired',
  'voided',
  'claimed_against',
] as const);
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/** The subset this phase may write. `wty.issue_warranty` creates `'issued'`. */
export const WARRANTY_STATUSES_WRITTEN_BY_P1_22 = Object.freeze(['issued'] as const);

/** `ck_warranty_coverage_scope`. */
export const COVERED_SCOPES = Object.freeze(['all', 'service', 'part'] as const);
export type CoveredScope = (typeof COVERED_SCOPES)[number];

/** `ck_warranty_record_items_kind`. */
export const WARRANTY_ITEM_KINDS = Object.freeze(['service', 'part'] as const);
export type WarrantyItemKind = (typeof WARRANTY_ITEM_KINDS)[number];

/** `ck_warranty_policies_status` and `ck_warranty_coverage_status`. */
export const WARRANTY_LIFECYCLE_STATUSES = Object.freeze(['active', 'archived'] as const);
export type WarrantyLifecycleStatus = (typeof WARRANTY_LIFECYCLE_STATUSES)[number];

/** `ck_warranty_policies_code`. */
export const POLICY_CODE_FORMAT = /^[a-z][a-z0-9_]{1,62}$/;

export class WarrantyRuleError extends Error {
  public override readonly name = 'WarrantyRuleError';
}

/**
 * Whether a coverage scope covers a given line kind.
 *
 * `'all'` covers both; otherwise the scope must equal the kind. This is the whole
 * of the eligibility rule and it is the coverage row's, not this module's — an
 * ineligible line produces no warranty rather than a warranty with a guessed
 * scope.
 */
export function coversItemKind(coveredScope: string, itemKind: string): boolean {
  if (coveredScope === 'all') return true;
  return coveredScope === itemKind;
}

/**
 * Refuses generation against a delivery that is not committed as delivered.
 *
 * `wty.guard_warranty_record_coherence` requires `status = 'delivered'` on INSERT
 * and `wty.issue_warranty` requires it too, so this is a pre-check that produces a
 * caller-safe refusal instead of a `check_violation`. It is also the invariant §12
 * states as "no warranty without committed eligible delivery" — and because the
 * primitive reads the delivery row without locking it, the *commit* is what makes
 * the precondition real, not this check.
 */
export function assertDeliveryDelivered(deliveryStatus: string): void {
  if (deliveryStatus !== 'delivered') {
    throw new WarrantyRuleError(
      `a warranty may only be generated from a delivered handover, and this delivery ` +
        `is "${deliveryStatus}" (wty.guard_warranty_record_coherence)`
    );
  }
}

/**
 * Refuses generation when no coverage is configured for the delivery date.
 *
 * This is a **controlled configuration error**, not a validation failure: the
 * caller cannot fix it by changing the request, and this module must not invent a
 * duration to proceed with. `wty.issue_warranty` would raise `no_data_found` from
 * its own `SELECT … LIMIT 1`; naming the policy and the date here lets an operator
 * act on it.
 */
export function assertCoverageConfigured(
  coverage: unknown,
  policyCode: string,
  effectiveOn: string
): void {
  if (coverage === null || coverage === undefined) {
    throw new WarrantyRuleError(
      `no active warranty coverage is configured for policy "${policyCode}" effective on ` +
        `${effectiveOn}; coverage duration and limits are operator configuration and are ` +
        'never defaulted by the backend'
    );
  }
}

/**
 * Refuses an archived policy or coverage row.
 *
 * `wty.issue_warranty` filters on `status = 'active'` for coverage but does **not**
 * check the policy's own status, so an archived policy with a still-active coverage
 * row would issue. That gap is closed here rather than in the database, because
 * closing it there would need a migration.
 */
export function assertPolicyActive(policyStatus: string, policyCode: string): void {
  if (policyStatus !== 'active') {
    throw new WarrantyRuleError(
      `warranty policy "${policyCode}" is "${policyStatus}", not active; note that ` +
        'wty.issue_warranty checks the coverage status but not the policy status'
    );
  }
}

/**
 * Refuses a status this phase is not permitted to write.
 *
 * A structural guard against the claim vocabulary leaking into a write path: the
 * only status P1-22 may create is `'issued'`, and an operation that wrote
 * `'claimed_against'` would be asserting a fact with no table behind it.
 */
export function assertWritableStatus(status: string): void {
  if (!(WARRANTY_STATUSES_WRITTEN_BY_P1_22 as readonly string[]).includes(status)) {
    throw new WarrantyRuleError(
      `P1-22 may only create warranty records with status ` +
        `${WARRANTY_STATUSES_WRITTEN_BY_P1_22.join(', ')}; "${status}" would assert a ` +
        'lifecycle fact this phase does not implement (P1-22-L-01)'
    );
  }
}
