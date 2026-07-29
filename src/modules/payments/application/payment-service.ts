/**
 * Payment mutations (Phase 1-22 — `sal.payment-record`, `sal.payment-allocate`).
 *
 * Both methods run inside the route handler's transaction, so the receipt or
 * allocation, its `sal.financial_events` row, its audit record and its outbox event
 * share one commit. There is no publish-after-commit path: that window is where a
 * crash loses the event, and here it would also be where a payment existed with no
 * trace of who applied it.
 *
 * ## What the protected schema guarantees, and what it does not
 *
 * `sal.record_receipt` and `sal.allocate_receipt` own everything this service must
 * not duplicate: the receipt number, the server-stamped cashier and tenant, the
 * receipt→invoice `FOR UPDATE` lock order (H-fin-2), the allocation bounds, the
 * currency equality between receipt and invoice, and the `receipt_recorded` /
 * `payment_allocated` financial events that the deferred completeness constraint
 * triggers demand. This service never re-implements any of them and never writes a
 * financial event of its own.
 *
 * What it does own are the refusals the database does not make:
 *
 *  - **A platform-scoped payment method cannot be cited by a receipt** and nothing
 *    in the schema says so in a caller-legible way — `fk_receipts_method` just
 *    raises `23503`. See `assertPaymentMethodIsTenantScoped`.
 *  - **`P0002` from the unprovisioned `'receipt'` number sequence** is a
 *    configuration gap, not a client error (SB3 / `P1-22-L-03`). Runtime holds no
 *    INSERT grant on `shared.number_sequences` by design, so nothing here may
 *    self-heal it and nothing here may guess a receipt number.
 *  - **Whether a request is a replay.** The primitive resolves an idempotency key
 *    internally and returns the receipt that already exists, which is correct and
 *    from the outside indistinguishable from a fresh one.
 *  - **The caller's own declared currency**, which the primitive never sees.
 *
 * ## No settlement, no credential, ever
 *
 * `ck_payment_methods_kind` admits exactly `cash`, `card_terminal` and
 * `bank_transfer`, with the schema comment "No online payment gateway/settlement
 * types (ASM-14, CON-04)". There is therefore **no column in which an external
 * settlement could be claimed** — no authorisation code, no gateway reference, no
 * PAN, no token, no expiry. The prohibition on claiming one is structural rather
 * than a rule this file has to remember, and the input types below carry no field a
 * caller could put such a claim in. Nothing is stored, forwarded or logged.
 *
 * ## Arithmetic
 *
 * Every sum is PostgreSQL's, in `numeric`. `Decimal` is used for exactly the three
 * things it exists for — refusing a value that does not fit `numeric(18,4)` before
 * it reaches SQL, comparing two amounts without materialising a double, and
 * serialising deterministically. `Money` has no `add` and no `multiply`, and none is
 * added here.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE, sqlState } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { billingModule } from '@/modules/billing';
import { Decimal, DecimalError, MONEY, assertCurrencyCode, moneyView } from '@/modules/pricing';
import type { MoneyView } from '@/modules/pricing';
import {
  PAYMENT_SQLSTATE,
  type PaymentsRepository,
  type ReceiptRow,
} from '../data/payments-repository';
import {
  PaymentRuleError,
  assertAllocatable,
  assertAllocationCurrencyCoherent,
  assertAllocationWithinBounds,
  assertPaymentMethodIsTenantScoped,
  assertPaymentMethodUsable,
  parsePaymentAmount,
} from '../domain/payments';

/**
 * Everything an allocation needs to know about its invoice, and nothing more.
 *
 * Composed in `resolveInvoiceHeader` from `@/modules/billing`'s public port, because
 * `sal.invoices` belongs to `billing` and this module may not read it (ADR-001, and
 * the boundary checker enforces it). Four fields are the invoice *header* — which is
 * deliberately NOT gated by `sal.finance.view`, so that a caller lacking it can see
 * that an invoice exists — and `openReceivable` is derived by
 * `sal.invoice_open_receivable`, whose inputs are gated.
 */
export interface AllocationInvoiceHeader {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  /** One of the four `ck_invoices_status` values. */
  readonly status: string;
  readonly currencyCode: string;
  /** `sal.invoice_open_receivable` as an exact decimal STRING, never a number. */
  readonly openReceivable: string;
}

