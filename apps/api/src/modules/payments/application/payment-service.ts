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
import { withBusinessRefusal } from '@/server/audit/business-refusals';
import { assertMinorUnitScale } from '@/server/http/validation';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE, sqlState } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import { billingModule } from '@/modules/billing';
import { Decimal, DecimalError, MONEY, assertCurrencyCode, moneyView } from '@/modules/pricing';
import type { MoneyView } from '@/modules/pricing';
import {
  PAYMENT_SQLSTATE,
  type PaymentAllocationRow,
  type PaymentsRepository,
  type ReceiptRow,
  type ReceiptScope,
  type ThirdPartyStatement,
} from '../data/payments-repository';
import { reversalRefusalToken } from './receipt-reversal-service';
import {
  PaymentRuleError,
  RECEIPT_REVERSAL_RULES,
  THIRD_PARTY_PERMISSION,
  THIRD_PARTY_RULES,
  assertAllocatable,
  assertAllocationCurrencyCoherent,
  assertAllocationWithinBounds,
  assertPaymentMethodIsTenantScoped,
  assertPaymentMethodUsable,
  parsePaymentAmount,
  thirdPartyViolations,
  type ThirdPartyDeclaration,
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
  /**
   * The party the invoice bills — its customer (`sal.invoices.payer_partner_id`).
   * Compared with the receipt's payer (ADR-023 D14): a different party is refused
   * unless the allocation is an explicit third-party one.
   */
  readonly payerPartnerId: string;
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
      readonly payerPartnerId: string;
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
  /**
   * The reversed receipt this one replaces (ADR-023 D4), or `null` for an
   * ordinary receipt. Set only by `sal.receipt-replacement-record`.
   */
  readonly replacesReceiptId: string | null;
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
  /**
   * The third-party detail (ADR-023 D14) when the receipt's payer settled another
   * customer's invoice, else `null`. The payer and the customer are unchanged
   * either way; what is left on the receipt stays the payer's.
   */
  readonly thirdParty: AllocationThirdPartyView | null;
}

