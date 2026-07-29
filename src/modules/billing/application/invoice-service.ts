/**
 * Invoice and credit-note mutations (Phase 1-22).
 *
 * Every method runs inside the route handler's transaction, so the business row,
 * its status-history row, its audit record and its outbox event share one commit.
 * There is no publish-after-commit path — that is precisely the window where a
 * crash loses the event, and BR-INT-001 requires an event to exist if and only if
 * its source transaction committed.
 *
 * ## No amount on this surface comes from a caller
 *
 * `CreateInvoiceInput` has no total, no unit price, no tax rate, no discount and no
 * line list. Client totals are not "ignored": there is no field to put one in, so
 * the refusal is structural rather than a validation rule someone could later
 * relax. Every figure an invoice carries is read from the captured items of an
 * accepted `quo.quotation_revision` — frozen by `quo.guard_quotation_item` once the
 * revision left draft — and summed by PostgreSQL in `numeric`.
 *
 * The only amount a caller may name anywhere in this file is a credit note's, and
 * it is bounded twice: by `assertCreditWithinOpenAmount` against
 * `sal.invoice_open_receivable` read under the invoice lock, and again inside
 * `sal.approve_credit_note` under that function's own lock.
 *
 * ## What the database owns, and what this service owns alone
 *
 * The schema owns: born-draft (`sal.guard_invoice_freeze` on INSERT), the
 * forward-only status graph, the frozen-once-issued line and amount rules, the
 * header↔lines reconciliation at COMMIT, one live invoice per work order, gapless
 * numbering, maker≠approver on a credit note, and the financial-event completeness
 * triggers. None of it is re-implemented here.
 *
 * This service owns three rules the database does **not** enforce, and each is
 * named at its call site:
 *
 *  - **credit-note currency = invoice currency.** Five triggers fire on
 *    `sal.credit_notes` and not one reads `sal.invoices.currency_code`;
 *    `sal.approve_credit_note` compares the amount and never the currency; and
 *    `sal.invoice_open_receivable` subtracts approved credits with no currency
 *    predicate either. `assertCurrencyMatches` is the ONLY defence (P1-22-L-02).
 *  - **a numbering sequence must be provisioned before the expensive work.**
 *    `shared.next_display_number` raises `no_data_found` and `app_runtime` holds no
 *    INSERT on `shared.number_sequences`, so an unprovisioned tenant cannot be
 *    helped by retrying — it must be told, and told which scope is missing.
 *  - **a non-blank, bounded reason.** `sal.credit_notes.reason` is `NOT NULL` with
 *    no format CHECK and no length CHECK, so `''` would be accepted by the
 *    database; `sal.invoice_status_history.reason` has neither either.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, sqlState, SQLSTATE } from '@/server/db/repository';
import { Decimal, MONEY } from '@/modules/pricing';
import { findSequenceDefinition, sharedServicesModule } from '@/modules/shared-services';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import {
  BILLING_SQLSTATE,
  INVOICE_UNIQUE_INDEX,
  violatedIndex,
  type BillingRepository,
  type CommercialSourceLineRow,
  type CreditNoteRow,
  type InvoiceRow,
} from '../data/billing-repository';
import {
  BillingRuleError,
  INVOICE_LINE_TYPES,
  MAX_REASON,
  assertCreditWithinOpenAmount,
  assertCurrencyMatches,
  assertInvoiceIsDraft,
  parseInstrumentAmount,
} from '../domain/billing';
import {
  FINANCE_VIEW_PERMISSION,
  balanceIsTrustworthy,
  resolveCommercialSource,
  toCreditNoteView,
  toInvoiceLineView,
  toInvoiceView,
  type CreditNoteView,
  type InvoiceDetailView,
  type InvoiceView,
} from './billing-read-service';

/**
 * The default sequence code, taken from `sal.issue_invoice`'s own COALESCE.
 *
 * Reproduced here because the provisioning pre-check must ask about exactly the
 * sequence the primitive will use. A different default here would make the
 * pre-check pass for one sequence and the allocation fail for another.
 */
const DEFAULT_INVOICE_SEQUENCE = 'invoice';

/**
 * The warranty share this phase can honestly write on an invoice line: none.
 *
 * `ck_invoice_line_amounts_payer_split` requires
 * `customer_pay_amount + warranty_pay_amount = gross_amount` (FR-WTY-004), so every
 * line MUST carry an unambiguous allocation. It does not say where the split comes
 * from, and **nothing in any schema does**:
 *
 *  - `wty.warranty_records` are generated FROM a committed delivery
 *    (`delivery_record_id` is required and `wty.issue_warranty` reads the delivery),
 *    which happens after invoicing — so they describe warranty the workshop grants,
 *    not coverage that reduces this bill;
 *  - there is no claim table anywhere (P1-22-L-01), no coverage reference on a work
 *    order, job, service line or quotation item, and `wo.work_orders.kind` is only
 *    `ordinary`/`rework`;
 *  - `quo.quotation_items` captures a price, a quantity, a discount and a tax rate,
 *    and no payer.
 *
 * So a non-zero warranty share could only come from client input, and accepting one
 * would let a caller reduce what a customer owes by asserting it — a financial fact
 * with no protected source. The whole gross is therefore allocated to the customer,
 * the identity holds exactly, and `sal.issue_invoice` emits no
 * `warranty_split_recorded` event because `Σ warranty_pay` is zero. When a coverage
 * source exists, this constant is the single place that changes.
 *
 * Written as `Decimal.zero(MONEY).toString()` rather than `'0'` so the value carries
 * the target column's scale and comes from the one exact-decimal type in the
 * codebase.
 */
const NO_WARRANTY_SHARE = Decimal.zero(MONEY).toString();