/**
 * The two methods this module calls on `@/modules/billing`'s read port.
 *
 * Declared structurally, and resolved by the METHODS it must provide rather than by
 * the composition key it happens to sit under, exactly as
 * `DeliveryReadService.resolveOpenReceivableReader` does for the financial blocker.
 * The key is billing's own choice; the methods are the contract. Naming a key here
 * would couple this module to a decision it has no part in, and the far worse
 * alternative — reading `sal.invoices` directly — would put a second definition of
 * "invoice status" and "open receivable" in the module least entitled to hold one.
 *
 * Both methods take the caller's `ScopeAuthorizer` and evaluate it against the
 * INVOICE's own company and branch. That is not redundant with the receipt's check:
 * it is the reason a caller cannot reach an invoice in a branch it holds no
 * `sal.payment.allocate` grant in, and it runs before this module compares the two
 * scopes. Both also raise `ERR-RES-001` themselves for an invoice that is absent or
 * outside the resolved scope, which is why the composition below is non-nullable.
 */
interface BillingInvoicePort {
  readInvoice(
    db: DbHandle,
    invoiceId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<{
    readonly invoice: {
      readonly id: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly status: string;
      readonly currency: string;
    };
  }>;
  readOutstanding(
    db: DbHandle,
    invoiceId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<{
    readonly invoiceId: string;
    readonly status: string;
    readonly outstanding: MoneyView;
  }>;
}

/**
 * Locates billing's invoice read port, or returns `null`.
 *
 * A `null` return is never treated as "no invoice" or "nothing outstanding" — the
 * caller refuses the whole allocation, because an allocation whose invoice status,
 * currency, scope and open receivable are unknown is precisely the allocation that
 * must not happen.
 */
function resolveBillingInvoicePort(): BillingInvoicePort | null {
  const services: Record<string, unknown> = billingModule();
  for (const service of Object.values(services)) {
    if (typeof service !== 'object' || service === null) continue;
    const candidate = service as Partial<BillingInvoicePort>;
    if (
      typeof candidate.readInvoice === 'function' &&
      typeof candidate.readOutstanding === 'function'
    ) {
      return candidate as BillingInvoicePort;
    }
  }
  return null;
}

/** A receipt as this module's write paths report it. */
export interface ReceiptView {
  readonly id: string;
  /**
   * The receipt's stable human reference. Allocated once by
   * `shared.next_display_number('receipt', …)` and frozen by
   * `sal.guard_receipt_freeze`, so a replay reports this same string and never
   * consumes a second number.
   */
  readonly reference: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly paymentMethodId: string;
  readonly payerPartnerId: string;
  readonly money: MoneyView;
  readonly status: string;
  readonly receivedAt: string;
  readonly recordVersion: number;
  /** True when an idempotent replay returned the receipt that already existed. */
  readonly replayed: boolean;
}

/** One allocation as the write path reports it. */
export interface AllocationView {
  readonly id: string;
  readonly sequence: string;
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly money: MoneyView;
  readonly allocatedAt: string;
  /** The receipt's status after `sal.allocate_receipt` re-summed and set it. */
  readonly receiptStatus: string;
  /** What remains on the receipt after this allocation, derived by the database. */
  readonly receiptUnallocated: MoneyView;
}

export interface RecordPaymentInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly paymentMethodId: string;
  readonly payerPartnerId: string;
  /**
   * REQUIRED and explicit.
   *
   * There is no `DEFAULT` on any `currency_code` column in `sal` or `wty`, and the
   * platform ships no jurisdiction default — a tenant's currency comes from its own
   * price list, never from a hard-coded country. Defaulting it here would invent the
   * one fact the schema refuses to invent.
   */
  readonly currencyCode: string;
  /** Exact decimal string, strictly positive (`ck_receipts_amount`). */
  readonly amount: string;
  /**
   * The RECEIPT-level idempotency key, stored in `sal.receipts.idempotency_key` and
   * unique per tenant via `uq_receipts_idempotency`. Distinct from the HTTP
   * `Idempotency-Key` the boundary middleware fingerprints: this one makes the
   * receipt itself single-instance for the life of the row.
   */
  readonly idempotencyKey?: string;
}

export interface AllocatePaymentInput {
  readonly receiptId: string;
  readonly invoiceId: string;
  /** Exact decimal string, strictly positive (`ck_payment_allocations_amount`). */
  readonly amount: string;
  /**
   * The currency the caller believes it is allocating in.
   *
   * Required, and compared against both the receipt's and the invoice's.
   * `sal.allocate_receipt` compares receipt against invoice itself but never sees
   * the caller's belief, so without this a client allocating what it thinks are USD
   * against a JOD receipt succeeds in a currency it did not intend.
   */
  readonly currencyCode: string;
}

/**
 * Translates the protected schema's refusals into the controlled catalog.
 *
 * The SQLSTATE is the contract, not the message: `23514` from
 * `sal.allocate_receipt`'s over-allocation guard and `23514` from
 * `ck_receipts_amount` are the same class of answer — the database refused because
 * an invariant would break — and a caller needs `ERR-TRN-001` for both. Constraint
 * names, function names and SQL never reach the caller.
 *
 * `no_data_found` (`P0002`) is deliberately NOT handled here: it means three
 * different things depending on which call raised it, and a single mapping would
 * report an unprovisioned number sequence as a missing receipt. Each call site maps
 * it itself.
 */
function toDomainFailure(error: unknown, what: string): never {
  if (error instanceof PaymentRuleError) {
    throw new AppFailure('ERR-TRN-001', { message: error.message });
  }
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a payment invariant`,
    });
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names a payment method, payer, currency or invoice that does not exist in scope`,
    });
  }
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    throw new AppFailure('ERR-INT-001', { message: `${what} has already been recorded` });
  }
  if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
    // `shared.next_display_number` raises this when the named company or branch is
    // outside the session's resolved scope. It is an authorization denial and takes
    // the same uniform shape as any other.
    throw new AppFailure('ERR-IAM-001', {
      message: `${what} named a company or branch outside the session scope`,
    });
  }
  throw error;
}