/** What a third-party allocation recorded (ADR-023 D14). */
export interface AllocationThirdPartyView {
  /** `insurer`, `employer` or `other` — a fixed vocabulary. */
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly reason: string;
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

/**
 * What a replacement receipt is recorded from (ADR-023 D4): everything an ordinary
 * receipt is, except the company and branch, which are the reversed receipt's own.
 */
export type RecordReplacementInput = Omit<RecordPaymentInput, 'companyId' | 'branchId'>;

/** The reversed receipt a replacement names, as the write path holds it. */
interface Replacing {
  readonly receiptId: string;
  readonly receiptNumber: string;
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
  /**
   * The request's `Idempotency-Key`, stored on the allocation as its business key
   * (P1-32-PRE-OD-FIN, M-09). A repeat of the key answers with the allocation it
   * already made; a key reused for another receipt, invoice or amount is refused.
   */
  readonly idempotencyKey?: string | undefined;
  /**
   * Present only to make a THIRD-PARTY allocation (ADR-023 D14): the receipt's
   * payer settles an invoice whose customer is somebody else — an insurer, an
   * employer. Without it such an allocation is refused; with it, it needs
   * `sal.payment.third_party` in the receipt's company and branch.
   */
  readonly thirdParty?: ThirdPartyDeclaration | undefined;
}

/**
 * The third-party statement as it is stored and compared: the relationship as
 * sent, the reference and the reason without surrounding spaces. One form, so a
 * repeated key compares the very values the first request booked.
 */
function normaliseThirdParty(declaration: ThirdPartyDeclaration): ThirdPartyStatement {
  return {
    relationship: declaration.relationship,
    authorisationReference: declaration.authorisationReference.trim(),
    reason: declaration.reason.trim(),
  };
}

/** The view of an allocation's stored third-party detail, or `null` for an ordinary one. */
function thirdPartyViewOf(row: PaymentAllocationRow): AllocationThirdPartyView | null {
  if (
    typeof row.thirdPartyRelationship !== 'string' ||
    typeof row.thirdPartyAuthorisationReference !== 'string' ||
    typeof row.thirdPartyReason !== 'string'
  ) {
    return null;
  }
  return {
    relationship: row.thirdPartyRelationship,
    authorisationReference: row.thirdPartyAuthorisationReference,
    reason: row.thirdPartyReason,
  };
}

/**
 * The refusal of an allocation to another customer's invoice that is not a
 * third-party allocation (ADR-023 D14), named on the invoice the request chose and
 * recorded once (D12). The invoice stays its customer's; nothing was booked.
 */
function payerMismatch(receiptId: string, cause?: unknown): AppFailure {
  return withBusinessRefusal(
    new AppFailure('ERR-TRN-001', {
      message:
        'That invoice belongs to a different customer from the one who paid this receipt. ' +
        'It can be paid from this receipt only as a third-party payment.',
      safeDetails: {
        violations: [{ path: 'body.invoiceId', rule: THIRD_PARTY_RULES.payerMismatch }],
      },
      ...(cause === undefined ? {} : { cause }),
    }),
    { entityType: 'sal.receipt', entityId: receiptId, rule: THIRD_PARTY_RULES.payerMismatch }
  );
}

/**
 * The refusal of a third-party allocation by a caller who does not hold
 * `sal.payment.third_party` in the receipt's company and branch (ADR-023 D14),
 * recorded once (D12). The same uniform authorization answer as any other.
 */
function thirdPartyPermissionMissing(receiptId: string, cause?: unknown): AppFailure {
  return withBusinessRefusal(
    new AppFailure('ERR-IAM-001', {
      message: 'Denied sal.payment-allocate: a third-party allocation needs its own authority',
      safeDetails: { requiredPermissions: [THIRD_PARTY_PERMISSION] },
      ...(cause === undefined ? {} : { cause }),
    }),
    { entityType: 'sal.receipt', entityId: receiptId, rule: THIRD_PARTY_RULES.permissionMissing }
  );
}

/** The field a payer-rule token from the database names, for the ones a caller can fix. */
const THIRD_PARTY_FIELD_OF_TOKEN: Readonly<Record<string, string>> = Object.freeze({
  [THIRD_PARTY_RULES.samePayer]: 'body.thirdParty',
  [THIRD_PARTY_RULES.relationshipInvalid]: 'body.thirdParty.relationship',
  [THIRD_PARTY_RULES.referenceRequired]: 'body.thirdParty.authorisationReference',
  [THIRD_PARTY_RULES.otherUnexplained]: 'body.thirdParty.reason',
  [THIRD_PARTY_RULES.reasonRequired]: 'body.thirdParty.reason',
  [THIRD_PARTY_RULES.currencyMismatch]: 'body.currencyCode',
});

/** The token before the first colon of a payer-rule refusal, or `null` for anything else. */
function payerRuleToken(error: unknown): string | null {
  if (
    !isSqlState(error, SQLSTATE.checkViolation) &&
    !isSqlState(error, SQLSTATE.insufficientPrivilege)
  ) {
    return null;
  }
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? (error as { message?: unknown }).message
      : undefined;
  const token = /^([a-z_]+):/.exec(typeof message === 'string' ? message : '')?.[1] ?? null;
  return token !== null && (Object.values(THIRD_PARTY_RULES) as string[]).includes(token)
    ? token
    : null;
}

/**
 * The rule an over-allocation is recorded under (ADR-023, D12): more than the
 * receipt has left, or more than the invoice still has open. One security event
 * per refused attempt, written by the route pipeline after the command rolls
 * back, naming the receipt; the amounts themselves are not recorded, because the
 * rule is all the record needs.
 */
export const OVER_ALLOCATION_RULE = 'payment_over_allocation';

/**
 * Which bound an over-allocation broke, as the token the screen reads from
 * `safeDetails.violations[].rule` on the amount field (P1-32-PRE-OD-FQA, DF-7):
 * more than the receipt has left, or more than the invoice still has open. The
 * token names the bound and nothing else — the figures stay off the answer and
 * off the record; the screen words the refusal with the figures it already shows.
 */
export const OVER_ALLOCATION_BOUNDS = Object.freeze({
  receipt: 'allocation_exceeds_receipt_remaining',
  invoice: 'allocation_exceeds_invoice_open',
} as const);

export type OverAllocationBound = keyof typeof OVER_ALLOCATION_BOUNDS;

/** An `ERR-TRN-001` for an allocation outside its bounds, marked for the record. */
function overAllocation(
  receiptId: string,
  message: string,
  bound: OverAllocationBound
): AppFailure {
  return withBusinessRefusal(
    new AppFailure('ERR-TRN-001', {
      message,
      safeDetails: { violations: [{ path: 'body.amount', rule: OVER_ALLOCATION_BOUNDS[bound] }] },
    }),
    {
      entityType: 'sal.receipt',
      entityId: receiptId,
      rule: OVER_ALLOCATION_RULE,
    }
  );
}

/**
 * The refusal of an allocation while a reversal of the receipt waits for a
 * decision (ADR-023 D4), named on the receipt in the path and recorded (D12).
 */
function pendingReversalBlocks(receiptId: string, cause?: unknown): AppFailure {
  return withBusinessRefusal(
    new AppFailure('ERR-TRN-001', {
      message:
        'This receipt has a reversal waiting for a decision, so no new allocation can be made ' +
        'until the reversal is decided or withdrawn.',
      safeDetails: {
        violations: [
          { path: 'path.paymentId', rule: RECEIPT_REVERSAL_RULES.pendingBlocksAllocation },
        ],
      },
      ...(cause === undefined ? {} : { cause }),
    }),
    {
      entityType: 'sal.receipt',
      entityId: receiptId,
      rule: RECEIPT_REVERSAL_RULES.pendingBlocksAllocation,
    }
  );
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
    return this.record(db, input, authorizeScope, null);
  }

