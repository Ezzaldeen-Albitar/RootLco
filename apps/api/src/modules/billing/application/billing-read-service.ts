/**
 * Billing reads and the cross-module financial port (Phase 1-22).
 *
 * Three things live here, and the file owns the view vocabulary the mutation
 * service also returns — one definition of what an invoice looks like on the wire,
 * so a created invoice and a read invoice cannot render differently.
 *
 * ## Money is never returned unlabelled
 *
 * Every amount crosses this boundary as a fixed-scale decimal STRING with an ISO 4217
 * code that applies to it, and there are exactly two shapes for that. Per-amount:
 * a `MoneyView` built by `moneyView()` from `@/modules/pricing`, used wherever amounts
 * of different currencies could appear in one response. Per-document: a single
 * `currency` field governing every figure below it, used only by `InvoicePreview`,
 * which is one quotation revision in one currency and would otherwise repeat that code
 * ten times per line.
 *
 * The distinction is stated because it is easy to read the per-document form as an
 * oversight. What it is NOT allowed to be is a way around the exactness check:
 * `readInvoicePreview` passes every figure through `Decimal.fromDatabase(_, MONEY)`
 * even though it does not wrap them in `MoneyView`, because that call is the
 * schema-drift guard as much as it is a parse. A `numeric(18,4)` holds values IEEE-754 cannot represent, so
 * a JSON number would lose money for some inputs, silently and unrepeatably. And
 * `sal.invoice_open_receivable` takes no currency and returns a bare `numeric`, so
 * an unlabelled balance is not merely untidy: it is a JOD figure that a client may
 * render as USD.
 *
 * ## Reads are scoped twice, and an invisible amount is not a 403
 *
 * RLS narrows the rows, and `authorizeScope` re-evaluates the operation's own
 * permissions against the concrete company and branch the loaded row names.
 * `app.branch_ids` is the union of every active grant regardless of which
 * permission it carries (P1-18-A-01), so RLS alone would let a principal holding
 * `sal.invoice.read` in one branch read invoices in another branch they merely have
 * some grant in.
 *
 * The money is a separate, narrower gate. `sal.invoice_amounts` and
 * `sal.invoice_line_amounts` are `restricted` tables whose every policy requires
 * `iam.has_permission('sal.finance.view')` (H-priv-1), so a caller without it sees
 * the invoice's structure and `totals: null`. That is the required behaviour, not a
 * denial: the base rows are structural and branch-scoped, and refusing the whole
 * read would withhold facts a reception clerk is entitled to.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { Decimal, MONEY, moneyView, type MinorUnits, type MoneyView } from '@/modules/pricing';
import { iamDirectory } from '@/modules/iam';
import { inventoryModule, type ItemLabel } from '@/modules/inventory';
import type { DbHandle } from '@/server/db/transaction';
import { callerHoldsPermissionAnywhere, type ScopeAuthorizer } from '@/server/auth/authorization';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  CUSTOMER_SEARCH_PERMISSION,
  toEntitySearchTerms,
  withoutCustomerArms,
  type EntitySearchTerms,
} from '@/shared/text/search-terms';
import {
  CREDIT_NOTE_ORDER,
  INVOICE_LIST_ORDER,
  REFUND_OBLIGATION_ORDER,
} from '../data/billing-repository';
import {
  deriveCreditStatus,
  derivePaymentStatus,
  deriveRefundStatus,
  isBillingStatus,
  type BillingStatus,
  type CreditStatus,
  type PaymentStatus,
  type RefundStatus,
} from '../domain/billing';
import type {
  BillingRepository,
  CommercialSourceLineRow,
  CommercialSourceRow,
  CreditNoteRow,
  InvoiceLineRow,
  InvoiceListRow,
  InvoiceRow,
  NumberingConfigRow,
  RefundObligationRow,
} from '../data/billing-repository';

/**
 * An invoice's three header totals, each labelled with the header currency.
 *
 * `null` on an `InvoiceView` whenever `sal.invoice_amounts` was invisible or absent
 * — the two are deliberately indistinguishable, because telling a caller "the row
 * exists but you may not see it" is the disclosure the gate exists to prevent.
 */
export interface InvoiceTotalsView {
  readonly net: MoneyView;
  readonly tax: MoneyView;
  readonly gross: MoneyView;
}

/** The FR-WTY-004 payer allocation on one line. Always sums to `gross`. */
export interface PayerSplitView {
  readonly customer: MoneyView;
  readonly warranty: MoneyView;
}

export interface InvoiceLineMoneyView {
  readonly unitPrice: MoneyView;
  readonly net: MoneyView;
  readonly tax: MoneyView;
  readonly gross: MoneyView;
  readonly payerSplit: PayerSplitView;
}

export interface InvoiceLineView {
  readonly id: string;
  readonly lineNumber: number;
  readonly lineType: string;
  /** `numeric(12,3)` decimal string. Not money, so it carries no currency. */
  readonly quantity: string;
  readonly currency: string;
  readonly sourceQuotationItemId: string | null;
  /**
   * What a counter-sale line sold, by code and name (GAP-09), so the line can be
   * printed with a description. On a work-order PART line, the item its quotation
   * line was quoted as (ADR-023 D6). `null` on a service line, which is described
   * by the quotation item it was copied from. Not money: shown to every invoice
   * reader.
   */
  readonly item: InvoiceLineItemView | null;
  /**
   * The unit a work-order PART line's quantity is in, as its quotation line
   * captured it (ADR-023 D6). `null` on a service line and on a counter-sale line,
   * which snapshots no unit. Not money.
   */
  readonly unit: InvoiceLineUnitView | null;
  /**
   * The quotation line this work-order line was copied from, as quoted (ADR-023
   * D5/D15), so a printed copy is described from the invoice's OWN source lines and
   * never from whatever revision the work order bills now. `null` on a counter-sale
   * line, and without `sal.finance.view`.
   */
  readonly source: InvoiceLineSourceView | null;
  readonly recordVersion: number;
  /** `null` without `sal.finance.view`. */
  readonly money: InvoiceLineMoneyView | null;
}

/** A work-order line's source quotation line, as quoted. */
export interface InvoiceLineSourceView {
  readonly description: string | null;
  /** `numeric(12,3)` decimal string: what the quotation line quoted. Not money. */
  readonly quotedQuantity: string;
  /** The quotation line's discount, as quoted, in the invoice currency. */
  readonly discount: MoneyView;
}

/**
 * The quotation revision a work-order invoice was made from, as quoted (ADR-023
 * D5/D15): its line count and its before-discount and discount totals. A printed
 * copy states the totals only for an invoice that billed every line of it whole.
 */
export interface InvoiceSourceView {
  readonly quotationRevisionId: string;
  readonly lineCount: number;
  readonly subtotal: MoneyView;
  readonly discountTotal: MoneyView;
}

/** An item a counter-sale line sold. `code` is the SKU. */
export interface InvoiceLineItemView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** The unit a part line's quantity is in, as it was quoted. */
export interface InvoiceLineUnitView {
  readonly code: string;
  readonly name: string;
}

export interface InvoiceView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  /** Null exactly when `saleKind` is `counter_sale` (P1-32 preparatory slice 2). */
  readonly workOrderId: string | null;
  /** `work_order` or `counter_sale`. */
  readonly saleKind: string;
  readonly quotationRevisionId: string | null;
  readonly payerPartnerId: string;
  readonly currency: string;
  readonly status: string;
  /** Present only once issued; `ck_invoices_number_iff_issued` is a biconditional. */
  readonly invoiceNumber: string | null;
  readonly issuedAt: string | null;
  readonly recordVersion: number;
  /** `null` without `sal.finance.view`, and on a draft before amounts are written. */
  readonly totals: InvoiceTotalsView | null;
}

/**
 * Who an invoice bills, by name (Owner directive, P1-32-PRE-OD-UX).
 *
 * Every field is `null` exactly when the payer is not named to THIS caller:
 * withheld because the caller does not hold `crm.customer.read`, or not a live
 * partner — retired since the invoice was written, or not visible. The box then
 * cannot reach that name either, so the list never names a payer it would not
 * find by name, nor finds one by a name it would not show. The block keeps its
 * shape either way, as the warranty list's customer block does. The id is
 * `payerPartnerId` on the header and is not repeated here.
 */
export interface InvoicePayerView {
  readonly displayName: string | null;
  readonly displayNumber: string | null;
  readonly partyType: string | null;
}

/**
 * One row of `sal.invoice-list`: the header every other invoice read publishes,
 * plus the payer's name and the open balance.
 *
 * `outstanding` is `null` whenever `balanceIsTrustworthy` says the zero
 * `sal.invoice_open_receivable` would compute cannot be believed — that is, for
 * an issued or credited invoice whose amounts row this caller cannot see. The
 * route's gate is `sal.finance.view`, so that is no longer the ordinary case;
 * the guard stays because a policy change underneath must hide money, never
 * report a zero. Omitted, never zeroed, for the reason `totals` is.
 */
export interface InvoiceListEntryView extends InvoiceView {
  readonly payer: InvoicePayerView;
  readonly outstanding: MoneyView | null;
  /**
   * What the invoice can still be credited — its gross less the credit notes
   * already approved (ADR-023 D2, P1-32-PRE-OD-FD2B) — `null` exactly when
   * `outstanding` is, for the same reason. The credit-note form caps at this.
   * Additive.
   */
  readonly creditable: MoneyView | null;
}

