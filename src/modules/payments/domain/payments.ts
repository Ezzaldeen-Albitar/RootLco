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
 * `sal.receipt_reversals` row already exists (`sal.guard_receipt_freeze`), which is
 * why this phase exposes no reversal route: the state is reachable but the
 * approval path that reaches it is out of scope (`P1-22-L-05`).
 */
export const RECEIPT_STATUSES = Object.freeze([
  'recorded',
  'partially_allocated',
  'allocated',
  'reversed',
] as const);
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

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
