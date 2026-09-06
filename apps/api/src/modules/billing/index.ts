/**
 * `billing` module — public surface (Phase 1-22).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/billing`.
 * `scripts/check-module-boundaries.mjs` rule B1 and the ESLint rule both reject
 * `@/modules/billing/<anything>`, in any import spelling — every specifier is
 * canonicalised before the rules see it.
 *
 * ## What this module owns
 *
 * The invoice half of the `sal` schema: `invoices`, the restricted
 * `invoice_amounts`, `invoice_lines`, the restricted `invoice_line_amounts`,
 * `invoice_numbering_configs`, the append-only `invoice_status_history`, and
 * `credit_notes`. It READS `sal.financial_events` provenance through the primitives
 * that write it and never inserts into it directly.
 *
 * The payment half — `receipts`, `payment_methods`, `payment_allocations`,
 * `receipt_reversals` — belongs to `@/modules/payments`, and delivery belongs to
 * `@/modules/delivery`. The split is by aggregate and by authority: a document that
 * states what is owed and an instrument that settles it change for different
 * reasons, under different permissions, and never in one transaction.
 *
 * ## What no other module may do
 *
 * Read or write a `sal` invoice or credit-note table directly. In particular
 * `@/modules/delivery` must not read `sal.invoices`: its
 * `financial_balance_outstanding` blocker comes from
 * `openReceivableForWorkOrder` below, and that is not bureaucracy. The open
 * receivable is only meaningful paired with the invoice header's currency
 * (`sal.invoice_open_receivable` has no currency predicate at all), "the live
 * invoice" is defined by a partial unique index a second reader would have to
 * reproduce, and a draft's zero must never be confused with a settled zero. One
 * reader, one definition.
 *
 * ## What this module deliberately does not do
 *
 * - **It does not compute money.** Every amount is summed by PostgreSQL in
 *   `numeric`, inside the same `round(…, 4)` expression shape the CHECK constraints
 *   on `sal.invoice_amounts` and `sal.invoice_line_amounts` validate. `Money` and
 *   `Decimal` come from `@/modules/pricing` and expose no `add` and no `multiply`,
 *   so a second arithmetic engine is unexpressible rather than merely discouraged.
 * - **It does not accept an amount from a client.** `CreateInvoiceInput` has no
 *   total, no unit price, no tax rate, no discount and no line list. The only
 *   caller-named amount anywhere on this surface is a credit note's, bounded twice
 *   against `sal.invoice_open_receivable`.
 * - **It does not synthesise an invoice number.** There is no timestamp fallback, no
 *   UUID fallback and no `max()+1`. An unprovisioned sequence is reported as a
 *   configuration error naming the company, branch and sequence code, because
 *   `app_runtime` holds no INSERT on `shared.number_sequences` and cannot fix it.
 * - **It does not correct an issued invoice.** `sal.guard_invoice_freeze` allows
 *   `issued -> credited` and nothing else, so the instruments after issue are a
 *   credit note and a new invoice. There is no un-issue and no post-issue void.
 * - **It does not post a general ledger.** `sal.financial_events` is the
 *   source-fact boundary this platform stops at (P1-11): no accounts, no journals,
 *   no double entry. A `financial_events` row is a fact that happened, not a
 *   posting.
 * - **It does not touch receipts, allocations or reversals.** In particular it never
 *   calls `sal.approve_receipt_reversal` (P1-22-L-05), and it never calls
 *   `sal.partner_outstanding_balance`, which sums the open receivables of every
 *   issued invoice for a partner without comparing their currency codes — it would
 *   return a number that no currency labels (P1-22-L-06).
 * - **It does not allocate a warranty share.** Every line's payer split is
 *   customer-100%, because no protected configuration anywhere determines a warranty
 *   contribution at invoice time. See `NO_WARRANTY_SHARE` in
 *   `application/invoice-service.ts` for the enumeration of what was looked for and
 *   is absent.
 */
