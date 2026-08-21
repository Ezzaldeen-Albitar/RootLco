/**
 * `payments` module — public surface (Phase 1-22).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/payments`. The
 * boundary checker and the ESLint rule both reject `@/modules/payments/<anything>`.
 *
 * ## What this module owns
 *
 * The payment half of the frozen `sal` schema: `sal.payment_methods`,
 * `sal.receipts`, and `sal.payment_allocations` — plus the four protected primitives
 * that mediate them (`sal.record_receipt`, `sal.allocate_receipt`,
 * `sal.receipt_unallocated`, and the `receipt`/`payment_allocation` legs of
 * `sal.financial_events`, which the primitives write and this module does not).
 *
 * ## What no other module may do
 *
 * Insert a row into `sal.payment_allocations`. `app_runtime` holds the grant, and
 * **no constraint, trigger or exclusion bounds `Σ allocations`** — every bound
 * BR-SAL-002 has lives inside `sal.allocate_receipt`, under its receipt→invoice
 * `FOR UPDATE` lock order. A second writer would not merely bypass this module's
 * conventions; it would be accepted by the database with no limit at all. The
 * repository therefore offers no INSERT path and asserts that property against its
 * own SQL at import time.
 *
 * ## What this module deliberately does not do
 *
 * - **It does not read `sal.invoices`.** The invoice header and its open receivable
 *   come from `@/modules/billing`'s public port; the required shape is declared as
 *   `AllocationInvoiceHeader` so the dependency is stated in one reviewable place.
 * - **It does not reverse a receipt, refund, or correct an allocation.**
 *   `P1-22-L-05`. `sal.receipt_reversals` is full-receipt-only and terminal, and
 *   reaching `reversed` requires an approved reversal under dual control;
 *   `sal.approve_receipt_reversal` is deliberately left unexposed and no partial
 *   reversal or refund exists to expose. Allocations have no UPDATE or DELETE grant,
 *   so a single misallocated line is not correctable by design.
 * - **It does not claim an external settlement.** `ck_payment_methods_kind` admits
 *   `cash`, `card_terminal` and `bank_transfer` only, with the schema's own note "No
 *   online payment gateway/settlement types (ASM-14, CON-04)". There is no column an
 *   authorisation code, gateway reference, card number or token could live in, so the
 *   prohibition is structural and this module stores, forwards and logs none of them.
 * - **It does not publish a partner-level outstanding balance.** `P1-22-L-06`.
 *   `sal.partner_outstanding_balance` loops a partner's issued invoices with no
 *   currency filter and returns one unlabelled scalar; every amount that leaves this
 *   module carries the currency that gives it meaning.
 * - **It does not list receipts.** `sal.receipts` is gated whole-row by
 *   `sal.finance.view`, so a caller without it sees zero rows rather than redacted
 *   ones — there is no honest amount-free projection, and building one would be a
 *   promise the RLS policy does not keep.
 * - **It performs no arithmetic on money.** Every sum is PostgreSQL's, in `numeric`.
 *   `Money` from `@/modules/pricing` has no `add` and no `multiply`, and none is
 *   added here.
 */
import { composeModule } from '@/server/layering';
import { PaymentsRepository } from './data/payments-repository';
import { PaymentService } from './application/payment-service';
import { PaymentReadService } from './application/payment-read-service';

export type {
  PaymentAllocationRow,
  PaymentMethodRow,
  ReceiptRow,
  ReceiptScope,
  ReceiptUnallocatedRow,
} from './data/payments-repository';

export type {
  AllocatePaymentInput,
  AllocationInvoiceHeader,
  AllocationView,
  ReceiptView,
  RecordPaymentInput,
} from './application/payment-service';

export type {
  PaymentMethodView,
  ReceiptAllocationView,
  ReceiptDetailView,
} from './application/payment-read-service';

export {
  ALLOCATION_PRIMITIVE,
  PAYMENT_METHOD_KINDS,
  PAYMENT_METHOD_SCOPES,
  PAYMENT_METHOD_STATUSES,
  PLATFORM_CODE_FORMAT,
  PaymentRuleError,
  RECEIPT_STATUSES,
  assertAllocatable,
  assertAllocationCurrencyCoherent,
  assertAllocationUsesPrimitive,
  assertAllocationWithinBounds,
  assertPaymentMethodIsTenantScoped,
  assertPaymentMethodUsable,
  parsePaymentAmount,
  type PaymentMethodKind,
  type PaymentMethodScope,
  type PaymentMethodStatus,
  type ReceiptStatus,
} from './domain/payments';

/**
 * Composition root: constructs the module's services once per process.
 *
 * Two services over ONE repository. The split is by authority — reads need
 * `sal.finance.view` (and, for the method list, `sal.payment.record`), while the two
 * mutations need `sal.payment.record` and `sal.payment.allocate` respectively — while
 * the SQL for a table stays in one file, because two files writing `sal.receipts` is
 * how a tenant predicate ends up on one query and not the other.
 *
 * The repository and the service classes are never exported. A caller that could
 * construct a `PaymentsRepository` could call `allocateReceipt` without the currency,
 * scope and bound checks the service performs — and, worse, could be extended with
 * the raw INSERT the whole module exists to prevent.
 */
export const paymentsModule = composeModule({
  module: 'payments',
  create: () => {
    const repository = new PaymentsRepository();
    return {
      reads: new PaymentReadService(repository),
      payments: new PaymentService(repository),
    };
  },
});
