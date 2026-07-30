/**
 * `sal` invoice, credit-note and numbering SQL (Phase 1-22).
 *
 * The only place billing SQL is written. Five conventions hold without exception,
 * and each one closes a failure this schema makes reachable:
 *
 *  - **Every query carries an explicit `tenant_id` predicate** even though RLS
 *    already narrows, and every query that follows an id-addressed entry point
 *    carries `company_id` and `branch_id` as well. RLS is the guarantee; the
 *    predicates are the intent, and they keep the plan on the
 *    `(tenant, company, branch, …)`-leading composite indexes every `sal` table
 *    is built around.
 *  - **`numeric` values are read and written as STRINGS, never numbers.** Eleven
 *    money columns across four `sal` tables are `numeric(18,4)` and
 *    `sal.invoice_lines.quantity` is `numeric(12,3)`; `pg` returns OID 1700 as
 *    text and this repository never overrides that. IEEE-754 cannot represent the
 *    fourth decimal place exactly, so a single `Number()` anywhere on this path
 *    would silently move money.
 *  - **All arithmetic happens in PostgreSQL `numeric`, inside the same expression
 *    shape the CHECK constraints validate.** `ck_invoice_amounts_gross` is
 *    `gross_total = round(net_total + tax_total, 4)` and
 *    `ck_invoice_line_amounts_gross` is the same shape per line, so the INSERTs
 *    below write `round($n::numeric + $m::numeric, 4)` rather than a value
 *    TypeScript computed. The database then validates its own output.
 *  - **Money and its currency are never separated.** `sal.invoice_open_receivable`
 *    has no currency predicate at all — it is single-invoice, so the invoice
 *    header's `currency_code` is the only thing that labels its result — and every
 *    read below returns the two together in one row so a caller cannot pair the
 *    amount with the wrong currency.
 *  - **Mutations that the schema exposes only through a protected function go
 *    through that function.** `sal.issue_invoice` and `sal.approve_credit_note`
 *    each take the row lock, enforce their invariant, write the
 *    `sal.financial_events` row and (for issue) the status-history row. Composing
 *    any of that here would be a second, weaker implementation beside a proven
 *    one — and `sal.guard_event_completeness` would then be the only thing
 *    between a bug and an invoice with no `invoice_issued` event.
 *
 * ## Two cross-schema READS, and why they are here
 *
 * `previewTotals`/`findCommercialSources` and `listCommercialSourceLines` select
 * from `quo.quotations`, `quo.quotation_revisions`, `quo.quotation_items` and
 * `quo.approval_decisions`; `findWorkOrderScope` selects from `wo.work_orders`.
 * Both are SELECT-only and both are unavoidable:
 *
 *  - an invoice's amounts must be *derived* from approved commercial data, and
 *    the derivation is a `SUM` over line rows. Reading the lines through
 *    `@/modules/quotation`'s public surface and summing them in TypeScript would
 *    put a second arithmetic engine beside `numeric` — exactly what the third
 *    convention above forbids — and no port on that surface answers
 *    "the accepted revision for this work order" anyway;
 *  - `sal.invoices.company_id`/`branch_id` must equal the work order's, because
 *    `fk_invoices_work_order` is a composite FK on all four columns, so the scope
 *    has to be read from `wo.work_orders` before the invoice row can be built.
 *
 * `src/modules/inventory/data/inventory-repository.ts` reads `wo.work_orders` the
 * same way and for the same reason. The `quo` read is the wider of the two and is
 * reported as such: `@/modules/quotation`'s own header states that no other module
 * reads its tables, and this file does. It writes nothing there, holds no lock
 * there, and every predicate is the tenant/company/branch triple, so the read
 * cannot see or change more than the caller's own scope.
 *
 * No migration is authorized and none is needed: every statement uses an existing
 * `app_runtime` grant.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/**
 * SQLSTATEs the `sal` primitives raise deliberately.
 *
 * Named rather than matched inline because the SQLSTATE is the contract and the
 * message text is not: `sal.issue_invoice` and `shared.next_display_number` both
 * raise `no_data_found`, and only the position in the call sequence distinguishes
 * them (see `issueInvoice`).
 */
export const BILLING_SQLSTATE = {
  /**
   * `RAISE … USING ERRCODE = 'no_data_found'`.
   *
   * Raised by `sal.issue_invoice` and `sal.approve_credit_note` when the row is
   * not visible in scope, and — the case that matters — by
   * `shared.next_display_number` when no sequence row is provisioned for
   * `(tenant, company, branch, sequence_code)`. `app_runtime` holds no INSERT on
   * `shared.number_sequences` and cannot create one, so that is a configuration
   * gap the caller cannot fix by changing the request.
   */
  noDataFound: 'P0002',
  /**
   * `insufficient_privilege`. From `shared.next_display_number` when the company
   * or branch is outside the session's resolved scope, and from
   * `shared.stamp_dual_control_maker` when there is no user context to stamp.
   */
  insufficientPrivilege: '42501',
  /** `check_violation` — a `sal` guard or CHECK refused the row. */
  checkViolation: '23514',
  /**
   * `numeric_value_out_of_range` — a total does not fit `numeric(18,4)`.
   *
   * Reachable in principle rather than in practice: each source line already fits
   * `numeric(18,4)` by `quo.quotation_items`' own columns, so a header total would
   * need a sum of hundreds of near-maximal lines. It is named because the
   * alternative is an unmapped 500 on a financial write, which tells a caller its
   * request broke the server when in fact the amount is too large to store.
   */
  numericOutOfRange: '22003',
} as const;

/**
 * Unique indexes on `sal.invoices` this module can collide with.
 *
 * PostgreSQL reports the *index* name in the error's `constraint` field for a
 * unique-index violation, which is the only thing that distinguishes "this work
 * order already has a live invoice" from "this idempotency key is taken" from "the
 * sequence handed out a number that is already in use". All three are 409s, and all
 * three need different messages, because only one tells the caller to stop retrying
 * with the same key and only one is a platform fault rather than a client one.
 */
export const INVOICE_UNIQUE_INDEX = {
  workOrderActive: 'uq_invoices_work_order_active',
  idempotency: 'uq_invoices_idempotency',
  /**
   * `uq_invoices_number`, partial on `invoice_number IS NOT NULL`.
   *
   * Only `sal.issue_invoice` writes `invoice_number`, so a collision here means
   * `shared.next_display_number` returned a value that already exists in the branch
   * — a re-provisioned or manually reset `shared.number_sequences` row. That is a
   * configuration fault, not a duplicate request, and it must not be reported as
   * "already recorded".
   */
  number: 'uq_invoices_number',
} as const;

/** Reads the violated constraint/index name from an unknown driver error. */
export function violatedIndex(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'constraint' in error) {
    const name = (error as { constraint?: unknown }).constraint;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Row shapes. Every field readonly; every `numeric` column typed `string`;
// every timestamp `Date | null`; `recordVersion` a number.
// ---------------------------------------------------------------------------

/**
 * An invoice header, with its money when the caller may see it.
 *
 * `money` is `null` for two different reasons and deliberately does not
 * distinguish them: the invoice is a draft whose `sal.invoice_amounts` row has not
 * been written yet, or the caller does not hold `sal.finance.view` and the RLS
 * policy `sel_invoice_amounts_gated` made the row invisible. The second case is
 * the required behaviour — a header without money, not a 403 — because the
 * structural row is branch-scoped only (H-priv-1) and refusing the whole read
 * would deny a reception clerk facts they are entitled to.
 */
export interface InvoiceRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly quotationRevisionId: string | null;
  readonly payerPartnerId: string;
  readonly currencyCode: string;
  readonly status: string;
  /** Present only once issued — `ck_invoices_number_iff_issued` makes it a biconditional. */
  readonly invoiceNumber: string | null;
  readonly issuedAt: Date | null;
  readonly idempotencyKey: string | null;
  readonly recordVersion: number;
  readonly money: InvoiceAmountsRow | null;
}

