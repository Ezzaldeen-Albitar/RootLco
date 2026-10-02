/**
 * The payment contract this phase consumes (P1-30, `W7`, FE-016 payment form,
 * FE-017 partial payment, FE-018 receipt, FE-021 receipt print).
 *
 * | operation                  | method | path                                  | permissions (ALL required)                |
 * | -------------------------- | ------ | ------------------------------------- | ----------------------------------------- |
 * | `sal.receipt-list`         | GET    | `/payments`                           | `sal.finance.view`                        |
 * | `sal.receipt-detail`       | GET    | `/payments/{paymentId}`               | `sal.finance.view`                        |
 * | `sal.payment-method-list`  | GET    | `/payment-methods`                    | **`sal.payment.record`**                  |
 * | `sal.payment-record`       | POST   | `/payments`                           | `sal.payment.record`, `sal.finance.view`  |
 * | `sal.payment-allocate`     | POST   | `/payments/{paymentId}/allocations`   | `sal.payment.allocate`, `sal.finance.view`|
 * | `sal.receipt-reversal-request`   | POST | `/payments/{paymentId}/reversals`            | `sal.payment.record`, `sal.finance.view`   |
 * | `sal.receipt-reversal-approve`   | POST | `/receipt-reversals/{reversalId}/approval`   | `sal.reversal.approve`, `sal.finance.view` |
 * | `sal.receipt-reversal-reject`    | POST | `/receipt-reversals/{reversalId}/rejection`  | `sal.reversal.approve`, `sal.finance.view` |
 * | `sal.receipt-reversal-withdraw`  | POST | `/receipt-reversals/{reversalId}/withdrawal` | `sal.payment.record`, `sal.finance.view`   |
 * | `sal.receipt-replacement-record` | POST | `/payments/{paymentId}/replacement`          | `sal.payment.record`, `sal.finance.view`   |
 *
 * Two more are read from beside this module, and are named here because the
 * screen depends on them: `sal.invoice-outstanding-read`
 * (`GET /invoices/{invoiceId}/outstanding`, `sal.finance.view` alone) for what
 * an invoice still owes after an allocation, and `org.branch-list`
 * (`GET /org/branches`, `org.branch.read`) for the target picker.
 *
 * Typed from the routes that own the shapes and the views in
 * `apps/api/src/modules/payments/application/*`. The published document carries
 * no field schema for these responses, so these interfaces are the only
 * field-level contract; `tests/backend/p1-30-w7-payments.test.ts` holds rows
 * that came out of the database against the fields they publish.
 *
 * ## Neither write is version-guarded
 *
 * Unlike the invoice acts of `W6`, `sal.payment-record` and
 * `sal.payment-allocate` declare no version guard: no `If-Match` is sent, none
 * is required, and neither response carries an `ETag`. A refused allocation is
 * therefore never a version conflict — it is a bound (`ERR-TRN-001`, 409)
 * decided inside row locks against figures the database recomputes.
 *
 * ## `replayed` belongs to ONE response, and a transport replay is not it
 *
 * `ReceiptView.replayed` exists only on the echo of `sal.payment-record`; the
 * allocation echo has no such field. A same-key retry is served by the
 * transport, which returns the STORED body — status 200, and the flag as it was
 * first written (`false`). The same key with a different body is refused
 * (`ERR-INT-001`, 409). Each opened form therefore holds one key for its own
 * retries, and the screen never reads a replay from the header.
 *
 * ## Every figure is the server's
 *
 * `money`, `unallocated` and an invoice's open balance are `numeric(18,4)`
 * strings computed by PostgreSQL on every call (`sal.receipt_unallocated`,
 * `sal.invoice_open_receivable`). The screen renders them and subtracts
 * nothing; a remainder is read back, never derived.
 *
 * ## What the backend does not publish, said rather than hidden
 *
 * - No payer NAME on the receipt detail — only `payerPartnerId`. The list
 *   names the payer beside the id (`ReceiptListEntry.payer`) for a caller who
 *   may read customers, and the screen asks the list for the one receipt's
 *   payer when it opens a receipt (Owner directive, browser QA row 5.6b).
 * - No cashier: `received_by` is stored and never selected, deliberately.
 * - No note or memo on a receipt; the only free text is `reference`, the
 *   branch's opaque receipt number.
 * - An allocation carries `invoiceId` and no invoice number; reading one costs
 *   a `sal.invoice-detail` call, which needs `sal.invoice.manage` — a code a
 *   cashier does not hold, so the printed copy names identifiers.
 * - No reversal of ONE allocation: `sal.payment_allocations` is INSERT-only.
 *   A mis-recorded receipt is corrected by reversing the WHOLE receipt under
 *   two people (ADR-023 D4) and recording its replacement; the allocation form
 *   says so before it sends one.
 * - The allocation echo does not carry the invoice's new balance; the screen
 *   re-reads `sal.invoice-outstanding-read` for it.
 */

