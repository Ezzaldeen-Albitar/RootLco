/**
 * Billing domain rules (Phase 1-22).
 *
 * Every constant here is transcribed from a CHECK constraint on the frozen `sal`
 * schema. Nothing is invented: where the P1-11 handoff prose and the deployed DDL
 * disagree, the DDL is what appears below and the divergence is named in the
 * comment beside it.
 *
 * ## Two money validators, not one
 *
 * The `sal` schema draws a line P1-20 did not have to: `>= 0` on invoice, line and
 * financial-event amounts, and `> 0` on every payment instrument. So **a
 * zero-total issued invoice is legal** — a fully warranty-covered job bills the
 * customer nothing and still needs a numbered document — while a zero credit note
 * is not. A single validator would have to pick one and be wrong about the other.
 *
 * Negative amounts are legal nowhere in this domain. There is no signed amount
 * anywhere in `sal`, so a credit is a separate positive-amount row, never a
 * negative line.
 *
 * ## Why there is no arithmetic here
 *
 * `Money` from `@/modules/pricing` has no `add` and no `multiply`, deliberately:
 * PostgreSQL `numeric` is the authoritative engine, and a second one in TypeScript
 * could disagree with the CHECK constraints that validate the database's own
 * output. This module keeps that decision. `Decimal` is used for what it is for —
 * refusing a value that does not fit `numeric(18,4)` before it reaches SQL, and
 * comparing two amounts without materialising a double.
 *
 * Exceeding scale is the case that matters most, because it is **not an error**:
 * PostgreSQL silently rounds a fifth decimal place away on the cast. Only
 * `Decimal.parse` refuses it, which is why every amount crosses this boundary
 * through one of the two parsers below.
 */
import { Decimal, MONEY, parseNonNegative, parsePositive } from '@/modules/pricing';

/** `ck_invoices_status`. The whole lifecycle, and it is exactly four values. */
export const INVOICE_STATUSES = Object.freeze([
  'draft',
  'issued',
  'credited',
  'void_before_issue',
] as const);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * `ck_invoice_status_history_to_status` — SIX values, deliberately wider than the
 * four above.
 *
 * `partially_paid` and `paid` are recordable in history and are **never storable
 * on the invoice row** by any database code, because payment state is derived
 * (M-fin-1) from `sal.invoice_open_receivable`. Reading this vocabulary as if it
 * were the invoice's own would invent two statuses the invoice cannot hold.
 */
export const INVOICE_HISTORY_STATES = Object.freeze([
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'credited',
  'void_before_issue',
] as const);
export type InvoiceHistoryState = (typeof INVOICE_HISTORY_STATES)[number];

/** `ck_invoice_lines_line_type`. */
export const INVOICE_LINE_TYPES = Object.freeze(['service', 'part', 'fee'] as const);
export type InvoiceLineType = (typeof INVOICE_LINE_TYPES)[number];

/** `ck_credit_notes_approval_state`, identical to the reversal vocabulary. */
export const APPROVAL_STATES = Object.freeze(['pending', 'approved', 'rejected'] as const);
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/** `ck_financial_events_event_type`. Closed at six. */
export const FINANCIAL_EVENT_TYPES = Object.freeze([
  'invoice_issued',
  'receipt_recorded',
  'payment_allocated',
  'credit_note_issued',
  'receipt_reversed',
  'warranty_split_recorded',
] as const);
export type FinancialEventType = (typeof FINANCIAL_EVENT_TYPES)[number];

/** `ck_financial_events_source_type`. */
export const FINANCIAL_EVENT_SOURCE_TYPES = Object.freeze([
  'invoice',
  'receipt',
  'payment_allocation',
  'credit_note',
  'receipt_reversal',
] as const);
export type FinancialEventSourceType = (typeof FINANCIAL_EVENT_SOURCE_TYPES)[number];

/**
 * `ck_invoice_numbering_configs_mode`.
 *
 * Exposed as read-only metadata and asserted nowhere. The column has **zero
 * behavioural effect anywhere in the DDL** — `shared.next_display_number` does not
 * read it — and the `invoice_number` column comment calls business-level gaps
 * "tolerated and never renumbered". Treating `gapless` as a promise this backend
 * keeps would be a claim the database does not support.
 */
export const INVOICE_NUMBERING_MODES = Object.freeze(['gapless', 'gapped'] as const);
export type InvoiceNumberingMode = (typeof INVOICE_NUMBERING_MODES)[number];

/**
 * The legal status edges, transcribed from `sal.guard_invoice_freeze`.
 *
 * There is no un-void, no un-issue and no re-open. `credited` and
 * `void_before_issue` are terminal. `draft → draft` is legal (a no-op update) and
 * is listed because omitting it would make an idempotent redraft look illegal.
 */
export const INVOICE_TRANSITIONS: readonly {
  readonly from: InvoiceStatus;
  readonly to: InvoiceStatus;
}[] = Object.freeze([
  { from: 'draft', to: 'draft' },
  { from: 'draft', to: 'issued' },
  { from: 'draft', to: 'void_before_issue' },
  { from: 'issued', to: 'credited' },
]);

