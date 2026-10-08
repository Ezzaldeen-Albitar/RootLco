/**
 * Payments domain rules (Phase 1-22).
 *
 * Transcribed from the frozen `sal` payment tables. The three vocabularies below
 * are closed CHECK constraints, not conventions, and the most consequential fact
 * in this file is the one that is deliberately absent: **there is no online
 * payment gateway and no settlement type.**
 *
 * `ck_payment_methods_kind` admits exactly `cash`, `card_terminal` and
 * `bank_transfer`, and the schema comment beside it says "No online payment
 * gateway/settlement types (ASM-14, CON-04)". So §12's prohibition on claiming an
 * external settlement is structural rather than a rule this code has to remember:
 * there is no column in which such a claim could be stored, and this module
 * therefore stores, forwards and logs no payment credential of any kind.
 *
 * ## Over-allocation is defended in exactly one place
 *
 * `Σ allocations ≤ receipt.amount` and `Σ allocations ≤ invoice.open` are enforced
 * **only inside `sal.allocate_receipt`**, under a receipt→invoice `FOR UPDATE`
 * lock order. There is no constraint, no trigger and no exclusion bounding the
 * sum, and `app_runtime` holds raw `INSERT` on `sal.payment_allocations`. The
 * database does not defend BR-SAL-002 against any path except the primitive.
 *
 * That makes "every allocation goes through `sal.allocate_receipt`" a P1-22
 * invariant rather than a stylistic preference, and it is enforced at the
 * repository layer by `assertAllocationUsesPrimitive` below plus a repository that
 * offers no INSERT path at all.
 */
import { Decimal, MONEY, parsePositive } from '@/modules/pricing';

/**
 * `ck_payment_methods_kind` — closed at three.
 *
 * `method_code` and `kind` happen to be equal for all three seeded platform rows
 * (`supabase/seeds/08_sal_payment_methods.sql`), but they are different columns
 * and a tenant-scoped method may set its own code, so nothing here treats one as
 * the other.
 */
export const PAYMENT_METHOD_KINDS = Object.freeze([
  'cash',
  'card_terminal',
  'bank_transfer',
] as const);
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/** `ck_payment_methods_scope`. Platform rows are immutable to runtime. */
export const PAYMENT_METHOD_SCOPES = Object.freeze(['platform', 'tenant'] as const);
export type PaymentMethodScope = (typeof PAYMENT_METHOD_SCOPES)[number];

/** `ck_payment_methods_status` and `ck_delivery_checklist_templates_status` alike. */
export const PAYMENT_METHOD_STATUSES = Object.freeze(['active', 'inactive'] as const);
export type PaymentMethodStatus = (typeof PAYMENT_METHOD_STATUSES)[number];

/**
 * `ck_receipts_status`.
 *
 * `recorded → partially_allocated → allocated` is driven by
 * `sal.allocate_receipt`, which re-sums after each allocation and sets the status
 * itself. `reversed` is terminal and reachable only when an approved
 * `sal.receipt_reversals` row already exists (`sal.guard_receipt_freeze`) — that is,
 * only through `sal.approve_receipt_reversal`, which `sal.receipt-reversal-approve`
 * reaches since ADR-023 D4 (P1-32-PRE-OD-FD4).
 */
export const RECEIPT_STATUSES = Object.freeze([
  'recorded',
  'partially_allocated',
  'allocated',
  'reversed',
] as const);
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/**
 * `ck_receipt_reversals_approval_state` (ADR-023 D4, P1-32-PRE-OD-FD4).
 *
 * `pending` until decided; `approved` reverses the receipt; `rejected` and
 * `withdrawn` reverse nothing. Every state but `pending` is terminal, which
 * `sal.guard_receipt_reversal_decision` enforces for every role that can write
 * the row.
 */
export const RECEIPT_REVERSAL_STATES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'withdrawn',
] as const);
export type ReceiptReversalState = (typeof RECEIPT_REVERSAL_STATES)[number];

/**
 * Who may do what with a receipt reversal (ADR-023 D4).
 *
 * Requesting and withdrawing are the payment recorder's acts, under the code that
 * records a receipt. Approving and rejecting are a different person's, under a
 * code of their own that no credit-note code satisfies — `sal.reversal.approve`,
 * seeded since Phase 1-11 for exactly this decision and bound to no operation
 * until D4.
 */
export const RECEIPT_REVERSAL_PERMISSIONS = Object.freeze({
  request: 'sal.payment.record',
  decide: 'sal.reversal.approve',
} as const);

/** A reversal request's and a rejection's reason: required, at most this many characters. */
export const MAX_REVERSAL_REASON = 2000;

/**
 * The stable rule tokens a refused reversal, decision, allocation or replacement
 * names (ADR-023 D4, D12). Each is the token the database guard raises before the
 * first colon of its message for the same rule, the token the screen reads from
 * `safeDetails.violations[].rule`, and the rule a business-refusal record carries.
 */