/** The permissions the W7 screen consults, as the backend registers them. */
export const PAYMENT_PERMISSIONS = {
  /** Both receipt reads — the page's own gate, and the code a cashier holds. */
  financeView: 'sal.finance.view',
  /** Recording a receipt, AND the method picker read (a write code gating a catalogue). */
  record: 'sal.payment.record',
  /** Allocating a receipt to an invoice. */
  allocate: 'sal.payment.allocate',
  /**
   * Approving and rejecting a receipt reversal somebody else requested (ADR-023
   * D4). Requesting and withdrawing are `record`'s; no credit-note code decides one.
   */
  reversalApprove: 'sal.reversal.approve',
  /**
   * Applying a receipt to ANOTHER customer's invoice as a third-party payment — an
   * insurer, an employer (ADR-023 D14). `sal.payment-allocate` consults it only for
   * such an allocation; without it the screen blocks with the plain reason.
   */
  thirdParty: 'sal.payment.third_party',
  /** Whether a branch list is requested for the target picker. */
  branchRead: 'org.branch.read',
  /** The payer is FOUND among customers, which `crm.customer-search` answers. */
  customerRead: 'crm.customer.read',
  /**
   * The invoice is FOUND among the branch's invoices — `sal.invoice-list`'s code.
   * The finance code, not an invoice-writing one: every caller of this page holds
   * it, so a cashier who may allocate is never refused the invoice to allocate to.
   */
  invoiceList: 'sal.finance.view',
} as const;

/** `ck_receipts_status`, mirrored. `reversed` is terminal: reached only by an approved reversal. */
export const RECEIPT_STATUSES = [
  'recorded',
  'partially_allocated',
  'allocated',
  'reversed',
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/** `ck_payment_methods_kind`, mirrored. */
export const METHOD_KINDS = ['cash', 'card_terminal', 'bank_transfer'] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];

/**
 * The page this screen asks the list for. It is a choice, not the route's
 * bound: `sal.receipt-list` defaults to 50 and refuses anything above 100
 * (`ERR-VAL-001`), so this sits well inside what the route accepts.
 */
export const PAGE_SIZE = 25;

/** A labelled amount as the server states it — `MoneyView`. */
export interface MoneyView {
  readonly amount: string;
  readonly currency: string;
  /**
   * How many decimals the currency is written with — `shared.currencies.minor_unit`,
   * as the server published it (Owner decision D1). `formatMoney` writes the amount
   * with it; absent only where the read did not look the currency up.
   */
  readonly minorUnit?: number | undefined;
}

/**
 * A payment method — `PaymentMethodView`. `recordable` is DERIVED by the server
 * as `scope === 'tenant'`: a platform row is visible to every tenant and
 * citable by no receipt at all, because the receipt's foreign key pairs the
 * tenant with the method and a platform row has no tenant. Nothing in this
 * phase can create a tenant row.
 */
export interface PaymentMethod {
  readonly id: string;
  readonly scope: string;
  readonly methodCode: string;
  readonly kind: MethodKind;
  readonly displayName: string;
  readonly status: string;
  readonly recordable: boolean;
}

