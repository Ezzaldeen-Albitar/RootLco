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
 * - **It does not refund, or correct one allocation.** A mis-recorded receipt is
 *   corrected by reversing the WHOLE receipt under dual control and recording its
 *   replacement (ADR-023 D4, `reversals` below): requested by a payment recorder,
 *   approved or rejected by a different holder of `sal.reversal.approve`, withdrawn
 *   only by the requester. The original receipt is retained and its allocations
 *   stay recorded; a reversed receipt stops counting. No partial reversal and no
 *   refund exists (refunds are ADR-023 D2), and allocations have no UPDATE or
 *   DELETE grant, so a single misallocated line is corrected only through the
 *   whole receipt.
 * - **It does not claim an external settlement.** `ck_payment_methods_kind` admits
 *   `cash`, `card_terminal` and `bank_transfer` only, with the schema's own note "No
 *   online payment gateway/settlement types (ASM-14, CON-04)". There is no column an
 *   authorisation code, gateway reference, card number or token could live in, so the
 *   prohibition is structural and this module stores, forwards and logs none of them.
 * - **It does not publish a partner-level outstanding balance.** `P1-22-L-06`.
 *   `sal.partner_outstanding_balance` loops a partner's issued invoices with no
 *   currency filter and returns one unlabelled scalar; every amount that leaves this
 *   module carries the currency that gives it meaning.
 * - **It does not offer an amount-free receipt list.** `sal.receipts` is gated
 *   whole-row by `sal.finance.view`, so a caller without it sees zero rows rather
 *   than redacted ones — there is no honest amount-free projection, and building one
 *   would be a promise the RLS policy does not keep. Phase 1-30 A2 (seam S-11) adds
 *   `sal.receipt-list`, which does not contradict that: it DECLARES
 *   `sal.finance.view`, the same code the sibling `sal.receipt-detail` declares, so
 *   every caller it serves is one `sel_receipts_gated` already hands whole rows to.
 *   The refusal above is a refusal to publish a list to callers who cannot hold the
 *   code, and the policy still enforces it.
 * - **It performs no arithmetic on money.** Every sum is PostgreSQL's, in `numeric`.
 *   `Money` from `@/modules/pricing` has no `add` and no `multiply`, and none is
 *   added here.
 */
import { composeModule } from '@/server/layering';
import { PaymentsRepository } from './data/payments-repository';
import { PaymentMethodBootstrapRepository } from './data/payment-method-bootstrap-repository';
import { PaymentService } from './application/payment-service';
import { PaymentReadService } from './application/payment-read-service';
import { ReceiptReversalService } from './application/receipt-reversal-service';
import { PaymentMethodBootstrapService } from './application/payment-method-bootstrap-service';
import { PaymentsReportPort } from './application/payments-report-port';

export type {
  PaymentAllocationRow,
  PaymentMethodRow,
  ReceiptDocumentFilter,
  ReceiptListRow,
  ReceiptReferenceRow,
  ReceiptReversalRow,
  ReceiptRow,
  ReceiptScope,
  ReceiptUnallocatedRow,
  ReportDocumentPage,
  ThirdPartyStatement,
} from './data/payments-repository';

export type {
  AllocatePaymentInput,
  AllocationInvoiceHeader,
  AllocationThirdPartyView,
  AllocationView,
  ReceiptView,
  RecordPaymentInput,
  RecordReplacementInput,
} from './application/payment-service';

export type {
  ReceiptReversalResult,
  ReceiptReversalView,
} from './application/receipt-reversal-service';

export type {
  PaymentMethodView,
  ReceiptAllocationThirdPartyView,
  ReceiptAllocationView,
  ReceiptDetailView,
  ReceiptLinkView,
  ReceiptListView,
  ReceiptPayerView,
  ReceiptReversalDetailView,
} from './application/payment-read-service';

export type {
  ReceiptDocumentEntry,
  ReceiptDocumentSummary,
  ReceiptDocumentTotal,
} from './application/payments-report-port';

export {
  ALLOCATION_PRIMITIVE,
  MAX_REVERSAL_REASON,
  PAYMENT_METHOD_KINDS,
  PAYMENT_METHOD_SCOPES,
  PAYMENT_METHOD_STATUSES,
  PLATFORM_CODE_FORMAT,
  PaymentRuleError,
  RECEIPT_REVERSAL_PERMISSIONS,
  RECEIPT_REVERSAL_RULES,
  RECEIPT_REVERSAL_STATES,
  RECEIPT_STATUSES,
  TENANT_BOOTSTRAP_METHOD_CODES,
  type TenantBootstrapMethodCode,
  MAX_THIRD_PARTY_AUTHORISATION_REFERENCE,
  MAX_THIRD_PARTY_REASON,
  THIRD_PARTY_PERMISSION,
  THIRD_PARTY_RELATIONSHIPS,
  THIRD_PARTY_RULES,
  thirdPartyViolations,
  type ThirdPartyDeclaration,
  type ThirdPartyRelationship,
  type ThirdPartyViolation,
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
  type ReceiptReversalState,
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
 *
 * `methodBootstrap` is the third service and the one exception to "two services over
 * ONE repository": it writes `sal.payment_methods` during tenant provisioning, as
 * `app_platform`, under a policy set no runtime caller can reach, and it must not be
 * reachable through the repository the two runtime services share. Its own repository
 * therefore holds exactly one statement and no read. The module still owns the table,
 * which is why the writer lives here and `@/modules/platform` calls it rather than
 * reaching into `sal` itself.
 */
export const paymentsModule = composeModule({
  module: 'payments',
  create: () => {
    const repository = new PaymentsRepository();
    return {
      reads: new PaymentReadService(repository),
      payments: new PaymentService(repository),
      // ADR-023 D4 (P1-32-PRE-OD-FD4): request, approve, reject and withdraw the
      // full reversal of a receipt. The replacement receipt is `payments`' own act.
      reversals: new ReceiptReversalService(repository),
      // P1-31 P-11 slice 4. The REPORTING port. Separate from `reads` because
      // that service is the receipt screen's — bounded by a payer or an invoice,
      // publishing the unallocated remainder and the allocation history — and a
      // period report shares none of those shapes.
      reportPort: new PaymentsReportPort(repository),
      methodBootstrap: new PaymentMethodBootstrapService(new PaymentMethodBootstrapRepository()),
    };
  },
});