export const RECEIPT_REVERSAL_RULES = Object.freeze({
  exists: 'receipt_reversal_exists',
  receiptReversed: 'receipt_reversal_receipt_reversed',
  selfApproval: 'receipt_reversal_self_approval',
  selfRejection: 'receipt_reversal_self_rejection',
  notRequester: 'receipt_reversal_withdraw_not_requester',
  decided: 'receipt_reversal_decision_frozen',
  requestPermissionMissing: 'receipt_reversal_request_permission_missing',
  approvePermissionMissing: 'receipt_reversal_approve_permission_missing',
  rejectPermissionMissing: 'receipt_reversal_reject_permission_missing',
  pendingBlocksAllocation: 'receipt_reversal_pending_blocks_allocation',
  replacementNotReversed: 'receipt_replacement_not_reversed',
  replacementExists: 'receipt_replacement_exists',
  // ADR-023 D2 (P1-32-PRE-OD-FD2A), an interim rule and an OPEN policy point: a
  // receipt that paid an invoice whose customer is owed a refund is not reversed
  // while that refund obligation is open, because the reversal would change the
  // excess the obligation was computed from.
  refundObligationOpen: 'receipt_reversal_refund_obligation_open',
} as const);

/**
 * A third-party payer (ADR-023 D14, P1-32-PRE-OD-FD14).
 *
 * Applying one party's receipt to another customer's invoice is refused by default
 * (`allocation_payer_mismatch`). It is accepted only as a THIRD-PARTY allocation,
 * which names what the payer is to the customer — from this FIXED vocabulary, held
 * in code and in `ck_payment_allocations_third_party_relationship`; an organisation
 * cannot add to it — an authorisation reference and a reason, and which only a
 * holder of `THIRD_PARTY_PERMISSION` in the receipt's company and branch may make.
 * Nothing changes hands: the invoice stays its customer's, the receipt stays its
 * payer's, and whatever is left on the receipt stays the payer's.
 */
export const THIRD_PARTY_RELATIONSHIPS = Object.freeze(['insurer', 'employer', 'other'] as const);
export type ThirdPartyRelationship = (typeof THIRD_PARTY_RELATIONSHIPS)[number];

/**
 * The authority a third-party allocation needs, beyond `sal.payment.allocate`.
 * Consulted by `sal.payment-allocate` only for a third-party allocation, and by the
 * database trigger `sal.guard_allocation_payer` for every one, whoever writes it.
 */
export const THIRD_PARTY_PERMISSION = 'sal.payment.third_party';

/** `ck_payment_allocations_third_party_shape`: the authorisation reference's ceiling. */
export const MAX_THIRD_PARTY_AUTHORISATION_REFERENCE = 100;
/** `ck_payment_allocations_third_party_shape`: the reason's ceiling. */
export const MAX_THIRD_PARTY_REASON = 2000;

/**
 * The stable rule tokens of the payer rule (ADR-023 D14, D12). Each is the token
 * `sal.guard_allocation_payer` raises before the first colon of its message, the
 * token the screen reads from `safeDetails.violations[].rule`, and — for the two
 * refusals of an allocation that may not be made at all — the rule a
 * business-refusal record carries.
 */
export const THIRD_PARTY_RULES = Object.freeze({
  payerMismatch: 'allocation_payer_mismatch',
  permissionMissing: 'third_party_permission_missing',
  samePayer: 'third_party_same_payer',
  relationshipInvalid: 'third_party_relationship_invalid',
  referenceRequired: 'third_party_authorisation_reference_required',
  otherUnexplained: 'third_party_other_unexplained',
  reasonRequired: 'third_party_reason_required',
  currencyMismatch: 'allocation_currency_mismatch',
} as const);

/** What a caller states to make a third-party allocation. */
export interface ThirdPartyDeclaration {
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly reason: string;
}

/** Characters as PostgreSQL's `char_length` counts them: code points, not UTF-16 units. */
const codePoints = (text: string): number => Array.from(text).length;

/** One field of a third-party declaration that does not hold, with the rule it breaks. */
export interface ThirdPartyViolation {
  readonly field: 'relationship' | 'authorisationReference' | 'reason';
  readonly rule: (typeof THIRD_PARTY_RULES)[keyof typeof THIRD_PARTY_RULES];
}

/**
 * Every field of a third-party declaration that breaks a rule, in field order, so
 * a screen can mark each one. The same rules `sal.guard_allocation_payer` holds the
 * row to; the database stays the authority, and this only names the refusals.
 *
 * 'other' must say in the reason what the payer is to the customer: a blank reason
 * then breaks `third_party_other_unexplained`, worded for that case, rather than
 * the general `third_party_reason_required`.
 */
