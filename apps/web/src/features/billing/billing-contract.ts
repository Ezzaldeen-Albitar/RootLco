/**
 * The invoice contract this phase consumes (P1-30, `W6`, FE-014 invoice
 * preview, FE-015 issue and cancel, FE-019 outstanding balance, FE-020 print).
 *
 * | operation                       | method | path                                       | permissions (ALL required)               |
 * | ------------------------------- | ------ | ------------------------------------------ | ---------------------------------------- |
 * | `sal.work-order-invoice-read`   | GET    | `/work-orders/{workOrderId}/invoice`       | `sal.invoice.manage`                     |
 * | `sal.invoice-preview`           | GET    | `/work-orders/{workOrderId}/invoice-preview` | `sal.invoice.manage`, `sal.finance.view` |
 * | `sal.invoice-detail`            | GET    | `/invoices/{invoiceId}`                    | `sal.invoice.manage`                     |
 * | `sal.invoice-outstanding-read`  | GET    | `/invoices/{invoiceId}/outstanding`        | `sal.finance.view`                       |
 * | `sal.invoice-create`            | POST   | `/invoices`                                | `sal.invoice.manage`, `sal.finance.view` |
 * | `sal.invoice-issue`             | POST   | `/invoices/{invoiceId}/issuance`           | `sal.invoice.issue`, `sal.finance.view`  |
 * | `sal.invoice-cancel`            | POST   | `/invoices/{invoiceId}/cancellation`       | `sal.invoice.manage`                     |
 *
 * Typed from the routes that own the shapes and from the views in
 * `apps/api/src/modules/billing/application/*`. The published document carries
 * no field schema for these responses, so these interfaces are the only
 * field-level contract; `tests/backend/p1-30-w6-invoices.test.ts` holds rows
 * that came out of the database against the fields they publish, with local row
 * types and literal expected strings.
 *
 * ## `sal.finance.view` splits every response, and nothing is zeroed
 *
 * The invoice header lives in a table the caller's scope gates; the money lives
 * in two amount tables gated by `sal.finance.view` and joined from the outside.
 * A caller without the code receives the header — status, number, dates, line
 * types, quantities — with `totals` and every line's `money` present as `null`.
 * Nothing is zeroed and nothing is omitted; the screen renders those areas as
 * unavailable, never as an amount. The outstanding read goes further: for an
 * issued invoice whose amounts the caller may not see it REFUSES (403) rather
 * than answer a zero that would look settled.
 *
 * ## Every figure is the server's
 *
 * Money is `numeric(18,4)` and travels as `{ amount: string, currency }`;
 * the preview's figures are bare strings labelled once by the document's
 * `currency`; quantities are `numeric(12,3)` strings; `taxRate` is a captured
 * FRACTION string (never a percent). Totals, the outstanding balance and every
 * line amount are computed by the database; the screen renders them and
 * computes nothing.
 *
 * ## Issue and cancel are guarded by the INVOICE's version
 *
 * `sal.invoice-detail` publishes `recordVersion` (the invoice's, echoed as the
 * response ETag); `sal.invoice-issue` (no body) and `sal.invoice-cancel`
 * (`{ reason }`) require it as `If-Match` and refuse a stale one (409) or a
 * missing one (428) — the version is compared before anything else. Under the
 * current version, issuing an already-issued invoice and cancelling an
 * already-cancelled one answer `replayed: true` and change nothing; any other
 * off-draft state is refused (409). Create is idempotent through the transport
 * key and not version-guarded.
 *
 * ## What the backend does not publish, said rather than hidden
 *
 * - No invoice-for-partner list. A branch's invoices are listed by
 *   `sal.invoice-list` (`sal.finance.view`), which the counter narrows to its
 *   own issued sales with `saleKind=counter_sale` so a copy can be printed again
 *   (finance checkpoint, DF-B3); a job's invoice is still reached through its
 *   work order (`sal.work-order-invoice-read`).
 * - No line description on the detail; the preview is the only read with one.
 * - No print or document route: a printable view is composed on the client
 *   from the detail and, when its revision matches, the preview.
 * - No tax rate is reachable today (no tax classes exist), so `taxTotal` and
 *   `taxRate` are shown as returned, which is zero.
 */

