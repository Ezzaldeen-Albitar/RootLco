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
 * - No payer NAME on any receipt read — only `payerPartnerId`.
 * - No cashier: `received_by` is stored and never selected, deliberately.
 * - No note or memo on a receipt; the only free text is `reference`, the
 *   branch's opaque receipt number.
 * - An allocation carries `invoiceId` and no invoice number; reading one costs
 *   a `sal.invoice-detail` call, which needs `sal.invoice.manage` — a code a
 *   cashier does not hold, so the printed copy names identifiers.
 * - No reversal: `sal.payment_allocations` is INSERT-only and no route undoes
 *   an allocation. The screen says so before it sends one.
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
  /** Whether a branch list is requested for the target picker. */
  branchRead: 'org.branch.read',
} as const;

/** `ck_receipts_status`, mirrored. `reversed` is terminal and unreachable from this phase. */
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

/** One allocation of a receipt — `ReceiptAllocationView`. Immutable; carries no invoice number. */
export interface ReceiptAllocation {
  readonly id: string;
  /** `seq` as a string; an ordering token, never arithmetic. */
  readonly sequence: string;
  readonly invoiceId: string;
  readonly money: MoneyView;
  readonly allocatedAt: string;
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

/** `sal.receipt-detail` — `ReceiptDetailView`; the list's row plus its allocation history. */
export interface ReceiptDetail extends Receipt {
  readonly allocations: readonly ReceiptAllocation[];
  /** True when the receipt holds more allocations than the read publishes (100). */
  readonly allocationsTruncated: boolean;
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
  /**
   * The server's own flag, true only when its key lookup found the receipt that
   * key had already created. A transport replay returns the STORED body, so an
   * ordinary retry reports `false`; the screen never infers a replay otherwise.
   */
  readonly replayed: boolean;
}

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
}