export interface CreateInvoiceInput {
  readonly workOrderId: string;
  /**
   * Used ONLY when the accepted quotation names no `payer_partner_ref`.
   *
   * `sal.invoices.payer_partner_id` is `NOT NULL` while
   * `quo.quotations.payer_partner_ref` is nullable, so a fallback is structurally
   * necessary. The quotation's value always wins when present: it is the protected
   * commercial record of who agreed to pay, and letting a request override it would
   * let an invoice be addressed to someone the quotation never named.
   */
  readonly payerPartnerId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

export interface RequestCreditNoteInput {
  readonly invoiceId: string;
  /** `numeric(18,4)`, strictly positive (`ck_credit_notes_amount`). */
  readonly amount: string;
  readonly reason: string;
  /**
   * Optional, and accepted only to be REFUSED on a mismatch.
   *
   * The value stored is always the parent invoice's `currency_code`. This field
   * exists so a caller that believes it is crediting USD is told it is wrong,
   * rather than silently having its amount recorded in JOD.
   */
  readonly currency?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

/** A created invoice, with `replayed` telling a retrying client which it got. */
export interface CreatedInvoice extends InvoiceDetailView {
  /** True when an idempotency key resolved to the invoice that already existed. */
  readonly replayed: boolean;
}

export interface IssuedInvoice {
  readonly invoice: InvoiceView;
  /** The allocated number. Never synthesised: it comes from the branch sequence. */
  readonly invoiceNumber: string;
  /** True when the invoice was already issued and no second number was allocated. */
  readonly replayed: boolean;
  /**
   * The invoice's version AFTER the issue, for the route's `ETag`.
   *
   * On a replay it is the version the already-issued invoice carries, so a caller
   * that retried does not come away holding a version that was never current.
   */
  readonly recordVersion: number;
}

export interface VoidedInvoice {
  readonly invoice: InvoiceView;
  /** True when the invoice was already void and nothing changed. */
  readonly replayed: boolean;
  /** The invoice's version after the void, for the route's `ETag`. */
  readonly recordVersion: number;
}

export interface CreditNoteResult {
  readonly creditNote: CreditNoteView;
  readonly replayed: boolean;
}

/**
 * Translates the protected schema's refusals into the controlled error catalog.
 *
 * The SQLSTATE is the contract, not the message text: `23514` from
 * `ck_invoice_line_amounts_payer_split` and `23514` from `sal.guard_invoice_freeze`
 * are the same class of answer — the database refused because an invariant would
 * break — and a caller needs `ERR-TRN-001` for both. Constraint names, SQL, and
 * driver messages are never echoed.
 *
 * `42501` is mapped to an authorization denial rather than a fault, and that
 * mapping earns its place: it arrives from three different places on this path —
 * an RLS `WITH CHECK` refusal on `sal.invoice_amounts` when the caller lacks
 * `sal.finance.view`, `shared.next_display_number` when the company or branch is
 * outside the session scope, and `sal.stamp_dual_control_maker` when there is no
 * user context to stamp. All three are "you may not", and `ERR-SYS-001` would tell
 * the caller its request broke the server when in fact the server refused it.
 */
function toDomainFailure(error: unknown, what: string): never {
  if (error instanceof BillingRuleError) {
    throw new AppFailure('ERR-TRN-001', { message: error.message, cause: error });
  }
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a billing invariant`,
      cause: error,
    });
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names a work order, payer, currency or invoice that does not exist in scope`,
      cause: error,
    });
  }
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    throw new AppFailure('ERR-INT-001', {
      message: `${what} has already been recorded`,
      cause: error,
    });
  }
  if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
    throw new AppFailure('ERR-IAM-001', {
      message: `${what} was refused: the operation requires a permission or scope this caller lacks`,
      cause: error,
    });
  }
  if (sqlState(error) === BILLING_SQLSTATE.numericOutOfRange) {
    // A total that does not fit `numeric(18,4)`. A conflict rather than a fault: the
    // request was well formed and what refuses it is the size of the commercial data
    // behind it, which the caller can act on by splitting the work.
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} produced an amount larger than a numeric(18,4) column can hold`,
      cause: error,
    });
  }
  throw error;
}

/**
 * Maps a domain refusal that is genuinely about the REQUEST onto `ERR-VAL-001`.
 *
 * Separate from `toDomainFailure` because the two answer different questions. An
 * amount with five decimal places is a malformed request (422); an amount that
 * exceeds the open receivable is a well-formed request that conflicts with state
 * (409). Collapsing them would tell a client to change its number when it should
 * change its expectations, or the reverse.
 */
function refuseInvalidValue(error: unknown, path: string): never {
  if (error instanceof BillingRuleError) {
    throw new AppFailure('ERR-VAL-001', {
      message: error.message,
      safeDetails: { violations: [{ path, rule: 'custom' }] },
      cause: error,
    });
  }
  throw error;
}

/**
 * Refuses a blank or over-long reason.
 *
 * The application is the ONLY defence on both counts. `sal.credit_notes.reason` is
 * `NOT NULL` with no `btrim(...) <> ''` CHECK and no length CHECK, so `'   '` would
 * be stored as the recorded justification for reducing a receivable;
 * `sal.invoice_status_history.reason` is nullable with neither check. `text` has no
 * width, so an unbounded reason is a storage vector rather than a truncation error.
 */
function requireReason(reason: string, path: string): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length === 0) {
    throw new AppFailure('ERR-VAL-001', {
      message: 'A reason is required and must not be blank',
      safeDetails: { violations: [{ path, rule: 'too_small' }] },
    });
  }
  if (trimmed.length > MAX_REASON) {
    throw new AppFailure('ERR-VAL-001', {
      message: `A reason must be at most ${MAX_REASON} characters`,
      safeDetails: { violations: [{ path, rule: 'too_big' }] },
    });
  }
  return trimmed;
}

/**
 * The one message an unprovisioned tenant gets, from both paths that detect it.
 *
 * It names the company, the branch and the sequence code because provisioning is an
 * operator action that no request can perform: `app_runtime` holds no INSERT on
 * `shared.number_sequences` and no policy allows one, so a caller told only "not
 * found" would retry forever against a configuration gap.
 *
 * Returns rather than throws so both call sites read as `throw`, and so the
 * `no_data_found` translator can attach the driver error as `cause`.
 */
function unprovisionedSequence(
  invoice: InvoiceRow,
  sequenceCode: string | null,
  cause?: unknown
): AppFailure {
  const named = sequenceCode ?? DEFAULT_INVOICE_SEQUENCE;
  return new AppFailure('ERR-RES-001', {
    message:
      `No number sequence is provisioned for sequence_code "${named}" in company ` +
      `${invoice.companyId}, branch ${invoice.branchId}, so invoice ${invoice.id} cannot be ` +
      'numbered. Provisioning shared.number_sequences is an operator action: app_runtime ' +
      'holds no INSERT on that table, and no number is ever synthesised as a fallback.',
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Refuses a duplicate invoice by naming which uniqueness rule was hit.
 *
 * Both collisions are pre-checked, so reaching here means a concurrent transaction
 * won the race between the pre-check and the INSERT. The two still need different
 * answers: a work-order collision means "an invoice already exists, read it", while
 * an idempotency collision means "stop retrying with this key". PostgreSQL reports
 * the *index* name in the error's `constraint` field for a unique-index violation,
 * which is the only thing that distinguishes them; an error carrying no name falls
 * back to a conflict, never to a 500.
 *
 * Module-level and declared `: never` so TypeScript's control-flow analysis treats
 * the `catch` that calls it as terminating, and the variable the `try` assigned is
 * definitely assigned afterwards. A private method would not narrow the same way.
 */
function refuseDuplicateInvoice(error: unknown, workOrderId: string): never {
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    if (violatedIndex(error) === INVOICE_UNIQUE_INDEX.idempotency) {
      throw new AppFailure('ERR-INT-001', {
        message:
          'This idempotency key was used for another invoice while this request was in ' +
          'flight. Re-read the invoice rather than retrying.',
        cause: error,
      });
    }
    throw new AppFailure('ERR-CON-001', {
      message:
        `A live invoice for work order ${workOrderId} was created concurrently. ` +
        'uq_invoices_work_order_active permits one per work order.',
      cause: error,
    });
  }
  toDomainFailure(error, 'Invoice creation');
}

/**
 * Translates a failure from `sal.issue_invoice`.
 *
 * `no_data_found` is raised in two places inside that call and the call sequence
 * distinguishes them: the primitive raises it when the invoice is not visible in
 * scope, but the invoice was read and locked in this same transaction a few
 * statements earlier — so the remaining source is `shared.next_display_number`,
 * which raises it when no sequence row exists for
 * `(tenant, company, branch, sequence_code)`. The pre-check should already have
 * caught that; reaching here means the sequence was de-provisioned mid-flight, and
 * the answer is the same either way — name the scope an operator must provision.
 *
 * `check_violation` from this call means the invoice has no lines
 * (`sal.issue_invoice` refuses that), it is no longer a draft, or the allocator's
 * period guard refused a backwards move (`shared.guard_number_sequence_regression`,
 * DBCR-P1-15-002). The draft check already ran under the lock, so the actionable
 * answer is a conflict the caller may retry in a fresh transaction — `ERR-SYS-001`
 * would tell it nothing at all.
 *
 * A `23505` on `uq_invoices_number` gets its own answer, and this is the one failure
 * on the path that is genuinely the platform's fault rather than the caller's: only
 * `sal.issue_invoice` writes `invoice_number`, so the number the branch sequence just
 * handed out is already in use — a `shared.number_sequences` row that was reset or
 * re-provisioned behind a run that had already issued past that point. Reporting it
 * as `ERR-INT-001` ("already recorded") would tell the caller its own request was a
 * duplicate, which is precisely wrong and would send it away instead of raising an
 * operator problem.
 */
function refuseIssueFailure(error: unknown, invoice: InvoiceRow): never {
  if (sqlState(error) === BILLING_SQLSTATE.noDataFound) {
    throw unprovisionedSequence(invoice, null, error);
  }
  if (
    isSqlState(error, SQLSTATE.uniqueViolation) &&
    violatedIndex(error) === INVOICE_UNIQUE_INDEX.number
  ) {
    throw new AppFailure('ERR-CON-001', {
      message:
        `Issuing invoice ${invoice.id} allocated a number that already exists in company ` +
        `${invoice.companyId}, branch ${invoice.branchId}. The branch number sequence has ` +
        'fallen behind the numbers already issued, which no request can correct — an ' +
        'operator must advance shared.number_sequences. No number was consumed: the ' +
        'allocation and this failure share one transaction.',
      cause: error,
    });
  }
  if (sqlState(error) === BILLING_SQLSTATE.checkViolation) {
    throw new AppFailure('ERR-CON-001', {
      message:
        `Issuing invoice ${invoice.id} was refused: the invoice has no lines, is no longer a ` +
        'draft, or the number sequence period moved backwards. Re-read the invoice and retry ' +
        'in a new transaction.',
      cause: error,
    });
  }
  toDomainFailure(error, 'Invoice issue');
}

export class InvoiceService {
  public constructor(private readonly repository: BillingRepository) {}

  // -------------------------------------------------------------------------
  // Create.
  // -------------------------------------------------------------------------

  /**
   * Creates a draft invoice from approved commercial data, in ONE transaction.
   *
   * The whole document — header, restricted header totals, every line, every line's
   * restricted money and payer split, the birth status-history row, the audit record
   * and the outbox event — is written in the caller's transaction. A partial invoice
   * is not a state this method can leave behind: the deferred
   * `tg_invoice_line_amounts_reconcile` would not even fire for a draft, so an
   * abandoned half-written draft would look valid.
   *
   * ### Order, and why each step is where it is
   *
   * 1. **Resolve the work order's scope.** `fk_invoices_work_order` is a composite FK
   *    over `(tenant, company, branch, work_order_id)`, so the invoice's scope is the
   *    work order's and is derived rather than accepted.
   * 2. **`authorizeScope` with both ids**, after the load. Before the load there is
   *    nothing to narrow by, and `requiresScopedEvaluation` returns false for an
   *    empty target whatever the route declares — so this is the call that makes a
   *    branch-scoped permission mean anything here (P1-18-A-01).
   * 3. **Resolve an idempotency replay BEFORE any work.** `uq_invoices_idempotency`
   *    would refuse the duplicate anyway, but as `23505` — and from the outside that
   *    is indistinguishable from any other conflict, so a retrying client could not
   *    tell whether it had invoiced the job twice.
   * 4. **Refuse a second live invoice.** `uq_invoices_work_order_active` is the
   *    guarantee; this pre-check is what turns it into a 409 with a message instead
   *    of a `23505` five layers down.
   * 5. **Read and validate the commercial source, then write.**
   *
   * ### Creating an invoice requires `sal.finance.view`
   *
   * Not by declaration but by construction: `ins_invoice_amounts_gated` and
   * `ins_invoice_line_amounts_gated` both require it, so a caller who may create an
   * invoice but may not see money gets `42501` on step 6 and the whole transaction
   * rolls back. That is the correct outcome — an invoice with no amounts row would
   * fail `sal.issue_invoice`'s reconciliation later, far from the cause — and it is
   * recorded here because it is not obvious from the route's declared permissions.
   */
  public async createInvoice(
    db: DbHandle,
    input: CreateInvoiceInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<CreatedInvoice> {
    const scope = await this.repository.findWorkOrderScope(db, input.workOrderId);
    if (!scope) {
      throw new AppFailure('ERR-RES-001', {
        message: `Work order ${input.workOrderId} was not found in scope`,
      });
    }
    await authorizeScope({ companyId: scope.companyId, branchId: scope.branchId });

    if (input.idempotencyKey !== undefined) {
      const existing = await this.repository.findInvoiceByIdempotencyKey(db, input.idempotencyKey);
      if (existing) {
        if (existing.workOrderId !== scope.workOrderId) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'This idempotency key already created an invoice for a different work order. ' +
              'Reuse a key only for an identical request.',
          });
        }
        // The stored invoice's own scope is re-authorized rather than assumed from
        // the work order: the key is unique per TENANT, not per branch, so a replay
        // can legitimately name a row this caller must be judged against again.
        await authorizeScope({ companyId: existing.companyId, branchId: existing.branchId });
        return { ...(await this.detailOf(db, existing)), replayed: true };
      }
    }

    const live = await this.repository.liveInvoiceForWorkOrder(db, {
      workOrderId: scope.workOrderId,
      companyId: scope.companyId,
      branchId: scope.branchId,
    });
    if (live) {
      throw new AppFailure('ERR-CON-001', {
        message:
          `Work order ${scope.workOrderId} already has a live invoice (${live.status}). ` +
          'uq_invoices_work_order_active permits one per work order; void the existing draft ' +
          'or credit the issued invoice.',
      });
    }

    const source = resolveCommercialSource(
      await this.repository.findCommercialSources(db, {
        workOrderId: scope.workOrderId,
        companyId: scope.companyId,
        branchId: scope.branchId,
      }),
      scope.workOrderId
    );
    const sourceLines = await this.repository.listCommercialSourceLines(db, {
      revisionId: source.revisionId,
      companyId: source.companyId,
      branchId: source.branchId,
    });
    this.assertSourceLinesAreBillable(source.currencyCode, sourceLines, source.revisionId);

    const payerPartnerId = source.payerPartnerRef ?? input.payerPartnerId;
    if (payerPartnerId === undefined) {
      // `sal.invoices.payer_partner_id` is NOT NULL and `quo.quotations.payer_partner_ref`
      // is nullable, so this gap is in the schema rather than in the request. It is a
      // validation failure because the caller CAN fix it, by naming the payer.
      throw new AppFailure('ERR-VAL-001', {
        message:
          `The accepted quotation ${source.quotationId} names no payer, and none was ` +
          'supplied. sal.invoices.payer_partner_id is NOT NULL, so an invoice cannot be ' +
          'created without one.',
        safeDetails: { violations: [{ path: 'body.payerPartnerId', rule: 'invalid_type' }] },
      });
    }

    let created: InvoiceRow;
    try {
      created = await this.repository.insertDraftInvoice(db, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        workOrderId: scope.workOrderId,
        quotationRevisionId: source.revisionId,
        payerPartnerId,
        currencyCode: source.currencyCode,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    } catch (error) {
      refuseDuplicateInvoice(error, scope.workOrderId);
    }

    try {
      // The header totals come straight from the aggregate PostgreSQL computed over
      // the source lines; `gross_total` is computed by the INSERT itself as
      // `round(net + tax, 4)`. `sal.issue_invoice` recomputes all three from the
      // stored line amounts at issue time, so this row is the draft's working total
      // rather than the authority — but it must exist and reconcile, because the
      // deferred reconcile trigger raises if an issued invoice has no header row.
      await this.repository.insertInvoiceAmounts(db, {
        invoiceId: created.id,
        companyId: created.companyId,
        branchId: created.branchId,
        netTotal: source.netTotal,
        taxTotal: source.taxTotal,
      });

      for (const line of sourceLines) {
        const inserted = await this.repository.insertInvoiceLine(db, {
          invoiceId: created.id,
          companyId: created.companyId,
          branchId: created.branchId,
          // The quotation's own line numbering is reused rather than re-sequenced.
          // `uq_invoice_lines_number` needs uniqueness per invoice and
          // `uq_quotation_items_line` already provides it per revision, so reusing it
          // keeps invoice line 3 pointing at quotation line 3 — which is what a
          // customer comparing the two documents expects.
          lineNumber: line.lineNumber,
          lineType: line.itemKind,
          quantity: line.quantity,
          currencyCode: created.currencyCode,
          sourceQuotationItemId: line.quotationItemId,
        });

        await this.repository.insertInvoiceLineAmounts(db, {
          invoiceLineId: inserted.id,
          invoiceId: created.id,
          companyId: created.companyId,
          branchId: created.branchId,
          unitPrice: line.unitPrice,
          netAmount: line.netAmount,
          taxAmount: line.taxAmount,
          warrantyPayAmount: NO_WARRANTY_SHARE,
        });
      }

      // The birth row of the append-only ledger. `from_status` is NULL because there
      // is no prior state — that is what the nullable column is for — and `actor_id`
      // and `occurred_at` are omitted so `shared.stamp_status_history` stamps them.
      await this.repository.insertInvoiceStatusHistory(db, {
        invoiceId: created.id,
        companyId: created.companyId,
        branchId: created.branchId,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        correlationId: db.context.correlationId,
      });
    } catch (error) {
      toDomainFailure(error, 'Invoice creation');
    }

    await appendAudit(db, {
      action: 'sal.invoice.created',
      entityType: 'sal.invoice',
      entityId: created.id,
      companyId: created.companyId,
      branchId: created.branchId,
      requestRef: 'sal.invoice-create',
      details: [
        { field: 'workOrderId', classification: 'internal', value: created.workOrderId },
        { field: 'quotationRevisionId', classification: 'internal', value: source.revisionId },
        { field: 'payerPartnerId', classification: 'internal', value: created.payerPartnerId },
        { field: 'currencyCode', classification: 'internal', value: created.currencyCode },
        { field: 'lineCount', classification: 'internal', value: String(sourceLines.length) },
        // `restricted`, so `iam.audit_mask` stores a fixed marker rather than the
        // figure. Deliberate: `iam.audit_records` is not gated by `sal.finance.view`,
        // so writing the gross total in clear would route restricted money around the
        // policy that restricts it. The marker still records that the invoice carries
        // a total, which is what the trail needs.
        { field: 'grossTotal', classification: 'restricted', value: source.grossTotal },
      ],
    });

    await publishEvent(db, {
      eventType: 'invoice.created',
      aggregateId: created.id,
      aggregateVersion: created.recordVersion,
      producer: 'billing.invoice-service',
      companyId: created.companyId,
      branchId: created.branchId,
      // The invoice id keys the event, so a producer that retries its own command
      // cannot emit the same event twice (`uq_event_outbox_event_key`).
      eventKey: `invoice.created:${created.id}`,
      // No amount and no invoice number. The amounts are `restricted` and the outbox
      // is not gated by `sal.finance.view`, so carrying them would publish money
      // past its own RLS policy to every consumer of the stream; the number does not
      // exist yet, because the invoice is born draft. A consumer that needs either
      // reads the aggregate under its own authorization.
      payload: {
        invoiceId: created.id,
        workOrderId: created.workOrderId,
        quotationRevisionId: source.revisionId,
        currency: created.currencyCode,
        status: created.status,
        lineCount: sourceLines.length,
      },
    });

    return { ...(await this.detailOf(db, created)), replayed: false };
  }

  // -------------------------------------------------------------------------
  // Issue.
  // -------------------------------------------------------------------------

  /**
   * Issues a draft invoice: allocates its number and makes it financial history.
   *
   * ### Replay safety is structural, not incidental
   *
   * `sal.issue_invoice` is idempotent — it returns the existing number for an
   * already-`issued` invoice without allocating another. That is necessary and not
   * sufficient: calling it blindly on a replay would return the right number and
   * then this method would append a SECOND audit record and publish a SECOND event
   * for one issuance. The second `publishEvent` would in fact abort the transaction
   * on `uq_event_outbox_event_key`, turning an idempotent retry into a 409.
   *
   * So the already-issued case short-circuits on the LOCKED pre-read, before the
   * primitive is called: no allocation, no audit, no event, and `replayed: true` so
   * the caller can tell.
   *
   * The read is `FOR UPDATE` because an unlocked one would leave a window in which a
   * concurrent issue completes between the status check and the call, and this
   * transaction would then claim credit — audit record and event included — for work
   * the other one did.
   *
   * ### The numbering pre-check
   *
   * Provisioning is checked BEFORE the primitive runs, because
   * `sal.issue_invoice` does its expensive work — the header recompute — and then
   * calls the allocator, so an unprovisioned tenant would pay for a recompute it
   * rolls back. More importantly the pre-check is what produces a message naming the
   * company, the branch and the sequence code: `app_runtime` holds no INSERT on
   * `shared.number_sequences` and cannot create one, so the caller needs to know
   * exactly which scope an operator must provision.
   *
   * There is deliberately NO fallback number. Not a timestamp, not a UUID, not a
   * max()+1. `uq_invoices_number` would accept any of them and the document would
   * then carry a number outside its own sequence — indistinguishable from a real one
   * and permanently wrong.
   */
  public async issueInvoice(
    db: DbHandle,
    invoiceId: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<IssuedInvoice> {
    const before = await this.repository.findInvoiceForUpdate(db, invoiceId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Invoice ${invoiceId} was not found in scope`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });

    // The version guard, applied against the LOCKED row.
    //
    // `versionGuarded: true` on the operation makes `handleOperation` require an
    // `If-Match` header and hand the parsed value to the handler as `expectedVersion`.
    // All three P1-22 version-guarded routes used to DISCARD it, which made the guard
    // decorative: a caller working from a stale read was told nothing, and its command
    // applied to a document that had already moved on. The suite author found it, wrote
    // the cases to the contract, and LEFT THEM FAILING rather than declaring evidence for
    // a control that did not exist — which is why this code is here.
    //
    // Compared AFTER the `FOR UPDATE` read, not before. Comparing against an unlocked
    // read would leave a window in which a concurrent write bumps the version between the
    // comparison and the mutation, which is precisely the race the guard exists to close.
    if (before.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The invoice has changed since it was read; re-read it and retry',
      });
    }

    if (before.status === 'issued') {
      /* c8 ignore next 5 -- `ck_invoices_number_iff_issued` makes a numberless
         issued invoice unrepresentable; the guard exists so a NULL cannot silently
         become the reported number. */
      if (before.invoiceNumber === null) {
        throw new AppFailure('ERR-SYS-001', {
          message: `Invoice ${invoiceId} is issued but carries no number`,
        });
      }
      return {
        invoice: toInvoiceView(before),
        invoiceNumber: before.invoiceNumber,
        replayed: true,
        recordVersion: before.recordVersion,
      };
    }
    // Refused here rather than by `sal.issue_invoice`, whose `check_violation` is not
    // a caller-safe contract. `credited` and `void_before_issue` are terminal.
    try {
      assertInvoiceIsDraft(before.status, 'Issuing an invoice');
    } catch (error) {
      toDomainFailure(error, 'Invoice issue');
    }

    await this.assertNumberingProvisioned(db, before);

    let invoiceNumber: string | null;
    try {
      invoiceNumber = await this.repository.issueInvoice(db, invoiceId, db.context.correlationId);
    } catch (error) {
      refuseIssueFailure(error, before);
    }
    if (invoiceNumber === null) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'sal.issue_invoice returned no invoice number',
      });
    }

    const after = await this.repository.findInvoice(db, invoiceId);
    /* c8 ignore next 5 -- the row was locked in this transaction, so it cannot
       disappear between the call and this read. */
    if (!after) {
      throw new AppFailure('ERR-SYS-001', { message: 'Invoice vanished after issue' });
    }

    // No status-history row is written here. `sal.issue_invoice` already inserts the
    // draft -> issued row itself, and a second one would make the append-only ledger
    // record one transition twice — which is unfixable, because the table has no
    // UPDATE or DELETE grant.
    await appendAudit(db, {
      action: 'sal.invoice.issued',
      entityType: 'sal.invoice',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'sal.invoice-issue',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        // `internal`, not `restricted`. The number is printed on the customer's own
        // document and lives on the ungated `sal.invoices` row, so masking it would
        // remove from the audit trail the one fact an auditor of an issuance needs —
        // WHICH number was consumed — while protecting nothing.
        { field: 'invoiceNumber', classification: 'internal', value: invoiceNumber },
        { field: 'currencyCode', classification: 'internal', value: after.currencyCode },
      ],
    });

    await publishEvent(db, {
      eventType: 'invoice.issued',
      aggregateId: after.id,
      aggregateVersion: after.recordVersion,
      producer: 'billing.invoice-service',
      companyId: after.companyId,
      branchId: after.branchId,
      eventKey: `invoice.issued:${after.id}`,
      // No amounts, for the reason given on `invoice.created`: the outbox is not
      // gated by `sal.finance.view`. No invoice number either — a consumer that
      // renders the document reads it under its own authorization, and the whole
      // point of the event is that the aggregate is now readable.
      payload: {
        invoiceId: after.id,
        workOrderId: after.workOrderId,
        currency: after.currencyCode,
        status: after.status,
      },
    });

    return {
      invoice: toInvoiceView(after),
      invoiceNumber,
      replayed: false,
      recordVersion: after.recordVersion,
    };
  }

  // -------------------------------------------------------------------------
  // Void before issue.
  // -------------------------------------------------------------------------

  /**
   * Voids a draft invoice before it is issued.
   *
   * Only from `draft`. There is no un-issue and no post-issue void, because a number
   * that has been shown to a customer is never withdrawn — `sal.guard_invoice_freeze`
   * permits `issued -> credited` and nothing else, so the instruments after issue are
   * a credit note and a new invoice.
   *
   * Idempotent on an already-void invoice: `void_before_issue` is terminal, so a
   * retry has nothing left to do and reports `replayed: true` with no audit record
   * and no event. Emitting them again would tell consumers a document was voided
   * twice and would abort the transaction on `uq_event_outbox_event_key`.
   *
   * The reason is required and recorded in two places for two audiences: the
   * append-only `sal.invoice_status_history` row, which is what a later reader of the
   * document's life sees, and the audit record, which is what an investigation sees.
   */
  public async cancelInvoice(
    db: DbHandle,
    invoiceId: string,
    reason: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<VoidedInvoice> {
    const trimmedReason = requireReason(reason, 'body.reason');

    const before = await this.repository.findInvoiceForUpdate(db, invoiceId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Invoice ${invoiceId} was not found in scope`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });

    // The version guard, applied against the LOCKED row.
    //
    // `versionGuarded: true` on the operation makes `handleOperation` require an
    // `If-Match` header and hand the parsed value to the handler as `expectedVersion`.
    // All three P1-22 version-guarded routes used to DISCARD it, which made the guard
    // decorative: a caller working from a stale read was told nothing, and its command
    // applied to a document that had already moved on. The suite author found it, wrote
    // the cases to the contract, and LEFT THEM FAILING rather than declaring evidence for
    // a control that did not exist — which is why this code is here.
    //
    // Compared AFTER the `FOR UPDATE` read, not before. Comparing against an unlocked
    // read would leave a window in which a concurrent write bumps the version between the
    // comparison and the mutation, which is precisely the race the guard exists to close.
    if (before.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The invoice has changed since it was read; re-read it and retry',
      });
    }

    if (before.status === 'void_before_issue') {
      return {
        invoice: toInvoiceView(before),
        replayed: true,
        recordVersion: before.recordVersion,
      };
    }
    try {
      assertInvoiceIsDraft(before.status, 'Voiding an invoice');
    } catch (error) {
      toDomainFailure(error, 'Invoice void');
    }

    const voided = await this.repository.voidInvoice(db, {
      invoiceId,
      companyId: before.companyId,
      branchId: before.branchId,
    });
    /* c8 ignore next 6 -- the row is held `FOR UPDATE` and was `draft` a moment ago,
       so the `status = 'draft'` predicate cannot have stopped matching. */
    if (!voided) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Invoice ${invoiceId} was no longer a draft when the void was applied`,
      });
    }

    try {
      await this.repository.insertInvoiceStatusHistory(db, {
        invoiceId: before.id,
        companyId: before.companyId,
        branchId: before.branchId,
        fromStatus: before.status,
        toStatus: 'void_before_issue',
        reason: trimmedReason,
        correlationId: db.context.correlationId,
      });
    } catch (error) {
      toDomainFailure(error, 'Invoice void');
    }

    await appendAudit(db, {
      action: 'sal.invoice.voided',
      entityType: 'sal.invoice',
      entityId: before.id,
      companyId: before.companyId,
      branchId: before.branchId,
      requestRef: 'sal.invoice-void',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: voided.status,
        },
        { field: 'reason', classification: 'internal', value: trimmedReason },
      ],
    });

    await publishEvent(db, {
      eventType: 'invoice.voided',
      aggregateId: before.id,
      aggregateVersion: voided.recordVersion,
      producer: 'billing.invoice-service',
      companyId: before.companyId,
      branchId: before.branchId,
      eventKey: `invoice.voided:${before.id}`,
      payload: {
        invoiceId: before.id,
        workOrderId: before.workOrderId,
        currency: before.currencyCode,
        status: voided.status,
      },
    });

    const after = await this.repository.findInvoice(db, invoiceId);
    return {
      invoice: toInvoiceView(after ?? before),
      replayed: false,
      // From the UPDATE's own RETURNING clause, not from the re-read: it is the
      // version the void produced, and `shared.touch_row_metadata` advanced it by
      // exactly one.
      recordVersion: voided.recordVersion,
    };
  }

  // -------------------------------------------------------------------------
  // Credit notes — request, then a second person approves.
  // -------------------------------------------------------------------------

  /**
   * Requests a credit note against an issued invoice.
   *
   * Born `pending` and worth nothing: `sal.stamp_dual_control_maker` forces
   * `requested_by` from the session and nulls the approval fields on INSERT, so a
   * request can never arrive pre-approved, and `sal.invoice_open_receivable` counts
   * only `approval_state = 'approved'` credits. No event is published for the same
   * reason — an event named `credit-note.issued` fired at request time would tell
   * every consumer the receivable had fallen when it had not.
   *
   * ### The currency comes from the invoice row, and this is the only check there is
   *
   * `currency_code` is read from the locked parent invoice and stored from there.
   * If the caller named a currency, `assertCurrencyMatches` refuses a mismatch —
   * and that assertion is the ONLY defence in the entire platform: five triggers
   * fire on `sal.credit_notes` and none reads `sal.invoices.currency_code`,
   * `sal.approve_credit_note` compares the amount but never the currency, and
   * `sal.invoice_open_receivable` subtracts approved credits with no currency
   * predicate either. A JOD credit note against a USD invoice would be accepted,
   * approved, and silently subtracted from the USD gross (P1-22-L-02).
   *
   * ### The ceiling is checked under the invoice lock
   *
   * `sal.approve_credit_note` re-checks it inside its own lock, which is the
   * guarantee. Checking here as well is worth the duplication for one reason: the
   * approval path raises `check_violation` with a message that is not a caller-safe
   * contract, and a caller can act on "exceeds the open amount" while it can act on
   * nothing at all given a 500.
   */
  public async requestCreditNote(
    db: DbHandle,
    input: RequestCreditNoteInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<CreditNoteResult> {
    const reason = requireReason(input.reason, 'body.reason');
    let amount: Decimal;
    try {
      amount = parseInstrumentAmount(input.amount, 'amount');
    } catch (error) {
      refuseInvalidValue(error, 'body.amount');
    }

    const invoice = await this.repository.findInvoiceForUpdate(db, input.invoiceId);
    if (!invoice) {
      throw new AppFailure('ERR-RES-001', {
        message: `Invoice ${input.invoiceId} was not found in scope`,
      });
    }
    await authorizeScope({ companyId: invoice.companyId, branchId: invoice.branchId });

    // `draft` and `void_before_issue` have nothing to credit — `invoice_open_receivable`
    // returns 0 for both — and refusing them here says so, where the ceiling check
    // would only say "0 exceeded". `credited` is admitted because the receivable
    // function computes a real figure for it; in practice it is unreachable, since no
    // `sal` primitive moves an invoice from `issued` to `credited`.
    if (invoice.status !== 'issued' && invoice.status !== 'credited') {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Invoice ${invoice.id} is "${invoice.status}"; only an issued invoice can be ` +
          'credited. A draft is corrected by editing or voiding it, not by a credit note.',
      });
    }

    if (input.currency !== undefined) {
      try {
        assertCurrencyMatches(invoice.currencyCode, input.currency, 'credit note');
      } catch (error) {
        refuseInvalidValue(error, 'body.currency');
      }
    }

    // Refused BEFORE the ceiling check, not after it. Without `sal.finance.view`
    // `sal.invoice_open_receivable` returns 0 rather than failing, so the ceiling
    // check would refuse every positive amount with "exceeds the invoice's open
    // amount of 0.0000" — a 409 that blames the caller's number for a missing
    // permission. `ins_credit_notes_gated` would refuse the INSERT anyway, so nothing
    // could have been written either way; what this changes is that the answer names
    // the real cause.
    if (!balanceIsTrustworthy(invoice)) {
      throw new AppFailure('ERR-IAM-001', {
        message:
          `Invoice ${invoice.id} has amounts this caller may not see, so a credit note ` +
          'cannot be bounded against its open receivable.',
        safeDetails: { requiredPermissions: [FINANCE_VIEW_PERMISSION] },
      });
    }

    const open = await this.repository.openReceivable(db, {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    /* c8 ignore next 5 -- the invoice is held `FOR UPDATE` in this transaction. */
    if (!open) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: invoice vanished between the lock and the receivable read',
      });
    }
    try {
      assertCreditWithinOpenAmount(amount, Decimal.fromDatabase(open.amount, MONEY));
    } catch (error) {
      toDomainFailure(error, 'Credit note request');
    }

    if (input.idempotencyKey !== undefined) {
      const existing = await this.repository.findCreditNoteByIdempotencyKey(
        db,
        input.idempotencyKey
      );
      if (existing) {
        if (existing.invoiceId !== invoice.id) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'This idempotency key already requested a credit note against a different ' +
              'invoice. Reuse a key only for an identical request.',
          });
        }
        if (!Decimal.fromDatabase(existing.amount, MONEY).equals(amount)) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'This idempotency key already requested a different amount. Reuse a key only ' +
              'for an identical request.',
          });
        }
        await authorizeScope({ companyId: existing.companyId, branchId: existing.branchId });
        return { creditNote: toCreditNoteView(existing), replayed: true };
      }
    }

    let note: CreditNoteRow;
    try {
      note = await this.repository.insertCreditNote(db, {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        branchId: invoice.branchId,
        // From the invoice ROW. Never from `input.currency`, which exists only to be
        // refused above.
        currencyCode: invoice.currencyCode,
        amount: amount.toString(),
        reason,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    } catch (error) {
      toDomainFailure(error, 'Credit note request');
    }

    await appendAudit(db, {
      action: 'sal.credit_note.requested',
      entityType: 'sal.credit_note',
      entityId: note.id,
      companyId: note.companyId,
      branchId: note.branchId,
      requestRef: 'sal.credit-note-request',
      details: [
        { field: 'invoiceId', classification: 'internal', value: note.invoiceId },
        { field: 'currencyCode', classification: 'internal', value: note.currencyCode },
        { field: 'approvalState', classification: 'internal', value: note.approvalState },
        { field: 'reason', classification: 'internal', value: note.reason },
        // `restricted`, so `iam.audit_mask` stores a marker: `sal.credit_notes` is
        // gated in its entirety by `sal.finance.view` and `iam.audit_records` is not.
        { field: 'amount', classification: 'restricted', value: note.amount },
      ],
    });

    return { creditNote: toCreditNoteView(note), replayed: false };
  }

  /**
   * Approves a credit note under dual control, reducing the invoice's receivable.
   *
   * ### Lock order matches the primitive's
   *
   * `sal.approve_credit_note` locks the credit note and then the invoice. The
   * pre-reads here take the same two locks in the same order, so this method cannot
   * deadlock against a concurrent approval of another note on the same invoice — and
   * both amounts are held still between the pre-check and the call.
   *
   * ### Maker ≠ approver
   *
   * The database enforces it twice: `ck_credit_notes_approved_distinct` structurally,
   * and `sal.guard_dual_control_approval`, which stamps `approved_by` from the
   * session and raises `check_violation` when it equals `requested_by`. Neither
   * produces a caller-safe message, so self-approval is refused here first with one
   * that says what to do — ask someone else — and the residual `check_violation` is
   * translated to the same answer.
   *
   * That translation is exact rather than a guess. The primitive raises
   * `check_violation` for three reasons: a non-`pending` state, refused above; an
   * amount exceeding the open receivable, refused below under the invoice lock that
   * makes it unable to change; and self-approval. With the first two eliminated, the
   * third is what remains.
   *
   * ### The currency is checked again
   *
   * `assertCurrencyMatches` runs at request time and again here, because the
   * approval is the moment the credit becomes a real subtraction from the
   * receivable and nothing in the database compares the two codes at any point. A
   * row inserted by a path that skipped the request service — `app_runtime` holds
   * raw INSERT on `sal.credit_notes` — is caught here.
   *
   * Idempotent on an already-`approved` note: no second audit record, no second
   * event.
   */
  public async approveCreditNote(
    db: DbHandle,
    creditNoteId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<CreditNoteResult> {
    const note = await this.repository.findCreditNoteForUpdate(db, creditNoteId);
    if (!note) {
      throw new AppFailure('ERR-RES-001', {
        message: `Credit note ${creditNoteId} was not found in scope`,
      });
    }
    await authorizeScope({ companyId: note.companyId, branchId: note.branchId });

    if (note.approvalState === 'approved') {
      return { creditNote: toCreditNoteView(note), replayed: true };
    }
    if (note.approvalState !== 'pending') {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Credit note ${creditNoteId} is "${note.approvalState}"; only a pending request ` +
          'can be approved, and a decided one is frozen.',
      });
    }

    // Second lock, in the primitive's own order (note, then invoice).
    const invoice = await this.repository.findInvoiceForUpdate(db, note.invoiceId);
    /* c8 ignore next 6 -- `fk_credit_notes_invoice` is a composite FK with
       ON DELETE RESTRICT, so a credit note cannot outlive its invoice. */
    if (!invoice) {
      throw new AppFailure('ERR-RES-001', {
        message: `The invoice for credit note ${creditNoteId} was not found in scope`,
      });
    }
    try {
      assertCurrencyMatches(invoice.currencyCode, note.currencyCode, 'credit note approval');
    } catch (error) {
      toDomainFailure(error, 'Credit note approval');
    }

    if (note.requestedBy === db.context.principal.userId) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          'The approver of a credit note must differ from the requester. Ask a second ' +
          'authorised person to approve this request.',
      });
    }

    const open = await this.repository.openReceivable(db, {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    /* c8 ignore next 5 -- the invoice is held `FOR UPDATE` in this transaction. */
    if (!open) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: invoice vanished between the lock and the receivable read',
      });
    }
    try {
      assertCreditWithinOpenAmount(
        Decimal.fromDatabase(note.amount, MONEY),
        Decimal.fromDatabase(open.amount, MONEY)
      );
    } catch (error) {
      toDomainFailure(error, 'Credit note approval');
    }

    try {
      await this.repository.approveCreditNote(db, creditNoteId, db.context.correlationId);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message:
            'The approver of a credit note must differ from the requester. Ask a second ' +
            'authorised person to approve this request.',
          cause: error,
        });
      }
      toDomainFailure(error, 'Credit note approval');
    }

    const approved = await this.repository.findCreditNote(db, creditNoteId);
    /* c8 ignore next 5 -- the note is held `FOR UPDATE` in this transaction. */
    if (!approved) {
      throw new AppFailure('ERR-SYS-001', { message: 'Credit note vanished after approval' });
    }

    await appendAudit(db, {
      action: 'sal.credit_note.approved',
      entityType: 'sal.credit_note',
      entityId: approved.id,
      companyId: approved.companyId,
      branchId: approved.branchId,
      requestRef: 'sal.credit-note-approve',
      details: [
        {
          field: 'approvalState',
          classification: 'internal',
          previousValue: note.approvalState,
          value: approved.approvalState,
        },
        { field: 'invoiceId', classification: 'internal', value: approved.invoiceId },
        { field: 'currencyCode', classification: 'internal', value: approved.currencyCode },
        { field: 'amount', classification: 'restricted', value: approved.amount },
      ],
    });

    await publishEvent(db, {
      eventType: 'credit-note.issued',
      aggregateId: approved.id,
      aggregateVersion: approved.recordVersion,
      producer: 'billing.invoice-service',
      companyId: approved.companyId,
      branchId: approved.branchId,
      eventKey: `credit-note.issued:${approved.id}`,
      // No amount, for the reason given on `invoice.created`. A consumer learns that
      // the receivable moved and re-reads it under its own authorization, which is
      // also the only way to see the CURRENT figure rather than a stale delta.
      payload: {
        creditNoteId: approved.id,
        invoiceId: approved.invoiceId,
        currency: approved.currencyCode,
        approvalState: approved.approvalState,
      },
    });

    return { creditNote: toCreditNoteView(approved), replayed: false };
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  /**
   * Refuses a commercial source whose lines cannot become invoice lines.
   *
   * Both checks pre-empt a `check_violation` that would arrive from a trigger in the
   * middle of writing the invoice, aborting a transaction that had already written
   * the header and several lines:
   *
   *  - **currency coherence.** `quo.guard_quotation_item` already forces every item
   *    to match its revision, and `tg_invoice_lines_frozen` forces every invoice line
   *    to match the invoice header — so a mismatch is only reachable through raw DML
   *    on `quo`. It is checked because that is exactly the case where the error would
   *    otherwise surface as an opaque 500 halfway through the write.
   *  - **line-type vocabulary.** `ck_quotation_items_kind` admits `service`/`part`
   *    and `ck_invoice_lines_line_type` admits `service`/`part`/`fee`, so today the
   *    first is a subset of the second. If `quo` ever widens its vocabulary, this
   *    refuses the invoice with a message naming the value instead of letting a
   *    CHECK abort the transaction.
   */
  private assertSourceLinesAreBillable(
    sourceCurrency: string,
    lines: readonly CommercialSourceLineRow[],
    revisionId: string
  ): void {
    if (lines.length === 0) {
      // `quo.issue_revision` forbids issuing a revision with no items, so this is
      // defence in depth against a source that was torn down between the aggregate
      // and the line read.
      throw new AppFailure('ERR-RES-001', {
        message: `The accepted quotation revision ${revisionId} has no billable lines`,
      });
    }
    for (const line of lines) {
      try {
        assertCurrencyMatches(
          sourceCurrency,
          line.currencyCode,
          `quotation line ${line.lineNumber}`
        );
      } catch (error) {
        toDomainFailure(error, 'Invoice creation');
      }
      if (!(INVOICE_LINE_TYPES as readonly string[]).includes(line.itemKind)) {
        throw new AppFailure('ERR-TRN-001', {
          message:
            `Quotation line ${line.lineNumber} has kind "${line.itemKind}", which is not one ` +
            `of the invoice line types ${INVOICE_LINE_TYPES.join(', ')}.`,
        });
      }
    }
  }

  /**
   * Refuses to start the issue when no number sequence is provisioned.
   *
   * The sequence code is resolved exactly as `sal.issue_invoice` resolves it — the
   * active `sal.invoice_numbering_configs` row for the company, COALESCEd to
   * `'invoice'` — so the pre-check asks about the sequence the primitive will
   * actually use.
   *
   * A configured code the platform does not recognise is reported as a configuration
   * error, not a validation failure: `ck_invoice_numbering_configs_sequence_code`
   * only constrains the spelling, so an operator can store `invoce`, and the caller
   * supplied nothing that a 422 could ask them to change.
   */
  private async assertNumberingProvisioned(db: DbHandle, invoice: InvoiceRow): Promise<void> {
    const config = await this.repository.activeNumberingConfig(db, invoice.companyId);
    const sequenceCode = config?.sequenceCode ?? DEFAULT_INVOICE_SEQUENCE;

    if (!findSequenceDefinition(sequenceCode)) {
      throw new AppFailure('ERR-RES-001', {
        message:
          `Company ${invoice.companyId} is configured to number invoices from sequence ` +
          `"${sequenceCode}", which is not in the platform sequence registry. An operator ` +
          'must correct sal.invoice_numbering_configs.sequence_code.',
      });
    }

    const provisioned = await sharedServicesModule().numbers.isProvisioned(db, {
      sequenceCode,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
    });
    if (!provisioned) {
      throw unprovisionedSequence(invoice, sequenceCode);
    }
  }

  /** Re-reads the invoice with its lines, so the response is what a reader sees. */
  private async detailOf(db: DbHandle, invoice: InvoiceRow): Promise<InvoiceDetailView> {
    // Re-read rather than compose from the INSERT results: the header's money is
    // visible only through `sel_invoice_amounts_gated`, so reading it back is what
    // guarantees the response shows exactly what this caller is entitled to see
    // rather than what this transaction happened to write.
    const fresh = (await this.repository.findInvoice(db, invoice.id)) ?? invoice;
    const lines = await this.repository.listInvoiceLines(db, {
      invoiceId: fresh.id,
      companyId: fresh.companyId,
      branchId: fresh.branchId,
    });
    return {
      invoice: toInvoiceView(fresh),
      lines: lines.map(toInvoiceLineView),
      recordVersion: fresh.recordVersion,
    };
  }
}