/** The permissions the W6 screen consults, as the backend registers them. */
export const BILLING_PERMISSIONS = {
  /** Every invoice read and the create/cancel writes — the page's own gate. */
  manage: 'sal.invoice.manage',
  /** Amounts: the preview, the totals, line money, the outstanding balance, creating and issuing. */
  financeView: 'sal.finance.view',
  /** Issuing (allocating the number). */
  issue: 'sal.invoice.issue',
  /** The work-order header, for the screen's context. */
  workOrderRead: 'wo.work_order.read',
  /** Credit notes — both reads, the request and the withdrawal declare it (DEF-T-07). */
  creditManage: 'sal.credit.manage',
  /**
   * Asking for a refund, withdrawing your own request and recording its payout
   * (ADR-023 D2, part 2) — the code that records a receipt.
   */
  paymentRecord: 'sal.payment.record',
  /** Approving and rejecting somebody else's refund request (ADR-023 D2, part 2). */
  refundApprove: 'sal.refund.approve',
  /**
   * Deciding a credit note — the approval and the rejection declare it (Owner
   * decision D13, ADR-023). An approval also needs a credit-note approval limit,
   * which the server checks; holding the code is what makes the decision offered.
   */
  creditApprove: 'sal.credit.approve',
  /** A different payer is FOUND among customers, which `crm.customer-search` answers. */
  customerRead: 'crm.customer.read',
  /**
   * The customer-returns screen's own gate (`inv.stock.read`). A credit note
   * raised by a return links to that screen only for a reader it would admit
   * (DF-B4); stated here so the credit-note page needs no inventory import.
   */
  returnsRead: 'inv.stock.read',
} as const;