  // -------------------------------------------------------------------------
  // `sal.receipt-replacement-record`
  // -------------------------------------------------------------------------

  /**
   * Records the receipt that replaces a REVERSED one (ADR-023 D4).
   *
   * Every rule of an ordinary receipt applies — the method, the currency, the
   * amount's minor unit, the number sequence — and two more: the receipt it names
   * was reversed by an approved reversal (`receipt_replacement_not_reversed`), and
   * has no replacement yet (`receipt_replacement_exists`). The new receipt is in
   * the reversed receipt's own company and branch, which is why the body names
   * neither. The reversed receipt is locked first, so two replacements of it
   * serialise and the second is refused; `sal.guard_receipt_replacement` and
   * `uq_receipts_replaces` hold both rules in the database too.
   *
   * A repeated key answers the replacement it already recorded, checked BEFORE
   * the "already replaced" rule, which would otherwise refuse the retry of the
   * very replacement it made.
   */
  public async recordReplacement(
    db: DbHandle,
    replacedReceiptId: string,
    input: RecordReplacementInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceiptView> {
    const replaced = await this.repository.findReceiptForUpdate(db, replacedReceiptId);
    if (!replaced || replaced.deletedAt !== null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Receipt ${replacedReceiptId} was not found`,
      });
    }
    const scope = { companyId: replaced.companyId, branchId: replaced.branchId };
    await authorizeScope(scope);
    const replacing: Replacing = { receiptId: replaced.id, receiptNumber: replaced.receiptNumber };
    const full: RecordPaymentInput = { ...input, ...scope };

    if (input.idempotencyKey !== undefined) {
      const existing = await this.repository.findReceiptByIdempotencyKey(db, input.idempotencyKey);
      if (existing) return this.record(db, full, authorizeScope, replacing);
    }

    const entity = { entityType: 'sal.receipt', entityId: replaced.id } as const;
    const reversal = await this.repository.findCurrentReversal(db, replaced.id, scope);
    if (replaced.status !== 'reversed' || reversal?.approvalState !== 'approved') {
      throw withBusinessRefusal(
        new AppFailure('ERR-TRN-001', {
          message: `Receipt ${replaced.id} has no approved reversal, so nothing can replace it.`,
          safeDetails: {
            violations: [
              { path: 'path.paymentId', rule: RECEIPT_REVERSAL_RULES.replacementNotReversed },
            ],
          },
        }),
        { ...entity, rule: RECEIPT_REVERSAL_RULES.replacementNotReversed }
      );
    }
    if (await this.repository.findReplacementOf(db, replaced.id, scope)) {
      throw withBusinessRefusal(
        new AppFailure('ERR-TRN-001', {
          message: `Receipt ${replaced.id} already has a replacement.`,
          safeDetails: {
            violations: [
              { path: 'path.paymentId', rule: RECEIPT_REVERSAL_RULES.replacementExists },
            ],
          },
        }),
        { ...entity, rule: RECEIPT_REVERSAL_RULES.replacementExists }
      );
    }
    return this.record(db, full, authorizeScope, replacing);
  }

  /**
   * The one recording path, for an ordinary receipt (`replacing` null) and for the
   * replacement of a reversed one. See `recordPayment`.
   */
  private async record(
    db: DbHandle,
    input: RecordPaymentInput,
    authorizeScope: ScopeAuthorizer,
    replacing: Replacing | null
  ): Promise<ReceiptView> {
    const amount = parseAmount(input.amount, 'amount');
    const currencyCode = parseCurrency(input.currencyCode, 'currencyCode');
    await this.assertAmountFitsCurrency(db, input.amount, currencyCode, 'body.amount');

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
        if (existing.replacesReceiptId !== (replacing?.receiptId ?? null)) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'That idempotency key already recorded a receipt that replaces a different ' +
              'receipt, or none. Reuse a key only for an identical request.',
          });
        }
        return this.toReceiptView(existing, true, await this.unitsOf(db, existing.currencyCode));
      }
    }

    // After the replay check for the same reason as the method below: a currency
    // withdrawn since a receipt was recorded must not refuse that receipt's retry.
    await this.assertCurrencyRecordable(db, currencyCode);

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
        replacesReceiptId: replacing?.receiptId ?? null,
      });
      receiptId = created.id;
    } catch (error) {
      const token = reversalRefusalToken(error);
      if (
        replacing !== null &&
        (token === RECEIPT_REVERSAL_RULES.replacementNotReversed ||
          token === RECEIPT_REVERSAL_RULES.replacementExists)
      ) {
        // The reversed receipt is locked, so only a row that moved between the
        // checks above and the insert reaches here; refused and recorded the same way.
        throw withBusinessRefusal(
          new AppFailure('ERR-TRN-001', {
            message: `Receipt ${replacing.receiptId} cannot take this replacement.`,
            safeDetails: { violations: [{ path: 'path.paymentId', rule: token }] },
            cause: error,
          }),
          { entityType: 'sal.receipt', entityId: replacing.receiptId, rule: token }
        );
      }
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
      action: replacing === null ? 'sal.receipt.recorded' : 'sal.receipt.replacement_recorded',
      entityType: 'sal.receipt',
      entityId: receipt.id,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      requestRef: replacing === null ? 'sal.payment-record' : 'sal.receipt-replacement-record',
      details: [
        ...(replacing === null
          ? []
          : [
              {
                field: 'replacesReceiptId',
                classification: 'internal' as const,
                value: replacing.receiptId,
              },
              {
                field: 'replacesReceiptNumber',
                classification: 'internal' as const,
                value: replacing.receiptNumber,
              },
            ]),
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
        payerPartnerId: receipt.payerPartnerId,
        paymentMethodId: receipt.paymentMethodId,
        paymentMethodKind: method.kind,
        // No amount, no currency and no receipt number, for the same reason
        // `invoice.created` carries none (see billing/invoice-service.ts): the
        // amount column is classified `restricted` and gated by
        // `sal.finance.view` plus company/branch scope, whereas the outbox's only
        // runtime SELECT policy is `sel_event_outbox_producer`, whose qualifier is
        // `tenant_id = iam.current_tenant_id()` — no permission predicate and no
        // scope predicate at all. Carrying money here would publish it past its
        // own RLS policy to every reader in the tenant.
        //
        // No settlement reference and no credential of any kind appears here,
        // because none exists to appear.
        receivedAt: receipt.receivedAt.toISOString(),
      },
    });

    return this.toReceiptView(receipt, false, await this.unitsOf(db, receipt.currencyCode));
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

    // 2a. A repeated business key is answered BEFORE any state or bound is
    //     re-evaluated, under the receipt lock just taken: the allocation already
    //     happened, and re-checking the bounds would refuse a retry of an
    //     allocation that consumed the whole receipt as an over-allocation. The key
    //     is tenant-wide, so a found allocation for another receipt, invoice or
    //     amount is a reused key and is refused, never replayed (M-09).
    if (input.idempotencyKey !== undefined) {
      const prior = await this.repository.findAllocationByIdempotencyKey(db, input.idempotencyKey);
      if (prior) {
        const stated =
          input.thirdParty === undefined ? null : normaliseThirdParty(input.thirdParty);
        if (
          prior.receiptId !== receipt.id ||
          prior.invoiceId !== input.invoiceId ||
          !Decimal.fromDatabase(prior.amount, MONEY).equals(amount) ||
          prior.currencyCode !== declaredCurrency ||
          (prior.thirdPartyRelationship ?? null) !== (stated?.relationship ?? null) ||
          (prior.thirdPartyAuthorisationReference ?? null) !==
            (stated?.authorisationReference ?? null) ||
          (prior.thirdPartyReason ?? null) !== (stated?.reason ?? null)
        ) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'That idempotency key already booked a different allocation. Reuse a key only ' +
              'for an identical request.',
          });
        }
        return this.allocationView(db, prior.id, receipt.id, scope);
      }
    }

    // 2b. A receipt with a reversal waiting for a decision takes no new allocation
    //     (ADR-023 D4): an approval must never reverse an allocation it did not see.
    //     Under the receipt lock just taken, which a reversal request also takes, so
    //     the answer cannot race a request. `sal.guard_allocation_receipt_open`
    //     refuses the insert in the database as well.
    const reversal = await this.repository.findCurrentReversal(db, receipt.id, scope);
    if (reversal?.approvalState === 'pending') {
      throw pendingReversalBlocks(receipt.id);
    }

    // Checked against the RECEIPT's currency, which is the stored record rather than the
    // request's claim about it. A half-cent allocation is refused here rather than
    // leaving a residue on the invoice that no tenderable payment can ever settle.
    await this.assertAmountFitsCurrency(db, input.amount, receipt.currencyCode, 'body.amount');

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

    // 6a. The payer (ADR-023 D14). The receipt's payer and the invoice's customer
    //     are the same party, or the allocation is an explicit third-party one: by
    //     a holder of `sal.payment.third_party` in the receipt's company and branch,
    //     naming the relationship, the authorisation and the reason. Refused by
    //     default, and recorded. `sal.guard_allocation_payer` holds the same rules
    //     in the database for whoever writes the row; this names each refusal.
    const thirdParty = await this.resolveThirdParty(db, receipt, invoice, input.thirdParty);

    // 7. Bounds, by exact decimal comparison. Never `Number`, never a subtraction in
    //    TypeScript: both remainders were computed by PostgreSQL in `numeric` and are
    //    only ever compared here.
    const remaining = await this.repository.receiptUnallocated(db, receipt.id, scope);
    if (!remaining) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'Receipt remainder read returned no row for a locked receipt',
      });
    }
    const receiptRemaining = Decimal.fromDatabase(remaining.unallocated, MONEY);
    try {
      assertAllocationWithinBounds(
        amount,
        receiptRemaining,
        Decimal.fromDatabase(invoice.openReceivable, MONEY)
      );
    } catch (error) {
      if (error instanceof PaymentRuleError) {
        // The receipt's bound is checked first, as `assertAllocationWithinBounds` does.
        throw overAllocation(
          receipt.id,
          error.message,
          amount.greaterThan(receiptRemaining) ? 'receipt' : 'invoice'
        );
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
        db.context.correlationId,
        input.idempotencyKey ?? null,
        thirdParty
      );
      allocationId = created.id;
    } catch (error) {
      const payerToken = payerRuleToken(error);
      if (payerToken === THIRD_PARTY_RULES.payerMismatch) throw payerMismatch(receipt.id, error);
      if (payerToken === THIRD_PARTY_RULES.permissionMissing) {
        throw thirdPartyPermissionMissing(receipt.id, error);
      }
      if (payerToken !== null) {
        // The rows were read under the receipt lock, so only a change between the
        // checks above and the insert reaches here: named on its field, as above.
        throw new AppFailure('ERR-VAL-001', {
          message: 'The third-party detail of this allocation does not hold',
          safeDetails: {
            violations: [
              { path: THIRD_PARTY_FIELD_OF_TOKEN[payerToken] ?? 'body', rule: payerToken },
            ],
          },
          cause: error,
        });
      }
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
      if (reversalRefusalToken(error) === RECEIPT_REVERSAL_RULES.pendingBlocksAllocation) {
        throw pendingReversalBlocks(receipt.id, error);
      }
      // The primitive's own bounds, re-checked under its locks: another allocation
      // against the same invoice can land between the pre-check above and this
      // call. The same refusal, recorded the same way.
      const exceeded =
        isSqlState(error, SQLSTATE.checkViolation) && error instanceof Error
          ? /exceeds (receipt unallocated|invoice open receivable)/.exec(error.message)
          : null;
      if (exceeded) {
        throw overAllocation(
          receipt.id,
          'Allocating a payment was refused: the amount exceeds what the receipt or the invoice has left',
          exceeded[1] === 'receipt unallocated' ? 'receipt' : 'invoice'
        );
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

    // A third-party allocation is audited as such, in the same transaction (ADR-023
    // D14): who paid, whose invoice it is, what the payer is to the customer, the
    // authorisation and the reason. The authorising user is the actor of this record
    // and was stamped on the row from the session by `sal.guard_allocation_payer`.
    const recorded = thirdPartyViewOf(allocation);
    if (recorded !== null) {
      await appendAudit(db, {
        action: 'sal.payment.third_party_allocated',
        entityType: 'sal.payment_allocation',
        entityId: allocation.id,
        companyId: allocation.companyId,
        branchId: allocation.branchId,
        requestRef: 'sal.payment-allocate',
        details: [
          { field: 'amount', classification: 'restricted', value: allocation.amount },
          { field: 'currency', classification: 'public', value: allocation.currencyCode },
          { field: 'receiptId', classification: 'internal', value: allocation.receiptId },
          { field: 'invoiceId', classification: 'internal', value: allocation.invoiceId },
          {
            field: 'receiptPayerPartnerId',
            classification: 'internal',
            value: receipt.payerPartnerId,
          },
          {
            field: 'invoicePayerPartnerId',
            classification: 'internal',
            value: invoice.payerPartnerId,
          },
          { field: 'relationship', classification: 'internal', value: recorded.relationship },
          {
            field: 'authorisationReference',
            classification: 'internal',
            value: recorded.authorisationReference,
          },
          { field: 'reason', classification: 'internal', value: recorded.reason },
        ],
      });
    }

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
        // The allocated amount and the receipt's unallocated remainder are both
        // withheld for the reason given on `receipt.recorded` above. The remainder
        // is the stronger case of the two: `sal.receipt_unallocated()` is
        // SECURITY INVOKER, so a reader without `sal.finance.view` cannot compute
        // it by any legitimate query — publishing it here would hand out a derived
        // financial position that RLS exists to withhold.
        //
        // `receiptStatus` stays: it is the lifecycle value a consumer needs to know
        // the aggregate moved, it is classified `internal` rather than
        // `restricted`, and it states no figure.
        receiptStatus: after.status,
      },
    });

    const units = await this.repository.minorUnitsFor(db, [
      allocation.currencyCode,
      remainder.currencyCode,
    ]);
    return {
      id: allocation.id,
      sequence: allocation.seq,
      receiptId: allocation.receiptId,
      invoiceId: allocation.invoiceId,
      companyId: allocation.companyId,
      branchId: allocation.branchId,
      money: moneyView(allocation.amount, allocation.currencyCode, units),
      allocatedAt: allocation.allocatedAt.toISOString(),
      receiptStatus: after.status,
      receiptUnallocated: moneyView(remainder.unallocated, remainder.currencyCode, units),
      thirdParty: thirdPartyViewOf(allocation),
    };
  }

  /**
   * The payer rule of an allocation (ADR-023 D14), and the third-party statement it
   * books, or `null` for an ordinary allocation.
   *
   * Same party: nothing to state, and a statement is refused on its field — an
   * allocation to the customer's own invoice is not a third-party payment. A
   * different party without a statement: refused and recorded
   * (`allocation_payer_mismatch`). With a statement: the caller must hold
   * `sal.payment.third_party` in the RECEIPT's company and branch — the scope the
   * receipt was taken in, which the invoice shares (step 4) — refused and recorded
   * otherwise; then every field that does not hold is named at once, so the screen
   * can mark each.
   */
  private async resolveThirdParty(
    db: DbHandle,
    receipt: ReceiptRow,
    invoice: AllocationInvoiceHeader,
    declaration: ThirdPartyDeclaration | undefined
  ): Promise<ThirdPartyStatement | null> {
    if (receipt.payerPartnerId === invoice.payerPartnerId) {
      if (declaration !== undefined) {
        throw new AppFailure('ERR-VAL-001', {
          message:
            'This invoice belongs to the customer who paid the receipt, so it is not a ' +
            'third-party payment.',
          safeDetails: {
            violations: [{ path: 'body.thirdParty', rule: THIRD_PARTY_RULES.samePayer }],
          },
        });
      }
      return null;
    }
    if (declaration === undefined) throw payerMismatch(receipt.id);
    const allowed = await callerHoldsPermission(db, THIRD_PARTY_PERMISSION, {
      companyId: receipt.companyId,
      branchId: receipt.branchId,
    });
    if (!allowed) throw thirdPartyPermissionMissing(receipt.id);
    const violations = thirdPartyViolations(declaration);
    if (violations.length > 0) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The third-party detail of this allocation is incomplete',
        safeDetails: {
          violations: violations.map((violation) => ({
            path: `body.thirdParty.${violation.field}`,
            rule: violation.rule,
          })),
        },
      });
    }
    return normaliseThirdParty(declaration);
  }

  /**
   * The allocation a repeated key already made, as the first answer described it.
   *
   * No audit record and no event: the command happened once, and both were written
   * then. The receipt's status and remainder are read as they stand now, because
   * those are the database's current answer rather than a figure this service keeps.
   */
  private async allocationView(
    db: DbHandle,
    allocationId: string,
    receiptId: string,
    scope: ReceiptScope
  ): Promise<AllocationView> {
    const allocation = await this.repository.findAllocation(db, allocationId, scope);
    const after = await this.repository.findReceipt(db, receiptId);
    const remainder = await this.repository.receiptUnallocated(db, receiptId, scope);
    /* c8 ignore next 5 -- the receipt is held FOR UPDATE and allocations are append-only. */
    if (!allocation || !after || !remainder) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'An allocation or its receipt vanished while answering a repeated key',
      });
    }
    const units = await this.repository.minorUnitsFor(db, [
      allocation.currencyCode,
      remainder.currencyCode,
    ]);
    return {
      id: allocation.id,
      sequence: allocation.seq,
      receiptId: allocation.receiptId,
      invoiceId: allocation.invoiceId,
      companyId: allocation.companyId,
      branchId: allocation.branchId,
      money: moneyView(allocation.amount, allocation.currencyCode, units),
      allocatedAt: allocation.allocatedAt.toISOString(),
      receiptStatus: after.status,
      receiptUnallocated: moneyView(remainder.unallocated, remainder.currencyCode, units),
      thirdParty: thirdPartyViewOf(allocation),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers.
  // -------------------------------------------------------------------------

  /**
   * Refuses a receipt in a currency the platform does not offer (M-09).
   *
   * A receipt's currency is frozen once recorded (`sal.guard_receipt_freeze`) and an
   * allocation must match the invoice's, so a mistyped code makes money that can
   * never be applied and never be corrected. An unknown code and a WITHDRAWN one
   * (`shared.currencies.status = 'inactive'`) are both refused here, on the currency
   * field, before anything is written; `sal.guard_receipt_currency_active` refuses
   * the same insert in the database. Only the NEW receipt is checked: allocating a
   * receipt recorded before its currency was withdrawn stays possible.
   */
  private async assertCurrencyRecordable(db: DbHandle, currency: string): Promise<void> {
    const found = await this.repository.findCurrency(db, currency);
    if (!found || found.status !== 'active') {
      throw new AppFailure('ERR-VAL-001', {
        message: `Currency ${currency} is not a supported currency.`,
        safeDetails: { violations: [{ path: 'body.currency', rule: 'unknown_currency' }] },
      });
    }
  }

  /**
   * Refuses an amount more precise than its currency.
   *
   * The money columns are `numeric(18,4)` and the boundary regex accepts four decimals
   * for every currency, but USD and EUR have two minor units and JOD has three
   * (`shared.currencies.minor_unit`). The database will not catch this: a fifth decimal
   * is rounded away silently on the cast, and the fourth is stored exactly, so nothing
   * downstream ever objects to a half-cent.
   */
  private async assertAmountFitsCurrency(
    db: DbHandle,
    rawAmount: string,
    currency: string,
    path: string
  ): Promise<void> {
    const minorUnit = await this.repository.minorUnitForCurrency(db, currency);
    if (minorUnit === null) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Currency ${currency} is not a supported currency.`,
        safeDetails: { violations: [{ path, rule: 'unknown_currency' }] },
      });
    }
    assertMinorUnitScale(rawAmount, currency, minorUnit, path);
  }

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
      payerPartnerId: detail.invoice.payerPartnerId,
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

  /**
   * The minor unit of a currency, so an echo states how many decimals its amounts
   * are written with, as the reads do (Owner decision D1).
   */
  private unitsOf(db: DbHandle, currencyCode: string): Promise<ReadonlyMap<string, number>> {
    return this.repository.minorUnitsFor(db, [currencyCode]);
  }

  private toReceiptView(
    receipt: ReceiptRow,
    replayed: boolean,
    units: ReadonlyMap<string, number>
  ): ReceiptView {
    return {
      id: receipt.id,
      reference: receipt.receiptNumber,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      paymentMethodId: receipt.paymentMethodId,
      payerPartnerId: receipt.payerPartnerId,
      money: moneyView(receipt.amount, receipt.currencyCode, units),
      status: receipt.status,
      receivedAt: receipt.receivedAt.toISOString(),
      recordVersion: receipt.recordVersion,
      replacesReceiptId: receipt.replacesReceiptId,
      replayed,
    };
  }
}
