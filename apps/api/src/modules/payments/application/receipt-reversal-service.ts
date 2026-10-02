/**
 * Receipt reversals (ADR-023 D4, P1-32-PRE-OD-FD4) — `sal.receipt-reversal-request`,
 * `sal.receipt-reversal-approve`, `sal.receipt-reversal-reject` and
 * `sal.receipt-reversal-withdraw`.
 *
 * A mis-recorded receipt — the wrong amount typed, the wrong payer chosen, money
 * applied to the wrong invoice — is corrected by reversing the WHOLE receipt and
 * recording the right one. Nothing on this surface edits or deletes the original:
 * it is retained, its allocations stay recorded, and a reversed receipt simply
 * stops counting (`sal.invoice_open_receivable` already leaves out the
 * allocations of a reversed receipt, so every invoice it paid opens again by
 * exactly what it applied).
 *
 * ## Two people, two codes
 *
 * The request is the payment recorder's act — the code that records a receipt,
 * `sal.payment.record`. The decision is a DIFFERENT person's, under
 * `sal.reversal.approve`, which no credit-note code satisfies. The requester may
 * withdraw their own pending request. Every rule is held twice: here first, so
 * the refusal names its rule, and in the database
 * (`sal.guard_receipt_reversal_request`, `sal.guard_receipt_reversal_decision`),
 * so a raw statement is held to it as well. A token the database raises for a
 * rule this service also checks is translated to the same refusal.
 *
 * ## Not a refund
 *
 * A reversal is bookkeeping. It returns no money and creates no refund and no
 * refund obligation (ADR-023 D2 is a separate decision), and nothing here can.
 *
 * ## Locks
 *
 * The receipt is locked before the reversal, on every path that takes both — the
 * order the database primitives take — so a request, an approval and an
 * allocation of one receipt serialise instead of deadlocking. A withdrawal and a
 * rejection lock the reversal only, which is the first lock an approval takes on
 * the reversal row too: whichever decision comes second finds it decided.
 *
 * ## Arithmetic
 *
 * None. The amount is the receipt's, read by the database under its lock; this
 * service never names one.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { withBusinessRefusal } from '@/server/audit/business-refusals';
import { isSqlState, sqlState, SQLSTATE, violatedConstraint } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import { moneyView, type MoneyView } from '@/modules/pricing';
import {
  PAYMENT_SQLSTATE,
  type PaymentsRepository,
  type ReceiptReversalRow,
  type ReceiptRow,
} from '../data/payments-repository';
import {
  MAX_REVERSAL_REASON,
  RECEIPT_REVERSAL_PERMISSIONS,
  RECEIPT_REVERSAL_RULES,
} from '../domain/payments';

/** A receipt reversal as the four commands and the receipt detail report it. */
export interface ReceiptReversalView {
  readonly id: string;
  readonly receiptId: string;
  readonly companyId: string;
  readonly branchId: string;
  /** `pending`, `approved`, `rejected` or `withdrawn`. */
  readonly state: string;
  /** The whole receipt's amount, in its currency — never a part of it. */
  readonly amount: MoneyView;
  readonly reason: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  /** Who decided: the approver of an approved reversal, else the decider. */
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Why it was rejected; `null` on every other state. */
  readonly decisionReason: string | null;
  /** When the receipt was reversed; set only on an approved reversal. */
  readonly reversedAt: string | null;
  readonly recordVersion: number;
}

/** A command's answer: the reversal, and whether the command had already happened. */
export interface ReceiptReversalResult {
  readonly reversal: ReceiptReversalView;
  /** True when the reversal was already in the state the command asked for. */
  readonly replayed: boolean;
}

export function toReversalView(
  row: ReceiptReversalRow,
  units: ReadonlyMap<string, number>
): ReceiptReversalView {
  const approved = row.approvalState === 'approved';
  return {
    id: row.id,
    receiptId: row.originalReceiptId,
    companyId: row.companyId,
    branchId: row.branchId,
    state: row.approvalState,
    amount: moneyView(row.amount, row.currencyCode, units),
    reason: row.reason,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    decidedBy: approved ? row.approvedBy : row.decidedBy,
    decidedAt: (approved ? row.approvedAt : row.decidedAt)?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    recordVersion: row.recordVersion,
  };
}