/** Column widths, so a caller gets a 422 rather than a driver truncation error. */
export const MAX_REASON = 2000;
export const MAX_DESCRIPTION = 2000;

/** `numeric(18,4)` — every money column in `sal`, on 11 columns across 4 tables. */
export const MONEY_PRECISION = 18;
export const MONEY_SCALE = 4;
/** `numeric(12,3)` — `sal.invoice_lines.quantity`, `CHECK (quantity > 0)`. */
export const QUANTITY_MIN = '0.001';
export const QUANTITY_MAX = '999999999.999';

export class BillingRuleError extends Error {
  public override readonly name = 'BillingRuleError';
}

/**
 * Parses an amount that may be zero: invoice totals, line amounts, event amounts.
 *
 * `ck_invoice_amounts_nonneg` and `ck_invoice_line_amounts_nonneg` both say
 * `>= 0`, and `ck_financial_events_amount` says the same.
 */
export function parseInvoiceAmount(input: string, field = 'amount'): Decimal {
  try {
    return parseNonNegative(input, MONEY);
  } catch (error) {
    throw new BillingRuleError(`${field}: ${(error as Error).message}`);
  }
}

/**
 * Parses an amount that must be strictly positive: credit notes, and every
 * payment instrument.
 *
 * `ck_credit_notes_amount`, `ck_receipts_amount`, `ck_payment_allocations_amount`
 * and `ck_receipt_reversals_amount` all say `> 0`.
 */
export function parseInstrumentAmount(input: string, field = 'amount'): Decimal {
  try {
    return parsePositive(input, MONEY);
  } catch (error) {
    throw new BillingRuleError(`${field}: ${(error as Error).message}`);
  }
}

/**
 * Refuses a credit note whose currency differs from its invoice's.
 *
 * **This is a P1-22 invariant, not a re-check of a database rule.** SB1 of the
 * archaeology reproduced the gap: five triggers fire on `sal.credit_notes` and not
 * one of them reads `sal.invoices.currency_code`, and `sal.approve_credit_note`
 * compares the amount but never the currency. A JOD credit note against a USD
 * invoice is accepted, approved, and then subtracted from the USD gross by
 * `sal.invoice_open_receivable`, which has no currency predicate either.
 *
 * So if this function is deleted, nothing else refuses the mismatch. That is
 * recorded as `P1-22-L-02` and an abuse-case test proves the database still
 * accepts it, so the residual stays visible instead of being assumed closed.
 */
export function assertCurrencyMatches(
  parentCurrency: string,
  childCurrency: string,
  context: string
): void {
  if (parentCurrency !== childCurrency) {
    throw new BillingRuleError(
      `${context}: currency ${childCurrency} does not match ${parentCurrency}; ` +
        'no protected constraint enforces this equality (P1-22-L-02)'
    );
  }
}

/** Whether an invoice may move from `from` to `to`. */
export function isLegalInvoiceTransition(from: string, to: string): boolean {
  return INVOICE_TRANSITIONS.some((edge) => edge.from === from && edge.to === to);
}

/**
 * Refuses an illegal status edge before SQL does.
 *
 * The message names the guard that would otherwise refuse it, so a reader can go
 * straight to the DDL rather than guessing which layer objected.
 */
export function assertLegalInvoiceTransition(from: string, to: string): void {
  if (!isLegalInvoiceTransition(from, to)) {
    throw new BillingRuleError(
      `an invoice may not move from "${from}" to "${to}"; see the protected ` +
        'sal.guard_invoice_freeze forward-only vocabulary'
    );
  }
}

/**
 * Refuses a credit note larger than the invoice's remaining open receivable.
 *
 * `sal.approve_credit_note` performs this comparison too, and this is the one
 * place a duplicated check is worth it: the approval path raises `check_violation`
 * with a message that is not a caller-safe contract, and the caller can act on
 * "exceeds the open amount" while it can act on nothing at all given a 500.
 */
export function assertCreditWithinOpenAmount(amount: Decimal, openAmount: Decimal): void {
  if (amount.greaterThan(openAmount)) {
    throw new BillingRuleError(
      `a credit note of ${amount.toString()} exceeds the invoice's open amount of ` +
        `${openAmount.toString()}`
    );
  }
}

/**
 * Refuses an issued or terminal invoice for an operation that requires a draft.
 *
 * `sal.guard_invoice_amount_frozen`, `guard_invoice_line_frozen` and
 * `guard_invoice_line_amount_frozen` each refuse a write whose parent invoice is
 * not `draft`, so post-issue correction is impossible by design. The only
 * instruments after issue are a credit note and a new invoice.
 */
export function assertInvoiceIsDraft(status: string, what: string): void {
  if (status !== 'draft') {
    throw new BillingRuleError(
      `${what} requires a draft invoice, and this invoice is "${status}"; issued ` +
        'financial history is immutable (sal.guard_invoice_freeze)'
    );
  }
}