export function thirdPartyViolations(
  declaration: ThirdPartyDeclaration
): readonly ThirdPartyViolation[] {
  const found: ThirdPartyViolation[] = [];
  const relationshipKnown = (THIRD_PARTY_RELATIONSHIPS as readonly string[]).includes(
    declaration.relationship
  );
  if (!relationshipKnown) {
    found.push({ field: 'relationship', rule: THIRD_PARTY_RULES.relationshipInvalid });
  }
  const reference = declaration.authorisationReference;
  if (reference.trim() === '' || codePoints(reference) > MAX_THIRD_PARTY_AUTHORISATION_REFERENCE) {
    found.push({ field: 'authorisationReference', rule: THIRD_PARTY_RULES.referenceRequired });
  }
  const reason = declaration.reason;
  if (reason.trim() === '' && declaration.relationship === 'other') {
    found.push({ field: 'reason', rule: THIRD_PARTY_RULES.otherUnexplained });
  } else if (reason.trim() === '' || codePoints(reason) > MAX_THIRD_PARTY_REASON) {
    found.push({ field: 'reason', rule: THIRD_PARTY_RULES.reasonRequired });
  }
  return found;
}

/** `ck_payment_methods_code` and `ck_invoice_numbering_configs_sequence_code`. */
export const PLATFORM_CODE_FORMAT = /^[a-z][a-z0-9_]{1,62}$/;

export class PaymentRuleError extends Error {
  public override readonly name = 'PaymentRuleError';
}

/**
 * Parses a payment amount. Strictly positive — `ck_receipts_amount` says `> 0`.
 *
 * A zero receipt is not a receipt, and a negative one would be a refund, which is
 * structurally absent from this schema (`P1-22-L-05`).
 */
export function parsePaymentAmount(input: string, field = 'amount'): Decimal {
  try {
    return parsePositive(input, MONEY);
  } catch (error) {
    throw new PaymentRuleError(`${field}: ${(error as Error).message}`);
  }
}

/** Refuses a method that is not active, or whose kind is outside the closed set. */
export function assertPaymentMethodUsable(method: {
  readonly kind: string;
  readonly status: string;
}): void {
  if (!(PAYMENT_METHOD_KINDS as readonly string[]).includes(method.kind)) {
    throw new PaymentRuleError(
      `payment method kind "${method.kind}" is not one of ${PAYMENT_METHOD_KINDS.join(', ')}; ` +
        'this platform records no online gateway settlement (ASM-14, CON-04)'
    );
  }
  if (method.status !== 'active') {
    throw new PaymentRuleError(`payment method is "${method.status}", not active`);
  }
}

/**
 * Refuses a platform-scoped method, which no receipt can cite.
 *
 * **Added in P1-22 because the rule was missing and is structural.**
 * `fk_receipts_method` is `(tenant_id, payment_method_id) → sal.payment_methods
 * (tenant_id, id)` and `ck_payment_methods_scope_tenant` forces a platform row's
 * `tenant_id` to be NULL. Under MATCH SIMPLE both referencing columns are NOT NULL,
 * so the referenced row must match on both, and no NULL tenant can equal a concrete
 * one — the three seeded platform methods are therefore **visible to every tenant
 * via `sel_payment_methods_scope` and citable by no receipt at all**. Recording
 * against one raises `23503`, which reads as "that method does not exist" about a
 * method the caller can see in the list.
 *
 * `tests/db/p1-11-helpers.ts` records the same conclusion beside the tenant-scoped
 * fixture method it has to create: *"receipts cannot use a platform method — FK is
 * (tenant_id,id)"*. Nothing else in the application refuses it, so this does.
 */
export function assertPaymentMethodIsTenantScoped(method: {
  readonly scope: string;
  readonly methodCode: string;
}): void {
  if (method.scope !== 'tenant') {
    throw new PaymentRuleError(
      `payment method "${method.methodCode}" is platform-scoped and cannot be cited by a ` +
        'receipt: fk_receipts_method resolves (tenant_id, payment_method_id) and a platform ' +
        "row's tenant_id is NULL, so the tenant must be provisioned with its own method row"
    );
  }
}

