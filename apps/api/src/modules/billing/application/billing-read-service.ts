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
import { Decimal, MONEY, moneyView, type MoneyView } from '@/modules/pricing';
// `rollUpDecisions` is imported rather than reimplemented so there is exactly ONE
// definition of "the customer accepted this revision" in the codebase. It is the
// quotation module's rule (BR-QUO-001: a revision is accepted only when EVERY item
// is approved and none is rejected), and a second copy here would be a second
// definition of what may be billed. Importing the surface does not boot the
// quotation composition root — `quotationModule()` is memoised behind a closure.
import { rollUpDecisions } from '@/modules/quotation';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import type {
  BillingRepository,
  CommercialSourceRow,
  CreditNoteRow,
  InvoiceLineRow,
  InvoiceRow,
  NumberingConfigRow,
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
  readonly recordVersion: number;
  /** `null` without `sal.finance.view`. */
  readonly money: InvoiceLineMoneyView | null;
}

export interface InvoiceView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
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

/** An invoice with its lines, as the detail read returns it. */
export interface InvoiceDetailView {
  readonly invoice: InvoiceView;
  readonly lines: readonly InvoiceLineView[];
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
}

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
}

/** One previewed line. Every amount a fixed-scale decimal STRING. */
export interface InvoicePreviewLine {
  readonly sourceQuotationItemId: string;
  readonly lineNumber: number;
  readonly lineType: string;
  readonly description: string | null;
  readonly serviceId: string | null;
  readonly itemId: string | null;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string;
  /** The captured `numeric(9,6)` fraction, for transparency about what was applied. */
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
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
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  /** `Σ round(unit × qty − discount, 4)` — what becomes the invoice's `net_total`. */
  readonly netTotal: string;
  readonly grossTotal: string;
  readonly lines: readonly InvoicePreviewLine[];
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
// ---------------------------------------------------------------------------

export const toInvoiceView = (row: InvoiceRow): InvoiceView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  workOrderId: row.workOrderId,
  quotationRevisionId: row.quotationRevisionId,
  payerPartnerId: row.payerPartnerId,
  currency: row.currencyCode,
  status: row.status,
  invoiceNumber: row.invoiceNumber,
  issuedAt: row.issuedAt?.toISOString() ?? null,
  recordVersion: row.recordVersion,
  totals: row.money
    ? {
        net: moneyView(row.money.netTotal, row.currencyCode),
        tax: moneyView(row.money.taxTotal, row.currencyCode),
        gross: moneyView(row.money.grossTotal, row.currencyCode),
      }
    : null,
});

export const toInvoiceLineView = (row: InvoiceLineRow): InvoiceLineView => ({
  id: row.id,
  lineNumber: row.lineNumber,
  lineType: row.lineType,
  quantity: row.quantity,
  currency: row.currencyCode,
  sourceQuotationItemId: row.sourceQuotationItemId,
  recordVersion: row.recordVersion,
  money: row.money
    ? {
        unitPrice: moneyView(row.money.unitPrice, row.currencyCode),
        net: moneyView(row.money.netAmount, row.currencyCode),
        tax: moneyView(row.money.taxAmount, row.currencyCode),
        gross: moneyView(row.money.grossAmount, row.currencyCode),
        payerSplit: {
          customer: moneyView(row.money.customerPayAmount, row.currencyCode),
          warranty: moneyView(row.money.warrantyPayAmount, row.currencyCode),
        },
      }
    : null,
});