/**
 * One allocation of a receipt — `ReceiptAllocationView`. Immutable. Names its
 * invoice by number (finance retest DF-R2-2); the id is for addressing only and is
 * never shown.
 */
export interface ReceiptAllocation {
  readonly id: string;
  /** `seq` as a string; an ordering token, never arithmetic. */
  readonly sequence: string;
  readonly invoiceId: string;
  /** The invoice's number; `null` only when the invoice is not visible in this scope. */
  readonly invoiceNumber: string | null;
  /** The customer the invoice bills, by name; `null` when withheld from this reader. */
  readonly invoicePayerName: string | null;
  readonly money: MoneyView;
  readonly allocatedAt: string;
  /**
   * When this receipt's payer settled another customer's invoice as a third-party
   * payment (ADR-023 D14), what was recorded; `null` (or absent) otherwise.
   */
  readonly thirdParty?: ReceiptAllocationThirdParty | null;
}

/**
 * What a third-party payer is to the invoice's customer (ADR-023 D14) — the
 * server's fixed vocabulary, mirrored. An organisation cannot add to it.
 */
export const THIRD_PARTY_RELATIONSHIPS = ['insurer', 'employer', 'other'] as const;
export type ThirdPartyRelationship = (typeof THIRD_PARTY_RELATIONSHIPS)[number];

/** The server's ceilings for a third-party statement, so the form refuses before the 422. */
export const THIRD_PARTY_REFERENCE_MAX = 100;
export const THIRD_PARTY_REASON_MAX = 2000;

/**
 * The refusal of a receipt applied to somebody else's invoice without third-party
 * handling, as the invoice field's own sentence (`form.violation.<rule>`).
 */
export const PAYER_MISMATCH_KEY = 'form.violation.allocation_payer_mismatch';

/** A third-party allocation's record — `ReceiptAllocationThirdPartyView`. */
export interface ReceiptAllocationThirdParty {
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly reason: string;
  /** Who authorised it, by name; `null` when withheld from this reader. */
  readonly authorisedByName: string | null;
}

/** The receipt as the list publishes it — `ReceiptListView` (the detail minus its allocations). */
export interface Receipt {
  readonly id: string;
  /** The branch's opaque receipt number; never parsed. */
  readonly reference: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly payerPartnerId: string;
  readonly method: {
    readonly id: string;
    readonly scope: string;
    readonly kind: MethodKind;
    readonly displayName: string;
    readonly status: string;
  } | null;
  readonly money: MoneyView;
  /** `sal.receipt_unallocated`, recomputed per call; `0` for a reversed receipt. */
  readonly unallocated: MoneyView;
  readonly status: ReceiptStatus;
  readonly receivedAt: string;
  readonly evidenceDocumentVersionId: string | null;
  readonly recordVersion: number;
}

/**
 * Who paid, by name — `ReceiptPayerView`. Every field is `null` when the payer is
 * not named to this caller: withheld without `crm.customer.read`, or retired
 * since the receipt was taken. The id is `payerPartnerId` beside it.
 */
export interface ReceiptPayer {
  readonly displayName: string | null;
  readonly displayNumber: string | null;
  readonly partyType: string | null;
}

/** One row of `sal.receipt-list` — `ReceiptListView`: the receipt and its payer's name. */
export interface ReceiptListEntry extends Receipt {
  readonly payer: ReceiptPayer;
}

/** `ck_receipt_reversals_approval_state`, mirrored (ADR-023 D4). Every state but `pending` is final. */
export const REVERSAL_STATES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type ReversalState = (typeof REVERSAL_STATES)[number];

/** The routes' `MAX_REVERSAL_REASON`: a request's and a rejection's reason, two thousand characters. */
export const REVERSAL_REASON_MAX = 2000;

/**
 * A receipt reversal — `ReceiptReversalView` (ADR-023 D4). The whole receipt's
 * amount, never a part of it. `requestedBy` and `decidedBy` are ids for deciding
 * who may act — whose request it is — and are never shown.
 */