/**
 * The method codes every tenant is provisioned with — the other half of the rule
 * above.
 *
 * `assertPaymentMethodIsTenantScoped` has said since P1-22 that "the tenant must
 * be provisioned with its own method row", and until the P1-30 corrective slice
 * nothing did: six organisations created through the shipped control-plane
 * operation held zero tenant-scope methods between them, so each could read the
 * payments experience and record nothing. Tenant provisioning now copies the
 * PLATFORM catalogue rows named here into the new tenant, inside the same
 * transaction that creates it.
 *
 * **Codes, not kinds, and not a set of labels.** `method_code` and `kind` are
 * equal for all three platform rows, and this file already refuses to treat one
 * as the other — so the bootstrap selects the platform rows BY CODE and copies
 * each row's own `kind` and `display_name` rather than restating them. The
 * canonical vocabulary is `supabase/seeds/08_sal_payment_methods.sql` (ASM-14 /
 * CON-04: cash, card terminal, bank transfer, and no online gateway or
 * settlement type); nothing is invented here, and a platform row missing at
 * provisioning time makes the provisioning fail rather than produce a tenant
 * with fewer methods than the product requires.
 *
 * SERVER-OWNED. No request field names a method: the provisioning body is
 * `.strict()` and carries no `paymentMethods` member, so the set is fixed for
 * every tenant and a caller cannot widen, narrow or rename it.
 */
export const TENANT_BOOTSTRAP_METHOD_CODES = Object.freeze([
  'cash',
  'card_terminal',
  'bank_transfer',
] as const);
export type TenantBootstrapMethodCode = (typeof TENANT_BOOTSTRAP_METHOD_CODES)[number];

/**
 * Refuses an allocation whose three currencies are not all the same.
 *
 * `sal.allocate_receipt` checks receipt-vs-invoice itself. This adds the caller's
 * declared currency as a third party to the comparison, so a client that believes
 * it is allocating USD against a JOD receipt is told so explicitly rather than
 * having its request silently succeed in a currency it did not intend.
 */
export function assertAllocationCurrencyCoherent(
  declared: string,
  receiptCurrency: string,
  invoiceCurrency: string
): void {
  if (declared !== receiptCurrency) {
    throw new PaymentRuleError(
      `allocation currency ${declared} does not match the receipt's ${receiptCurrency}`
    );
  }
  if (receiptCurrency !== invoiceCurrency) {
    throw new PaymentRuleError(
      `receipt currency ${receiptCurrency} does not match the invoice's ${invoiceCurrency}`
    );
  }
}

/**
 * Refuses an allocation that exceeds either bound, before the primitive does.
 *
 * Duplicating the primitive's own comparison is justified here for the same reason
 * as the credit-note ceiling: `sal.allocate_receipt` raises `check_violation`,
 * whose message is not a caller-safe contract, and "you tried to allocate more
 * than remains" is something a caller can act on. The primitive remains the
 * authority — it holds the locks, and this check races by construction, which is
 * why it is `assert`-shaped advice and not the enforcement.
 */
export function assertAllocationWithinBounds(
  amount: Decimal,
  receiptRemaining: Decimal,
  invoiceOpen: Decimal
): void {
  if (amount.greaterThan(receiptRemaining)) {
    throw new PaymentRuleError(
      `an allocation of ${amount.toString()} exceeds the receipt's unallocated ` +
        `${receiptRemaining.toString()}`
    );
  }
  if (amount.greaterThan(invoiceOpen)) {
    throw new PaymentRuleError(
      `an allocation of ${amount.toString()} exceeds the invoice's open amount of ` +
        `${invoiceOpen.toString()}`
    );
  }
}

/**
 * Refuses an allocation against a receipt or invoice in an unusable state.
 *
 * Mirrors the primitive's own refusals so the caller gets a 409/422 rather than a
 * 500 carrying a constraint name.
 */
export function assertAllocatable(receiptStatus: string, invoiceStatus: string): void {
  if (receiptStatus === 'reversed') {
    throw new PaymentRuleError('a reversed receipt cannot be allocated');
  }
  if (invoiceStatus !== 'issued' && invoiceStatus !== 'credited') {
    throw new PaymentRuleError(
      `an invoice must be issued or credited to receive payment, and this one is "${invoiceStatus}"`
    );
  }
}

/**
 * The SQL text that is the only legal way to create an allocation.
 *
 * Named as a constant so `tests/backend/p1-22-payment-allocation.test.ts` can
 * assert the repository contains no `INSERT INTO sal.payment_allocations` — the
 * grant exists, the guard does not, and a future edit that "optimises" the
 * primitive away would silently remove the only defence of BR-SAL-002.
 */
export const ALLOCATION_PRIMITIVE = 'sal.allocate_receipt';

/**
 * Refuses any allocation statement that is not the primitive.
 *
 * A structural guard, called by the repository against its own SQL. It looks
 * paranoid and is not: `app_runtime` genuinely holds `INSERT` on
 * `sal.payment_allocations`, and a raw insert would be accepted by the database
 * with no bound on the sum at all.
 */
export function assertAllocationUsesPrimitive(sql: string): void {
  if (!sql.includes(ALLOCATION_PRIMITIVE)) {
    throw new PaymentRuleError(
      `an allocation must be created by ${ALLOCATION_PRIMITIVE}; a raw INSERT into ` +
        'sal.payment_allocations is granted but unbounded (BR-SAL-002)'
    );
  }
}
