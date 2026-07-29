/**
 * Delivery domain rules (Phase 1-22).
 *
 * ## Eligibility is composed here, and nowhere in the database
 *
 * `sal.complete_delivery` enforces exactly three preconditions: an authorized
 * receiver row exists, every mandatory checklist item has a `passed` or `waived`
 * result, and at least one signature exists. It checks **no work-order state, no
 * QC outcome, and no financial balance at all.**
 *
 * So the financial blocker — the single most consequential gate on this
 * operation — has no database enforcement whatsoever. It is composed by the
 * application from `sal.invoice_open_receivable` reached through the billing
 * module's public port, and if the composition is deleted the database will hand
 * over a vehicle with an unpaid invoice without complaint.
 *
 * That is why `BLOCKER_CODES` is a closed vocabulary and why eligibility is
 * returned as an explicit list of blocker codes rather than a boolean: a caller
 * that receives `eligible: false` with no reason cannot act, and a caller that
 * sends `eligible: true` must never be believed. Nothing in this module reads an
 * eligibility flag from client input.
 */
import { type Decimal, type DecimalSpec, parseNonNegative } from '@/modules/pricing';

/** `ck_delivery_records_status`. */
export const DELIVERY_STATUSES = Object.freeze([
  'ready',
  'receiver_verified',
  'signed',
  'delivered',
  'exception',
] as const);
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** `ck_delivery_checklist_results_outcome`. */
export const CHECKLIST_OUTCOMES = Object.freeze(['passed', 'failed', 'waived'] as const);
export type ChecklistOutcome = (typeof CHECKLIST_OUTCOMES)[number];

/**
 * Outcomes that satisfy a mandatory item.
 *
 * Transcribed from `sal.complete_delivery`'s own predicate,
 * `outcome IN ('passed','waived')` — a `failed` mandatory item blocks delivery and
 * a waiver requires `waiver_reason`, which `ck_delivery_checklist_results_waiver`
 * makes structural.
 */
export const CHECKLIST_SATISFYING_OUTCOMES = Object.freeze(['passed', 'waived'] as const);

/** `ck_delivery_signatures_signer_role`. */
export const SIGNER_ROLES = Object.freeze(['receiver', 'delivering_employee', 'witness'] as const);
export type SignerRole = (typeof SIGNER_ROLES)[number];

/**
 * Every reason a delivery may be refused, as a closed vocabulary.
 *
 * A closed set rather than free prose because these codes are the operation's
 * contract: a client renders them, an operator acts on them, and an override is
 * authorised against a specific one. Free text could not be any of those things.
 */
export const BLOCKER_CODES = Object.freeze([
  /** The work order is not in a state that permits handover. */
  'work_order_not_complete',
  /** Quality control has not signed off, or signed off negatively. */
  'quality_control_not_passed',
  /** An invoice for this work order still has an open receivable. */
  'financial_balance_outstanding',
  /** Parts are still reserved or issued-but-unreconciled against the work order. */
  'part_obligation_outstanding',
  /** A mandatory checklist item has no passing or waived result. */
  'checklist_incomplete',
  /** No `sal.authorized_receivers` row exists for this delivery. */
  'receiver_not_verified',
  /** No `sal.delivery_signatures` row exists for this delivery. */
  'signature_missing',
  /** The delivery record is in `exception`, or already `delivered`. */
  'delivery_state_invalid',
] as const);
export type BlockerCode = (typeof BLOCKER_CODES)[number];

/**
 * Blockers an authorised caller may override, and the permission each requires.
 *
 * Only the financial blocker is overridable, and only with
 * `sal.delivery.complete` — the high-risk authority. The others are not
 * overridable at all: two of them (`receiver_not_verified`, `checklist_incomplete`)
 * are enforced inside `sal.complete_delivery`, so an "override" would simply fail
 * at the database with a `check_violation`, and advertising an override that cannot
 * work is worse than not offering one.
 */
export const OVERRIDABLE_BLOCKERS: readonly {
  readonly code: BlockerCode;
  readonly permission: string;
}[] = Object.freeze([
  { code: 'financial_balance_outstanding', permission: 'sal.delivery.complete' },
]);

/** Column widths, so a caller gets a 422 rather than a driver truncation error. */
export const MAX_REASON = 2000;
/** `veh.odometer_readings.unit` — `sal.complete_delivery` defaults to `'km'`. */
export const ODOMETER_UNITS = Object.freeze(['km', 'mi'] as const);
export type OdometerUnit = (typeof ODOMETER_UNITS)[number];

/**
 * `veh.odometer_readings.value` — `numeric(12,1)`, `CHECK (value >= 0)`.
 *
 * The final odometer reading is the one numeric value this module writes, and it is
 * **not** money: its column is `numeric(12,1)`, so validating it against `MONEY`
 * (`numeric(18,4)`) would accept `123.4567` and let PostgreSQL silently round three
 * digits away on the cast. A reading is a fact about a vehicle that a warranty term
 * may later be measured against, so the scale is checked against the column that
 * actually holds it.
 */
export const ODOMETER_VALUE: DecimalSpec = Object.freeze({
  precision: 12,
  scale: 1,
  label: 'odometer value',
});

export class DeliveryRuleError extends Error {
  public override readonly name = 'DeliveryRuleError';
}

/**
 * Parses the final odometer reading, refusing anything the column would not hold.
 *
 * Returns a `Decimal` and nothing else — no arithmetic is performed on it here or
 * anywhere in this module. The value crosses into SQL as the canonical decimal STRING
 * bound to `$2::numeric`, because `numeric` holds values IEEE-754 cannot represent and
 * `veh.guard_odometer_reading` compares it against the vehicle's current effective
 * kilometres to enforce a forward-only series. Nothing about it may be approximate.
 *
 * `>= 0` mirrors `ck_odometer_readings_value_nonneg`. Whether the value is high enough
 * is not decidable here: it is the guard's judgement, made under the vehicle row's own
 * lock against every non-superseded prior reading.
 */
