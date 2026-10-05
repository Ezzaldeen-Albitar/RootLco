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

/** Money handed back (D7). The platform has no refund instrument yet, so only `none`. */
export const REFUND_STATUSES = ['none'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** `SettlementView` — three separate positions of an issued invoice, and the two amounts behind them. */
export interface Settlement {
  readonly creditStatus: CreditStatus;
  readonly paymentStatus: PaymentStatus;
  readonly refundStatus: RefundStatus;
  readonly credited: MoneyView;
  readonly paid: MoneyView;
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

/** One invoice line — `InvoiceLineView`. Carries NO description. */
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
  readonly recordVersion: number;
  readonly money: InvoiceLineMoney | null;
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
  readonly recordVersion: number;
}

/** `sal.work-order-invoice-read` — `WorkOrderInvoiceView`; `invoice` is `null` when the order has no live invoice. */
export interface WorkOrderInvoice {
  readonly workOrderId: string;
  readonly invoice: Invoice | null;
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
}

/** `sal.invoice-preview` — `InvoicePreview`; what the accepted quotation revision would bill, computed by the database. */
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
}

/** The shape `sal.credit-note-create` accepts, mirrored: unsigned, 14 integer digits, 4 decimals. */
export const CREDIT_AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;