/** The message of a driver error, or `undefined`. */
function driverMessage(error: unknown): string | undefined {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? (error as { message?: unknown }).message
      : undefined;
  return typeof message === 'string' ? message : undefined;
}

/** The token a reversal guard raised before the first colon, or `null`. */
export function reversalRefusalToken(error: unknown): string | null {
  if (
    !isSqlState(error, SQLSTATE.checkViolation) &&
    !isSqlState(error, SQLSTATE.insufficientPrivilege) &&
    !isSqlState(error, SQLSTATE.foreignKeyViolation)
  ) {
    return null;
  }
  const token = /^([a-z_]+):/.exec(driverMessage(error) ?? '')?.[1] ?? null;
  return token !== null &&
    (token.startsWith('receipt_reversal_') || token.startsWith('receipt_replacement_'))
    ? token
    : null;
}

/** The live-reversal index: a second pending or approved request lost a race. */
const LIVE_REVERSAL_INDEX = 'uq_receipt_reversals_receipt_live';

/**
 * Throws an `ERR-TRN-001` naming `rule` on the path parameter, marked as a
 * refusal by business rule so the pipeline records it after the rollback (D12).
 */
function refuse(
  entity: { readonly type: 'sal.receipt' | 'sal.receipt_reversal'; readonly id: string },
  path: string,
  rule: string,
  message: string,
  cause?: unknown
): never {
  throw withBusinessRefusal(
    new AppFailure('ERR-TRN-001', {
      message,
      safeDetails: { violations: [{ path, rule }] },
      ...(cause === undefined ? {} : { cause }),
    }),
    { entityType: entity.type, entityId: entity.id, rule }
  );
}

/**
 * Refuses a blank or over-long reason as a field error. Never recorded as a
 * refusal of the receipt: it is the request that is malformed.
 */
function requireReason(reason: string): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length === 0) {
    throw new AppFailure('ERR-VAL-001', {
      message: 'A reason is required and must not be blank',
      safeDetails: { violations: [{ path: 'body.reason', rule: 'too_small' }] },
    });
  }
  if (trimmed.length > MAX_REVERSAL_REASON) {
    throw new AppFailure('ERR-VAL-001', {
      message: `A reason must be at most ${MAX_REVERSAL_REASON} characters`,
      safeDetails: { violations: [{ path: 'body.reason', rule: 'too_big' }] },
    });
  }
  return trimmed;
}

/** Everything else a primitive refused, in the controlled catalogue. */
function toDomainFailure(error: unknown, what: string): never {
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a payment invariant`,
      cause: error,
    });
  }
  if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
    throw new AppFailure('ERR-IAM-001', {
      message: `${what} was refused: the operation requires a permission or scope this caller lacks`,
      cause: error,
    });
  }
  if (sqlState(error) === PAYMENT_SQLSTATE.noDataFound) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names a receipt or reversal that is not in scope`,
      cause: error,
    });
  }
  throw error;
}

export class ReceiptReversalService {
  public constructor(private readonly repository: PaymentsRepository) {}

  // -------------------------------------------------------------------------
  // `sal.receipt-reversal-request`
  // -------------------------------------------------------------------------