export function parseOdometerValue(input: string): Decimal {
  try {
    return parseNonNegative(input, ODOMETER_VALUE);
  } catch (error) {
    throw new DeliveryRuleError(`final odometer value: ${(error as Error).message}`);
  }
}

/** One composed eligibility decision. */
export interface EligibilityDecision {
  /** Server-derived. Never read from, and never influenced by, client input. */
  readonly eligible: boolean;
  readonly blockers: readonly BlockerCode[];
  /** Blockers that were overridden, with the authority that permitted each. */
  readonly overridden: readonly BlockerCode[];
}

/**
 * Composes an eligibility decision from the facts the caller could not forge.
 *
 * Every input is a fact this module read from a protected table or obtained from
 * another module's public port. There is deliberately no parameter through which a
 * client could assert eligibility, so `assertEligible` cannot be satisfied by
 * anything a request body contains.
 */
export function composeEligibility(facts: {
  readonly deliveryStatus: string;
  readonly workOrderComplete: boolean;
  readonly qualityControlPassed: boolean;
  readonly hasOutstandingBalance: boolean;
  readonly hasOutstandingPartObligation: boolean;
  readonly mandatoryChecklistComplete: boolean;
  readonly receiverVerified: boolean;
  readonly signatureRecorded: boolean;
}): EligibilityDecision {
  const blockers: BlockerCode[] = [];

  // `delivered` is not a blocker on its own — completion is idempotent, and
  // reporting an already-delivered record as blocked would make the replay path
  // look like a failure. `exception` is terminal for this purpose.
  if (facts.deliveryStatus === 'exception') blockers.push('delivery_state_invalid');
  if (!facts.workOrderComplete) blockers.push('work_order_not_complete');
  if (!facts.qualityControlPassed) blockers.push('quality_control_not_passed');
  if (facts.hasOutstandingBalance) blockers.push('financial_balance_outstanding');
  if (facts.hasOutstandingPartObligation) blockers.push('part_obligation_outstanding');
  if (!facts.mandatoryChecklistComplete) blockers.push('checklist_incomplete');
  if (!facts.receiverVerified) blockers.push('receiver_not_verified');
  if (!facts.signatureRecorded) blockers.push('signature_missing');

  return { eligible: blockers.length === 0, blockers, overridden: [] };
}

/** Whether a blocker may be overridden at all. */
export function isOverridable(code: BlockerCode): boolean {
  return OVERRIDABLE_BLOCKERS.some((entry) => entry.code === code);
}

/** The permission an override of `code` requires, or `null` if it cannot be overridden. */
export function overridePermission(code: BlockerCode): string | null {
  return OVERRIDABLE_BLOCKERS.find((entry) => entry.code === code)?.permission ?? null;
}

/**
 * Applies an authorised override to a decision, returning a new decision.
 *
 * `authorised` is the set of blocker codes the *service* has already confirmed the
 * caller may override, having checked the permission against the database. This
 * function does not consult a permission itself — a domain function that could
 * authorise anything would be a domain function that reached the database.
 */
export function withOverrides(
  decision: EligibilityDecision,
  authorised: readonly BlockerCode[]
): EligibilityDecision {
  const applied = decision.blockers.filter(
    (code) => isOverridable(code) && authorised.includes(code)
  );
  const remaining = decision.blockers.filter((code) => !applied.includes(code));
  return { eligible: remaining.length === 0, blockers: remaining, overridden: applied };
}

/**
 * Refuses a delivery that is not eligible, naming every remaining blocker.
 *
 * The message lists the codes because a caller that is told only "not eligible"
 * has to guess, and guessing against a handover gate produces exactly the
 * pressure to add an override that should not exist.
 */
export function assertEligible(decision: EligibilityDecision): void {
  if (!decision.eligible) {
    throw new DeliveryRuleError(`delivery is blocked: ${decision.blockers.join(', ')}`);
  }
}

/**
 * Refuses a signer role outside the closed vocabulary.
 *
 * `ck_delivery_signatures_signer_role` would refuse it too, as `23514` with a
 * constraint name this platform never echoes to a caller.
 */
export function assertSignerRole(role: string): void {
  if (!(SIGNER_ROLES as readonly string[]).includes(role)) {
    throw new DeliveryRuleError(`signer role "${role}" is not one of ${SIGNER_ROLES.join(', ')}`);
  }
}

/**
 * Refuses a checklist outcome that is `waived` without a reason, and vice versa.
 *
 * `ck_delivery_checklist_results_waiver` makes the biconditional structural:
 * `(outcome = 'waived') = (waiver_reason IS NOT NULL)`. A waiver with no reason and
 * a reason with no waiver are both refused.
 */
export function assertChecklistResultShape(outcome: string, waiverReason: string | null): void {
  if (!(CHECKLIST_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new DeliveryRuleError(
      `checklist outcome "${outcome}" is not one of ${CHECKLIST_OUTCOMES.join(', ')}`
    );
  }
  const waived = outcome === 'waived';
  const hasReason = waiverReason !== null && waiverReason.trim() !== '';
  if (waived && !hasReason) {
    throw new DeliveryRuleError('a waived checklist item requires a waiver reason');
  }
  if (!waived && hasReason) {
    throw new DeliveryRuleError(
      `a waiver reason is only accepted with outcome "waived", not "${outcome}"`
    );
  }
}
