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
 * - No invoice list, and no invoice-for-partner list: an invoice is reached
 *   through its work order (`sal.work-order-invoice-read` answers `null` when
 *   the order has no live invoice).
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
  /** Credit notes — both reads and the approval declare it (DEF-T-07). */
  creditManage: 'sal.credit.manage',
  /** A different payer is FOUND among customers, which `crm.customer-search` answers. */
  customerRead: 'crm.customer.read',
} as const;

/** `ck_invoices_status`, mirrored. `credited` is admitted by the guard and unreachable today. */
export const INVOICE_STATUSES = ['draft', 'issued', 'credited', 'void_before_issue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** `ck_invoice_lines_line_type`, mirrored. The preview carries `service` and `part` only. */
export const LINE_TYPES = ['service', 'part', 'fee'] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** Column width of a cancellation reason, mirrored, so the form refuses before the 422 does. */
export const MAX_REASON = 2000;

/** A labelled amount as the server states it — `MoneyView`. */
export interface MoneyView {
  readonly amount: string;
  readonly currency: string;
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
  readonly recordVersion: number;
  readonly money: InvoiceLineMoney | null;
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
 * | `sal.credit-note-approve` | POST  | `/credit-notes/{creditNoteId}/approval` | `sal.credit.manage`, `sal.finance.view` |
 *
 * Both DECLARE `sal.finance.view` rather than nulling amounts the way the
 * invoice reads do, and that asymmetry is the database's: the invoice header is
 * scope-gated with its money in separate gated tables, so a header without money
 * is an honest answer; `sel_credit_notes_gated` gates a credit note's WHOLE row,
 * so a caller without the permission is refused rather than shown an empty list
 * that would read as "nothing has been credited here". `amount` is therefore
 * never null on this surface.
 * ------------------------------------------------------------------ */

/** `ck_credit_notes_approval_state`, mirrored. */
export const CREDIT_NOTE_STATES = ['pending', 'approved', 'rejected'] as const;
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
  readonly recordVersion: number;
}

/**
 * `sal.credit-note-create` — `POST /invoices/{invoiceId}/credit-notes`.
 *
 * An amount and a reason, and nothing else a screen sends: the currency is the
 * invoice's (the route only checks one if it is given), the requester is the
 * session, and the note is born pending. The amount is a decimal string of at
 * most fourteen integer digits and four decimals, strictly positive; the server
 * bounds it by the invoice's open receivable.
 *
 * Declared here rather than in `lib/contracts/billing-contract.ts`: that file is
 * a P1-30 payload-parity mirror, and `sal.credit-note-create` is still recorded
 * there as a mirror a later phase owes. Moving the shape into the mirror retires
 * that record, which is a change to the gate itself.
 */
export interface CreditNoteRequestBody {
  readonly amount: string;
  readonly reason: string;
}

/** The echo of `sal.credit-note-create` and `sal.credit-note-approve` — `CreditNoteResult`. */
export interface CreditNoteEcho {
  readonly creditNote: CreditNote;
  /** True when the key (create) or an already-approved note (approve) was met again. */
  readonly replayed: boolean;
}

/** The shape `sal.credit-note-create` accepts, mirrored: unsigned, 14 integer digits, 4 decimals. */
export const CREDIT_AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;