/** An invoice with its lines, as the detail read returns it. */
export interface InvoiceDetailView {
  readonly invoice: InvoiceView;
  readonly lines: readonly InvoiceLineView[];
  /**
   * The revision this invoice was made from, as quoted. `null` on a counter sale,
   * for a revision the caller cannot see, and without `sal.finance.view`.
   */
  readonly source: InvoiceSourceView | null;
  /**
   * The AGGREGATE's version, mirroring `invoice.recordVersion`.
   *
   * Duplicated at the top level on purpose: the HTTP layer's `ETag` / `If-Match`
   * contract is about the aggregate as a whole, and a route that had to reach into
   * `invoice.recordVersion` would be encoding this view's shape into the version
   * guard. It is the INVOICE's version and never a line's — a line has its own
   * `record_version` and none of them is the document's.
   */
  readonly recordVersion: number;
}

/**
 * The derived open receivable.
 *
 * `amount` and `currency` are one value: the amount comes from
 * `sal.invoice_open_receivable`, which has no currency predicate, and the currency
 * is the invoice header's. `isSettled` is computed by comparing `Decimal`s, never
 * by coercing the string to a number.
 */
export interface OutstandingView {
  readonly invoiceId: string;
  readonly status: string;
  readonly outstanding: MoneyView;
  readonly isSettled: boolean;
  /**
   * The credit, payment and refund positions, kept apart (Owner decision D7,
   * ADR-023). `null` for a draft or a voided invoice, which has claimed nothing
   * and so has nothing to credit, pay or refund.
   */
  readonly settlement: SettlementView | null;
  /**
   * When the balance and the settlement were read, on the database's clock, as an
   * ISO instant (Owner decision D10, ADR-023): a printed copy states its
   * settlement figures "as of" this moment, apart from the issued facts, which
   * never change. Additive; every other field is unchanged.
   */
  readonly asOf: string;
}

/**
 * Three separate facts about an issued invoice, derived on every read (D7).
 *
 * `creditStatus` compares the effective (approved) credits with the eligible
 * total, the invoice's gross; `paymentStatus` compares what was paid with what
 * is still open; `refundStatus` is `owed` while the customer is owed money back
 * (an open refund obligation, ADR-023 D2) and `none` otherwise — nothing is ever
 * paid back automatically. A fully credited invoice reads `credited` /
 * `nothing_due` — never "settled" or "paid". `credited`, `paid` and
 * `refundOwed` are the amounts the statuses were derived from, in the invoice's
 * currency.
 */
export interface SettlementView {
  readonly creditStatus: CreditStatus;
  readonly paymentStatus: PaymentStatus;
  readonly refundStatus: RefundStatus;
  readonly credited: MoneyView;
  readonly paid: MoneyView;
  /**
   * What the customer is owed back: the sum of the invoice's OPEN refund
   * obligations (ADR-023 D2, P1-32-PRE-OD-FD2A), `0` when none is open. An
   * operational figure, not an accounting entry. Additive.
   */
  readonly refundOwed: MoneyView;
  /**
   * What the invoice can still be credited (ADR-023 D2): its gross less the credit
   * notes already APPROVED on it, never what is merely still owed. A credit up to
   * this is accepted even once the invoice is paid; the part of it above what is
   * still owed becomes a refund owed to the customer. Computed by the database
   * with the predicates `sal.approve_credit_note` applies; pending notes are not
   * counted and the approval re-checks under the invoice lock. Additive
   * (P1-32-PRE-OD-FD2B).
   */
  readonly creditable: MoneyView;
  /**
   * The part of `paid` that somebody other than the invoice's customer paid, as an
   * explicit third-party payment (ADR-023 D14) — an insurer, an employer — oldest
   * first, at most `THIRD_PARTY_PAYMENTS_SHOWN`. Additive; empty when the customer
   * paid it all. The invoice stays its customer's either way.
   */
  readonly thirdPartyPayments: readonly ThirdPartyPaymentView[];
  /** True when the invoice has more third-party payments than are listed. */
  readonly thirdPartyPaymentsTruncated: boolean;
}

/**
 * One third-party payment of an invoice, as its settlement shows it (ADR-023 D14):
 * who paid, named only to a caller holding `crm.customer.read` as everywhere else,
 * what they are to the customer, the authorisation and the reason, the receipt by
 * its number, and the amount applied.
 */
export interface ThirdPartyPaymentView {
  readonly receipt: { readonly id: string; readonly reference: string };
  /** `null` when the caller may not read customers, or the payer is not a live partner. */
  readonly payerName: string | null;
  /** `insurer`, `employer` or `other` — a fixed vocabulary. */
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly reason: string;
  readonly money: MoneyView;
  readonly allocatedAt: string;
}

/** How many third-party payments one settlement lists. */
export const THIRD_PARTY_PAYMENTS_SHOWN = 50;

/**
 * The delivery module's financial blocker, and the whole reason this port exists.
 *
 * `sal.complete_delivery` checks an authorized receiver, the mandatory checklist and
 * at least one signature — and **no financial balance at all**. So this is the only
 * thing standing between the platform and handing over a vehicle with an unpaid
 * invoice, and it is application-composed: if this port is deleted the database
 * raises no objection.
 */
export interface WorkOrderReceivableView {
  readonly invoiceId: string;
  /**
   * The open receivable, or `null` when this caller may not see financial detail.
   *
   * `null` is not zero and must never be rendered as zero. See
   * `openReceivableForWorkOrder` for why the distinction exists and why the safe
   * answer when it is `null` is `hasOutstanding: true`.
   */
  readonly amount: string | null;
  readonly currency: string;
  /** `amount > 0`, decided by `Decimal.greaterThan`. Never by `Number()`. */
  readonly hasOutstanding: boolean;
  /**
   * False when `sal.finance.view` hid the amounts and the balance is unknown.
   *
   * A consumer that renders a figure must check this first. A consumer that only
   * gates on `hasOutstanding` need not: that field is already fail-closed.
   */
  readonly balanceVisible: boolean;
  /**
   * False when the invoice exists but is not yet ISSUED, so nothing is collectable.
   *
   * This is the third distinct reason `amount` can be `null`, and it is NOT an
   * authorization problem — `balanceVisible` stays true, because the caller can see
   * everything. There is simply nothing to collect yet.
   *
   * It exists because the alternative was strictly worse than having no invoice at all.
   * `sal.invoice_open_receivable` returns `0` for a `draft`, by design, so a draft
   * carrying a real five-thousand of derived amounts answered "nothing outstanding" —
   * and `null` (no invoice) is treated as BLOCKING on the principle that "nothing was
   * invoiced is not settlement". Creating a draft therefore REMOVED the financial
   * blocker. `hasOutstanding` is now true in this case for the same reason it is true
   * when the balance is invisible: a zero that is structural is not a zero that was paid.
   */
  readonly collectable: boolean;
  /**
   * The live invoice's own status, so a consumer can say WHY rather than only that a
   * blocker is present. `draft` and `issued` are very different conversations with an
   * operator, and the eligibility response is the place that difference has to survive.
   */
  readonly status: string;
  /**
   * Approved quotation work remains that no live invoice holds (ADR-023 D5/D15,
   * P1-32-PRE-OD-FD5). A work order may now be invoiced in more than one invoice, so
   * every invoice being settled no longer means everything approved was billed; a
   * consumer gating a handover treats this as outstanding, for the reason it treats
   * a work order with no invoice at all as outstanding.
   */
  readonly unbilledApprovedWork: boolean;
}

/** One previewed line. Every amount a fixed-scale decimal STRING. */
export interface InvoicePreviewLine {
  readonly sourceQuotationItemId: string;
  readonly lineNumber: number;
  readonly lineType: string;
  readonly description: string | null;
  readonly serviceId: string | null;
  readonly itemId: string | null;
  /**
   * On a PART line, the item as its quotation line was quoted — stock code and
   * name (ADR-023 D6) — so the preview names the part. `null` on a service line.
   * Not money.
   */
  readonly item: InvoiceLineItemView | null;
  /** On a PART line, the unit its quantity is in, as quoted. `null` otherwise. Not money. */
  readonly unit: InvoiceLineUnitView | null;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string;
  /** The captured `numeric(9,6)` fraction, for transparency about what was applied. */
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
  /**
   * `numeric(12,3)` strings, not money (ADR-023 D5/D15): the line's approved
   * quantity and what live invoices already hold of it. `quantity` above is what
   * remains, and is what this invoice line would bill.
   */
  readonly approvedQuantity: string;
  readonly invoicedQuantity: string;
  /**
   * Part of what this line sells was invoiced under an earlier revision, so the
   * amounts above are what remains of the approved line's total (its discount is not
   * restated and reads zero) rather than the line as quoted.
   */
  readonly partlyInvoicedEarlier: boolean;
}

/**
 * One line of the source revision as quoted, decided and billed so far
 * (ADR-023 D5/D15). Quoted figures, never what remains; every amount a decimal STRING.
 */
export interface InvoicePreviewRevisionLine {
  readonly sourceQuotationItemId: string;
  readonly lineNumber: number;
  readonly lineType: string;
  readonly description: string | null;
  readonly item: InvoiceLineItemView | null;
  readonly unit: InvoiceLineUnitView | null;
  /** The customer's decision: `approved`, `rejected`, or `null` while undecided. */
  readonly decision: string | null;
  readonly quotedQuantity: string;
  readonly approvedQuantity: string;
  readonly invoicedQuantity: string;
  readonly remainingQuantity: string;
  /** `billable`, or why the line is not billed (`BILLING_STATUSES`). */
  readonly billingStatus: BillingStatus;
  readonly unitPrice: string;
  readonly discount: string;
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
}