/** The restricted 1:1 header totals. `numeric(18,4)` decimal strings. */
export interface InvoiceAmountsRow {
  readonly netTotal: string;
  readonly taxTotal: string;
  readonly grossTotal: string;
}

/**
 * One invoice line, with its money and payer split when visible.
 *
 * `money` is `null` under the same `sal.finance.view` gate as the header's, so a
 * caller without it sees the structure of the invoice and none of its amounts.
 */
export interface InvoiceLineRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly lineNumber: number;
  readonly lineType: string;
  /** `numeric(12,3)`, `CHECK (quantity > 0)`. */
  readonly quantity: string;
  readonly taxClassId: string | null;
  readonly currencyCode: string;
  readonly sourceServiceLineId: string | null;
  readonly sourcePartIssueId: string | null;
  readonly sourceQuotationItemId: string | null;
  readonly recordVersion: number;
  readonly money: InvoiceLineAmountsRow | null;
}

/** The restricted 1:1 line money and FR-WTY-004 payer split. */
export interface InvoiceLineAmountsRow {
  readonly unitPrice: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
  readonly customerPayAmount: string;
  readonly warrantyPayAmount: string;
}

/**
 * The derived open receivable, inseparable from the currency that labels it.
 *
 * Returned as one row from one query because `sal.invoice_open_receivable` takes
 * no currency and returns a bare `numeric`. Handing that number to a caller
 * unlabelled is how a JOD balance gets rendered as USD.
 */
export interface OpenReceivableRow {
  readonly invoiceId: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly status: string;
}

/**
 * The active invoice-numbering configuration for a company.
 *
 * `mode` is carried for display and asserted nowhere. It has **zero behavioural
 * effect anywhere in the DDL** — `shared.next_display_number` does not read it,
 * and `sal.issue_invoice` reads only `sequence_code` from this row — so treating
 * `gapless` as a promise this backend keeps would be a claim the database does not
 * support. The `invoice_number` column comment calls business-level gaps
 * "tolerated and never renumbered".
 */
export interface NumberingConfigRow {
  readonly id: string;
  readonly companyId: string;
  readonly mode: string;
  readonly sequenceCode: string;
  readonly status: string;
  readonly recordVersion: number;
}

/** A credit note. The WHOLE row is gated by `sal.finance.view`. */
export interface CreditNoteRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly invoiceId: string;
  readonly currencyCode: string;
  /** `numeric(18,4)`, `CHECK (amount > 0)`. */
  readonly amount: string;
  readonly reason: string;
  readonly approvalState: string;
  /** Server-stamped by `sal.stamp_dual_control_maker`; never supplied by a caller. */
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly issuedAt: Date | null;
  readonly idempotencyKey: string | null;
  readonly recordVersion: number;
}

/** A work order's scope. `sal.invoices` must be created in exactly this scope. */
export interface WorkOrderScopeRow {
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly state: string;
}

/**
 * One candidate commercial source for a work order, with its totals summed by
 * PostgreSQL.
 *
 * A *candidate*, not the answer: `ix_quotations_work_order` is not unique, so a
 * work order may carry several quotations and nothing in the DDL prevents two of
 * them from being accepted. The decision counts are returned so the caller can
 * derive the outcome with the platform's own `rollUpDecisions` rather than a
 * second definition of "accepted", and so an ambiguous source is reported rather
 * than silently resolved by picking one.
 *
 * Totals are ROUND-THEN-SUM, matching `sal.issue_invoice`, which sums the already
 * rounded `sal.invoice_line_amounts` (L-fin-3). Sum-then-round would produce a
 * preview that disagreed with the invoice by a hundredth in some inputs.
 */
export interface CommercialSourceRow {
  readonly quotationId: string;
  readonly revisionId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly currencyCode: string;
  /** `quo.quotations.payer_partner_ref`, nullable in the schema. */
  readonly payerPartnerRef: string | null;
  readonly itemCount: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
  /** `Σ round(unit × qty, 4)`. */
  readonly subtotal: string;
  /** `Σ captured_discount`. Already `numeric(18,4)`, so no rounding step. */
  readonly discountTotal: string;
  /** `Σ captured_tax_amount`, validated by `ck_quotation_items_tax_amount`. */
  readonly taxTotal: string;
  /** `Σ round(unit × qty − discount, 4)` — what becomes `net_total`. */
  readonly netTotal: string;
  /** `round(netTotal + taxTotal, 4)` — the shape `ck_invoice_amounts_gross` enforces. */
  readonly grossTotal: string;
}

/**
 * One approved commercial line, in the shape `sal.invoice_line_amounts` stores.
 *
 * `netAmount`, `taxAmount` and `grossAmount` are computed in `numeric` by the
 * query, from the captured values `quo` froze when the revision was issued. Tax
 * comes from `captured_tax_rate`/`captured_tax_amount` — configuration the
 * pricing layer resolved at quotation time and `ck_quotation_items_tax_amount`
 * validated — so nothing here defaults, guesses or computes a rate.
 */
export interface CommercialSourceLineRow {
  readonly quotationItemId: string;
  readonly lineNumber: number;
  /** `quo.quotation_items.item_kind`: `service` or `part`. */
  readonly itemKind: string;
  readonly serviceId: string | null;
  readonly itemRef: string | null;
  readonly description: string | null;
  readonly currencyCode: string;
  readonly unitPrice: string;
  readonly quantity: string;
  readonly discount: string;
  /** `numeric(9,6)` fraction in `[0,1]`. Carried for transparency, never re-applied. */
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
}

// ---------------------------------------------------------------------------
// SQL-shape interfaces and mappers.
// ---------------------------------------------------------------------------

const INVOICE_COLUMNS = `i.id, i.company_id, i.branch_id, i.work_order_id, i.quotation_revision_id,
  i.payer_partner_id, i.currency_code, i.status, i.invoice_number, i.issued_at,
  i.idempotency_key, i.record_version`;

interface InvoiceSql {
  id: string;
  company_id: string;
  branch_id: string;
  work_order_id: string;
  quotation_revision_id: string | null;
  payer_partner_id: string;
  currency_code: string;
  status: string;
  invoice_number: string | null;
  issued_at: Date | null;
  idempotency_key: string | null;
  record_version: number;
  net_total?: string | null;
  tax_total?: string | null;
  gross_total?: string | null;
}

/**
 * Maps an invoice row, folding the three amount columns into one nullable object.
 *
 * All three are checked rather than just one: they are `NOT NULL` together on
 * `sal.invoice_amounts`, so a partial set can only mean the LEFT JOIN found
 * nothing, and testing one column would leave the other two to be read as
 * `undefined` by a future edit.
 */