/**
 * Parses an amount, mapping the domain refusal onto the catalog.
 *
 * Without this wrapper an unmapped `PaymentRuleError` surfaces as `ERR-SYS-001` — a
 * 500 telling the caller its request broke the server when the server in fact
 * refused it. The Zod schema at the edge catches most malformed shapes but not every
 * one: `"0"` is a well-formed decimal string and only `ck_receipts_amount`'s `> 0`
 * rule refuses it, and a fifth decimal place is not an error to PostgreSQL at all —
 * it is silently rounded away on the cast, so `Decimal.parse` is the only thing that
 * refuses it.
 */
function parseAmount(raw: string, field: string): Decimal {
  try {
    return parsePaymentAmount(raw, field);
  } catch (error) {
    if (error instanceof PaymentRuleError) {
      throw new AppFailure('ERR-VAL-001', {
        message: error.message,
        safeDetails: { violations: [{ path: `body.${field}`, rule: 'custom' }] },
      });
    }
    throw error;
  }
}

/** Validates the ISO 4217 shape. An unseeded code still fails `23503` downstream. */
function parseCurrency(raw: string, field: string): string {
  try {
    return assertCurrencyCode(raw);
  } catch (error) {
    if (error instanceof DecimalError) {
      throw new AppFailure('ERR-VAL-001', {
        message: error.message,
        safeDetails: { violations: [{ path: `body.${field}`, rule: 'invalid_string' }] },
      });
    }
    throw error;
  }
}

/**
 * Maps a domain refusal about the request's own contents to a validation failure.
 *
 * A method that is inactive, outside the closed `kind` set, or platform-scoped is
 * not a state conflict — the caller named the wrong method and can fix the request
 * by naming another, which is `ERR-VAL-001` and not `ERR-TRN-001`.
 */
function refuseRequestField(error: unknown, path: string): never {
  if (error instanceof PaymentRuleError) {
    throw new AppFailure('ERR-VAL-001', {
      message: error.message,
      safeDetails: { violations: [{ path, rule: 'custom' }] },
    });
  }
  throw error;
}

export class PaymentService {
  public constructor(private readonly repository: PaymentsRepository) {}

  // -------------------------------------------------------------------------
  // `sal.payment-record`
  // -------------------------------------------------------------------------