/** The source revision's totals as quoted — what the preview reported before D5/D15. */
export interface InvoicePreviewRevisionTotals {
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly netTotal: string;
  readonly grossTotal: string;
}

/**
 * What an invoice for this work order would contain.
 *
 * Read-only and server-derived: there is no field on the request through which a
 * caller could propose an amount, and every figure below was summed by PostgreSQL
 * from the frozen `quo.quotation_items` of the accepted revision.
 */
export interface InvoicePreview {
  readonly workOrderId: string;
  readonly quotationId: string;
  readonly quotationRevisionId: string;
  readonly currency: string;
  /**
   * The minor unit of `currency`, as `shared.currencies` records it (Owner decision
   * D1), so a client writes the preview's figures the way the platform does.
   * Absent only for a currency the register does not hold.
   */
  readonly minorUnit?: number;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  /** `Σ` of the rounded line nets (ADR-023, D1) — what becomes the invoice's `net_total`. */
  readonly netTotal: string;
  readonly grossTotal: string;
  /** What a new invoice would bill: the billable lines, at what remains of each. */
  readonly lines: readonly InvoicePreviewLine[];
  /** Every line of the source revision, billable or not, with why not. */
  readonly revisionLines: readonly InvoicePreviewRevisionLine[];
  /** The source revision's totals as quoted, for a copy of an invoice that billed it whole. */
  readonly revisionTotals: InvoicePreviewRevisionTotals;
}

export interface CreditNoteView {
  readonly id: string;
  readonly invoiceId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly amount: MoneyView;
  readonly reason: string;
  readonly approvalState: string;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly issuedAt: string | null;
  /**
   * Who withdrew or rejected the request and when (ADR-023, D3) — the requester
   * for a withdrawal, a different person for a rejection; `null` while pending
   * and on an approved note, whose approver is `approvedBy`.
   */
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Why the request was rejected; `null` on every other state. */
  readonly decisionReason: string | null;
  readonly recordVersion: number;
}

/**
 * The invoice a credit note reduces, as the note's detail names it (finance
 * checkpoint, DF-B4). `payerName` is the name of who the invoice bills, published
 * only to a caller holding `crm.customer.read` — the rule `sal.invoice-list`
 * keeps — and `null` otherwise or when the payer is retired. `workOrderId` is
 * there so a screen can link a job's invoice; a counter sale has none.
 */
export interface CreditNoteInvoiceView {
  readonly invoiceNumber: string | null;
  readonly saleKind: string;
  readonly workOrderId: string | null;
  readonly payerName: string | null;
}

/**
 * The customer return that raised a credit note (DF-B4). A return carries no
 * number of its own, so it is named by what came back — the item's code and name
 * and the quantity — and when it was received.
 */
export interface CreditNoteSourceReturnView {
  readonly id: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  /** `numeric(12,3)` decimal string. Not money. */
  readonly quantity: string;
  readonly receivedAt: string;
}

/**
 * `sal.credit-note-detail` — the note, and what it is traceable to (finance
 * checkpoint, DF-B4): the invoice it reduces, the return that raised it, when it
 * was requested, and the people on it by NAME. Every field of `CreditNoteView`
 * is unchanged; these are additive.
 *
 * Each name is `null` for a caller who may not read users — resolved through
 * `iamDirectory().directory`, which checks `iam.user.read` itself, so a billing
 * read never becomes a staff directory — and for a person who is not named. The
 * ids stay where they were, so nothing a caller had is taken away.
 */
export interface CreditNoteDetailView extends CreditNoteView {
  readonly requestedAt: string;
  readonly requestedByName: string | null;
  readonly approvedByName: string | null;
  readonly decidedByName: string | null;
  readonly invoice: CreditNoteInvoiceView | null;
  readonly sourceReturn: CreditNoteSourceReturnView | null;
  /**
   * What approving this PENDING note would do now (ADR-023 D2): how much of it
   * reduces what the invoice still owes, and how much the customer would be owed
   * back as a refund — nothing is paid automatically. Computed by the database at
   * this read; the approval recomputes it under the invoice lock. `null` on every
   * decided note. Additive.
   */
  readonly approvalEffect: CreditApprovalEffectView | null;
  /** The refund obligation this APPROVED note created, or `null` (D2). Additive. */
  readonly refundObligation: RefundObligationView | null;
}

/** The two parts of a pending credit note's amount, in its currency (ADR-023 D2). */
export interface CreditApprovalEffectView {
  readonly reducesBalanceBy: MoneyView;
  readonly refundOwed: MoneyView;
}

/**
 * One refund obligation (ADR-023 D2, P1-32-PRE-OD-FD2A): money the customer is
 * owed back because an approved credit exceeded what the invoice still owed. An
 * operational record, not an accounting entry: nothing has been paid. `state` is
 * `open` until refund requests exist (FD2B).
 */
export interface RefundObligationView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  /** The customer owed the money: the invoice's billed party. */
  readonly partnerId: string;
  readonly invoiceId: string;
  readonly creditNoteId: string;
  readonly amount: MoneyView;
  readonly source: string;
  readonly state: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly recordVersion: number;
}

/**
 * The active numbering configuration, exposed read-only.
 *
 * `mode` is reported and asserted nowhere. It has zero behavioural effect anywhere
 * in the DDL: `shared.next_display_number` never reads it, `sal.issue_invoice` reads
 * only `sequence_code` from this row, and the `invoice_number` column comment calls
 * business-level gaps "tolerated and never renumbered". Reporting `gapless` as a
 * guarantee this backend keeps would be a claim the database does not support, so it
 * is reported as what it is — the recorded legal posture.
 */
export interface NumberingConfigView {
  readonly id: string;
  readonly companyId: string;
  readonly mode: string;
  readonly sequenceCode: string;
  readonly status: string;
  readonly recordVersion: number;
}

// ---------------------------------------------------------------------------
// View mappers. Module-level and exported, because the mutation service returns
// the same shapes and two mappers would be two wire contracts.
//
// Each takes the minor units of the currencies it renders (`minorUnitsFor`), so
// every amount it publishes says how many decimals its currency is written with
// (Owner decision D1). Without them the amounts are the same, unstamped.
// ---------------------------------------------------------------------------

/** No minor units looked up: every amount is published unstamped. */
const NO_MINOR_UNITS: MinorUnits = new Map();

export const toInvoiceView = (
  row: InvoiceRow,
  units: MinorUnits = NO_MINOR_UNITS
): InvoiceView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  workOrderId: row.workOrderId,
  saleKind: row.saleKind,
  quotationRevisionId: row.quotationRevisionId,
  payerPartnerId: row.payerPartnerId,
  currency: row.currencyCode,
  status: row.status,
  invoiceNumber: row.invoiceNumber,
  issuedAt: row.issuedAt?.toISOString() ?? null,
  recordVersion: row.recordVersion,
  totals: row.money
    ? {
        net: moneyView(row.money.netTotal, row.currencyCode, units),
        tax: moneyView(row.money.taxTotal, row.currencyCode, units),
        gross: moneyView(row.money.grossTotal, row.currencyCode, units),
      }
    : null,
});

/** The payer block of a caller the payer may not be named to. Same shape, every field null. */
const WITHHELD_PAYER: InvoicePayerView = Object.freeze({
  displayName: null,
  displayNumber: null,
  partyType: null,
});

/**
 * The list row: the shared header mapper, the payer's name where the caller may
 * read customers, and the open balance only where it can be believed.
 */
export const toInvoiceListEntryView = (
  row: InvoiceListRow,
  mayNamePayer: boolean,
  units: MinorUnits = NO_MINOR_UNITS
): InvoiceListEntryView => ({
  ...toInvoiceView(row, units),
  payer: mayNamePayer
    ? {
        displayName: row.payerDisplayName,
        displayNumber: row.payerDisplayNumber,
        partyType: row.payerPartyType,
      }
    : WITHHELD_PAYER,
  outstanding: balanceIsTrustworthy(row)
    ? moneyView(row.openAmount, row.currencyCode, units)
    : null,
  creditable: balanceIsTrustworthy(row)
    ? moneyView(row.creditableAmount, row.currencyCode, units)
    : null,
});

/**
 * The permission a caller needs before the invoice list's box may match a plate
 * or a VIN — the code the vehicle module itself asks before it tells anyone a
 * registration (`VehicleReadRepository.mayReadVehicles`).
 */
const VEHICLE_SEARCH_PERMISSION = 'veh.vehicle.read';

/** Switches off the two arms that read vehicle data. See `withoutCustomerArms`. */
function withoutVehicleArms(terms: EntitySearchTerms): EntitySearchTerms {
  if (!terms.present) return terms;
  return { ...terms, plateFragment: '', vinFragment: '' };
}