import { composeModule } from '@/server/layering';
import { BillingRepository } from './data/billing-repository';
import { BillingReadService } from './application/billing-read-service';
import { InvoiceService } from './application/invoice-service';

// ---- Row-shape types --------------------------------------------------------
//
// Exported as types only. The repository class itself is NOT exported: handing one
// out would let a caller run `sal` SQL under this module's identity and skip the
// scope authorization, audit and event rules that only the services apply.

export type {
  CommercialSourceLineRow,
  CommercialSourceRow,
  CreditNoteRow,
  InvoiceAmountsRow,
  InvoiceLineAmountsRow,
  InvoiceLineRow,
  InvoiceRow,
  NumberingConfigRow,
  OpenReceivableRow,
  WorkOrderScopeRow,
} from './data/billing-repository';

// ---- View types -------------------------------------------------------------

export type {
  CreditNoteView,
  InvoiceDetailView,
  InvoiceLineMoneyView,
  InvoiceLineView,
  InvoicePreview,
  InvoicePreviewLine,
  InvoiceTotalsView,
  InvoiceView,
  NumberingConfigView,
  OutstandingView,
  PayerSplitView,
  WorkOrderInvoiceView,
  /**
   * The delivery module's financial blocker. Exported because `@/modules/delivery`
   * composes its eligibility decision from it and must be able to name the type.
   */
  WorkOrderReceivableView,
} from './application/billing-read-service';

export type {
  CreatedInvoice,
  CreateInvoiceInput,
  CreditNoteResult,
  IssuedInvoice,
  RequestCreditNoteInput,
  VoidedInvoice,
} from './application/invoice-service';

// ---- Domain runtime values --------------------------------------------------
//
// The vocabularies and the assertions, so a consumer renders the same status names
// the CHECK constraints admit rather than a second list that can drift.

export {
  APPROVAL_STATES,
  BillingRuleError,
  FINANCIAL_EVENT_SOURCE_TYPES,
  FINANCIAL_EVENT_TYPES,
  INVOICE_HISTORY_STATES,
  INVOICE_LINE_TYPES,
  INVOICE_NUMBERING_MODES,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  MAX_DESCRIPTION,
  MAX_REASON,
  MONEY_PRECISION,
  MONEY_SCALE,
  QUANTITY_MAX,
  QUANTITY_MIN,
  assertCreditWithinOpenAmount,
  assertCurrencyMatches,
  assertInvoiceIsDraft,
  assertLegalInvoiceTransition,
  isLegalInvoiceTransition,
  parseInstrumentAmount,
  parseInvoiceAmount,
  type ApprovalState,
  type FinancialEventSourceType,
  type FinancialEventType,
  type InvoiceHistoryState,
  type InvoiceLineType,
  type InvoiceNumberingMode,
  type InvoiceStatus,
} from './domain/billing';

/**
 * Composition root: constructs the module's services once per process.
 *
 * Two services over ONE repository. The split is by authority — reads need
 * `sal.invoice.read` (and the money inside them additionally needs
 * `sal.finance.view`, enforced by RLS rather than by this module), while the
 * mutations need `sal.invoice.create`, `sal.invoice.issue` and
 * `sal.credit_note.approve` — but all the SQL for a table stays in one file,
 * because two files writing `sal.invoice_line_amounts` is how a tenant predicate
 * ends up on one query and not the other.
 *
 * `reads` is also the cross-module port: `openReceivableForWorkOrder` lives there
 * rather than on the mutation service because it answers a question and changes
 * nothing, and a delivery module holding a handle to the mutation service would be
 * one refactor away from issuing an invoice.
 */
export const billingModule = composeModule({
  module: 'billing',
  create: () => {
    const repository = new BillingRepository();
    return {
      reads: new BillingReadService(repository),
      invoices: new InvoiceService(repository),
    };
  },
});