  /**
   * Records money received, as a numbered receipt.
   *
   * The scope check runs against the pair the caller **named**, not one discovered
   * from a row, because there is no row yet: a receipt is created in a company and
   * branch rather than found in one. Both ids are passed, so
   * `iam.has_permission_in_scope` evaluates for real — an empty target would fail
   * closed, and a target naming only one of the two would let a company-scoped grant
   * satisfy a request while `shared.next_display_number` allocated from a sequence
   * the caller was never authorized for.
   *
   * Evidence is not attachable in this phase. `sal.receipts.evidence_document_version_id`
   * exists and is not frozen by `sal.guard_receipt_freeze`, so a later phase can add
   * an attach operation — but the only reviewed way to verify an evidence version
   * (`sharedServicesModule().attachments.verifyEvidenceVersion`) requires the version
   * to be *already linked to the target entity*, and a receipt is created and
   * numbered inside a single primitive call, so no window exists in which the link
   * could be made first. Accepting the field with a weaker check than every other
   * evidence path in the repository would be worse than not accepting it, so `null`
   * is passed and the gap is recorded (`P1-22-L-04` neighbours it).
   */
  public async recordPayment(
    db: DbHandle,
    input: RecordPaymentInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceiptView> {
    const amount = parseAmount(input.amount, 'amount');
    const currencyCode = parseCurrency(input.currencyCode, 'currencyCode');

    await authorizeScope({ companyId: input.companyId, branchId: input.branchId });

    /**
     * A replay is detected BEFORE the call, not inferred after it.
     *
     * `sal.record_receipt` resolves an existing `(tenant_id, idempotency_key)` and
     * returns the receipt that already exists — correct, but indistinguishable from
     * a fresh receipt once it returns, so a retrying client could not tell whether it
     * had consumed a second receipt number. `uq_receipts_idempotency` is tenant-wide
     * rather than branch-scoped, so the found receipt's own company and branch are
     * compared here too: without that, a caller in one branch replaying another
     * branch's key would be handed a receipt from a scope this request never named.
     *
     * This runs BEFORE the payment method is validated, and the order matters. A
     * receipt's `payment_method_id` is frozen by `sal.guard_receipt_freeze`, so a
     * method that has since been deactivated or withdrawn cannot make the stored
     * receipt wrong — refusing the retry on that basis would tell a client its
     * already-recorded payment had failed, and it would keep telling it that forever.
     */
    if (input.idempotencyKey !== undefined) {
      const existing = await this.repository.findReceiptByIdempotencyKey(db, input.idempotencyKey);
      if (existing) {
        this.assertReplayMatches(existing, input, amount, currencyCode);
        return this.toReceiptView(existing, true);
      }
    }

    const method = await this.repository.findPaymentMethod(db, input.paymentMethodId);
    // A withdrawn method is treated as absent rather than as a state conflict: the
    // lookup does not filter `deleted_at` (the detail read needs the row to render a
    // receipt that already cites it), so the write path makes the refusal itself.
    if (!method || method.deletedAt !== null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Payment method ${input.paymentMethodId} was not found`,
      });
    }
    try {
      // Two refusals, both about the method the request named. The first is the
      // closed `kind` vocabulary and the `active` status; the second is the FK shape
      // that makes a platform row unciteable — see the domain function's comment.
      assertPaymentMethodUsable(method);
      assertPaymentMethodIsTenantScoped(method);
    } catch (error) {
      refuseRequestField(error, 'body.paymentMethodId');
    }

    let receiptId: string;
    try {
      const created = await this.repository.recordReceipt(db, {
        companyId: input.companyId,
        branchId: input.branchId,
        paymentMethodId: input.paymentMethodId,
        payerPartnerId: input.payerPartnerId,
        currencyCode,
        // The canonical fixed-scale form, so the value that reaches `numeric(18,4)`
        // is the value that was validated rather than the raw client string.
        amount: amount.toString(),
        evidenceDocumentVersionId: null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: db.context.correlationId,
      });
      receiptId = created.id;
    } catch (error) {
      if (sqlState(error) === PAYMENT_SQLSTATE.noDataFound) {
        // SB3 / `P1-22-L-03`. `sal.record_receipt` hard-codes the sequence code
        // `'receipt'` — unlike the invoice path, which resolves a configurable
        // `sequence_code` from `sal.invoice_numbering_configs` — and
        // `shared.next_display_number` raises `no_data_found` when no
        // `shared.number_sequences` row exists for that code in this
        // `(company, branch)`. Runtime holds no INSERT grant on that table by
        // design, so this cannot be self-healed and MUST NOT be worked around by
        // inventing a receipt number: the fix is a provisioning action. The
        // configuration error names all three coordinates an operator needs.
        throw new AppFailure('ERR-RES-001', {
          message:
            'No display-number sequence is provisioned for sequence code "receipt" in ' +
            `company ${input.companyId}, branch ${input.branchId}. A receipt cannot be ` +
            'numbered until an operator provisions it (shared.number_sequences has no ' +
            'runtime INSERT grant); no receipt number was invented.',
          cause: error,
        });
      }
      toDomainFailure(error, 'Recording a payment');
    }

    const receipt = await this.repository.findReceipt(db, receiptId);
    if (!receipt) {
      // Unreachable while the primitive returns an id for a row it just inserted in
      // this transaction; kept because a silent null here would publish an event for
      // a receipt nobody can read.
      throw new AppFailure('ERR-SYS-001', { message: 'Receipt vanished after recording' });
    }

    await appendAudit(db, {
      action: 'sal.receipt.recorded',
      entityType: 'sal.receipt',
      entityId: receipt.id,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      requestRef: 'sal.payment-record',
      details: [
        // The amount is `restricted` in
        // docs/database/sal-wty-rpt-personal-data-classification.json, so
        // `iam.audit_mask` collapses it to a fixed marker before storage. The audit
        // record proves a receipt of some amount was taken, in a named currency, by
        // a named actor — it deliberately does not become a second copy of the
        // financial figure, which lives in `sal.receipts` and `sal.financial_events`.
        { field: 'amount', classification: 'restricted', value: receipt.amount },
        { field: 'currency', classification: 'public', value: receipt.currencyCode },
        { field: 'receiptNumber', classification: 'internal', value: receipt.receiptNumber },
        {
          field: 'paymentMethodId',
          classification: 'internal',
          value: receipt.paymentMethodId,
        },
        { field: 'paymentMethodKind', classification: 'internal', value: method.kind },
        { field: 'payerPartnerId', classification: 'internal', value: receipt.payerPartnerId },
      ],
    });

    await publishEvent(db, {
      eventType: 'receipt.recorded',
      aggregateId: receipt.id,
      aggregateVersion: receipt.recordVersion,
      // The catalog assigns `receipt.recorded` to module `payments`, and
      // `buildEventEnvelope` enforces that the producer's first dot-segment equals
      // the owner — so this string is checked, not documentary. `aggregateType` is
      // NOT passed: the envelope takes it from the catalog entry (`sal.receipt`), so
      // a producer cannot mislabel the aggregate it wrote.
      producer: 'payments.payment-service',
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      // Keyed on the receipt, which is single-instance per idempotency key, so a
      // retried command cannot publish this event twice.
      eventKey: `receipt.recorded:${receipt.id}`,
      payload: {
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        payerPartnerId: receipt.payerPartnerId,
        paymentMethodId: receipt.paymentMethodId,
        paymentMethodKind: method.kind,
        // Money crosses as `{ amount, currency }` — a fixed-scale decimal string
        // beside the code that gives it meaning, never a bare number and never an
        // unlabelled aggregate. No settlement reference and no credential of any
        // kind appears here, because none exists to appear.
        amount: receipt.amount,
        currency: receipt.currencyCode,
        receivedAt: receipt.receivedAt.toISOString(),
      },
    });

    return this.toReceiptView(receipt, false);
  }

  // -------------------------------------------------------------------------
  // `sal.payment-allocate`
  // -------------------------------------------------------------------------

  /**
   * Applies part or all of a receipt to one invoice.
   *
   * The order of the first two reads is load-bearing: **receipt first, then
   * invoice**, because `sal.allocate_receipt` locks them in exactly that order
   * (H-fin-2) and an application path that took them the other way round would
   * introduce a deadlock the primitive's documented order exists to prevent.
   *
   * Authorization runs **twice, against two different scopes**, and both are needed.
   * The receipt's pair is authorized immediately after the row is locked — earlier
   * than the checks below need it, deliberately, because the receipt id is
   * caller-supplied, RLS admits it on the permission-blind union of every active grant
   * (P1-18-A-01), and answering "that invoice is in another currency" before answering
   * "you may not touch this receipt" would let an unauthorized caller use the
   * difference between error codes as an oracle for what exists in a branch it only
   * holds some grant in. The invoice's pair is then authorized by billing's own read
   * port, which is what stops a caller from reaching an invoice in a branch it holds
   * no `sal.payment.allocate` grant in. Neither check subsumes the other, and the
   * coherence comparison in step 4 is a third, separate thing: two individually
   * authorized scopes can still be two DIFFERENT scopes.
   *
   * Every bound is then checked twice, and only the second check counts. The
   * application's comparison races by construction — `sal.receipt_unallocated` and
   * `sal.invoice_open_receivable` are both `STABLE` snapshot reads — and the
   * primitive re-evaluates both inside its own locks. The duplication is worth it
   * for one reason only: the primitive raises `check_violation` with a message that
   * is not a caller-safe contract, and "you tried to allocate more than remains" is
   * something a caller can act on, while a 500 is not.
   */
  public async allocatePayment(
    db: DbHandle,
    input: AllocatePaymentInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<AllocationView> {
    const amount = parseAmount(input.amount, 'amount');
    const declaredCurrency = parseCurrency(input.currencyCode, 'currencyCode');

    // 1. RECEIPT FIRST, and locked. See the method comment.
    const receipt = await this.repository.findReceiptForUpdate(db, input.receiptId);
    if (!receipt || receipt.deletedAt !== null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Receipt ${input.receiptId} was not found`,
      });
    }