export const toInvoiceLineView = (
  row: InvoiceLineRow,
  items: ReadonlyMap<string, ItemLabel> = new Map(),
  units: MinorUnits = NO_MINOR_UNITS
): InvoiceLineView => ({
  id: row.id,
  lineNumber: row.lineNumber,
  lineType: row.lineType,
  quantity: row.quantity,
  currency: row.currencyCode,
  sourceQuotationItemId: row.sourceQuotationItemId,
  item:
    row.quotedPart === null
      ? lineItemView(row.itemId, items)
      : { id: row.quotedPart.itemId, code: row.quotedPart.itemCode, name: row.quotedPart.itemName },
  unit:
    row.quotedPart === null
      ? null
      : { code: row.quotedPart.unitCode, name: row.quotedPart.unitName },
  source:
    row.quotedSource === null
      ? null
      : {
          description: row.quotedSource.description,
          quotedQuantity: row.quotedSource.quotedQuantity,
          discount: moneyView(row.quotedSource.discount, row.currencyCode, units),
        },
  recordVersion: row.recordVersion,
  money: row.money
    ? {
        unitPrice: moneyView(row.money.unitPrice, row.currencyCode, units),
        net: moneyView(row.money.netAmount, row.currencyCode, units),
        tax: moneyView(row.money.taxAmount, row.currencyCode, units),
        gross: moneyView(row.money.grossAmount, row.currencyCode, units),
        payerSplit: {
          customer: moneyView(row.money.customerPayAmount, row.currencyCode, units),
          warranty: moneyView(row.money.warrantyPayAmount, row.currencyCode, units),
        },
      }
    : null,
});

export const toCreditNoteView = (
  row: CreditNoteRow,
  units: MinorUnits = NO_MINOR_UNITS
): CreditNoteView => ({
  id: row.id,
  invoiceId: row.invoiceId,
  companyId: row.companyId,
  branchId: row.branchId,
  amount: moneyView(row.amount, row.currencyCode, units),
  reason: row.reason,
  approvalState: row.approvalState,
  requestedBy: row.requestedBy,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  issuedAt: row.issuedAt?.toISOString() ?? null,
  decidedBy: row.decidedBy,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  decisionReason: row.decisionReason,
  recordVersion: row.recordVersion,
});

export const toRefundObligationView = (
  row: RefundObligationRow,
  units: MinorUnits = NO_MINOR_UNITS
): RefundObligationView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  partnerId: row.partnerId,
  invoiceId: row.invoiceId,
  creditNoteId: row.creditNoteId,
  amount: moneyView(row.amount, row.currencyCode, units),
  source: row.source,
  state: row.state,
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
  recordVersion: row.recordVersion,
});

const toNumberingConfigView = (row: NumberingConfigRow): NumberingConfigView => ({
  id: row.id,
  companyId: row.companyId,
  mode: row.mode,
  sequenceCode: row.sequenceCode,
  status: row.status,
  recordVersion: row.recordVersion,
});

/**
 * Picks the ONE commercial source a work order may be invoiced from: the current
 * revision of the quotation whose customer approved at least one line.
 *
 * Module-level and exported because the preview and the create path must agree:
 * previewing one revision and invoicing another would be a silent mispricing, and
 * the only way two call sites cannot drift is for there to be one function.
 *
 * Three outcomes, three different answers:
 *
 *  - **no approved line** → `ERR-RES-001`. There is no approved commercial data to
 *    derive amounts from, and the alternative — billing zero, or billing an
 *    undecided quotation — would manufacture a financial fact. A missing source is
 *    reported as a missing resource because the caller cannot fix it by changing
 *    the request.
 *  - **exactly one** → that revision. Since ADR-023 D5 (P1-32-PRE-OD-FD5) it need
 *    not be accepted as a whole: approved items and quantities are invoiceable and
 *    rejected or undecided ones are not, so a partly approved revision is a source
 *    for its approved lines, and `sal.billable_quotation_lines` says which those
 *    are and how much of each remains.
 *  - **more than one** → `ERR-CON-001`. `ix_quotations_work_order` is NOT unique and
 *    no constraint anywhere prevents two quotations with approved lines on one work
 *    order, so this is reachable. Picking one by `created_at` would be an arbitrary
 *    choice between two prices the customer agreed to, made silently, inside a
 *    financial document. The caller must cancel the superfluous quotation.
 *
 * Only a quotation that still has something to bill competes (`billableCount > 0`):
 * one whose approved lines are all invoiced already is not a second price for the
 * work that remains, so it does not make another quotation's approved work
 * ambiguous. When no quotation has anything left to bill, the approved ones compete
 * as before, so a single source still previews as "nothing to bill" and two still
 * conflict.
 *
 * Narrower than base, and an Owner open point (ADR-023 D5/D15, DBCR section 4):
 * base billed the one quotation accepted as a whole and ignored another with only
 * some lines approved. Here both have approved lines to bill, so both compete and
 * the work order is refused until one is cancelled — choosing the wholly accepted
 * one is a policy this backend does not take silently.
 *
 * Approval is read from the decision counts, not from `quo.quotations.status`: that
 * column is a cached roll-up and no constraint ties it to `quo.approval_decisions`.
 */
export function resolveCommercialSource(
  candidates: readonly CommercialSourceRow[],
  workOrderId: string
): CommercialSourceRow {
  const withApproved = candidates.filter((candidate) => candidate.approvedCount > 0);
  const withRemaining = withApproved.filter((candidate) => candidate.billableCount > 0);
  const approved = withRemaining.length > 0 ? withRemaining : withApproved;

  if (approved.length === 0) {
    throw new AppFailure('ERR-RES-001', {
      message:
        `Work order ${workOrderId} has no quotation revision with an approved line, so ` +
        'there is no approved commercial data to derive invoice amounts from. Every line, ' +
        'price, discount and tax rate on an invoice comes from an approved line of the ' +
        "quotation's current revision; none is defaulted.",
    });
  }
  if (approved.length > 1) {
    throw new AppFailure('ERR-CON-001', {
      message:
        `Work order ${workOrderId} has ${approved.length} quotations with approved lines, so ` +
        'the commercial source for an invoice is ambiguous. No constraint prevents this — ' +
        'ix_quotations_work_order is not unique — and choosing between two agreed prices is ' +
        'not a decision this backend may make.',
    });
  }

  const source = approved[0];
  /* c8 ignore next 4 -- unreachable: length is exactly 1 above. Kept so a future
     edit to the filter cannot turn a missing element into `undefined` amounts. */
  if (!source) {
    throw new AppFailure('ERR-SYS-001', { message: 'billing: commercial source vanished' });
  }
  if (source.itemCount === 0) {
    // `quo.issue_revision` forbids issuing a revision with no items, so this is
    // defence in depth rather than an expected path. It matters because an
    // item-less source would preview as a zero-total invoice, and a zero total is
    // legal on an issued invoice (a fully warranty-covered job) — so nothing
    // downstream would refuse it.
    throw new AppFailure('ERR-RES-001', {
      message:
        `The quotation revision ${source.revisionId} carries no items, so it ` +
        'cannot be the source of invoice amounts.',
    });
  }
  return source;
}

/**
 * A source line's billing status, narrowed to the vocabulary
 * `sal.billable_quotation_lines` answers in. An answer outside it is a contract
 * fault between this module and its own migration, never something to render.
 */
export function billingStatusOf(line: CommercialSourceLineRow): BillingStatus {
  if (!isBillingStatus(line.billingStatus)) {
    throw new AppFailure('ERR-SYS-001', {
      message: `billing: quotation line ${line.quotationItemId} has an unknown billing status`,
    });
  }
  return line.billingStatus;
}

/** What one invoice line bills: the remaining amounts of its source line. */
export interface BillableLine {
  readonly line: CommercialSourceLineRow;
  readonly money: {
    readonly net: string;
    readonly tax: string;
    readonly gross: string;
    readonly discount: string;
  };
}

/**
 * The lines a NEW invoice bills, each with the money it bills (ADR-023 D5/D15).
 *
 * Module-level and exported for the reason `resolveCommercialSource` is: the
 * preview and the create path must bill the same lines at the same amounts. Only
 * `billable` lines are kept, at what remains of them. A billable line whose
 * remaining amounts the database withheld — they are published only to a holder of
 * `sal.finance.view` — is refused rather than billed at zero.
 */
export function billableLines(lines: readonly CommercialSourceLineRow[]): readonly BillableLine[] {
  return lines
    .filter((line) => billingStatusOf(line) === 'billable')
    .map((line) => {
      const { remainingNet, remainingTax, remainingGross, remainingDiscount } = line;
      if (
        remainingNet === null ||
        remainingTax === null ||
        remainingGross === null ||
        remainingDiscount === null
      ) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            `What remains to bill of quotation line ${line.lineNumber} is not visible to this ` +
            'caller, so it cannot be previewed or invoiced.',
          safeDetails: { requiredPermissions: [FINANCE_VIEW_PERMISSION] },
        });
      }
      return {
        line,
        money: {
          net: remainingNet,
          tax: remainingTax,
          gross: remainingGross,
          discount: remainingDiscount,
        },
      };
    });
}

/** The permission every restricted `sal` money policy is gated on. */
export const FINANCE_VIEW_PERMISSION = 'sal.finance.view';

/**
 * Whether `sal.invoice_open_receivable`'s answer can be believed for this caller.
 *
 * **This is the most consequential inference in the module.** The function is
 * `SECURITY INVOKER`, so RLS applies to everything it reads, and every one of its
 * three inputs is gated by `iam.has_permission('sal.finance.view')`:
 * `sel_invoice_amounts_gated` on the gross, `sel_payment_allocations_gated` and
 * `sel_receipts_gated` on the allocations, and `sel_credit_notes_gated` on the
 * credits. So for a caller without that permission it computes
 * `round(COALESCE(NULL, 0) − 0 − 0, 4)` and returns **0** — byte-identical to the
 * answer for a fully settled invoice, with no error and no signal.
 *
 * Left unhandled, that would silently delete the delivery module's
 * `financial_balance_outstanding` blocker for exactly the principal most likely to
 * complete a handover: a delivery operator who may see invoices but not money would
 * see every invoice as paid, and `sal.complete_delivery` checks no balance itself.
 *
 * Visibility is detected through the header amounts, which is exact rather than
 * approximate. An `issued` invoice ALWAYS has an `sal.invoice_amounts` row —
 * `sal.issue_invoice` writes one, and `sal.guard_invoice_totals_reconcile` raises at
 * COMMIT for an issued invoice that has none — so `money === null` on an issued
 * invoice can only mean `sel_invoice_amounts_gated` hid it.
 *
 * `draft` and `void_before_issue` are trustworthy without any of this: the function
 * short-circuits to 0 for both before reading anything, so 0 is the true answer
 * whether or not the caller may see money.
 */