export interface ReceiptReversal {
  readonly id: string;
  readonly receiptId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly state: ReversalState;
  readonly amount: MoneyView;
  readonly reason: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  /** The approver of an approved reversal, else who withdrew or rejected it. */
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Why it was rejected; `null` on every other state. */
  readonly decisionReason: string | null;
  readonly reversedAt: string | null;
  /** What a rejection and a withdrawal send as `If-Match`. */
  readonly recordVersion: number;
}

/**
 * The reversal as the receipt detail publishes it — `ReceiptReversalDetailView`:
 * the people by NAME, `null` for a reader who may not read users.
 */
export interface ReceiptReversalDetail extends ReceiptReversal {
  readonly requestedByName: string | null;
  readonly decidedByName: string | null;
}

/** The echo of the four reversal commands — `ReceiptReversalResult`. */
export interface ReceiptReversalEcho {
  readonly reversal: ReceiptReversal;
  /** True when the reversal was already in the state the command asked for. */
  readonly replayed: boolean;
}

/** A receipt named by its id and its branch's number — `ReceiptLinkView`. */
export interface ReceiptLink {
  readonly id: string;
  readonly reference: string;
}

/** `sal.receipt-detail` — `ReceiptDetailView`; the receipt plus its allocation history. */
export interface ReceiptDetail extends Receipt {
  readonly allocations: readonly ReceiptAllocation[];
  /** True when the receipt holds more allocations than the read publishes (100). */
  readonly allocationsTruncated: boolean;
  /**
   * Its reversal (ADR-023 D4): the pending or approved one, else the latest
   * declined one; `null` when nobody asked. While `pending`, no allocation.
   */
  readonly reversal: ReceiptReversalDetail | null;
  /** The reversed receipt this one replaces. */
  readonly replaces: ReceiptLink | null;
  /** The receipt that replaces this reversed one. */
  readonly replacedBy: ReceiptLink | null;
}

/**
 * The echo of `sal.payment-record` — `ReceiptView`, which is NOT the list's row.
 * It names the method by id alone (no label), and carries NO remainder: a
 * receipt's `unallocated` is only ever read back from `sal.receipt-detail`.
 */
export interface RecordedReceipt {
  readonly id: string;
  readonly reference: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly paymentMethodId: string;
  readonly payerPartnerId: string;
  readonly money: MoneyView;
  readonly status: ReceiptStatus;
  readonly receivedAt: string;
  readonly recordVersion: number;
  /** The reversed receipt this one replaces (ADR-023 D4), or `null`. */
  readonly replacesReceiptId?: string | null;
  /**
   * The server's own flag, true only when its key lookup found the receipt that
   * key had already created. A transport replay returns the STORED body, so an
   * ordinary retry reports `false`; the screen never infers a replay otherwise.
   */
  readonly replayed: boolean;
}

/**
 * The two bounds an allocation can break, as the amount field's own sentences:
 * `payment-service` names the bound on `body.amount` (finance checkpoint DF-7),
 * and the client derives `form.violation.<rule>` from it.
 */
export const OVER_ALLOCATION_KEYS = Object.freeze({
  receipt: 'form.violation.allocation_exceeds_receipt_remaining',
  invoice: 'form.violation.allocation_exceeds_invoice_open',
} as const);

/**
 * The echo of `sal.payment-allocate` — `AllocationView`. Carries the receipt's
 * state AFTER the database re-summed it, and NOT the invoice's new balance.
 */
export interface Allocation {
  readonly id: string;
  readonly sequence: string;
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly money: MoneyView;
  readonly allocatedAt: string;
  readonly receiptStatus: ReceiptStatus;
  readonly receiptUnallocated: MoneyView;
  /** The third-party detail booked with it (ADR-023 D14), or `null`/absent for an ordinary one. */
  readonly thirdParty?: {
    readonly relationship: string;
    readonly authorisationReference: string;
    readonly reason: string;
  } | null;
}