    // 2. The receipt names its own company and branch, so the deferred check has a
    //    concrete target and evaluates with `iam.has_permission_in_scope`. The same
    //    pair is then bound as predicates on every derived read below — authorization
    //    is satisfied by company OR branch, so the check alone does not make the pair
    //    coherent and the predicates are what pin it (H6).
    const scope = { companyId: receipt.companyId, branchId: receipt.branchId };
    await authorizeScope(scope);

    // 3. The invoice comes from `@/modules/billing`'s public port. This module may not
    //    read `sal.invoices` — `billing` owns that table, and a second reader would be
    //    a second definition of what an invoice's status means. The port authorizes the
    //    INVOICE's own scope with this operation's permissions, and reports an absent
    //    or out-of-scope invoice as `ERR-RES-001` itself, so there is no null to check.
    const invoice = await this.resolveInvoiceHeader(db, input.invoiceId, authorizeScope);

    // 4. Scope coherence. Both allocation FKs are four-column composite scoped FKs,
    //    so the database would refuse a cross-branch pair — but it refuses it as
    //    `no_data_found` from inside the primitive, which reads as "the invoice does
    //    not exist" about an invoice the caller can see. RLS admits every branch the
    //    caller holds any grant in, so this pair really can be incoherent.
    if (invoice.companyId !== receipt.companyId || invoice.branchId !== receipt.branchId) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          'That invoice belongs to a different company or branch from the receipt; an ' +
          'allocation cannot cross a branch boundary',
        safeDetails: { violations: [{ path: 'body.invoiceId', rule: 'custom' }] },
      });
    }

    // 5. Three currencies, all compared. The primitive checks receipt against
    //    invoice; the caller's declared currency is the third party it never sees.
    try {
      assertAllocationCurrencyCoherent(
        declaredCurrency,
        receipt.currencyCode,
        invoice.currencyCode
      );
    } catch (error) {
      refuseRequestField(error, 'body.currencyCode');
    }

    // 6. States. `reversed` is terminal for a receipt; an invoice must be `issued` or
    //    `credited` — a `credited` invoice may still hold an open receivable, which is
    //    why it is payable and why this is not simply `status = 'issued'`.
    try {
      assertAllocatable(receipt.status, invoice.status);
    } catch (error) {
      if (error instanceof PaymentRuleError) {
        throw new AppFailure('ERR-TRN-001', { message: error.message });
      }
      throw error;
    }

    // 7. Bounds, by exact decimal comparison. Never `Number`, never a subtraction in
    //    TypeScript: both remainders were computed by PostgreSQL in `numeric` and are
    //    only ever compared here.
    const remaining = await this.repository.receiptUnallocated(db, receipt.id, scope);
    if (!remaining) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'Receipt remainder read returned no row for a locked receipt',
      });
    }
    try {
      assertAllocationWithinBounds(
        amount,
        Decimal.fromDatabase(remaining.unallocated, MONEY),
        Decimal.fromDatabase(invoice.openReceivable, MONEY)
      );
    } catch (error) {
      if (error instanceof PaymentRuleError) {
        throw new AppFailure('ERR-TRN-001', { message: error.message });
      }
      throw error;
    }

    // 8. The primitive. The only path that may create an allocation.
    let allocationId: string;
    try {
      const created = await this.repository.allocateReceipt(
        db,
        receipt.id,
        invoice.id,
        amount.toString(),
        db.context.correlationId
      );
      allocationId = created.id;
    } catch (error) {
      if (sqlState(error) === PAYMENT_SQLSTATE.noDataFound) {
        // The primitive's own scope refusals for the receipt and the invoice. The
        // pre-checks above should have caught both, so reaching here means the row
        // moved out of scope between the read and the call — reported as a missing
        // resource, in the same uniform shape, rather than as a fault.
        throw new AppFailure('ERR-RES-001', {
          message: 'The receipt or the invoice is no longer in scope for this allocation',
          cause: error,
        });
      }
      toDomainFailure(error, 'Allocating a payment');
    }

    const allocation = await this.repository.findAllocation(db, allocationId, scope);
    if (!allocation) {
      throw new AppFailure('ERR-SYS-001', { message: 'Allocation vanished after creation' });
    }
    // Re-read rather than derive: `sal.allocate_receipt` re-sums the allocations and
    // sets the receipt to `allocated` or `partially_allocated` itself, and the
    // remainder is recomputed by the database. Reporting a status this service
    // calculated would be a second, weaker implementation of the primitive's own
    // decision.
    const after = await this.repository.findReceipt(db, receipt.id);
    const remainder = await this.repository.receiptUnallocated(db, receipt.id, scope);
    if (!after || !remainder) {
      throw new AppFailure('ERR-SYS-001', { message: 'Receipt vanished after allocation' });
    }

    await appendAudit(db, {
      action: 'sal.payment.allocated',
      entityType: 'sal.payment_allocation',
      entityId: allocation.id,
      companyId: allocation.companyId,
      branchId: allocation.branchId,
      requestRef: 'sal.payment-allocate',
      details: [
        // `sal.payment_allocations.amount` is `restricted`, like the receipt's.
        { field: 'amount', classification: 'restricted', value: allocation.amount },
        { field: 'currency', classification: 'public', value: allocation.currencyCode },
        { field: 'receiptId', classification: 'internal', value: allocation.receiptId },
        { field: 'invoiceId', classification: 'internal', value: allocation.invoiceId },
        // The status the primitive computed, so the trail records the receipt's
        // resulting state rather than only the delta.
        { field: 'receiptStatus', classification: 'internal', value: after.status },
      ],
    });

    await publishEvent(db, {
      eventType: 'payment.allocated',
      aggregateId: allocation.id,
      // `sal.payment_allocations` has no `record_version` column, and the table is
      // append-only — SELECT and INSERT are granted, UPDATE and DELETE are not. The
      // row therefore has exactly one version for its whole life, and `1` states
      // that rather than borrowing `seq`, which is a per-tenant ledger position and
      // not a version of this aggregate.
      aggregateVersion: 1,
      producer: 'payments.payment-service',
      companyId: allocation.companyId,
      branchId: allocation.branchId,
      // The allocation id is unique per row, and the same receipt may legally
      // allocate to the same invoice more than once, so the key must be the
      // allocation and not the pair.
      eventKey: `payment.allocated:${allocation.id}`,
      payload: {
        allocationId: allocation.id,
        receiptId: allocation.receiptId,
        invoiceId: allocation.invoiceId,
        amount: allocation.amount,
        currency: allocation.currencyCode,
        receiptStatus: after.status,
        receiptUnallocated: remainder.unallocated,
      },
    });

    return {
      id: allocation.id,
      sequence: allocation.seq,
      receiptId: allocation.receiptId,
      invoiceId: allocation.invoiceId,
      companyId: allocation.companyId,
      branchId: allocation.branchId,
      money: moneyView(allocation.amount, allocation.currencyCode),
      allocatedAt: allocation.allocatedAt.toISOString(),
      receiptStatus: after.status,
      receiptUnallocated: moneyView(remainder.unallocated, remainder.currencyCode),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers.
  // -------------------------------------------------------------------------

  /**
   * The module's ONLY coupling to `@/modules/billing`, in one place.
   *
   * Two reads rather than one, because billing's surface offers no header-only
   * reader: `readInvoice` carries the scope, status and currency, and
   * `readOutstanding` carries the derived open receivable with the currency that
   * labels it. `readInvoice` also returns the invoice's lines, which are discarded
   * here — an allocation has no business with line detail, and the wasted work is one
   * bounded read inside a transaction that is already reading four rows and writing
   * three. A dedicated header port on billing's side would remove it, and is recorded
   * as the obvious follow-up rather than worked around by reading `sal.invoices`.
   *
   * `readOutstanding` **refuses** rather than reporting a masked zero when the caller
   * cannot see financial detail, which is what makes it safe to feed
   * `assertAllocationWithinBounds`: `sal.invoice_open_receivable` computes `0` for a
   * caller without `sal.finance.view` because the amount rows are invisible to it, and
   * a zero read that way would look like a settled invoice. `sal.payment-allocate`
   * requires the permission anyway, so the refusal is a backstop rather than a path.
   *
   * The two currencies are cross-checked. They come from the same header by
   * construction — `sal.invoice_open_receivable` returns a bare `numeric` and billing
   * labels it from `sal.invoices.currency_code` — so a disagreement means the two
   * reads did not describe the same row, and this value feeds
   * `assertAllocationCurrencyCoherent`, which is the only defence against a
   * cross-currency allocation that the caller's own declaration does not already
   * cover. A silent mismatch there would be worse than a refused command.
   */
  private async resolveInvoiceHeader(
    db: DbHandle,
    invoiceId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<AllocationInvoiceHeader> {
    const port = resolveBillingInvoicePort();
    if (!port) {
      // Fails the command closed. Never "assume nothing outstanding": that would let
      // an allocation past both of its bounds, and `sal.payment_allocations` has no
      // constraint that would catch it afterwards.
      throw new AppFailure('ERR-SYS-001', {
        message:
          'The billing module exposes no invoice read port (readInvoice + readOutstanding ' +
          'on @/modules/billing), so an allocation cannot be bounded and is refused',
      });
    }
    const detail = await port.readInvoice(db, invoiceId, authorizeScope);
    const outstanding = await port.readOutstanding(db, invoiceId, authorizeScope);
    if (detail.invoice.currency !== outstanding.outstanding.currency) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'The invoice header and its open receivable disagree about the currency',
      });
    }
    return {
      id: detail.invoice.id,
      companyId: detail.invoice.companyId,
      branchId: detail.invoice.branchId,
      status: detail.invoice.status,
      currencyCode: detail.invoice.currency,
      openReceivable: outstanding.outstanding.amount,
    };
  }

  /**
   * Refuses a replay whose request differs from the one the key already recorded.
   *
   * Every compared field is frozen by `sal.guard_receipt_freeze` once the receipt
   * exists — amount, currency, method, payer — so a differing request can never be
   * satisfied by amending the stored receipt. The only two honest answers are "you
   * already did this" and "you cannot reuse this key for that". Returning the
   * existing receipt for a different amount would be the worst of the three: the
   * caller would believe money it never received had been recorded.
   *
   * The scope comparison is not belt-and-braces. `uq_receipts_idempotency` is
   * `(tenant_id, idempotency_key)` — tenant-wide — so two branches sharing a key
   * collide, and without this the second branch would be handed the first's receipt.
   */
  private assertReplayMatches(
    existing: ReceiptRow,
    input: RecordPaymentInput,
    amount: Decimal,
    currencyCode: string
  ): void {
    if (existing.deletedAt !== null) {
      throw new AppFailure('ERR-INT-001', {
        message:
          'That idempotency key belongs to a receipt that is no longer available. Use a new key.',
      });
    }
    if (existing.companyId !== input.companyId || existing.branchId !== input.branchId) {
      throw new AppFailure('ERR-INT-001', {
        message:
          'That idempotency key already recorded a receipt in a different company or branch. ' +
          'Reuse a key only for an identical request.',
      });
    }
    if (!Decimal.fromDatabase(existing.amount, MONEY).equals(amount)) {
      throw new AppFailure('ERR-INT-001', {
        message:
          'That idempotency key already recorded a different amount. Reuse a key only for an ' +
          'identical request.',
      });
    }
    if (existing.currencyCode !== currencyCode) {
      throw new AppFailure('ERR-INT-001', {
        message:
          'That idempotency key already recorded a receipt in a different currency. Reuse a ' +
          'key only for an identical request.',
      });
    }
    if (
      existing.paymentMethodId !== input.paymentMethodId ||
      existing.payerPartnerId !== input.payerPartnerId
    ) {
      throw new AppFailure('ERR-INT-001', {
        message:
          'That idempotency key already recorded a different payment method or payer. Reuse a ' +
          'key only for an identical request.',
      });
    }
  }

  private toReceiptView(receipt: ReceiptRow, replayed: boolean): ReceiptView {
    return {
      id: receipt.id,
      reference: receipt.receiptNumber,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      paymentMethodId: receipt.paymentMethodId,
      payerPartnerId: receipt.payerPartnerId,
      money: moneyView(receipt.amount, receipt.currencyCode),
      status: receipt.status,
      receivedAt: receipt.receivedAt.toISOString(),
      recordVersion: receipt.recordVersion,
      replayed,
    };
  }
}