const toInvoice = (r: InvoiceSql): InvoiceRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  workOrderId: r.work_order_id,
  quotationRevisionId: r.quotation_revision_id,
  payerPartnerId: r.payer_partner_id,
  currencyCode: r.currency_code,
  status: r.status,
  invoiceNumber: r.invoice_number,
  issuedAt: r.issued_at,
  idempotencyKey: r.idempotency_key,
  recordVersion: r.record_version,
  money:
    r.net_total !== null &&
    r.net_total !== undefined &&
    r.tax_total !== null &&
    r.tax_total !== undefined &&
    r.gross_total !== null &&
    r.gross_total !== undefined
      ? { netTotal: r.net_total, taxTotal: r.tax_total, grossTotal: r.gross_total }
      : null,
});

interface InvoiceLineSql {
  id: string;
  company_id: string;
  branch_id: string;
  line_number: number;
  line_type: string;
  quantity: string;
  tax_class_id: string | null;
  currency_code: string;
  source_service_line_id: string | null;
  source_part_issue_id: string | null;
  source_quotation_item_id: string | null;
  record_version: number;
  unit_price: string | null;
  net_amount: string | null;
  tax_amount: string | null;
  gross_amount: string | null;
  customer_pay_amount: string | null;
  warranty_pay_amount: string | null;
}

const toInvoiceLine = (r: InvoiceLineSql): InvoiceLineRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  lineNumber: r.line_number,
  lineType: r.line_type,
  quantity: r.quantity,
  taxClassId: r.tax_class_id,
  currencyCode: r.currency_code,
  sourceServiceLineId: r.source_service_line_id,
  sourcePartIssueId: r.source_part_issue_id,
  sourceQuotationItemId: r.source_quotation_item_id,
  recordVersion: r.record_version,
  money:
    r.unit_price !== null &&
    r.net_amount !== null &&
    r.tax_amount !== null &&
    r.gross_amount !== null &&
    r.customer_pay_amount !== null &&
    r.warranty_pay_amount !== null
      ? {
          unitPrice: r.unit_price,
          netAmount: r.net_amount,
          taxAmount: r.tax_amount,
          grossAmount: r.gross_amount,
          customerPayAmount: r.customer_pay_amount,
          warrantyPayAmount: r.warranty_pay_amount,
        }
      : null,
});

interface CreditNoteSql {
  id: string;
  company_id: string;
  branch_id: string;
  invoice_id: string;
  currency_code: string;
  amount: string;
  reason: string;
  approval_state: string;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  issued_at: Date | null;
  idempotency_key: string | null;
  record_version: number;
}

const toCreditNote = (r: CreditNoteSql): CreditNoteRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  invoiceId: r.invoice_id,
  currencyCode: r.currency_code,
  amount: r.amount,
  reason: r.reason,
  approvalState: r.approval_state,
  requestedBy: r.requested_by,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  issuedAt: r.issued_at,
  idempotencyKey: r.idempotency_key,
  recordVersion: r.record_version,
});

const CREDIT_NOTE_COLUMNS = `c.id, c.company_id, c.branch_id, c.invoice_id, c.currency_code,
  c.amount::text AS amount, c.reason, c.approval_state, c.requested_by, c.approved_by,
  c.approved_at, c.issued_at, c.idempotency_key, c.record_version`;

export class BillingRepository extends Repository {
  protected readonly module = 'billing';

  // -------------------------------------------------------------------------
  // Scope resolution.
  // -------------------------------------------------------------------------

  /**
   * The work order's own company, branch and state.
   *
   * Read before anything else on the create path because `fk_invoices_work_order`
   * is a composite FK over `(tenant_id, company_id, branch_id, work_order_id)`:
   * an invoice cannot be placed in a scope its work order is not in, so the scope
   * is derived rather than accepted from the caller. It is also what the deferred
   * `authorizeScope` check is given, which is the difference between a
   * branch-scoped permission being enforced and being decorative (P1-18-A-01).
   *
   * The state is returned for transparency and this module gates nothing on it.
   * Nothing in `sal` ties invoice creation to a work-order state — there is no
   * trigger, no CHECK and no guard — and inventing a lifecycle rule here would be
   * a business decision this phase was not given. Handover *is* gated, by the
   * delivery module's own blocker list.
   */
  /**
   * The currency's minor unit, so an inbound amount can be refused for being more
   * precise than the money it is denominated in.
   *
   * `shared.currencies` is reference data: `sel_currencies_all` is `true` and
   * `app_runtime` holds SELECT, so this needs no permission and no scope. `null` means
   * the code is not a currency this platform supports, which the caller reports as a
   * validation failure rather than defaulting to the column's scale.
   */
  public async minorUnitForCurrency(db: DbHandle, code: string): Promise<number | null> {
    const row = await this.runOne<{ minor_unit: number }>(
      db,
      `SELECT minor_unit FROM shared.currencies WHERE code = $1`,
      [code]
    );
    return row ? row.minor_unit : null;
  }

