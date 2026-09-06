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

/** The invoice header — `InvoiceView`. */
export interface Invoice {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
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