export const toCreditNoteView = (row: CreditNoteRow): CreditNoteView => ({
  id: row.id,
  invoiceId: row.invoiceId,
  companyId: row.companyId,
  branchId: row.branchId,
  amount: moneyView(row.amount, row.currencyCode),
  reason: row.reason,
  approvalState: row.approvalState,
  requestedBy: row.requestedBy,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  issuedAt: row.issuedAt?.toISOString() ?? null,
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
 * Picks the ONE accepted commercial source a work order may be invoiced from.
 *
 * Module-level and exported because the preview and the create path must agree:
 * previewing one revision and invoicing another would be a silent mispricing, and
 * the only way two call sites cannot drift is for there to be one function.
 *
 * Three outcomes, three different answers:
 *
 *  - **none accepted** → `ERR-RES-001`. There is no approved commercial data to
 *    derive amounts from, and the alternative — billing zero, or billing an
 *    undecided quotation — would manufacture a financial fact. A missing source is
 *    reported as a missing resource because the caller cannot fix it by changing
 *    the request.
 *  - **exactly one** → that revision.
 *  - **more than one** → `ERR-CON-001`. `ix_quotations_work_order` is NOT unique and
 *    no constraint anywhere prevents two accepted quotations on one work order, so
 *    this is reachable. Picking one by `created_at` would be an arbitrary choice
 *    between two prices the customer agreed to, made silently, inside a financial
 *    document. The caller must cancel the superfluous quotation.
 *
 * Acceptance is derived from the decision counts by the quotation module's own
 * `rollUpDecisions`, not read from `quo.quotations.status`: that column is a cached
 * roll-up and no constraint ties it to `quo.approval_decisions`.
 */
export function resolveCommercialSource(
  candidates: readonly CommercialSourceRow[],
  workOrderId: string
): CommercialSourceRow {
  const accepted = candidates.filter(
    (candidate) =>
      rollUpDecisions({
        itemCount: candidate.itemCount,
        approvedCount: candidate.approvedCount,
        rejectedCount: candidate.rejectedCount,
      }) === 'accepted'
  );

  if (accepted.length === 0) {
    throw new AppFailure('ERR-RES-001', {
      message:
        `Work order ${workOrderId} has no accepted quotation revision, so there is no ` +
        'approved commercial data to derive invoice amounts from. Every line, price, ' +
        'discount and tax rate on an invoice comes from the captured items of an accepted ' +
        'revision; none is defaulted.',
    });
  }
  if (accepted.length > 1) {
    throw new AppFailure('ERR-CON-001', {
      message:
        `Work order ${workOrderId} has ${accepted.length} accepted quotation revisions, so ` +
        'the commercial source for an invoice is ambiguous. No constraint prevents this — ' +
        'ix_quotations_work_order is not unique — and choosing between two agreed prices is ' +
        'not a decision this backend may make.',
    });
  }

  const source = accepted[0];
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
        `The accepted quotation revision ${source.revisionId} carries no items, so it ` +
        'cannot be the source of invoice amounts.',
    });
  }
  return source;
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
    return {
      invoice: toInvoiceView(invoice),
      lines: lines.map(toInvoiceLineView),
      recordVersion: invoice.recordVersion,
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
    return {
      invoiceId: open.invoiceId,
      status: open.status,
      outstanding: moneyView(open.amount, open.currencyCode),
      isSettled: !amount.greaterThan(Decimal.zero(MONEY)),
    };
  }

  /**
   * What an invoice for this work order would contain, without creating one.
   *
   * Every amount is computed by PostgreSQL in `numeric`, in the same
   * `round(…, 4)` shape `ck_invoice_amounts_gross` enforces and
   * `sal.issue_invoice` later applies, from the captured values of the accepted
   * quotation revision. So the preview is not an estimate that the create path
   * might contradict — it is the same expression over the same frozen rows.
   *
   * Nothing here defaults a tax rate, a discount, a currency or a jurisdiction. The
   * rate is `quo.quotation_items.captured_tax_rate`, resolved by the pricing layer
   * when the revision was priced and validated by `ck_quotation_items_tax_amount`;
   * the discount is `captured_discount`, bounded by `ck_quotation_items_discount`;
   * the currency is the revision's. A work order with no accepted revision produces
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
     * `numeric`, not `numeric(18,4)`, and `ck_quotation_items_line_total` bounds each
     * line's own total without bounding their sum — so a Σ exceeding 14 integer digits
     * was returned here as a cheerful `200`, while `POST /invoices` for the same work
     * order answered `409` on SQLSTATE `22003`. The preview now fails on exactly the
     * input the invoice fails on.
     */
    const exact = (value: string): string => Decimal.fromDatabase(value, MONEY).toString();

    return {
      workOrderId: scope.workOrderId,
      quotationId: source.quotationId,
      quotationRevisionId: source.revisionId,
      currency: source.currencyCode,
      subtotal: exact(source.subtotal),
      discountTotal: exact(source.discountTotal),
      taxTotal: exact(source.taxTotal),
      netTotal: exact(source.netTotal),
      grossTotal: exact(source.grossTotal),
      lines: lines.map((line) => ({
        sourceQuotationItemId: line.quotationItemId,
        lineNumber: line.lineNumber,
        // The `quo` vocabulary (`service`/`part`) is a subset of
        // `ck_invoice_lines_line_type` (`service`/`part`/`fee`), so the value is
        // carried through rather than translated. `fee` has no quotation counterpart.
        lineType: line.itemKind,
        description: line.description,
        serviceId: line.serviceId,
        itemId: line.itemRef,
        quantity: line.quantity,
        unitPrice: exact(line.unitPrice),
        discount: exact(line.discount),
        // A `numeric(9,6)` fraction, not money — carried through unchanged, because
        // validating it against MONEY's scale would be the wrong check.
        taxRate: line.taxRate,
        netAmount: exact(line.netAmount),
        taxAmount: exact(line.taxAmount),
        grossAmount: exact(line.grossAmount),
      })),
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

  /** One credit note, or `ERR-RES-001` when it is absent or not visible. */
  public async readCreditNote(
    db: DbHandle,
    creditNoteId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<CreditNoteView> {
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
    return toCreditNoteView(note);
  }

  // -------------------------------------------------------------------------
  // The cross-module port. Consumed by `@/modules/delivery`.
  // -------------------------------------------------------------------------

  /**
   * The open receivable on the live invoice for a work order, or `null`.
   *
   * This is the delivery module's `financial_balance_outstanding` blocker, and it is
   * the single most consequential gate on handover. `sal.complete_delivery` enforces
   * a verified receiver, a complete mandatory checklist and at least one signature —
   * and reads **no financial balance at all**. If this method is deleted, the
   * database will hand over a vehicle with an unpaid invoice without complaint.
   *
   * It exists so that delivery never reads `sal.invoices` itself. That is not
   * bureaucracy: `sal.invoice_open_receivable` is meaningless without the header
   * currency, the "live" invoice is defined by a partial unique index that a second
   * reader would have to reproduce, and a draft's zero must not be confused with a
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

    const invoice = await this.repository.liveInvoiceForWorkOrder(db, {
      workOrderId: scope.workOrderId,
      companyId: scope.companyId,
      branchId: scope.branchId,
    });
    if (!invoice) return null;

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