  public async findWorkOrderScope(
    db: DbHandle,
    workOrderId: string
  ): Promise<WorkOrderScopeRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      work_order_id: string;
      company_id: string;
      branch_id: string;
      state: string;
    }>(
      db,
      `SELECT w.id AS work_order_id, w.company_id, w.branch_id, w.state
         FROM wo.work_orders w
        WHERE w.tenant_id = $1 AND w.id = $2 AND w.deleted_at IS NULL`,
      [context.principal.tenantId, workOrderId]
    );
    return row
      ? {
          workOrderId: row.work_order_id,
          companyId: row.company_id,
          branchId: row.branch_id,
          state: row.state,
        }
      : null;
  }

  // -------------------------------------------------------------------------
  // Invoice reads.
  // -------------------------------------------------------------------------

  /**
   * One invoice by id, with its money when the caller may see it.
   *
   * Addressed by `(tenant_id, id)` alone, and that is the one place in this file
   * where the company/branch predicates are absent: this is the entry point, so
   * there is no scope to bind yet — the row it returns is what supplies company
   * and branch to `authorizeScope` and to every subsequent query. `pk_invoices` is
   * on `id`, so the pair is already a unique lookup, and RLS narrows it to the
   * caller's companies and branches. The same shape as
   * `InventoryRepository.readOpeningBatch`.
   *
   * The money is a LEFT JOIN rather than a second query, and that is load-bearing
   * rather than an optimisation: `sel_invoice_amounts_gated` requires
   * `iam.has_permission('sal.finance.view')`, so for a caller without it the join
   * yields NULL and the header is still returned. A subselect that expected a row
   * would have made the absence of a permission look like a missing invoice.
   */
  public async findInvoice(db: DbHandle, invoiceId: string): Promise<InvoiceRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<InvoiceSql>(
      db,
      `SELECT ${INVOICE_COLUMNS},
              a.net_total::text   AS net_total,
              a.tax_total::text   AS tax_total,
              a.gross_total::text AS gross_total
         FROM sal.invoices i
         LEFT JOIN sal.invoice_amounts a
           ON a.tenant_id = i.tenant_id AND a.company_id = i.company_id
          AND a.branch_id = i.branch_id AND a.invoice_id = i.id
          AND a.deleted_at IS NULL
        WHERE i.tenant_id = $1 AND i.id = $2 AND i.deleted_at IS NULL`,
      [context.principal.tenantId, invoiceId]
    );
    return row ? toInvoice(row) : null;
  }

  /**
   * One invoice by id, held still for the rest of the transaction.
   *
   * `FOR UPDATE` is what makes a status decision meaningful on the issue, void and
   * credit paths. `sal.issue_invoice` takes the same lock internally, so an
   * unlocked pre-read would leave a window in which a concurrent issue completes
   * between "this is a draft" and the call — and this service would then write an
   * audit record and publish an event for work the other transaction did.
   *
   * `FOR UPDATE OF i` rather than a bare `FOR UPDATE`, and the money is LEFT JOINed
   * exactly as in `findInvoice`. Three consequences, all wanted:
   *
   *  - only the lifecycle row is locked. `sal.invoice_amounts` is rewritten by
   *    `sal.issue_invoice` in the same transaction, so a lock on it here would be
   *    taken and held for nothing;
   *  - a bare `FOR UPDATE` would be a syntax error, because PostgreSQL refuses to
   *    lock the nullable side of an outer join;
   *  - the caller can tell whether the money is VISIBLE to this principal, which is
   *    what `balanceIsTrustworthy` needs. An issued invoice always has an amounts row
   *    (`sal.guard_invoice_totals_reconcile` raises at COMMIT for one that does not),
   *    so a NULL here is the `sal.finance.view` gate and nothing else. Locking without
   *    that signal would have left the credit-note path unable to distinguish a
   *    settled invoice from an unreadable one.
   *
   * The LEFT JOIN — rather than an inner one — is why this still returns the header
   * for a caller without `sal.finance.view`, which is precisely the caller a void path
   * may legitimately have.
   */
  public async findInvoiceForUpdate(db: DbHandle, invoiceId: string): Promise<InvoiceRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<InvoiceSql>(
      db,
      `SELECT ${INVOICE_COLUMNS},
              a.net_total::text   AS net_total,
              a.tax_total::text   AS tax_total,
              a.gross_total::text AS gross_total
         FROM sal.invoices i
         LEFT JOIN sal.invoice_amounts a
           ON a.tenant_id = i.tenant_id AND a.company_id = i.company_id
          AND a.branch_id = i.branch_id AND a.invoice_id = i.id
          AND a.deleted_at IS NULL
        WHERE i.tenant_id = $1 AND i.id = $2 AND i.deleted_at IS NULL
          FOR UPDATE OF i`,
      [context.principal.tenantId, invoiceId]
    );
    return row ? toInvoice(row) : null;
  }

  /** An invoice resolved by its idempotency key, for replay detection. */
  public async findInvoiceByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<InvoiceRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<InvoiceSql>(
      db,
      // `uq_invoices_idempotency` is per (tenant_id, idempotency_key) — company and
      // branch are deliberately NOT in that index, so narrowing this lookup by them
      // would let the same key be reported as free in one branch and taken in
      // another, and the INSERT would then fail on a uniqueness rule the pre-check
      // had said nothing about.
      `SELECT ${INVOICE_COLUMNS}
         FROM sal.invoices i
        WHERE i.tenant_id = $1 AND i.idempotency_key = $2 AND i.deleted_at IS NULL`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? toInvoice(row) : null;
  }

  /**
   * The at-most-one live invoice for a work order.
   *
   * `uq_invoices_work_order_active` is a partial unique index over
   * `(tenant, company, branch, work_order_id) WHERE status <> 'void_before_issue'
   * AND deleted_at IS NULL`, so this predicate reproduces the index exactly and the
   * result cannot be more than one row. Used twice: to refuse a duplicate create
   * before the INSERT collides, and as the delivery module's financial blocker,
   * which needs "the invoice for this work order, if any" and must not read
   * `sal.invoices` itself.
   */
  public async liveInvoiceForWorkOrder(
    db: DbHandle,
    scope: { readonly workOrderId: string; readonly companyId: string; readonly branchId: string }
  ): Promise<InvoiceRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<InvoiceSql>(
      db,
      `SELECT ${INVOICE_COLUMNS},
              a.net_total::text   AS net_total,
              a.tax_total::text   AS tax_total,
              a.gross_total::text AS gross_total
         FROM sal.invoices i
         LEFT JOIN sal.invoice_amounts a
           ON a.tenant_id = i.tenant_id AND a.company_id = i.company_id
          AND a.branch_id = i.branch_id AND a.invoice_id = i.id
          AND a.deleted_at IS NULL
        WHERE i.tenant_id = $1 AND i.company_id = $2 AND i.branch_id = $3
          AND i.work_order_id = $4
          AND i.status <> 'void_before_issue' AND i.deleted_at IS NULL`,
      [context.principal.tenantId, scope.companyId, scope.branchId, scope.workOrderId]
    );
    return row ? toInvoice(row) : null;
  }

  /**
   * Every line of one invoice, with its money when visible.
   *
   * Not paginated, and not silently truncated either. The set is bounded by
   * construction: only this module writes `sal.invoice_lines`, it writes at most
   * one line per approved quotation item, and `MAX_ITEMS_PER_REVISION` caps that
   * at 200. A `LIMIT` here would trade a bounded read for a truncated one, which is
   * how a caller comes to believe an invoice has fewer lines than it does.
   *
   * Ordered by `line_number`, a total order inside one invoice by
   * `uq_invoice_lines_number`.
   */
  public async listInvoiceLines(
    db: DbHandle,
    scope: { readonly invoiceId: string; readonly companyId: string; readonly branchId: string }
  ): Promise<readonly InvoiceLineRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<InvoiceLineSql>(
      db,
      `SELECT l.id, l.company_id, l.branch_id, l.line_number, l.line_type,
              l.quantity::text AS quantity, l.tax_class_id, l.currency_code,
              l.source_service_line_id, l.source_part_issue_id, l.source_quotation_item_id,
              l.record_version,
              la.unit_price::text          AS unit_price,
              la.net_amount::text          AS net_amount,
              la.tax_amount::text          AS tax_amount,
              la.gross_amount::text        AS gross_amount,
              la.customer_pay_amount::text AS customer_pay_amount,
              la.warranty_pay_amount::text AS warranty_pay_amount
         FROM sal.invoice_lines l
         LEFT JOIN sal.invoice_line_amounts la
           ON la.tenant_id = l.tenant_id AND la.company_id = l.company_id
          AND la.branch_id = l.branch_id AND la.invoice_line_id = l.id
          AND la.deleted_at IS NULL
        WHERE l.tenant_id = $1 AND l.company_id = $2 AND l.branch_id = $3
          AND l.invoice_id = $4 AND l.deleted_at IS NULL
        ORDER BY l.line_number ASC`,
      [context.principal.tenantId, scope.companyId, scope.branchId, scope.invoiceId]
    );
    return result.rows.map(toInvoiceLine);
  }

  /**
   * The derived open receivable, with the currency that labels it.
   *
   * One query, two values, always together. `sal.invoice_open_receivable` returns
   * `round(gross − allocations − approved credits, 4)` excluding reversed receipts,
   * or `0` for a draft, a voided invoice, or an invoice it cannot see. It carries
   * **no currency predicate** — it is single-invoice, so the header's
   * `currency_code` is what the amount is denominated in, and this is the only
   * place that pairing is made.
   *
   * `round(…, 4)` is applied again on the way out purely to fix the scale: the
   * function's `RETURNS numeric` is unconstrained, so its `RETURN 0` path yields
   * `0` at scale 0 while the computed path yields scale 4, and a caller comparing
   * two `Decimal`s should not have to care which branch ran.
   *
   * Deliberately does NOT call `sal.partner_outstanding_balance`, which loops over
   * every issued invoice of a partner and adds the results without comparing
   * currency codes (P1-22-L-06). It would return a number no currency labels.
   */
  public async openReceivable(
    db: DbHandle,
    scope: { readonly invoiceId: string; readonly companyId: string; readonly branchId: string }
  ): Promise<OpenReceivableRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      invoice_id: string;
      amount: string;
      currency_code: string;
      status: string;
    }>(
      db,
      `SELECT i.id AS invoice_id, i.currency_code, i.status,
              round(sal.invoice_open_receivable(i.id), 4)::text AS amount
         FROM sal.invoices i
        WHERE i.tenant_id = $1 AND i.company_id = $2 AND i.branch_id = $3
          AND i.id = $4 AND i.deleted_at IS NULL`,
      [context.principal.tenantId, scope.companyId, scope.branchId, scope.invoiceId]
    );
    return row
      ? {
          invoiceId: row.invoice_id,
          amount: row.amount,
          currencyCode: row.currency_code,
          status: row.status,
        }
      : null;
  }

  /**
   * The active numbering configuration for a company, or `null`.
   *
   * Company-scoped with **no branch predicate**, and that is the table's own
   * shape rather than an omission: `sal.invoice_numbering_configs` has no
   * `branch_id` column and its RLS policies carry no branch clause, so numbering
   * posture is a company-level decision even though the sequence itself is
   * allocated per branch.
   *
   * `uq_invoice_numbering_configs_active` is partial on
   * `status = 'active' AND deleted_at IS NULL`, so at most one row can match.
   * `null` is not an error: `sal.issue_invoice` COALESCEs the resolved
   * `sequence_code` to `'invoice'`.
   */
  public async activeNumberingConfig(
    db: DbHandle,
    companyId: string
  ): Promise<NumberingConfigRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      mode: string;
      sequence_code: string;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT n.id, n.company_id, n.mode, n.sequence_code, n.status, n.record_version
         FROM sal.invoice_numbering_configs n
        WHERE n.tenant_id = $1 AND n.company_id = $2
          AND n.status = 'active' AND n.deleted_at IS NULL`,
      [context.principal.tenantId, companyId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          mode: row.mode,
          sequenceCode: row.sequence_code,
          status: row.status,
          recordVersion: row.record_version,
        }
      : null;
  }

  // -------------------------------------------------------------------------
  // Credit-note reads.
  // -------------------------------------------------------------------------

  /**
   * One credit note by id.
   *
   * No `deleted_at` predicate anywhere on this table, and that is the DDL rather
   * than an oversight: `sal.credit_notes` has no `deleted_at` and no `deleted_by`
   * column at all. A credit note is never soft-deleted — `rejected` is how a
   * request is refused, and an approved one is frozen by
   * `sal.guard_dual_control_approval`.
   *
   * The whole row is gated by `sal.finance.view` (`sel_credit_notes_gated`), so a
   * caller without that permission gets `null` and, from the service, the same
   * `ERR-RES-001` a genuinely absent note produces. That non-disclosure is
   * deliberate.
   */
  public async findCreditNote(db: DbHandle, creditNoteId: string): Promise<CreditNoteRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<CreditNoteSql>(
      db,
      `SELECT ${CREDIT_NOTE_COLUMNS}
         FROM sal.credit_notes c
        WHERE c.tenant_id = $1 AND c.id = $2`,
      [context.principal.tenantId, creditNoteId]
    );
    return row ? toCreditNote(row) : null;
  }

  /**
   * One credit note, held still for the approval decision.
   *
   * `sal.approve_credit_note` locks the note and then the invoice. Taking the
   * note's lock first here preserves that order, so the pre-read and the call
   * cannot interleave with a concurrent approval — and two concurrent approvals
   * serialise rather than both reaching the audit and outbox writes, where the
   * second would abort the transaction on `uq_event_outbox_event_key`.
   */
  public async findCreditNoteForUpdate(
    db: DbHandle,
    creditNoteId: string
  ): Promise<CreditNoteRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<CreditNoteSql>(
      db,
      `SELECT ${CREDIT_NOTE_COLUMNS}
         FROM sal.credit_notes c
        WHERE c.tenant_id = $1 AND c.id = $2
          FOR UPDATE`,
      [context.principal.tenantId, creditNoteId]
    );
    return row ? toCreditNote(row) : null;
  }

  /** A credit note resolved by its idempotency key, for replay detection. */
  public async findCreditNoteByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<CreditNoteRow | null> {
    const context = this.assertContext(db);
    // `uq_credit_notes_idempotency` is per (tenant_id, idempotency_key), so this
    // lookup matches the index rather than narrowing past it.
    const row = await this.runOne<CreditNoteSql>(
      db,
      `SELECT ${CREDIT_NOTE_COLUMNS}
         FROM sal.credit_notes c
        WHERE c.tenant_id = $1 AND c.idempotency_key = $2`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? toCreditNote(row) : null;
  }

  // -------------------------------------------------------------------------
  // The invoice preview — read-only, server-derived, computed in `numeric`.
  // -------------------------------------------------------------------------

  /**
   * Every candidate commercial source for a work order, with totals summed by
   * PostgreSQL.
   *
   * This is the invoice preview's arithmetic, and it runs in the database for one
   * reason: the amounts it produces are the amounts the invoice will carry, and
   * `ck_invoice_amounts_gross`, `ck_invoice_line_amounts_gross` and
   * `sal.issue_invoice` all express them in `numeric`. A TypeScript sum would be a
   * second engine that could disagree with the constraint validating its own
   * output — and `Money` deliberately has no `add` for exactly that reason.
   *
   * ### Which tables, and why these
   *
   * `quo.quotation_revisions` and `quo.quotation_items`, joined to
   * `quo.quotations` for the work-order link and the payer, with
   * `quo.approval_decisions` LEFT JOINed for the per-item customer decision. Those
   * four are the approved commercial source in this platform: the items carry
   * `captured_unit_price`, `captured_quantity`, `captured_discount`,
   * `captured_tax_rate` and `captured_tax_amount`, frozen when the revision was
   * issued (`quo.guard_quotation_item` refuses any write once the parent leaves
   * draft), and `ck_quotation_items_tax_amount` has already validated that
   * `captured_tax_amount = round((unit × qty − discount) × rate, 4)`.
   *
   * So every rate and every discount in the preview is captured configuration.
   * Nothing here reads a live price list, resolves a tax rate, or defaults one:
   * this module hard-codes no rate, no currency, no jurisdiction and no
   * tax-inclusive/exclusive convention, and a work order with no accepted revision
   * yields no row rather than a zero.
   *
   * ### Which revision, and why acceptance is not read from a status column
   *
   * `r.id = q.current_revision_id AND r.status = 'issued'` picks at most one
   * revision per quotation — `uq_quotation_revisions_one_issued` already guarantees
   * one issued revision per quotation, and the `current_revision_id` equality pins
   * it to the one the quotation itself points at rather than a superseded sibling.
   *
   * `q.status` is filtered only to exclude `cancelled`. Acceptance is DERIVED from
   * the per-item decisions on every read (BR-QUO-001): `quo.quotations.status` is a
   * cached roll-up and no constraint ties it to `quo.approval_decisions`, so
   * trusting it would mean billing from a value that could have drifted from the
   * decisions it summarises. The three counts are the underlying facts and the
   * caller derives the outcome from them with the platform's own `rollUpDecisions`.
   *
   * Expiry is deliberately not a filter. `quo.expireLapsed` expires revisions whose
   * decision is still incomplete, so an accepted revision that has since passed
   * `expires_at` was accepted before it lapsed — refusing to bill it would refuse
   * work the customer authorised.
   *
   * ### Round-then-sum, not sum-then-round
   *
   * `sal.issue_invoice` recomputes the header from `Σ` of the *already rounded*
   * per-line `sal.invoice_line_amounts` (L-fin-3). The aggregate below rounds each
   * line first and then sums, so the preview equals what issue will write. The
   * identity `grossTotal = round(subtotal − discountTotal + taxTotal, 4)` also
   * holds exactly here, because `captured_discount` is `numeric(18,4)`: subtracting
   * a scale-4 value commutes with rounding to scale 4.
   *
   * `count(it.id)` rather than `count(*)`: the join to items is a LEFT JOIN, so
   * `count(*)` would report 1 for a revision with no items and the caller could not
   * tell an empty source from a one-line one.
   */
  public async findCommercialSources(
    db: DbHandle,
    scope: { readonly workOrderId: string; readonly companyId: string; readonly branchId: string }
  ): Promise<readonly CommercialSourceRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      quotation_id: string;
      revision_id: string;
      company_id: string;
      branch_id: string;
      currency_code: string;
      payer_partner_ref: string | null;
      item_count: number;
      approved_count: number;
      rejected_count: number;
      subtotal: string;
      discount_total: string;
      tax_total: string;
      net_total: string;
      gross_total: string;
    }>(
      db,
      `SELECT q.id AS quotation_id, r.id AS revision_id, r.company_id, r.branch_id,
              r.currency_code, q.payer_partner_ref,
              count(it.id)::int AS item_count,
              count(d.id) FILTER (WHERE d.decision = 'approved')::int AS approved_count,
              count(d.id) FILTER (WHERE d.decision = 'rejected')::int AS rejected_count,
              COALESCE(sum(round(it.captured_unit_price * it.captured_quantity, 4)), 0)::text
                AS subtotal,
              COALESCE(sum(it.captured_discount), 0)::text AS discount_total,
              COALESCE(sum(it.captured_tax_amount), 0)::text AS tax_total,
              COALESCE(sum(round(it.captured_unit_price * it.captured_quantity
                                 - it.captured_discount, 4)), 0)::text AS net_total,
              round(COALESCE(sum(round(it.captured_unit_price * it.captured_quantity
                                       - it.captured_discount, 4)), 0)
                    + COALESCE(sum(it.captured_tax_amount), 0), 4)::text AS gross_total
         FROM quo.quotations q
         JOIN quo.quotation_revisions r
           ON r.tenant_id = q.tenant_id AND r.company_id = q.company_id
          AND r.branch_id = q.branch_id AND r.quotation_id = q.id
         LEFT JOIN quo.quotation_items it
           ON it.tenant_id = r.tenant_id AND it.company_id = r.company_id
          AND it.branch_id = r.branch_id AND it.quotation_revision_id = r.id
          AND it.deleted_at IS NULL
         LEFT JOIN quo.approval_decisions d
           ON d.tenant_id = it.tenant_id AND d.company_id = it.company_id
          AND d.branch_id = it.branch_id AND d.quotation_revision_id = it.quotation_revision_id
          AND d.quotation_item_id = it.id
        WHERE q.tenant_id = $1 AND q.company_id = $2 AND q.branch_id = $3
          AND q.work_order_id = $4 AND q.deleted_at IS NULL AND q.status <> 'cancelled'
          AND r.id = q.current_revision_id AND r.status = 'issued' AND r.deleted_at IS NULL
        GROUP BY q.id, r.id, r.company_id, r.branch_id, r.currency_code, q.payer_partner_ref
        ORDER BY r.id ASC`,
      [context.principal.tenantId, scope.companyId, scope.branchId, scope.workOrderId]
    );
    return result.rows.map((r) => ({
      quotationId: r.quotation_id,
      revisionId: r.revision_id,
      companyId: r.company_id,
      branchId: r.branch_id,
      currencyCode: r.currency_code,
      payerPartnerRef: r.payer_partner_ref,
      itemCount: r.item_count,
      approvedCount: r.approved_count,
      rejectedCount: r.rejected_count,
      subtotal: r.subtotal,
      discountTotal: r.discount_total,
      taxTotal: r.tax_total,
      netTotal: r.net_total,
      grossTotal: r.gross_total,
    }));
  }

  /**
   * The approved commercial lines of one revision, in the shape the invoice stores.
   *
   * The per-line amounts are computed by the same `numeric` expressions the
   * aggregate sums, so a line list and a total can never disagree:
   * `net = round(unit × qty − discount, 4)`, `tax = captured_tax_amount`,
   * `gross = round(net + tax, 4)`. That last value is provably
   * `captured_line_total`, since `ck_quotation_items_line_total` already fixes
   * `captured_line_total = round(unit × qty − discount + tax, 4)` and adding a
   * scale-4 tax commutes with rounding to scale 4 — so the invoice line inherits an
   * amount the quotation's own CHECK constraint validated, rather than a
   * recomputation of it.
   *
   * `item_kind` is carried through unmapped. `quo` uses `service`/`part` and
   * `ck_invoice_lines_line_type` admits `service`/`part`/`fee`; the two vocabularies
   * overlap exactly on the values a quotation can produce, and `fee` has no
   * quotation counterpart, so no translation table is needed or invented.
   */
  public async listCommercialSourceLines(
    db: DbHandle,
    scope: { readonly revisionId: string; readonly companyId: string; readonly branchId: string }
  ): Promise<readonly CommercialSourceLineRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      quotation_item_id: string;
      line_number: number;
      item_kind: string;
      service_id: string | null;
      item_ref: string | null;
      description: string | null;
      currency_code: string;
      unit_price: string;
      quantity: string;
      discount: string;
      tax_rate: string;
      net_amount: string;
      tax_amount: string;
      gross_amount: string;
    }>(
      db,
      `SELECT it.id AS quotation_item_id, it.line_number, it.item_kind, it.service_id,
              it.item_ref, it.description, it.currency_code,
              it.captured_unit_price::text AS unit_price,
              it.captured_quantity::text   AS quantity,
              it.captured_discount::text   AS discount,
              it.captured_tax_rate::text   AS tax_rate,
              round(it.captured_unit_price * it.captured_quantity
                    - it.captured_discount, 4)::text AS net_amount,
              it.captured_tax_amount::text AS tax_amount,
              round(round(it.captured_unit_price * it.captured_quantity
                          - it.captured_discount, 4)
                    + it.captured_tax_amount, 4)::text AS gross_amount
         FROM quo.quotation_items it
        WHERE it.tenant_id = $1 AND it.company_id = $2 AND it.branch_id = $3
          AND it.quotation_revision_id = $4 AND it.deleted_at IS NULL
        ORDER BY it.line_number ASC`,
      [context.principal.tenantId, scope.companyId, scope.branchId, scope.revisionId]
    );
    return result.rows.map((r) => ({
      quotationItemId: r.quotation_item_id,
      lineNumber: r.line_number,
      itemKind: r.item_kind,
      serviceId: r.service_id,
      itemRef: r.item_ref,
      description: r.description,
      currencyCode: r.currency_code,
      unitPrice: r.unit_price,
      quantity: r.quantity,
      discount: r.discount,
      taxRate: r.tax_rate,
      netAmount: r.net_amount,
      taxAmount: r.tax_amount,
      grossAmount: r.gross_amount,
    }));
  }

  // -------------------------------------------------------------------------
  // Invoice mutations. Every statement uses an existing `app_runtime` grant.
  // -------------------------------------------------------------------------

  /**
   * Inserts a draft invoice.
   *
   * `status` is **omitted from the column list**, not passed as `'draft'`. The
   * column default is `'draft'` and `sal.guard_invoice_freeze` raises
   * `check_violation` on any INSERT whose status is not `draft`, so there is
   * nothing a caller could usefully supply — and leaving the column out means no
   * code path exists through which a client-chosen status could ever reach it.
   * `invoice_number` and `issued_at` are omitted for the same reason:
   * `ck_invoices_number_iff_issued` makes them a biconditional with the status, and
   * `sal.issue_invoice` is the only thing that sets either.
   *
   * A 23505 here is one of two distinct conflicts —
   * `uq_invoices_work_order_active` or `uq_invoices_idempotency` — and the caller
   * separates them with `violatedIndex`.
   */
  public async insertDraftInvoice(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly workOrderId: string;
      readonly quotationRevisionId: string | null;
      readonly payerPartnerId: string;
      readonly currencyCode: string;
      readonly idempotencyKey: string | null;
    }
  ): Promise<InvoiceRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<InvoiceSql>(
      db,
      `INSERT INTO sal.invoices
         (tenant_id, company_id, branch_id, work_order_id, quotation_revision_id,
          payer_partner_id, currency_code, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, company_id, branch_id, work_order_id, quotation_revision_id,
                 payer_partner_id, currency_code, status, invoice_number, issued_at,
                 idempotency_key, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.quotationRevisionId,
        input.payerPartnerId,
        input.currencyCode,
        input.idempotencyKey,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('billing: draft invoice insert returned no row');
    return toInvoice(row);
  }

  /**
   * Inserts the restricted 1:1 header totals.
   *
   * `gross_total` is computed by the statement as `round($n + $m, 4)` rather than
   * bound: that is `ck_invoice_amounts_gross` verbatim, so the constraint validates
   * an expression the database itself evaluated and a TypeScript rounding
   * disagreement is unexpressible. `sal.issue_invoice` recomputes all three from
   * the lines at issue time, so this row is the draft's working total, not the
   * authority.
   *
   * `tg_invoice_amounts_frozen` requires the parent invoice to be `draft`, and
   * `ins_invoice_amounts_gated` requires `sal.finance.view` — so a caller who may
   * create an invoice but may not see money cannot write this row, and the create
   * path fails closed rather than producing an invoice with no totals.
   */
  public async insertInvoiceAmounts(
    db: DbHandle,
    input: {
      readonly invoiceId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly netTotal: string;
      readonly taxTotal: string;
    }
  ): Promise<InvoiceAmountsRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ net_total: string; tax_total: string; gross_total: string }>(
      db,
      `INSERT INTO sal.invoice_amounts
         (tenant_id, company_id, branch_id, invoice_id, net_total, tax_total, gross_total, created_by)
       VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric,
               round($5::numeric + $6::numeric, 4), $7)
       RETURNING net_total::text AS net_total, tax_total::text AS tax_total,
                 gross_total::text AS gross_total`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.invoiceId,
        input.netTotal,
        input.taxTotal,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('billing: invoice amounts insert returned no row');
    return { netTotal: row.net_total, taxTotal: row.tax_total, grossTotal: row.gross_total };
  }

  /**
   * Inserts one structural invoice line.
   *
   * `currency_code` is bound from the header rather than from the source line, and
   * `tg_invoice_lines_frozen` checks the equality itself: it refuses any line whose
   * currency differs from `sal.invoices.currency_code`. Passing the header value is
   * what makes that check a confirmation rather than a rejection.
   *
   * `tax_class_id` is left NULL, deliberately. `quo.quotation_items` captures a
   * tax *rate* (`numeric(9,6)`) and no tax class, and `org.tax_classes` is keyed by
   * `(tenant, company, id)` — so there is no protected mapping from a captured rate
   * back to the class that produced it, and inventing one would attach a
   * classification to an invoice line on a guess. The rate that was actually
   * applied is preserved where it belongs: in the line's `tax_amount`.
   */
  public async insertInvoiceLine(
    db: DbHandle,
    input: {
      readonly invoiceId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly lineNumber: number;
      readonly lineType: string;
      readonly quantity: string;
      readonly currencyCode: string;
      readonly sourceQuotationItemId: string | null;
    }
  ): Promise<{ readonly id: string; readonly lineNumber: number }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string; line_number: number }>(
      db,
      `INSERT INTO sal.invoice_lines
         (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity,
          currency_code, source_quotation_item_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10)
       RETURNING id, line_number`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.invoiceId,
        input.lineNumber,
        input.lineType,
        input.quantity,
        input.currencyCode,
        input.sourceQuotationItemId,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('billing: invoice line insert returned no row');
    return { id: row.id, lineNumber: row.line_number };
  }

  /**
   * Inserts the restricted 1:1 line money and its payer split.
   *
   * Three amounts are computed by the statement rather than bound, each mirroring a
   * CHECK on the target table:
   *
   *  - `gross_amount = round(net + tax, 4)` — `ck_invoice_line_amounts_gross`;
   *  - `customer_pay_amount = round(net + tax, 4) − warranty_pay` and
   *    `warranty_pay_amount = warranty_pay` — together they satisfy
   *    `ck_invoice_line_amounts_payer_split`
   *    (`customer_pay + warranty_pay = gross`) by construction rather than by
   *    arithmetic luck. FR-WTY-004 requires every line to carry one unambiguous
   *    payer allocation, and computing the customer share as a remainder is the only
   *    way two bound values cannot fail to add up.
   *
   * `invoice_id` is passed alongside `invoice_line_id` because the column is
   * denormalised and `sal.guard_invoice_line_amount_frozen` verifies the pair —
   * L-fin-4 closed a mis-parented line amount between two draft invoices, which
   * would have made `sal.issue_invoice` (which sums by the line's `invoice_id`) and
   * the deferred reconcile trigger (which sums by this row's) diverge.
   */
  public async insertInvoiceLineAmounts(
    db: DbHandle,
    input: {
      readonly invoiceLineId: string;
      readonly invoiceId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly unitPrice: string;
      readonly netAmount: string;
      readonly taxAmount: string;
      readonly warrantyPayAmount: string;
    }
  ): Promise<InvoiceLineAmountsRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      unit_price: string;
      net_amount: string;
      tax_amount: string;
      gross_amount: string;
      customer_pay_amount: string;
      warranty_pay_amount: string;
    }>(
      db,
      `INSERT INTO sal.invoice_line_amounts
         (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price,
          net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount,
          created_by)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric,
               round($7::numeric + $8::numeric, 4),
               round($7::numeric + $8::numeric, 4) - $9::numeric,
               $9::numeric, $10)
       RETURNING unit_price::text          AS unit_price,
                 net_amount::text          AS net_amount,
                 tax_amount::text          AS tax_amount,
                 gross_amount::text        AS gross_amount,
                 customer_pay_amount::text AS customer_pay_amount,
                 warranty_pay_amount::text AS warranty_pay_amount`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.invoiceLineId,
        input.invoiceId,
        input.unitPrice,
        input.netAmount,
        input.taxAmount,
        input.warrantyPayAmount,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('billing: invoice line amounts insert returned no row');
    return {
      unitPrice: row.unit_price,
      netAmount: row.net_amount,
      taxAmount: row.tax_amount,
      grossAmount: row.gross_amount,
      customerPayAmount: row.customer_pay_amount,
      warrantyPayAmount: row.warranty_pay_amount,
    };
  }

  /**
   * Issues the invoice through `sal.issue_invoice` and returns the allocated number.
   *
   * The primitive does all of it under its own `FOR UPDATE`: recompute the header
   * totals from the lines, resolve `sequence_code` from the active numbering config
   * (COALESCE to `'invoice'`), call `shared.next_display_number`, flip the status,
   * and write the `invoice_issued` financial event, the `warranty_split_recorded`
   * event when `Σ warranty_pay > 0`, and the `invoice_status_history` row. None of
   * that is reproduced here, and `sal.guard_event_completeness` exists precisely to
   * refuse an issue whose event is missing.
   *
   * It is idempotent: an already-`issued` invoice returns its existing number
   * without allocating a second one.
   *
   * The correlation id is passed so the financial event and the status-history row
   * carry the request's trace. It comes from the request context, never from a
   * caller.
   */
  public async issueInvoice(
    db: DbHandle,
    invoiceId: string,
    correlationId: string | null
  ): Promise<string | null> {
    const row = await this.runOne<{ invoice_number: string | null }>(
      db,
      `SELECT sal.issue_invoice($1::uuid, $2::uuid) AS invoice_number`,
      [invoiceId, correlationId]
    );
    return row ? row.invoice_number : null;
  }

  /**
   * Voids a draft invoice before issue.
   *
   * `AND status = 'draft'` is in the predicate rather than left to
   * `sal.guard_invoice_freeze`: the guard would refuse `issued → void_before_issue`
   * with a `check_violation` that aborts the whole transaction, while an unmatched
   * predicate returns no row and lets the caller answer precisely. Zero rows is
   * therefore "not a draft any more", never "the update silently did nothing" —
   * the caller has already read and locked the row.
   *
   * `void_before_issue` is terminal and there is no un-void, so this update is the
   * end of the document's life.
   */
  public async voidInvoice(
    db: DbHandle,
    scope: { readonly invoiceId: string; readonly companyId: string; readonly branchId: string }
  ): Promise<{
    readonly id: string;
    readonly status: string;
    readonly recordVersion: number;
  } | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string; status: string; record_version: number }>(
      db,
      `UPDATE sal.invoices
          SET status = 'void_before_issue'
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND id = $4
          AND status = 'draft' AND deleted_at IS NULL
       RETURNING id, status, record_version`,
      [context.principal.tenantId, scope.companyId, scope.branchId, scope.invoiceId]
    );
    return row ? { id: row.id, status: row.status, recordVersion: row.record_version } : null;
  }

  /**
   * Appends one row to the invoice status ledger.
   *
   * `actor_id` and `occurred_at` are **not** in the column list:
   * `shared.stamp_status_history` sets both `BEFORE INSERT` from
   * `iam.current_user_id()` and `now()`, and raises `check_violation` when there is
   * no actor in the session context. Passing either would be an attribution a
   * caller could forge, and the trigger would overwrite it anyway.
   *
   * `to_status` accepts SIX values, two more than the invoice row can hold:
   * `partially_paid` and `paid` are recordable here and storable nowhere, because
   * payment state is derived from `sal.invoice_open_receivable` (M-fin-1). This
   * module writes only the four lifecycle values; the wider vocabulary belongs to
   * whatever records a payment milestone.
   *
   * The table has SELECT and INSERT grants only — it is append-only, so a status
   * row can never be corrected, only followed by another.
   */
  public async insertInvoiceStatusHistory(
    db: DbHandle,
    input: {
      readonly invoiceId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly fromStatus: string | null;
      readonly toStatus: string;
      readonly reason: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<void> {
    const context = this.assertContext(db);
    await this.run(
      db,
      `INSERT INTO sal.invoice_status_history
         (tenant_id, company_id, branch_id, invoice_id, from_status, to_status, reason,
          correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid)`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.invoiceId,
        input.fromStatus,
        input.toStatus,
        input.reason,
        input.correlationId,
      ]
    );
  }

  // -------------------------------------------------------------------------
  // Credit-note mutations.
  // -------------------------------------------------------------------------

  /**
   * Inserts a pending credit note.
   *
   * `requested_by` is **omitted from the column list**, and that is the whole
   * dual-control guarantee at this end: `sal.stamp_dual_control_maker` forces
   * `requested_by := iam.current_user_id()` `BEFORE INSERT`, nulls
   * `approved_by`/`approved_at`, and raises `insufficient_privilege` when there is
   * no user context. Binding a value would be ignored, so not binding one makes the
   * contract visible rather than merely satisfied. `approval_state` is likewise
   * omitted — the column default is `pending`, and
   * `ck_credit_notes_approved_shape` makes an `approved` row without an approver
   * unrepresentable.
   *
   * `currency_code` is bound from the PARENT INVOICE's row by the caller, never
   * from client input. Five triggers fire on this table and not one reads
   * `sal.invoices.currency_code`, and `sal.approve_credit_note` compares the amount
   * but never the currency — so the application's `assertCurrencyMatches` is the
   * ONLY defence against a JOD credit note against a USD invoice (P1-22-L-02).
   */
  public async insertCreditNote(
    db: DbHandle,
    input: {
      readonly invoiceId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly currencyCode: string;
      readonly amount: string;
      readonly reason: string;
      readonly idempotencyKey: string | null;
    }
  ): Promise<CreditNoteRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<CreditNoteSql>(
      db,
      `INSERT INTO sal.credit_notes
         (tenant_id, company_id, branch_id, invoice_id, currency_code, amount, reason,
          idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9)
       RETURNING id, company_id, branch_id, invoice_id, currency_code,
                 amount::text AS amount, reason, approval_state, requested_by, approved_by,
                 approved_at, issued_at, idempotency_key, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.invoiceId,
        input.currencyCode,
        input.amount,
        input.reason,
        input.idempotencyKey,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('billing: credit note insert returned no row');
    return toCreditNote(row);
  }

  /**
   * Approves a credit note through `sal.approve_credit_note`.
   *
   * The primitive locks the note, returns silently for an already-`approved` one,
   * refuses any other non-`pending` state, locks the invoice, re-checks the amount
   * against `sal.invoice_open_receivable` *inside* that lock, sets
   * `approval_state = 'approved'` and `issued_at = now()`, and writes the
   * `credit_note_issued` financial event. The `BEFORE UPDATE` trigger stamps
   * `approved_by` from the session and raises `check_violation` when it equals
   * `requested_by`.
   *
   * It does **not** compare the credit note's currency to the invoice's. That
   * comparison happens before the request is ever stored, in the service.
   */
  public async approveCreditNote(
    db: DbHandle,
    creditNoteId: string,
    correlationId: string | null
  ): Promise<void> {
    await this.run(db, `SELECT sal.approve_credit_note($1::uuid, $2::uuid)`, [
      creditNoteId,
      correlationId,
    ]);
  }
}