  /**
   * A payment recorder asks for the WHOLE receipt to be reversed, stating why.
   *
   * The receipt is locked and its own scope authorized for `sal.payment.record`
   * and `sal.finance.view`. A repeated idempotency key answers the request it
   * already raised (`replayed: true`, no second record) — checked before the
   * version, because the request does not change the receipt and a retry must
   * not be refused for a version that moved for another reason. `If-Match`
   * carries the RECEIPT's version from its detail read, compared with the locked
   * row: an allocation recorded since the screen was read is a conflict the
   * operator answers by reading again. A reversed receipt and one that already has
   * a pending or approved reversal are refused by name. The amount is never the
   * caller's: the database writes the receipt's own.
   */
  public async requestReversal(
    db: DbHandle,
    receiptId: string,
    input: { readonly reason: string; readonly idempotencyKey?: string | undefined },
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceiptReversalResult> {
    const reason = requireReason(input.reason);
    const receipt = await this.lockReceipt(db, receiptId);
    const scope = { companyId: receipt.companyId, branchId: receipt.branchId };
    await this.authorizeRecording(db, receipt, authorizeScope);

    if (input.idempotencyKey !== undefined) {
      const prior = await this.repository.findReversalByIdempotencyKey(db, input.idempotencyKey);
      if (prior) {
        if (prior.originalReceiptId !== receipt.id) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'That idempotency key already raised the reversal of another receipt. Reuse a key ' +
              'only for an identical request.',
          });
        }
        return { reversal: await this.view(db, prior), replayed: true };
      }
    }

    if (receipt.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The receipt has changed since it was read; re-read it and retry',
      });
    }
    const entity = { type: 'sal.receipt', id: receipt.id } as const;
    if (receipt.status === 'reversed') {
      refuse(
        entity,
        'path.paymentId',
        RECEIPT_REVERSAL_RULES.receiptReversed,
        `Receipt ${receipt.id} is already reversed.`
      );
    }
    const current = await this.repository.findCurrentReversal(db, receipt.id, scope);
    if (current && (current.approvalState === 'pending' || current.approvalState === 'approved')) {
      refuse(
        entity,
        'path.paymentId',
        RECEIPT_REVERSAL_RULES.exists,
        `Receipt ${receipt.id} already has a reversal waiting for a decision or approved.`
      );
    }

    let reversalId: string;
    try {
      reversalId = (
        await this.repository.requestReversal(db, receipt.id, reason, input.idempotencyKey ?? null)
      ).id;
    } catch (error) {
      const token = reversalRefusalToken(error);
      if (
        token === RECEIPT_REVERSAL_RULES.exists ||
        token === RECEIPT_REVERSAL_RULES.receiptReversed ||
        (isSqlState(error, SQLSTATE.uniqueViolation) &&
          violatedConstraint(error) === LIVE_REVERSAL_INDEX)
      ) {
        refuse(
          entity,
          'path.paymentId',
          token ?? RECEIPT_REVERSAL_RULES.exists,
          `Receipt ${receipt.id} cannot take another reversal request.`,
          error
        );
      }
      if (token === 'receipt_reversal_reason_required') {
        throw new AppFailure('ERR-VAL-001', {
          message: 'A reason is required, within the permitted length',
          safeDetails: { violations: [{ path: 'body.reason', rule: 'too_small' }] },
          cause: error,
        });
      }
      toDomainFailure(error, 'Requesting a receipt reversal');
    }

    const created = await this.mustFind(db, reversalId);
    await appendAudit(db, {
      action: 'sal.receipt_reversal.requested',
      entityType: 'sal.receipt_reversal',
      entityId: created.id,
      companyId: created.companyId,
      branchId: created.branchId,
      requestRef: 'sal.receipt-reversal-request',
      details: [
        { field: 'approvalState', classification: 'internal', value: created.approvalState },
        { field: 'receiptId', classification: 'internal', value: receipt.id },
        { field: 'receiptNumber', classification: 'internal', value: receipt.receiptNumber },
        { field: 'currency', classification: 'public', value: created.currencyCode },
        { field: 'reason', classification: 'internal', value: created.reason },
        { field: 'amount', classification: 'restricted', value: created.amount },
      ],
    });
    return { reversal: await this.view(db, created), replayed: false };
  }

  // -------------------------------------------------------------------------
  // `sal.receipt-reversal-approve`
  // -------------------------------------------------------------------------

  /**
   * A different person holding `sal.reversal.approve` in the receipt's company and
   * branch approves a pending reversal. Atomic in the database: the reversal is
   * approved, the receipt reversed and one `receipt_reversed` financial event
   * written by `sal.approve_receipt_reversal`, in this transaction with the audit
   * record. Idempotent on an approved reversal: no second record, no second event.
   */
  public async approveReversal(
    db: DbHandle,
    reversalId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceiptReversalResult> {
    const located = await this.repository.findReversal(db, reversalId);
    if (!located) {
      throw new AppFailure('ERR-RES-001', {
        message: `Receipt reversal ${reversalId} was not found in scope`,
      });
    }
    // Receipt first, then the reversal: the primitive's order.
    const receipt = await this.lockReceipt(db, located.originalReceiptId);
    await this.authorizeDeciding(db, located, authorizeScope);
    const reversal = await this.repository.findReversalForUpdate(db, reversalId);
    /* c8 ignore next 5 -- the reversal was found above and rows are never deleted. */
    if (!reversal) {
      throw new AppFailure('ERR-RES-001', {
        message: `Receipt reversal ${reversalId} was not found in scope`,
      });
    }
    const entity = { type: 'sal.receipt_reversal', id: reversal.id } as const;
    if (reversal.approvalState === 'approved') {
      return { reversal: await this.view(db, reversal), replayed: true };
    }
    if (reversal.approvalState !== 'pending') {
      refuse(
        entity,
        'path.reversalId',
        RECEIPT_REVERSAL_RULES.decided,
        `Receipt reversal ${reversal.id} is "${reversal.approvalState}"; a decided reversal is frozen.`
      );
    }
    if (reversal.requestedBy === db.context.principal.userId) {
      refuse(
        entity,
        'path.reversalId',
        RECEIPT_REVERSAL_RULES.selfApproval,
        'The approver of a receipt reversal must differ from the person who requested it.'
      );
    }
    if (receipt.status === 'reversed') {
      refuse(
        entity,
        'path.reversalId',
        RECEIPT_REVERSAL_RULES.receiptReversed,
        `Receipt ${receipt.id} is already reversed.`
      );
    }

    try {
      await this.repository.approveReversal(db, reversal.id, db.context.correlationId);
    } catch (error) {
      this.refuseDecisionFailure(error, entity, 'Approving a receipt reversal');
    }

    const approved = await this.mustFind(db, reversal.id);
    const after = await this.repository.findReceipt(db, receipt.id);
    await appendAudit(db, {
      action: 'sal.receipt_reversal.approved',
      entityType: 'sal.receipt_reversal',
      entityId: approved.id,
      companyId: approved.companyId,
      branchId: approved.branchId,
      requestRef: 'sal.receipt-reversal-approve',
      details: [
        {
          field: 'approvalState',
          classification: 'internal',
          previousValue: reversal.approvalState,
          value: approved.approvalState,
        },
        { field: 'receiptId', classification: 'internal', value: receipt.id },
        { field: 'receiptNumber', classification: 'internal', value: receipt.receiptNumber },
        {
          field: 'receiptStatus',
          classification: 'internal',
          previousValue: receipt.status,
          value: after?.status ?? null,
        },
        { field: 'currency', classification: 'public', value: approved.currencyCode },
        { field: 'amount', classification: 'restricted', value: approved.amount },
      ],
    });
    return { reversal: await this.view(db, approved), replayed: false };
  }

  // -------------------------------------------------------------------------
  // `sal.receipt-reversal-reject`
  // -------------------------------------------------------------------------

  /**
   * A different person holding `sal.reversal.approve` rejects a pending reversal,
   * stating why. The receipt is untouched and keeps counting. `If-Match` carries
   * the REVERSAL's version. Idempotent on a rejected reversal.
   */
  public async rejectReversal(
    db: DbHandle,
    reversalId: string,
    input: { readonly reason: string },
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceiptReversalResult> {
    const reason = requireReason(input.reason);
    const reversal = await this.lockReversal(db, reversalId, expectedVersion, authorizeScope, true);
    const entity = { type: 'sal.receipt_reversal', id: reversal.id } as const;
    if (reversal.requestedBy === db.context.principal.userId) {
      refuse(
        entity,
        'path.reversalId',
        RECEIPT_REVERSAL_RULES.selfRejection,
        'A receipt reversal is rejected by someone other than the person who requested it; ' +
          'the requester withdraws it instead.'
      );
    }
    if (reversal.approvalState === 'rejected') {
      return { reversal: await this.view(db, reversal), replayed: true };
    }
    if (reversal.approvalState !== 'pending') {
      refuse(
        entity,
        'path.reversalId',
        RECEIPT_REVERSAL_RULES.decided,
        `Receipt reversal ${reversal.id} is "${reversal.approvalState}"; a decided reversal is frozen.`
      );
    }
    try {
      await this.repository.rejectReversal(db, reversal.id, reason);
    } catch (error) {
      this.refuseDecisionFailure(error, entity, 'Rejecting a receipt reversal');
    }
    const rejected = await this.mustFind(db, reversal.id);
    await appendAudit(db, {
      action: 'sal.receipt_reversal.rejected',
      entityType: 'sal.receipt_reversal',
      entityId: rejected.id,
      companyId: rejected.companyId,
      branchId: rejected.branchId,
      requestRef: 'sal.receipt-reversal-reject',
      details: [
        {
          field: 'approvalState',
          classification: 'internal',
          previousValue: reversal.approvalState,
          value: rejected.approvalState,
        },
        { field: 'receiptId', classification: 'internal', value: rejected.originalReceiptId },
        { field: 'decisionReason', classification: 'internal', value: rejected.decisionReason },
        { field: 'currency', classification: 'public', value: rejected.currencyCode },
        { field: 'amount', classification: 'restricted', value: rejected.amount },
      ],
    });
    return { reversal: await this.view(db, rejected), replayed: false };
  }

  // -------------------------------------------------------------------------
  // `sal.receipt-reversal-withdraw`
  // -------------------------------------------------------------------------

  /**
   * The requester withdraws their own pending reversal (D3 parity). Nobody else
   * may. The receipt is untouched. `If-Match` carries the REVERSAL's version.
   * Idempotent for the requester on a withdrawn reversal.
   */
  public async withdrawReversal(
    db: DbHandle,
    reversalId: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceiptReversalResult> {
    const reversal = await this.lockReversal(
      db,
      reversalId,
      expectedVersion,
      authorizeScope,
      false
    );
    const entity = { type: 'sal.receipt_reversal', id: reversal.id } as const;
    if (reversal.requestedBy !== db.context.principal.userId) {
      refuse(
        entity,
        'path.reversalId',
        RECEIPT_REVERSAL_RULES.notRequester,
        'A receipt reversal can be withdrawn only by the person who requested it.'
      );
    }
    if (reversal.approvalState === 'withdrawn') {
      return { reversal: await this.view(db, reversal), replayed: true };
    }
    if (reversal.approvalState !== 'pending') {
      refuse(
        entity,
        'path.reversalId',
        RECEIPT_REVERSAL_RULES.decided,
        `Receipt reversal ${reversal.id} is "${reversal.approvalState}"; a decided reversal is frozen.`
      );
    }
    try {
      await this.repository.withdrawReversal(db, reversal.id);
    } catch (error) {
      this.refuseDecisionFailure(error, entity, 'Withdrawing a receipt reversal');
    }
    const withdrawn = await this.mustFind(db, reversal.id);
    await appendAudit(db, {
      action: 'sal.receipt_reversal.withdrawn',
      entityType: 'sal.receipt_reversal',
      entityId: withdrawn.id,
      companyId: withdrawn.companyId,
      branchId: withdrawn.branchId,
      requestRef: 'sal.receipt-reversal-withdraw',
      details: [
        {
          field: 'approvalState',
          classification: 'internal',
          previousValue: reversal.approvalState,
          value: withdrawn.approvalState,
        },
        { field: 'receiptId', classification: 'internal', value: withdrawn.originalReceiptId },
        { field: 'currency', classification: 'public', value: withdrawn.currencyCode },
        { field: 'amount', classification: 'restricted', value: withdrawn.amount },
      ],
    });
    return { reversal: await this.view(db, withdrawn), replayed: false };
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  private async lockReceipt(db: DbHandle, receiptId: string): Promise<ReceiptRow> {
    const receipt = await this.repository.findReceiptForUpdate(db, receiptId);
    if (!receipt || receipt.deletedAt !== null) {
      throw new AppFailure('ERR-RES-001', { message: `Receipt ${receiptId} was not found` });
    }
    return receipt;
  }

  /**
   * Locks a reversal for a rejection or a withdrawal, authorizes its own scope and
   * compares the caller's `If-Match` with the LOCKED row. A rejection records a
   * caller who lacks the deciding code in that scope as a refusal (D12).
   */
  private async lockReversal(
    db: DbHandle,
    reversalId: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer,
    deciding: boolean
  ): Promise<ReceiptReversalRow> {
    const reversal = await this.repository.findReversalForUpdate(db, reversalId);
    if (!reversal) {
      throw new AppFailure('ERR-RES-001', {
        message: `Receipt reversal ${reversalId} was not found in scope`,
      });
    }
    if (deciding) {
      await this.authorizeDeciding(db, reversal, authorizeScope, true);
    } else {
      await authorizeScope({ companyId: reversal.companyId, branchId: reversal.branchId });
    }
    if (reversal.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The receipt reversal has changed since it was read; re-read it and retry',
      });
    }
    return reversal;
  }

  /**
   * Authorizes the receipt's own company and branch for a request, and records a
   * caller who lacks `sal.payment.record` THERE as a refusal (D12). The answer is
   * the uniform authorization denial either way.
   */
  private async authorizeRecording(
    db: DbHandle,
    receipt: ReceiptRow,
    authorizeScope: ScopeAuthorizer
  ): Promise<void> {
    const scope = { companyId: receipt.companyId, branchId: receipt.branchId };
    try {
      await authorizeScope(scope);
    } catch (failure) {
      if (
        failure instanceof AppFailure &&
        failure.code === 'ERR-IAM-001' &&
        !(await callerHoldsPermission(db, RECEIPT_REVERSAL_PERMISSIONS.request, scope))
      ) {
        withBusinessRefusal(failure, {
          entityType: 'sal.receipt',
          entityId: receipt.id,
          rule: RECEIPT_REVERSAL_RULES.requestPermissionMissing,
        });
      }
      throw failure;
    }
  }

  /**
   * Authorizes the reversal's own company and branch for a decision, and records a
   * caller who lacks `sal.reversal.approve` THERE — holding it elsewhere, or
   * holding only the credit-note codes — as a refusal (D12). The answer is the
   * uniform authorization denial either way.
   */
  private async authorizeDeciding(
    db: DbHandle,
    reversal: ReceiptReversalRow,
    authorizeScope: ScopeAuthorizer,
    rejecting = false
  ): Promise<void> {
    const scope = { companyId: reversal.companyId, branchId: reversal.branchId };
    try {
      await authorizeScope(scope);
    } catch (failure) {
      if (
        failure instanceof AppFailure &&
        failure.code === 'ERR-IAM-001' &&
        !(await callerHoldsPermission(db, RECEIPT_REVERSAL_PERMISSIONS.decide, scope))
      ) {
        withBusinessRefusal(failure, {
          entityType: 'sal.receipt_reversal',
          entityId: reversal.id,
          rule: rejecting
            ? RECEIPT_REVERSAL_RULES.rejectPermissionMissing
            : RECEIPT_REVERSAL_RULES.approvePermissionMissing,
        });
      }
      throw failure;
    }
  }

  /**
   * Translates a refusal a decision primitive or its guard raised. The checks above
   * answer every rule first; a token reaching here means the row moved between the
   * two, and is translated and recorded the same way.
   */
  private refuseDecisionFailure(
    error: unknown,
    entity: { readonly type: 'sal.receipt_reversal'; readonly id: string },
    what: string
  ): never {
    const token = reversalRefusalToken(error);
    if (token === 'receipt_reversal_reject_reason_required') {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A rejection states why, within the permitted length',
        safeDetails: { violations: [{ path: 'body.reason', rule: 'too_small' }] },
        cause: error,
      });
    }
    if (
      token === RECEIPT_REVERSAL_RULES.selfApproval ||
      token === RECEIPT_REVERSAL_RULES.selfRejection ||
      token === RECEIPT_REVERSAL_RULES.notRequester ||
      token === RECEIPT_REVERSAL_RULES.decided ||
      token === RECEIPT_REVERSAL_RULES.receiptReversed
    ) {
      refuse(entity, 'path.reversalId', token, `${what} was refused by the rule ${token}`, error);
    }
    if (
      token === RECEIPT_REVERSAL_RULES.approvePermissionMissing ||
      token === RECEIPT_REVERSAL_RULES.rejectPermissionMissing
    ) {
      throw withBusinessRefusal(
        new AppFailure('ERR-IAM-001', {
          message: `${what} was refused: the decider lacks the permission in this scope`,
          cause: error,
        }),
        { entityType: entity.type, entityId: entity.id, rule: token }
      );
    }
    toDomainFailure(error, what);
  }

  private async mustFind(db: DbHandle, reversalId: string): Promise<ReceiptReversalRow> {
    const row = await this.repository.findReversal(db, reversalId);
    /* c8 ignore next 5 -- the row was written or locked in this transaction. */
    if (!row) {
      throw new AppFailure('ERR-SYS-001', { message: 'Receipt reversal vanished after a write' });
    }
    return row;
  }

  private async view(db: DbHandle, row: ReceiptReversalRow): Promise<ReceiptReversalView> {
    return toReversalView(row, await this.repository.minorUnitsFor(db, [row.currencyCode]));
  }
}