export function balanceIsTrustworthy(invoice: InvoiceRow): boolean {
  if (invoice.status === 'draft' || invoice.status === 'void_before_issue') return true;
  return invoice.money !== null;
}

/**
 * The invoices a work order has, or the fact that it has none.
 *
 * A named envelope rather than a bare `InvoiceView | null`, because the absence is
 * itself the answer a screen needs: "this work order has not been invoiced yet" is
 * a 200 with `invoice: null`, not a 404. A 404 here would be indistinguishable from
 * "that work order is not visible to you", and those two must not collapse.
 *
 * Since ADR-023 D5/D15 (P1-32-PRE-OD-FD5) a work order may carry several live
 * invoices, each billing approved quantity none of the others holds. `invoice` is
 * the one a screen acts on — the open draft when there is one, else the newest —
 * and `invoices` lists every live one, the draft first and then newest first.
 */
export interface WorkOrderInvoiceView {
  readonly workOrderId: string;
  readonly invoice: InvoiceView | null;
  /** Every live invoice of the work order, up to `WORK_ORDER_INVOICES_SHOWN`. */
  readonly invoices: readonly InvoiceView[];
  /** More live invoices exist than `invoices` lists. */
  readonly invoicesTruncated: boolean;
  /**
   * Approved quotation work remains that no live invoice holds, so another invoice
   * may be created for it. Quantities only; whether it can be billed now, and for
   * how much, is the preview's answer.
   */
  readonly approvedWorkToInvoice: boolean;
}

/** How many live invoices `sal.work-order-invoice-read` lists for one work order. */
export const WORK_ORDER_INVOICES_SHOWN = 50;

/** The line's item as published, or null when it names none or cannot be named. */
function lineItemView(
  itemId: string | null,
  items: ReadonlyMap<string, ItemLabel>
): InvoiceLineItemView | null {
  if (itemId === null) return null;
  const label = items.get(itemId);
  return label ? { id: itemId, code: label.code, name: label.name } : null;
}

/**
 * The code and name of every item the lines sold, from `@/modules/inventory`'s
 * port — the item master is that module's table (GAP-09). One read per invoice,
 * and none at all for a work-order invoice, whose lines name no item.
 */
export async function describeLineItems(
  db: DbHandle,
  lines: readonly InvoiceLineRow[]
): Promise<ReadonlyMap<string, ItemLabel>> {
  const ids = lines.flatMap((line) => (line.itemId === null ? [] : [line.itemId]));
  if (ids.length === 0) return new Map();
  return inventoryModule().reads.describeItems(db, ids);
}

/**
 * The revision a work-order invoice was made from, as quoted, or `null` (a counter
 * sale, a revision the caller cannot see, or a caller without `sal.finance.view`).
 * Read for the invoice's OWN revision, so it never depends on which revision the
 * work order would bill now (ADR-023 D5/D15).
 */
export async function describeInvoiceSource(
  db: DbHandle,
  repository: BillingRepository,
  invoice: InvoiceRow,
  units: MinorUnits = NO_MINOR_UNITS
): Promise<InvoiceSourceView | null> {
  if (invoice.quotationRevisionId === null) return null;
  const row = await repository.sourceRevision(db, {
    revisionId: invoice.quotationRevisionId,
    companyId: invoice.companyId,
    branchId: invoice.branchId,
  });
  return row === null
    ? null
    : {
        quotationRevisionId: invoice.quotationRevisionId,
        lineCount: row.lineCount,
        subtotal: moneyView(row.subtotal, invoice.currencyCode, units),
        discountTotal: moneyView(row.discountTotal, invoice.currencyCode, units),
      };
}

export class BillingReadService {
  public constructor(private readonly repository: BillingRepository) {}