/** `ck_invoices_status`, mirrored. `credited` is admitted by the guard and unreachable today. */
export const INVOICE_STATUSES = ['draft', 'issued', 'credited', 'void_before_issue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * How much of an invoice has been credited (Owner decision D7, ADR-023) —
 * `BillingReadService.SettlementView.creditStatus`, derived by the server from the
 * approved credits against the invoice's gross. Never read from `status`.
 */
export const CREDIT_STATUSES = ['none', 'partly_credited', 'credited'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

/** What was paid against what is still open (D7). `nothing_due`: credits cleared it, nothing paid. */
export const PAYMENT_STATUSES = ['open', 'partly_paid', 'paid', 'nothing_due'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Money owed back or handed back (D7), as the server derives it (ADR-023 D2):
 * `owed` — an approved credit exceeded what the invoice still owed, and nothing has
 * been asked for or paid back yet; `requested` — a refund request waits for a second
 * person's decision; `approved` — a request is approved and its payout not yet
 * recorded; `partly_refunded` — part was paid back, the rest is still owed;
 * `refunded` — everything owed was paid back. Nothing is paid back automatically.
 */
export const REFUND_STATUSES = [
  'none',
  'owed',
  'requested',
  'approved',
  'partly_refunded',
  'refunded',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** `SettlementView` — three separate positions of an issued invoice, and the two amounts behind them. */
export interface Settlement {
  readonly creditStatus: CreditStatus;
  readonly paymentStatus: PaymentStatus;
  readonly refundStatus: RefundStatus;
  readonly credited: MoneyView;
  readonly paid: MoneyView;
  /**
   * What the customer is owed back — the open refund obligations of the invoice
   * (ADR-023 D2), the server's sum; absent from a server before D2.
   */
  readonly refundOwed?: MoneyView;
  /**
   * What has been paid back to the customer — the recorded payouts of the invoice's
   * refund requests (ADR-023 D2, P1-32-PRE-OD-FD2B), the server's sum; absent from a
   * server before it.
   */
  readonly refunded?: MoneyView;
  /**
   * What the invoice can still be credited — its total less the credit notes already
   * approved (ADR-023 D2) — as the server states it. The credit-note form caps at
   * this, not at what is still owed; absent from a server before P1-32-PRE-OD-FD2B.
   */
  readonly creditable?: MoneyView;
  /**
   * The part of `paid` somebody other than the customer paid as a third-party
   * payment (ADR-023 D14), oldest first; absent from a server before D14.
   */
  readonly thirdPartyPayments?: readonly ThirdPartyPayment[];
  /** True when the invoice has more third-party payments than are listed. */
  readonly thirdPartyPaymentsTruncated?: boolean;
}

/** One third-party payment of an invoice — `ThirdPartyPaymentView` (ADR-023 D14). */
export interface ThirdPartyPayment {
  readonly receipt: { readonly id: string; readonly reference: string };
  /** Who paid, by name; `null` when withheld from this reader. */
  readonly payerName: string | null;
  /** `insurer`, `employer` or `other`. */
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly reason: string;
  readonly money: MoneyView;
  readonly allocatedAt: string;
}

/** `ck_invoice_lines_line_type`, mirrored. The preview carries `service` and `part` only. */
export const LINE_TYPES = ['service', 'part', 'fee'] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** Column width of a cancellation reason, mirrored, so the form refuses before the 422 does. */
export const MAX_REASON = 2000;

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

/** The three header totals — `InvoiceTotalsView`; `null` on the header when the amounts are not the caller's to see. */
export interface InvoiceTotals {
  readonly net: MoneyView;
  readonly tax: MoneyView;
  readonly gross: MoneyView;
}

/** `ck_invoices_sale_kind`, mirrored. A counter sale has no work order (P1-32). */
export const SALE_KINDS = ['work_order', 'counter_sale'] as const;
export type SaleKind = (typeof SALE_KINDS)[number];

/** The invoice header — `InvoiceView`. */
export interface Invoice {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  /**
   * Null exactly when `saleKind` is `counter_sale`: a part sold over the counter
   * opens no job, and `ck_invoices_sale_kind_source` makes the work order present
   * for exactly one of the two kinds.
   */
  readonly workOrderId: string | null;
  readonly saleKind: SaleKind;
  readonly quotationRevisionId: string | null;
  readonly payerPartnerId: string;
  readonly currency: string;
  readonly status: InvoiceStatus;
  /** Present iff issued; opaque text from the branch's sequence, never parsed. */
  readonly invoiceNumber: string | null;
  readonly issuedAt: string | null;
  /** The version `If-Match` on issue and cancel must carry. */
  readonly recordVersion: number;
  readonly totals: InvoiceTotals | null;
}

/**
 * Who an invoice bills, by name — `InvoicePayerView`. Every field is `null` when
 * the payer is not named to this caller: withheld without `crm.customer.read`, or
 * retired since the invoice was written.
 */
export interface InvoicePayer {
  readonly displayName: string | null;
  readonly displayNumber: string | null;
  readonly partyType: string | null;
}

/**
 * One row of `sal.invoice-list` — `InvoiceListEntryView` (Owner directive,
 * `P1-32-PRE-OD-UX`).
 *
 * `outstanding` is `null` whenever the balance cannot be believed for this
 * caller — an issued or credited invoice whose amounts it cannot see — and is
 * never a zero standing in for "not shown". A draft's zero IS the true answer, and
 * the picker still shows no balance beside it (`InvoicePicker`).
 */
export interface InvoiceListEntry extends Invoice {
  readonly payer: InvoicePayer;
  readonly outstanding: MoneyView | null;
  /**
   * What the invoice can still be credited — its total less the credit notes already
   * approved (ADR-023 D2) — `null` exactly when `outstanding` is; absent from a server
   * before P1-32-PRE-OD-FD2B. The credit-note form caps at this.
   */
  readonly creditable?: MoneyView | null;
}

/** The shortest and longest box `sal.invoice-list` accepts, mirrored. */
export const MIN_INVOICE_SEARCH = 2;
export const MAX_INVOICE_SEARCH = 80;

/** A line's money — `InvoiceLineMoneyView`; `null` without `sal.finance.view`. */
export interface InvoiceLineMoney {
  readonly unitPrice: MoneyView;
  readonly net: MoneyView;
  readonly tax: MoneyView;
  readonly gross: MoneyView;
  readonly payerSplit: { readonly customer: MoneyView; readonly warranty: MoneyView };
}

/**
 * One invoice line — `InvoiceLineView`. Carries no description of its own; a
 * work-order line names the quotation line it was copied from in `source`.
 */
export interface InvoiceLine {
  readonly id: string;
  readonly lineNumber: number;
  readonly lineType: LineType;
  /** `numeric(12,3)` as a string; not money, no currency of its own. */
  readonly quantity: string;
  readonly currency: string;
  readonly sourceQuotationItemId: string | null;
  /**
   * `InvoiceLineItemView` — what a counter-sale line sold, by code and name, so
   * the printed copy can describe the line (GAP-09); on a work-order PART line,
   * the item its quotation line quoted (ADR-023 D6). `null` on a service line,
   * which is described by its quotation item instead. Not money.
   */
  readonly item: InvoiceLineItem | null;
  /**
   * `InvoiceLineUnitView` — the unit a work-order part line's quantity is in, as
   * its quotation line captured it (ADR-023 D6). `null` otherwise. Not money.
   */
  readonly unit: InvoiceLineUnit | null;
  /**
   * `InvoiceLineSourceView` — the quotation line this work-order line was copied
   * from, as quoted (ADR-023 D5/D15): the printed copy is described from it, never
   * from the revision the work order would bill now. `null` on a counter-sale
   * line and without `sal.finance.view`.
   */
  readonly source: InvoiceLineSource | null;
  readonly recordVersion: number;
  readonly money: InvoiceLineMoney | null;
}

/** `InvoiceLineSourceView` — a work-order line's source quotation line, as quoted. */
export interface InvoiceLineSource {
  readonly description: string | null;
  /** `numeric(12,3)` as a string: what the quotation line quoted. Not money. */
  readonly quotedQuantity: string;
  readonly discount: MoneyView;
}

/**
 * `InvoiceSourceView` — the quotation revision a work-order invoice was made
 * from, as quoted: its line count and its before-discount and discount totals.
 */
export interface InvoiceSource {
  readonly quotationRevisionId: string;
  readonly lineCount: number;
  readonly subtotal: MoneyView;
  readonly discountTotal: MoneyView;
}

/** `InvoiceLineItemView` — an item a counter-sale line sold. `code` is its SKU. */
export interface InvoiceLineItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** `InvoiceLineUnitView` — the unit a part line's quantity is in, as quoted. */
export interface InvoiceLineUnit {
  readonly code: string;
  readonly name: string;
}

/** `sal.invoice-detail` — `InvoiceDetailView`; `recordVersion` mirrors the header's. */
export interface InvoiceDetail {
  readonly invoice: Invoice;
  readonly lines: readonly InvoiceLine[];
  /** The revision it was made from, as quoted; `null` on a counter sale and without `sal.finance.view`. */
  readonly source: InvoiceSource | null;
  readonly recordVersion: number;
}

/**
 * `sal.work-order-invoice-read` — `WorkOrderInvoiceView`. `invoice` is `null` when
 * the order has no live invoice; otherwise it is the open draft, else the newest.
 * A work order may carry several live invoices (ADR-023 D5/D15), all listed in
 * `invoices`, draft first and then newest first; `approvedWorkToInvoice` says
 * approved quotation work remains that no live invoice holds.
 */
export interface WorkOrderInvoice {
  readonly workOrderId: string;
  readonly invoice: Invoice | null;
  readonly invoices: readonly Invoice[];
  readonly invoicesTruncated: boolean;
  readonly approvedWorkToInvoice: boolean;
}

/** One preview line — `InvoicePreviewLine`; bare strings labelled by the document's `currency`. */
export interface InvoicePreviewLine {
  readonly sourceQuotationItemId: string;
  readonly lineNumber: number;
  readonly lineType: LineType;
  readonly description: string | null;
  readonly serviceId: string | null;
  readonly itemId: string | null;
  /**
   * On a PART line, the item as its quotation line quoted it — stock code and name
   * (ADR-023 D6). `null` on a service line, which the read describes by its typed
   * note only. Not money.
   */
  readonly item: InvoiceLineItem | null;
  /** On a PART line, the unit its quantity is in, as quoted. `null` otherwise. Not money. */
  readonly unit: InvoiceLineUnit | null;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string;
  /** A captured `numeric(9,6)` FRACTION, rendered verbatim, never as a percent. */
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
  /**
   * `numeric(12,3)` strings, not money (ADR-023 D5/D15): the line's approved
   * quantity and what live invoices already hold of it. `quantity` is what
   * remains, and what this invoice would bill.
   */
  readonly approvedQuantity: string;
  readonly invoicedQuantity: string;
  /**
   * Part of what the line sells was invoiced under an earlier revision, so its
   * amounts are what remains of the approved line's total, not the line as quoted.
   */
  readonly partlyInvoicedEarlier: boolean;
}

/**
 * Why a quotation line is or is not billed now — `BillingStatus` (ADR-023
 * D5/D15). Every value but `billable` is a reason the line is left off.
 */
export const BILLING_STATUSES = [
  'billable',
  'not_current',
  'not_approved',
  'rejected',
  'lineage_ambiguous',
  'fully_invoiced',
  'repriced_below_invoiced',
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/** `InvoicePreviewRevisionLine` — one line of the source revision as quoted, decided and billed so far. */
export interface InvoicePreviewRevisionLine {
  readonly sourceQuotationItemId: string;
  readonly lineNumber: number;
  readonly lineType: LineType;
  readonly description: string | null;
  readonly item: InvoiceLineItem | null;
  readonly unit: InvoiceLineUnit | null;
  /** `approved`, `rejected`, or `null` while the customer has not decided. */
  readonly decision: 'approved' | 'rejected' | null;
  readonly quotedQuantity: string;
  readonly approvedQuantity: string;
  readonly invoicedQuantity: string;
  readonly remainingQuantity: string;
  readonly billingStatus: BillingStatus;
  readonly unitPrice: string;
  readonly discount: string;
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
}

/** `InvoicePreviewRevisionTotals` — the source revision's totals as quoted. */
export interface InvoicePreviewRevisionTotals {
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly netTotal: string;
  readonly grossTotal: string;
}

/**
 * `sal.invoice-preview` — `InvoicePreview`; what a NEW invoice for the work order
 * would bill now, computed by the database: the approved lines that remain, each at
 * what remains of it (ADR-023 D5/D15). `revisionLines` is every line of the source
 * revision with why it is or is not billed; `revisionTotals` is that revision as quoted.
 */
export interface InvoicePreview {
  readonly workOrderId: string;
  readonly quotationId: string;
  readonly quotationRevisionId: string;
  readonly currency: string;
  /** The minor unit of `currency`, as `shared.currencies` records it (Owner decision D1). */
  readonly minorUnit?: number | undefined;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly netTotal: string;
  readonly grossTotal: string;
  readonly lines: readonly InvoicePreviewLine[];
  readonly revisionLines: readonly InvoicePreviewRevisionLine[];
  readonly revisionTotals: InvoicePreviewRevisionTotals;
}

/** `sal.invoice-outstanding-read` — `OutstandingView`; the open receivable as the database computes it on every call. */
export interface Outstanding {
  readonly invoiceId: string;
  readonly status: InvoiceStatus;
  readonly outstanding: MoneyView;
  readonly isSettled: boolean;
  /** `null` for a draft or voided invoice, which claims nothing yet. */
  readonly settlement: Settlement | null;
  /**
   * When the balance and the settlement were read, on the database's clock (an
   * ISO instant). A printed copy states its settlement figures "as of" this
   * moment, apart from the issued amounts, which never change (Owner decision
   * D10, ADR-023).
   */
  readonly asOf: string;
}

/** The echo of `sal.invoice-create` — the detail plus whether the key had already been used. */
export interface CreatedInvoice extends InvoiceDetail {
  readonly replayed: boolean;
}

/** The echo of `sal.invoice-issue` — `IssuedInvoice`. */
export interface IssuedInvoice {
  readonly invoice: Invoice;
  readonly invoiceNumber: string;
  readonly replayed: boolean;
  readonly recordVersion: number;
}

/** The echo of `sal.invoice-cancel` — `VoidedInvoice`. */
export interface VoidedInvoice {
  readonly invoice: Invoice;
  readonly replayed: boolean;
  readonly recordVersion: number;
}

/* ------------------------------------------------------------------ *
 * Credit notes (DEF-T-07).
 *
 * | operation                | method | path                             | permissions (ALL required)               |
 * | ------------------------ | ------ | -------------------------------- | ---------------------------------------- |
 * | `sal.credit-note-list`   | GET    | `/credit-notes`                  | `sal.credit.manage`, `sal.finance.view`  |
 * | `sal.credit-note-detail` | GET    | `/credit-notes/{creditNoteId}`   | `sal.credit.manage`, `sal.finance.view`  |
 * | `sal.credit-note-create` | POST   | `/invoices/{invoiceId}/credit-notes` | `sal.credit.manage`, `sal.finance.view` |
 * | `sal.credit-note-approve` | POST  | `/credit-notes/{creditNoteId}/approval` | `sal.credit.approve`, `sal.finance.view` |
 * | `sal.credit-note-reject`  | POST  | `/credit-notes/{creditNoteId}/rejection` | `sal.credit.approve`, `sal.finance.view` |
 * | `sal.credit-note-withdraw` | POST | `/credit-notes/{creditNoteId}/withdrawal` | `sal.credit.manage` |
 *
 * Rejection and withdrawal (ADR-023, D3) are version-guarded: `If-Match` is the
 * NOTE's `recordVersion` from the detail read. Only the requester withdraws, and
 * only someone else rejects, with a reason; every state but `pending` is final.
 *
 * Both DECLARE `sal.finance.view` rather than nulling amounts the way the
 * invoice reads do, and that asymmetry is the database's: the invoice header is
 * scope-gated with its money in separate gated tables, so a header without money
 * is an honest answer; `sel_credit_notes_gated` gates a credit note's WHOLE row,
 * so a caller without the permission is refused rather than shown an empty list
 * that would read as "nothing has been credited here". `amount` is therefore
 * never null on this surface.
 * ------------------------------------------------------------------ */

/** `ck_credit_notes_approval_state`, mirrored. `withdrawn` is the requester's own withdrawal. */
export const CREDIT_NOTE_STATES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type CreditNoteState = (typeof CREDIT_NOTE_STATES)[number];

/** `sal.credit-note-list` and `sal.credit-note-detail` — `CreditNoteView`. */
export interface CreditNote {
  readonly id: string;
  readonly invoiceId: string;
  readonly companyId: string;
  readonly branchId: string;
  /** `numeric(18,4)` beside its currency; the note's currency is the invoice's. */
  readonly amount: MoneyView;
  /** Free text the requester wrote. Rendered as given, never parsed. */
  readonly reason: string;
  readonly approvalState: CreditNoteState;
  readonly requestedBy: string;
  /** Present only once approved — `ck_credit_notes_approved_shape`. */
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly issuedAt: string | null;
  /**
   * Who withdrew or rejected the request, and when — the requester for a
   * withdrawal, somebody else for a rejection; `null` while pending and on an
   * approved note. An id, compared with the signed-in person and never shown.
   */
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Why it was rejected, as the person who rejected it wrote it; `null` otherwise. */
  readonly decisionReason: string | null;
  readonly recordVersion: number;
}

/**
 * The invoice a credit note reduces, as the note's detail names it — the
 * `CreditNoteInvoiceView` of `sal.credit-note-detail` (finance checkpoint, DF-B4).
 * `payerName` is `null` for a reader who may not read customers, or for a payer
 * who is no longer named; the screen then says the name is not shown.
 */
export interface CreditNoteInvoice {
  readonly invoiceNumber: string | null;
  readonly saleKind: SaleKind;
  readonly workOrderId: string | null;
  readonly payerName: string | null;
}

/**
 * The customer return that raised a credit note — `CreditNoteSourceReturnView`.
 * A return has no number of its own, so it is named by what came back and when.
 */
export interface CreditNoteSourceReturn {
  readonly id: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  /** `numeric(12,3)` as a string; not money. */
  readonly quantity: string;
  readonly receivedAt: string;
}

/**
 * `sal.credit-note-detail` — `CreditNoteDetailView`: the note, and what it is
 * traceable to (DF-B4). Every person is named, never shown by reference: each
 * name is `null` for a reader who may not read users, and the screen then says
 * the name is not shown. The ids above stay for comparing with the signed-in
 * person and are never printed.
 */
export interface CreditNoteDetail extends CreditNote {
  readonly requestedAt: string;
  readonly requestedByName: string | null;
  readonly approvedByName: string | null;
  readonly decidedByName: string | null;
  /** `null` only if the invoice could not be read with the note. */
  readonly invoice: CreditNoteInvoice | null;
  /** `null` when the note was raised by hand rather than by a customer return. */
  readonly sourceReturn: CreditNoteSourceReturn | null;
  /**
   * What approving this PENDING note would do, as the server computed it at the read
   * (ADR-023 D2): how much reduces what is still owed and how much the customer would
   * be owed back. `null` on a decided note; absent from a server before D2.
   */
  readonly approvalEffect?: CreditApprovalEffect | null;
  /** The refund obligation an APPROVED note left, or `null` (D2). */
  readonly refundObligation?: RefundObligation | null;
}

/** `CreditApprovalEffectView` — the two parts of a pending note's amount (ADR-023 D2). */
export interface CreditApprovalEffect {
  readonly reducesBalanceBy: MoneyView;
  readonly refundOwed: MoneyView;
}

/**
 * `RefundObligationView` (ADR-023 D2): money a customer is owed back. Nothing has been
 * paid; `state` is `open` until refunds can be requested.
 */
export interface RefundObligation {
  readonly id: string;
  readonly invoiceId: string;
  readonly creditNoteId: string;
  readonly amount: MoneyView;
  /** `open` until what has been paid out reaches its amount, then `settled`. */
  readonly state: string;
  readonly companyId?: string;
  readonly branchId?: string;
  readonly partnerId?: string;
  readonly createdAt?: string;
  readonly recordVersion?: number;
  /** What has been paid out on it, the server's sum (P1-32-PRE-OD-FD2B). */
  readonly paidOut?: MoneyView;
  /** Its amount less what has been paid out, the server's figure (P1-32-PRE-OD-FD2B). */
  readonly stillOwed?: MoneyView;
}

/**
 * A refund request as the server reads it (`RefundRequestView`, ADR-023 D2 part 2):
 * its decision, and `executed` once its payout is recorded.
 */
export const REFUND_REQUEST_STATES = [
  'pending',
  'approved',
  'executed',
  'rejected',
  'withdrawn',
] as const;
export type RefundRequestState = (typeof REFUND_REQUEST_STATES)[number];

/** A request's and a rejection's reason, mirrored: at most this many characters. */
export const MAX_REFUND_REASON = 2000;
/** A payout reference, mirrored: at most this many characters. */
export const MAX_PAYOUT_REFERENCE = 200;

/** `RefundMethodView` — the tenant payment method a refund is paid by. */
export interface RefundMethod {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
}

/** `RefundRequestView` (ADR-023 D2, part 2). No figure here is computed by the screen. */
export interface RefundRequest {
  readonly id: string;
  readonly obligationId: string;
  readonly invoiceId: string;
  /** `null` when the invoice header is not readable to the caller. */
  readonly invoiceNumber: string | null;
  /** The invoice's work order — where its screen opens — or `null` (a counter sale). */
  readonly workOrderId: string | null;
  readonly companyId: string;
  readonly branchId: string;
  readonly payeePartnerId: string;
  readonly state: RefundRequestState;
  readonly amount: MoneyView;
  /** `null` only when the method row is not readable. */
  readonly paymentMethod: RefundMethod | null;
  readonly reason: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  readonly executedBy: string | null;
  readonly executedAt: string | null;
  readonly payoutReference: string | null;
  /** `YYYY-MM-DD`. */
  readonly payoutDate: string | null;
  readonly recordVersion: number;
}

/** `RefundObligationPositionView` — where an obligation stands, in the server's figures. */
export interface RefundObligationPosition {
  readonly id: string;
  readonly state: string;
  readonly amount: MoneyView;
  readonly paidOut: MoneyView;
  readonly stillOwed: MoneyView;
  readonly recordVersion: number;
}

/** The echo of every refund command — `RefundRequestResult`. */
export interface RefundRequestEcho {
  readonly refundRequest: RefundRequest;
  readonly obligation: RefundObligationPosition;
  readonly replayed: boolean;
}

/** `RefundRequestDetailView` — one request with its obligation and the people, by name. */
export interface RefundRequestDetail extends RefundRequest {
  readonly requestedByName: string | null;
  readonly decidedByName: string | null;
  readonly executedByName: string | null;
  readonly obligation: RefundObligationPosition;
}

/*
 * The request body of `sal.credit-note-create` is `CreditNoteCreateBody` in
 * `lib/contracts/billing-contract.ts`, the payload-parity mirror the P1-30 gate
 * holds against the route's zod schema.
 */

/**
 * The echo of `sal.credit-note-create`, `sal.credit-note-approve`,
 * `sal.credit-note-reject` and `sal.credit-note-withdraw` — `CreditNoteResult`.
 */
export interface CreditNoteEcho {
  readonly creditNote: CreditNote;
  /** True when the key (create) or an already-approved note (approve) was met again. */
  readonly replayed: boolean;
  /**
   * On an APPROVAL only (`CreditNoteApprovalResult`, ADR-023 D2): how the approved
   * amount split — what it took off the balance and what the customer is owed back,
   * zero when nothing — as the server computed it. Absent on the other commands
   * and from a server before P1-32-PRE-OD-FD2B.
   */
  readonly approvalEffect?: CreditApprovalEffect | null;
}

/** The shape `sal.credit-note-create` accepts, mirrored: unsigned, 14 integer digits, 4 decimals. */
export const CREDIT_AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;