  /**
   * One invoice with its lines.
   *
   * The invoice is loaded first and `authorizeScope` is then given the company and
   * branch it names. Without that the route's declared `scope` would be inert on an
   * id-addressed read: `requiresScopedEvaluation` returns false for an empty target
   * whatever the declaration says, so the check would degrade to the scope-blind
   * `iam.has_permission` — which is P1-18-A-01 exactly.
   *
   * The line query runs only after authorization, so a caller denied the branch
   * never causes a second read.
   */
  public async readInvoice(
    db: DbHandle,
    invoiceId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<InvoiceDetailView> {
    const invoice = await this.requireInvoice(db, invoiceId);
    await authorizeScope({ companyId: invoice.companyId, branchId: invoice.branchId });

    const lines = await this.repository.listInvoiceLines(db, {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    const items = await describeLineItems(db, lines);
    const units = await this.repository.minorUnitsFor(db, [invoice.currencyCode]);
    return {
      invoice: toInvoiceView(invoice, units),
      lines: lines.map((line) => toInvoiceLineView(line, items, units)),
      source: await describeInvoiceSource(db, this.repository, invoice, units),
      recordVersion: invoice.recordVersion,
    };
  }

  /**
   * The live invoices of a work order, if it has any (P1-30 A2, seam S-10; several
   * since ADR-023 D5/D15, P1-32-PRE-OD-FD5).
   *
   * The repository read behind it had no route in front of it before P1-30: its only
   * callers were the duplicate-create refusal and the delivery module's
   * financial-blocker port, neither of which a screen can reach. So a work-order
   * screen could not answer "has this been invoiced?" without listing invoices and
   * filtering client-side.
   *
   * Scope comes from the WORK ORDER row, never from the request. `findWorkOrderScope`
   * resolves company and branch, and `authorizeScope` is given those before the
   * invoice is read — the same order `readInvoice` and `previewInvoice` use, and for
   * the same reason: an id-addressed read with an empty target degrades to the
   * scope-blind `iam.has_permission` (P1-18-A-01).
   *
   * A work order that is not visible is `ERR-RES-001`. A visible work order with no
   * invoice is a 200 carrying `invoice: null`. Collapsing those two would tell a
   * caller "no invoice" for a work order in a branch they cannot see.
   */
  public async readWorkOrderInvoice(
    db: DbHandle,
    workOrderId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<WorkOrderInvoiceView> {
    const scope = await this.repository.findWorkOrderScope(db, workOrderId);
    if (!scope) {
      throw new AppFailure('ERR-RES-001', {
        message: `Work order ${workOrderId} was not found in scope`,
      });
    }
    await authorizeScope({ companyId: scope.companyId, branchId: scope.branchId });

    const where = {
      workOrderId: scope.workOrderId,
      companyId: scope.companyId,
      branchId: scope.branchId,
    };
    // One past the bound, so a truncated list says so rather than looking complete.
    const live = await this.repository.liveInvoicesForWorkOrder(
      db,
      where,
      WORK_ORDER_INVOICES_SHOWN + 1
    );
    const shown = live.slice(0, WORK_ORDER_INVOICES_SHOWN);
    const approvedWorkToInvoice = await this.repository.hasApprovedWorkToInvoice(db, where);

    // `toInvoiceView` folds the three amount columns to `totals: null` when RLS hid
    // them, so a caller without `sal.finance.view` gets the header with the money
    // OMITTED rather than zeroed. Reused deliberately: a second mapper would be a
    // second wire contract for one row.
    const units = await this.repository.minorUnitsFor(db, [
      ...new Set(shown.map((invoice) => invoice.currencyCode)),
    ]);
    const invoices = shown.map((invoice) => toInvoiceView(invoice, units));
    return {
      workOrderId: scope.workOrderId,
      // The draft first, then the newest: the repository's order.
      invoice: invoices[0] ?? null,
      invoices,
      invoicesTruncated: live.length > WORK_ORDER_INVOICES_SHOWN,
      approvedWorkToInvoice,
    };
  }

  /**
   * The invoice's open receivable, always as an amount WITH its currency.
   *
   * `isSettled` compares two `Decimal`s. It is not `Number(amount) === 0`: the
   * amount is `numeric(18,4)` and a double cannot represent every value it holds, so
   * a coercion could report an invoice with `0.0001` outstanding as settled.
   *
   * A draft or voided invoice reports `0` because `sal.invoice_open_receivable`
   * returns `0` for both — nothing has been claimed from the customer yet — and the
   * status is returned alongside so a caller can tell that zero from a paid one.
   *
   * A caller without `sal.finance.view` is DENIED rather than told zero. That is not
   * defensive politeness — see `balanceIsTrustworthy`: all three inputs to
   * `sal.invoice_open_receivable` are gated by that permission and the function is
   * `SECURITY INVOKER`, so without it the function computes `0 − 0 − 0` and returns a
   * figure indistinguishable from a fully settled invoice.
   */
  public async readOutstanding(
    db: DbHandle,
    invoiceId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<OutstandingView> {
    const invoice = await this.requireInvoice(db, invoiceId);
    await authorizeScope({ companyId: invoice.companyId, branchId: invoice.branchId });

    if (!balanceIsTrustworthy(invoice)) {
      throw new AppFailure('ERR-IAM-001', {
        message:
          `Invoice ${invoice.id} is "${invoice.status}" and its amounts are not visible to this ` +
          'caller, so its open receivable cannot be reported. Returning the 0 that ' +
          'sal.invoice_open_receivable computes without sal.finance.view would state that a ' +
          'possibly unpaid invoice is settled.',
        safeDetails: { requiredPermissions: [FINANCE_VIEW_PERMISSION] },
      });
    }

    const open = await this.repository.openReceivable(db, {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    /* c8 ignore next 4 -- the invoice was just read in the same transaction under
       the same context, so the second read cannot lose it. */
    if (!open) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: invoice vanished between the header read and the receivable read',
      });
    }

    const amount = Decimal.fromDatabase(open.amount, MONEY);
    const units = await this.repository.minorUnitsFor(db, [
      open.currencyCode,
      invoice.currencyCode,
    ]);
    return {
      invoiceId: open.invoiceId,
      status: open.status,
      outstanding: moneyView(open.amount, open.currencyCode, units),
      isSettled: !amount.greaterThan(Decimal.zero(MONEY)),
      settlement: await this.settlementOf(db, invoice, open.amount, units),
      asOf: open.asOf.toISOString(),
    };
  }

  /**
   * The credit, payment and refund positions of a trustworthy invoice (D7), or
   * `null` for one that claims nothing yet (draft, voided).
   *
   * Every comparison is between `Decimal`s built from the database's strings, and
   * the amounts are the ones `sal.invoice_open_receivable` itself subtracts, read
   * in the same transaction (`creditPosition`).
   */
  private async settlementOf(
    db: DbHandle,
    invoice: InvoiceRow,
    openAmount: string,
    units: MinorUnits
  ): Promise<SettlementView | null> {
    if (invoice.status !== 'issued' && invoice.status !== 'credited') return null;
    const position = await this.repository.creditPosition(db, {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    /* c8 ignore next 5 -- the invoice was read in the same transaction under the
       same context, and an issued invoice always has its amounts row. */
    if (!position || position.gross === null) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: an issued invoice has no readable amounts for its credit position',
      });
    }
    const credited = Decimal.fromDatabase(position.credited, MONEY);
    const paid = Decimal.fromDatabase(position.paid, MONEY);
    // Who paid for whom (ADR-023 D14). The payer is named only to a caller who may
    // read customers — asked once, and only when there is a payment to name.
    const thirdPartyRows = await this.repository.thirdPartyPayments(
      db,
      { invoiceId: invoice.id, companyId: invoice.companyId, branchId: invoice.branchId },
      THIRD_PARTY_PAYMENTS_SHOWN
    );
    const truncated = thirdPartyRows.length > THIRD_PARTY_PAYMENTS_SHOWN;
    const shown = truncated ? thirdPartyRows.slice(0, THIRD_PARTY_PAYMENTS_SHOWN) : thirdPartyRows;
    const mayNamePayer =
      shown.length > 0 && (await callerHoldsPermissionAnywhere(db, CUSTOMER_SEARCH_PERMISSION));
    // What the customer is owed back (ADR-023 D2): the open refund obligations.
    const refundOwed = await this.repository.openRefundOwed(db, {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    // What the invoice can still be credited (ADR-023 D2): the ceiling the
    // credit-note form caps at, stated by the database and never derived here.
    const ceiling = await this.repository.creditCeiling(db, {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    /* c8 ignore next 5 -- the invoice was read in the same transaction. */
    if (!ceiling) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: an issued invoice has no readable credit ceiling',
      });
    }
    return {
      creditStatus: deriveCreditStatus(credited, Decimal.fromDatabase(position.gross, MONEY)),
      paymentStatus: derivePaymentStatus(paid, Decimal.fromDatabase(openAmount, MONEY)),
      refundStatus: deriveRefundStatus(Decimal.fromDatabase(refundOwed, MONEY)),
      credited: moneyView(position.credited, invoice.currencyCode, units),
      paid: moneyView(position.paid, invoice.currencyCode, units),
      refundOwed: moneyView(refundOwed, invoice.currencyCode, units),
      creditable: moneyView(ceiling.creditable, invoice.currencyCode, units),
      thirdPartyPayments: shown.map((row) => ({
        receipt: { id: row.receiptId, reference: row.receiptNumber },
        payerName: mayNamePayer ? row.payerDisplayName : null,
        relationship: row.relationship,
        authorisationReference: row.authorisationReference,
        reason: row.reason,
        money: moneyView(row.amount, row.currencyCode, units),
        allocatedAt: row.allocatedAt.toISOString(),
      })),
      thirdPartyPaymentsTruncated: truncated,
    };
  }

  /**
   * What an invoice for this work order would contain, without creating one.
   *
   * Every amount is summed by PostgreSQL in `numeric` from the captured line
   * amounts of the source quotation revision, each already rounded half-up to
   * the currency's minor unit by `tg_quotation_items_money` (ADR-023, D1: a
   * document total is the sum of its rounded lines), which is how
   * `sal.issue_invoice` later recomputes the header from the invoice lines. So
   * the preview is not an estimate that the create path might contradict — it is
   * the same sum over the same frozen rows.
   *
   * Since ADR-023 D5/D15 (P1-32-PRE-OD-FD5) `lines` and the totals are what a NEW
   * invoice would bill: the approved lines that remain, each at what remains of it,
   * as `sal.billable_quotation_lines` answers — the read the database guards judge
   * the invoice by. A revision approved whole and never invoiced previews exactly as
   * before. `revisionLines` lists every line of the revision with its decision and
   * why it is or is not billed, and `revisionTotals` are the revision as quoted.
   * When everything approved is invoiced already the preview is a 200 with no lines
   * and zero totals, never a 404: the source exists, nothing remains of it.
   *
   * Nothing here defaults a tax rate, a discount, a currency or a jurisdiction. The
   * rate is `quo.quotation_items.captured_tax_rate`, resolved by the pricing layer
   * when the revision was priced and validated by `tg_quotation_items_money`;
   * the discount is `captured_discount`, bounded by `ck_quotation_items_discount`;
   * the currency is the revision's. A work order with no approved line produces
   * `ERR-RES-001`, never a guessed zero.
   */
  public async previewInvoice(
    db: DbHandle,
    workOrderId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<InvoicePreview> {
    const scope = await this.repository.findWorkOrderScope(db, workOrderId);
    if (!scope) {
      throw new AppFailure('ERR-RES-001', {
        message: `Work order ${workOrderId} was not found in scope`,
      });
    }
    await authorizeScope({ companyId: scope.companyId, branchId: scope.branchId });

    const source = resolveCommercialSource(
      await this.repository.findCommercialSources(db, {
        workOrderId: scope.workOrderId,
        companyId: scope.companyId,
        branchId: scope.branchId,
      }),
      workOrderId
    );

    const lines = await this.repository.listCommercialSourceLines(db, {
      revisionId: source.revisionId,
      companyId: source.companyId,
      branchId: source.branchId,
    });

    /**
     * Every previewed total passes through `Decimal.fromDatabase(_, MONEY)`, which is
     * not decoration: it is the same scale-and-precision check the invoice path applies,
     * and the preview's promise is that it "cannot disagree with the invoice it is
     * previewing".
     *
     * Without it the promise was breakable. PostgreSQL's `sum()` returns UNCONSTRAINED
     * `numeric`, not `numeric(18,4)`, and `tg_quotation_items_money` bounds each
     * line's own total without bounding their sum — so a Σ exceeding 14 integer digits
     * was returned here as a cheerful `200`, while `POST /invoices` for the same work
     * order answered `409` on SQLSTATE `22003`. The preview now fails on exactly the
     * input the invoice fails on.
     */
    const exact = (value: string): string => Decimal.fromDatabase(value, MONEY).toString();
    const minorUnit = (await this.repository.minorUnitsFor(db, [source.currencyCode])).get(
      source.currencyCode
    );
    const describe = (line: CommercialSourceLineRow) => ({
      sourceQuotationItemId: line.quotationItemId,
      lineNumber: line.lineNumber,
      // The `quo` vocabulary (`service`/`part`) is a subset of
      // `ck_invoice_lines_line_type` (`service`/`part`/`fee`), so the value is
      // carried through rather than translated. `fee` has no quotation counterpart.
      lineType: line.itemKind,
      description: line.description,
      item:
        line.quotedPart === null
          ? null
          : {
              id: line.quotedPart.itemId,
              code: line.quotedPart.itemCode,
              name: line.quotedPart.itemName,
            },
      unit:
        line.quotedPart === null
          ? null
          : { code: line.quotedPart.unitCode, name: line.quotedPart.unitName },
    });

    return {
      workOrderId: scope.workOrderId,
      quotationId: source.quotationId,
      quotationRevisionId: source.revisionId,
      currency: source.currencyCode,
      ...(minorUnit === undefined ? {} : { minorUnit }),
      subtotal: exact(source.subtotal),
      discountTotal: exact(source.discountTotal),
      taxTotal: exact(source.taxTotal),
      netTotal: exact(source.netTotal),
      grossTotal: exact(source.grossTotal),
      lines: billableLines(lines).map(({ line, money }) => ({
        ...describe(line),
        serviceId: line.serviceId,
        itemId: line.itemRef,
        // What this invoice line would bill: the remaining quantity, never the quoted one.
        quantity: line.remainingQuantity,
        unitPrice: exact(line.unitPrice),
        discount: exact(money.discount),
        // A `numeric(9,6)` fraction, not money — carried through unchanged, because
        // validating it against MONEY's scale would be the wrong check.
        taxRate: line.taxRate,
        netAmount: exact(money.net),
        taxAmount: exact(money.tax),
        grossAmount: exact(money.gross),
        approvedQuantity: line.approvedQuantity,
        invoicedQuantity: line.invoicedQuantity,
        partlyInvoicedEarlier: line.carried,
      })),
      revisionLines: lines.map((line) => ({
        ...describe(line),
        decision: line.decision,
        quotedQuantity: line.quantity,
        approvedQuantity: line.approvedQuantity,
        invoicedQuantity: line.invoicedQuantity,
        remainingQuantity: line.remainingQuantity,
        billingStatus: billingStatusOf(line),
        unitPrice: exact(line.unitPrice),
        discount: exact(line.discount),
        taxRate: line.taxRate,
        netAmount: exact(line.netAmount),
        taxAmount: exact(line.taxAmount),
        grossAmount: exact(line.grossAmount),
      })),
      revisionTotals: {
        subtotal: exact(source.revisionSubtotal),
        discountTotal: exact(source.revisionDiscountTotal),
        taxTotal: exact(source.revisionTaxTotal),
        netTotal: exact(source.revisionNetTotal),
        grossTotal: exact(source.revisionGrossTotal),
      },
    };
  }

  /**
   * The active invoice-numbering configuration for a company.
   *
   * `authorizeScope` is given a company and NO branch, which is the one place in
   * this module that happens: `sal.invoice_numbering_configs` has no `branch_id`
   * column and its RLS policies carry no branch clause, so there is no branch to
   * name. `requireScopedPermissions` fails closed only on a target with neither id,
   * so a company-only target is still evaluated against grant scope by
   * `iam.has_permission_in_scope`. Passing a fabricated branch would be worse than
   * passing none — it would assert a narrowing the row does not have.
   *
   * `null` is a legitimate answer, not an error: `sal.issue_invoice` COALESCEs the
   * resolved sequence code to `'invoice'`, so an unconfigured company still numbers.
   */
  public async readNumberingConfig(
    db: DbHandle,
    companyId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<NumberingConfigView | null> {
    await authorizeScope({ companyId });
    const row = await this.repository.activeNumberingConfig(db, companyId);
    return row ? toNumberingConfigView(row) : null;
  }

  /**
   * One credit note and what it is traceable to (DF-B4), or `ERR-RES-001` when it
   * is absent or not visible.
   *
   * The trace is read only after the scope is authorized. It costs a fixed number
   * of statements whatever the note: the trace, the customer-read answer, the
   * item label when a return raised the note, and the names — the directory
   * issues nothing for a caller who may not read users beyond its own check.
   */
  public async readCreditNote(
    db: DbHandle,
    creditNoteId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<CreditNoteDetailView> {
    const note = await this.repository.findCreditNote(db, creditNoteId);
    if (!note) {
      // Indistinguishable from "you do not hold sal.finance.view", because the whole
      // row is gated by it (`sel_credit_notes_gated`). Reporting the difference
      // would confirm the existence of a financial document to a caller who may not
      // see financial documents.
      throw new AppFailure('ERR-RES-001', {
        message: `Credit note ${creditNoteId} was not found in scope`,
      });
    }
    await authorizeScope({ companyId: note.companyId, branchId: note.branchId });
    const trace = await this.repository.findCreditNoteTrace(db, note);
    /* c8 ignore next 5 -- the note was just read in the same transaction under the
       same context, so the trace read cannot lose it. */
    if (!trace) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: credit note vanished between the note read and its trace read',
      });
    }
    const mayReadCustomers =
      trace.invoice !== null &&
      (await callerHoldsPermissionAnywhere(db, CUSTOMER_SEARCH_PERMISSION));
    const items =
      trace.sourceReturn === null
        ? new Map<string, ItemLabel>()
        : await inventoryModule().reads.describeItems(db, [trace.sourceReturn.itemId]);
    const people = [note.requestedBy, note.approvedBy, note.decidedBy].filter(
      (id): id is string => id !== null
    );
    const names = await iamDirectory().directory.resolveDisplayIdentities(db, [...new Set(people)]);
    const nameOf = (id: string | null): string | null =>
      id === null ? null : (names.get(id)?.displayName ?? null);
    const returned = trace.sourceReturn;
    const units = await this.repository.minorUnitsFor(db, [note.currencyCode]);
    // ADR-023 D2: what approving a pending note would do, and what an approved one
    // left the customer owed. Both under the caller's own row security.
    const effect =
      note.approvalState === 'pending'
        ? await this.repository.creditApprovalEffect(db, note)
        : null;
    const obligation =
      note.approvalState === 'approved'
        ? await this.repository.findRefundObligationForCreditNote(db, note)
        : null;
    return {
      ...toCreditNoteView(note, units),
      requestedAt: trace.requestedAt.toISOString(),
      requestedByName: nameOf(note.requestedBy),
      approvedByName: nameOf(note.approvedBy),
      decidedByName: nameOf(note.decidedBy),
      invoice:
        trace.invoice === null
          ? null
          : {
              invoiceNumber: trace.invoice.invoiceNumber,
              saleKind: trace.invoice.saleKind,
              workOrderId: trace.invoice.workOrderId,
              payerName: mayReadCustomers ? trace.invoice.payerDisplayName : null,
            },
      sourceReturn:
        returned === null
          ? null
          : {
              id: returned.id,
              itemCode: items.get(returned.itemId)?.code ?? null,
              itemName: items.get(returned.itemId)?.name ?? null,
              quantity: returned.quantity,
              receivedAt: returned.receivedAt.toISOString(),
            },
      approvalEffect:
        effect === null
          ? null
          : {
              reducesBalanceBy: moneyView(effect.reducesBalanceBy, note.currencyCode, units),
              refundOwed: moneyView(effect.refundOwed, note.currencyCode, units),
            },
      refundObligation: obligation === null ? null : toRefundObligationView(obligation, units),
    };
  }

  /**
   * One branch's refund obligations, newest first (`sal.refund-obligation-list`,
   * ADR-023 D2, P1-32-PRE-OD-FD2A), filtered by customer, invoice and state.
   *
   * The branch is the read's TARGET, re-authorized here before any row is fetched,
   * exactly as `listCreditNotes` does; RLS narrows again underneath, and
   * `sel_refund_obligations_gated` removes every row from a caller without
   * `sal.finance.view`, which the operation therefore declares.
   */
  public async listRefundObligations(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly partnerId?: string | undefined;
      readonly invoiceId?: string | undefined;
      readonly state?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<RefundObligationView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listRefundObligations(
      db,
      filter,
      pageRequest(REFUND_OBLIGATION_ORDER, page)
    );
    const units = await this.repository.minorUnitsFor(
      db,
      result.items.map((row) => row.currencyCode)
    );
    return { ...result, items: result.items.map((row) => toRefundObligationView(row, units)) };
  }

  /**
   * One branch's credit notes, newest first (DEF-T-07).
   *
   * The acceptance campaign raised a credit note from a customer return, was told
   * a second person had to approve it, and then found nothing anywhere that could
   * open it. A note is created against an invoice and carries no parent screen of
   * its own, so without a list it is reachable only by an id no screen prints.
   *
   * The branch is the read's TARGET — named by the caller and re-authorized here
   * before any row is fetched, exactly as `listCounterSales` does — so a caller
   * cannot page a branch it holds no authority in and learn what was credited
   * there. RLS narrows again underneath, and `sel_credit_notes_gated` removes
   * every row from a caller without `sal.finance.view`; that is why the operation
   * declares the permission rather than answering an empty page that would read
   * as "this branch has credited nothing".
   */
  public async listCreditNotes(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly approvalState?: string | undefined;
      readonly invoiceId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<CreditNoteView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listCreditNotes(
      db,
      filter,
      pageRequest(CREDIT_NOTE_ORDER, page)
    );
    const units = await this.repository.minorUnitsFor(
      db,
      result.items.map((row) => row.currencyCode)
    );
    return { ...result, items: result.items.map((row) => toCreditNoteView(row, units)) };
  }

  /**
   * One branch's invoices of every kind, newest first (Owner directive,
   * P1-32-PRE-OD-UX, `sal.invoice-list`).
   *
   * The pair is authorized BEFORE any row is read, as `listCreditNotes` and
   * `listCounterSales` do, so a caller cannot page a branch it holds no authority
   * in and learn what was billed there.
   *
   * ## Least privilege
   *
   * The gate is `sal.finance.view`, and that code reaches money, never a
   * customer's name or a vehicle's registration. So the page names the payer,
   * and the box matches a payer's name, only for a caller holding
   * `crm.customer.read`; and the box matches a plate or a VIN only for a caller
   * holding `veh.vehicle.read`. The invoice number is always matched: it is on
   * the row the caller already reads. Each answer is ONE scope-blind
   * `iam.has_permission` statement, asked the way the reception, appointment,
   * delivery and warranty lists ask it — the customer question on every call,
   * because the payer block depends on it; the vehicle question only when a box
   * was sent. Both can only narrow the page, never widen it, and neither depends
   * on the page size, so the statements sent stay constant.
   *
   * The PHONE arm is switched off for everyone: a phone number is on no row of
   * this list, and a box that matched one would turn a billing read into a way
   * of probing contact data.
   */
  public async listInvoices(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      /** Only the invoices money can still be applied to (`issued`/`credited`, open above zero). */
      readonly allocatable?: boolean | undefined;
      /** Only one kind: `counter_sale` or `work_order` (DF-B3). */
      readonly saleKind?: string | undefined;
      /** The raw free-text box; reduced here, once, by the shared rule. */
      readonly q?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<InvoiceListEntryView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const mayReadCustomers = await callerHoldsPermissionAnywhere(db, CUSTOMER_SEARCH_PERMISSION);
    let terms = toEntitySearchTerms(filter.q);
    if (terms.present) {
      terms = { ...terms, phoneDigits: '', phoneSuffixEligible: false };
      if (!mayReadCustomers) terms = withoutCustomerArms(terms);
      if (!(await callerHoldsPermissionAnywhere(db, VEHICLE_SEARCH_PERMISSION))) {
        terms = withoutVehicleArms(terms);
      }
    }
    const result = await this.repository.listInvoices(
      db,
      {
        companyId: filter.companyId,
        branchId: filter.branchId,
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.allocatable === true ? { allocatable: true } : {}),
        ...(filter.saleKind === undefined ? {} : { saleKind: filter.saleKind }),
        search: terms,
      },
      pageRequest(INVOICE_LIST_ORDER, page)
    );
    const units = await this.repository.minorUnitsFor(
      db,
      result.items.map((row) => row.currencyCode)
    );
    return {
      ...result,
      items: result.items.map((row) => toInvoiceListEntryView(row, mayReadCustomers, units)),
    };
  }

  // -------------------------------------------------------------------------
  // The cross-module port. Consumed by `@/modules/delivery`.
  // -------------------------------------------------------------------------

  /**
   * The open receivable on the live invoices of a work order, or `null`.
   *
   * Since ADR-023 D5/D15 (P1-32-PRE-OD-FD5) a work order may carry several live
   * invoices; the answer is the most blocking of them, and approved quotation work
   * no live invoice holds keeps it outstanding (`unbilledApprovedWork`).
   *
   * This is the delivery module's `financial_balance_outstanding` blocker, and it is
   * the single most consequential gate on handover. `sal.complete_delivery` enforces
   * a verified receiver, a complete mandatory checklist and at least one signature —
   * and reads **no financial balance at all**. If this method is deleted, the
   * database will hand over a vehicle with an unpaid invoice without complaint.
   *
   * It exists so that delivery never reads `sal.invoices` itself. That is not
   * bureaucracy: `sal.invoice_open_receivable` is meaningless without the header
   * currency, "live" is a predicate (and what remains to bill a database read) that a
   * second reader would have to reproduce, and a draft's zero must not be confused with a
   * settled zero. One reader, one definition.
   *
   * `null` means no live invoice exists — nothing has been billed, so there is
   * nothing outstanding. A caller must treat that as "no financial blocker", never
   * as "unknown".
   *
   * `hasOutstanding` is `amount > 0` decided by `Decimal.greaterThan`. Not
   * `Number(amount) > 0`: the amount is `numeric(18,4)`, and a double cannot
   * represent every value that column holds.
   *
   * ## It fails CLOSED when the balance is invisible
   *
   * `sal.invoice_open_receivable` returns 0 — not an error — for a caller without
   * `sal.finance.view`, because it is `SECURITY INVOKER` and all three of its inputs
   * are gated by that permission (see `balanceIsTrustworthy`). Trusting that 0 would
   * silently remove this blocker for a delivery operator who may see invoices but not
   * money, which is a plausible and probably common grant shape.
   *
   * So when the balance is not visible this reports `hasOutstanding: true`,
   * `amount: null` and `balanceVisible: false`. Blocked, with the amount explicitly
   * unknown rather than falsely zero. The system stays usable through the path the
   * delivery domain already designed for it: `financial_balance_outstanding` is the
   * one overridable blocker, and the override requires `sal.delivery.complete`. An
   * unpaid handover then needs a deliberate, audited, high-authority act instead of
   * happening by default.
   *
   * ## What this port is NOT
   *
   * An authorization boundary. It takes no `ScopeAuthorizer`, because the consuming
   * operation authorizes its own scope before it asks — the delivery record's
   * company and branch are what `sal.complete_delivery` acts in. The read is still
   * narrowed by RLS to the caller's companies and branches, and the work order's own
   * scope supplies the company/branch predicates. It must therefore never be exposed
   * as a route of its own: as a route it would answer a financial question with no
   * permission of its own attached.
   */
  public async openReceivableForWorkOrder(
    db: DbHandle,
    workOrderId: string
  ): Promise<WorkOrderReceivableView | null> {
    const scope = await this.repository.findWorkOrderScope(db, workOrderId);
    if (!scope) return null;

    const where = {
      workOrderId: scope.workOrderId,
      companyId: scope.companyId,
      branchId: scope.branchId,
    };
    // Every live invoice, unbounded: a gate that judged only some of them would clear
    // a work order whose other invoice is unpaid (ADR-023 D5/D15 lets there be several).
    const invoices = await this.repository.liveInvoicesForWorkOrder(db, where);
    if (invoices.length === 0) return null;
    const unbilledApprovedWork = await this.repository.hasApprovedWorkToInvoice(db, where);

    /**
     * The answer is the MOST blocking invoice, in the order a person would have to act
     * on them: one not yet issued (nothing collectable — the draft, which the
     * repository lists first), then one whose balance this caller cannot see, then one
     * with money outstanding. Only when every invoice is issued, visible and settled is
     * the newest one reported — and even then approved work no invoice holds yet keeps
     * the work order outstanding, for the reason no invoice at all does: nothing billed
     * is not settlement.
     */
    const views: WorkOrderReceivableView[] = [];
    for (const invoice of invoices) {
      views.push(await this.receivableOf(db, invoice, unbilledApprovedWork));
    }
    const blocking =
      views.find((view) => !view.collectable) ??
      views.find((view) => !view.balanceVisible) ??
      views.find((view) => view.hasOutstanding);
    if (blocking !== undefined) return blocking;
    const [newest] = views;
    /* c8 ignore next 3 -- `invoices` is not empty, so neither is `views`. */
    if (newest === undefined) {
      throw new AppFailure('ERR-SYS-001', { message: 'billing: no receivable view was built' });
    }
    return unbilledApprovedWork ? { ...newest, hasOutstanding: true } : newest;
  }

  /** One live invoice's part of `openReceivableForWorkOrder`. */
  private async receivableOf(
    db: DbHandle,
    invoice: InvoiceRow,
    unbilledApprovedWork: boolean
  ): Promise<WorkOrderReceivableView> {
    /**
     * A NOT-YET-ISSUED invoice has an open receivable of ZERO, and that zero is
     * structural rather than settlement.
     *
     * `sal.invoice_open_receivable` opens with
     * `IF v_status IS NULL OR v_status IN ('draft','void_before_issue') THEN RETURN 0`,
     * so a draft carrying a real 5,000.0000 of derived amounts answers `0.0000` — and an
     * independent `Decimal` comparison confirms that zero rather than questioning it.
     *
     * Reported as an outstanding balance, because the consumer that matters is the
     * delivery gate and the alternative was strictly worse than having no invoice at all:
     * `null` (no invoice) is treated as BLOCKING on the stated principle that "nothing was
     * invoiced is not settlement", while a draft resolved to `hasOutstanding: false` and
     * cleared the gate. Creating a draft invoice therefore REMOVED the financial blocker,
     * and the completion audit recorded `overriddenBlockers: null` — affirmatively
     * asserting the handover had cleared every gate on its own.
     *
     * `amount: null` rather than `'0.0000'` for the same reason the invisible case reports
     * null: the number is not a balance a caller may act on. `balanceVisible` stays true,
     * because this is not an authorization problem — the caller can see everything; there
     * is simply nothing collectable yet.
     */
    if (invoice.status !== 'issued' && invoice.status !== 'credited') {
      return {
        invoiceId: invoice.id,
        amount: null,
        currency: invoice.currencyCode,
        hasOutstanding: true,
        balanceVisible: true,
        collectable: false,
        status: invoice.status,
        unbilledApprovedWork,
      };
    }

    if (!balanceIsTrustworthy(invoice)) {
      return {
        invoiceId: invoice.id,
        amount: null,
        // The currency is on the ungated header row, so it is knowable even when the
        // amounts are not. Reported so a consumer can say WHICH currency the unknown
        // balance is in rather than having to omit the whole fact.
        currency: invoice.currencyCode,
        hasOutstanding: true,
        balanceVisible: false,
        collectable: true,
        status: invoice.status,
        unbilledApprovedWork,
      };
    }

    const open = await this.repository.openReceivable(db, {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    /* c8 ignore next 6 -- the invoice was read in this transaction under this
       context, so the receivable read cannot lose it. */
    if (!open) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: invoice vanished between the live-invoice read and the receivable read',
      });
    }

    const amount = Decimal.fromDatabase(open.amount, MONEY);
    return {
      invoiceId: open.invoiceId,
      amount: open.amount,
      currency: open.currencyCode,
      hasOutstanding: amount.greaterThan(Decimal.zero(MONEY)),
      balanceVisible: true,
      collectable: true,
      status: invoice.status,
      unbilledApprovedWork,
    };
  }

  /**
   * Loads an invoice or reports it absent.
   *
   * `ERR-RES-001` covers "does not exist" and "exists outside your scope" with one
   * answer, which is the platform-wide contract: distinguishing them would make the
   * error code an existence oracle for another branch's financial documents.
   */
  private async requireInvoice(db: DbHandle, invoiceId: string): Promise<InvoiceRow> {
    const invoice = await this.repository.findInvoice(db, invoiceId);
    if (!invoice) {
      throw new AppFailure('ERR-RES-001', {
        message: `Invoice ${invoiceId} was not found in scope`,
      });
    }
    return invoice;
  }
}
