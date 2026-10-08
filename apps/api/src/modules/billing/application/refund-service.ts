/**
 * Refund requests (ADR-023 D2, part 2, P1-32-PRE-OD-FD2B) — `sal.refund-request`,
 * `sal.refund-approve`, `sal.refund-reject`, `sal.refund-withdraw`,
 * `sal.refund-execute`, `sal.refund-request-list` and `sal.refund-request-detail`.
 *
 * A refund obligation (part 1, `sal.refund_obligations`) records that a customer is
 * owed money back. Nothing pays it automatically. A payment recorder REQUESTS that
 * (part of) it be paid back; a DIFFERENT person holding `sal.refund.approve` approves
 * or rejects the request; the requester may withdraw it while it waits; and once it
 * is approved, a payment recorder RECORDS the payout — its reference, its day and
 * the approved method — exactly once. When what has been paid out on an obligation
 * reaches its amount, the obligation is settled.
 *
 * ## Two people, and a separate payout
 *
 * Requesting, withdrawing and recording the payout declare `sal.payment.record`;
 * approving and rejecting declare `sal.refund.approve`, which no other code
 * satisfies. Every operation also declares `sal.finance.view`, whose whole-row gate
 * covers both refund tables. Every rule is held twice: here first, so the refusal
 * names its rule (recorded after the rollback, ADR-023 D12), and in the database
 * (`sal.guard_refund_request_insert`, `sal.guard_refund_request_update`), so a raw
 * statement is held to it as well. A token the database raises for a rule this
 * service also checks is translated to the same refusal.
 *
 * ## Not accounting
 *
 * The payout's `refund_executed` row of `sal.financial_events` is an operational
 * fact like every row of that table — no account, no posting, no ledger, no cash or
 * bank movement. Accounting waits on the accounting questionnaire.
 *
 * ## Locks
 *
 * The obligation is locked before the request, on every path — the order the
 * database primitives take — so a request, a decision and a payout on one
 * obligation serialise instead of deadlocking.
 *
 * ## Arithmetic
 *
 * None in JavaScript. What is still owed is computed by PostgreSQL in `numeric`, and
 * every comparison of two amounts is the database's.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { withBusinessRefusal, withPermissionRefusal } from '@/server/audit/business-refusals';
import { isSqlState, sqlState, SQLSTATE, violatedConstraint } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { assertMinorUnitScale } from '@/server/http/validation';
import { moneyView, type MoneyView } from '@/modules/pricing';
import { iamDirectory } from '@/modules/iam';
import {
  REFUND_REQUEST_ORDER,
  type RefundMethodRow,
  type RefundObligationHeadRow,
  type RefundRepository,
  type RefundRequestRow,
} from '../data/refund-repository';
import { BILLING_SQLSTATE } from '../data/billing-repository';
import {
  BillingRuleError,
  MAX_PAYOUT_REFERENCE,
  MAX_REFUND_REASON,
  REFUND_PERMISSIONS,
  REFUND_RULES,
  parseInstrumentAmount,
  refundRequestState,
  type RefundRequestState,
} from '../domain/billing';

/** The method a refund is paid by, named. */
export interface RefundMethodView {
  readonly id: string;
  /** `cash`, `card_terminal` or `bank_transfer` (`ck_payment_methods_kind`). */
  readonly kind: string;
  readonly displayName: string;
}

/** A refund request as every refund command and read reports it. */
export interface RefundRequestView {
  readonly id: string;
  readonly obligationId: string;
  readonly invoiceId: string;
  /** The invoice's number; `null` when its header is not readable to the caller. */
  readonly invoiceNumber: string | null;
  /** The invoice's work order — where its screen is opened — or `null` (a counter sale). */
  readonly workOrderId: string | null;
  readonly companyId: string;
  readonly branchId: string;
  /** Who is paid: the obligation's customer. */
  readonly payeePartnerId: string;
  /** `pending`, `approved`, `executed` (paid out), `rejected` or `withdrawn`. */
  readonly state: RefundRequestState;
  readonly amount: MoneyView;
  /** `null` only when the tenant's method row is not readable. */
  readonly paymentMethod: RefundMethodView | null;
  readonly reason: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  /** The approver of an approved request, else the person who rejected or withdrew it. */
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Why it was rejected; `null` on every other state. */
  readonly decisionReason: string | null;
  /** Who recorded the payout, and when; `null` until it is recorded. */
  readonly executedBy: string | null;
  readonly executedAt: string | null;
  readonly payoutReference: string | null;
  /** The payout day as `YYYY-MM-DD`. */
  readonly payoutDate: string | null;
  readonly recordVersion: number;
}

/** Where an obligation stands after the request's command (ADR-023 D2). */
export interface RefundObligationPositionView {
  readonly id: string;
  /** `open` or `settled`. */
  readonly state: string;
  readonly amount: MoneyView;
  /** What has been paid out on it. */
  readonly paidOut: MoneyView;
  /** Its amount less what has been paid out. */
  readonly stillOwed: MoneyView;
  readonly recordVersion: number;
}

/** A refund command's answer: the request, the obligation, and whether it had happened already. */
export interface RefundRequestResult {
  readonly refundRequest: RefundRequestView;
  readonly obligation: RefundObligationPositionView;
  /** True when the request was already in the state the command asked for. */
  readonly replayed: boolean;
}

/**
 * One refund request read by id: the request, its obligation's position and the
 * people on it by NAME. Each name is `null` for a caller who may not read users —
 * resolved through `iamDirectory().directory`, which checks `iam.user.read` itself —
 * and the ids stay beside them, so a screen can tell whose request it is.
 */
export interface RefundRequestDetailView extends RefundRequestView {
  readonly requestedByName: string | null;
  readonly decidedByName: string | null;
  readonly executedByName: string | null;
  readonly obligation: RefundObligationPositionView;
}

type Entity =
  | { readonly type: 'sal.refund_obligation'; readonly id: string }
  | { readonly type: 'sal.refund_request'; readonly id: string };

/** The message of a driver error, or `undefined`. */
function driverMessage(error: unknown): string | undefined {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? (error as { message?: unknown }).message
      : undefined;
  return typeof message === 'string' ? message : undefined;
}

/** The token a refund guard or primitive raised before the first colon, or `null`. */
export function refundRefusalToken(error: unknown): string | null {
  if (
    !isSqlState(error, SQLSTATE.checkViolation) &&
    !isSqlState(error, SQLSTATE.insufficientPrivilege) &&
    !isSqlState(error, SQLSTATE.foreignKeyViolation)
  ) {
    return null;
  }
  const token = /^([a-z_]+):/.exec(driverMessage(error) ?? '')?.[1] ?? null;
  return token !== null && token.startsWith('refund_') ? token : null;
}

/** The one-live-request index: a second live request lost a race. */
const LIVE_REQUEST_INDEX = 'uq_refund_requests_obligation_live';

/**
 * Throws an `ERR-TRN-001` naming `rule` on `path`, marked as a refusal by business
 * rule so the pipeline records it after the rollback (D12).
 */
function refuse(
  entity: Entity,
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

/** A field error, never recorded as a refusal: it is the request that is malformed. */
function fieldError(path: string, rule: string, message: string, cause?: unknown): never {
  throw new AppFailure('ERR-VAL-001', {
    message,
    safeDetails: { violations: [{ path, rule }] },
    ...(cause === undefined ? {} : { cause }),
  });
}

/** A required text, trimmed, within `max` characters, or a field error on `path`. */
function requireText(value: string, max: number, path: string, what: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0)
    fieldError(path, 'too_small', `${what} is required and must not be blank`);
  if (trimmed.length > max)
    fieldError(path, 'too_big', `${what} must be at most ${max} characters`);
  return trimmed;
}

/** Everything else a primitive refused, in the controlled catalogue. */
function toDomainFailure(error: unknown, what: string): never {
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a refund invariant`,
      cause: error,
    });
  }
  if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
    throw new AppFailure('ERR-IAM-001', {
      message: `${what} was refused: the operation requires a permission or scope this caller lacks`,
      cause: error,
    });
  }
  if (sqlState(error) === BILLING_SQLSTATE.noDataFound) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names a refund obligation or request that is not in scope`,
      cause: error,
    });
  }
  throw error;
}

/** A refusal the database decided for want of a permission, recorded as one (D12 extension). */
function permissionRefused(error: unknown, what: string, code: string, branchId: string): never {
  throw withPermissionRefusal(
    new AppFailure('ERR-IAM-001', {
      message: `${what} was refused: the caller lacks the permission in this scope`,
      cause: error,
    }),
    { source: 'database', missing: [code], branchId }
  );
}

const METHOD_UNREADABLE = null;

export class RefundService {
  public constructor(private readonly repository: RefundRepository) {}

  // -------------------------------------------------------------------------
  // `sal.refund-request`
  // -------------------------------------------------------------------------

  /**
   * A payment recorder asks for (part of) an obligation to be paid back, by a
   * method and with a reason. The obligation is locked and its own scope
   * authorized. A repeated key answers the request it raised (`replayed: true`, no
   * second record). An obligation that is not open, one that already has a live
   * request, an amount above what is still owed on it and a method that is not an
   * active method of the organisation are refused by name.
   */
  public async requestRefund(
    db: DbHandle,
    obligationId: string,
    input: {
      readonly amount: string;
      readonly paymentMethodId: string;
      readonly reason: string;
      readonly idempotencyKey?: string | undefined;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<RefundRequestResult> {
    const reason = requireText(input.reason, MAX_REFUND_REASON, 'body.reason', 'A reason');
    try {
      parseInstrumentAmount(input.amount);
    } catch (error) {
      /* c8 ignore next -- parseInstrumentAmount throws only BillingRuleError. */
      if (!(error instanceof BillingRuleError)) throw error;
      fieldError('body.amount', 'too_small', 'A refund is an amount above zero', error);
    }
    const obligation = await this.lockObligation(db, obligationId);
    await authorizeScope({ companyId: obligation.companyId, branchId: obligation.branchId });

    if (input.idempotencyKey !== undefined) {
      const prior = await this.repository.findRequestByIdempotencyKey(db, input.idempotencyKey);
      if (prior) {
        if (prior.obligationId !== obligation.id) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'That idempotency key already raised a refund request on another obligation. ' +
              'Reuse a key only for an identical request.',
          });
        }
        return this.result(db, prior, true);
      }
    }

    const units = await this.repository.minorUnitsFor(db, [obligation.currencyCode]);
    const minorUnit = units.get(obligation.currencyCode);
    /* c8 ignore next 3 -- an obligation's currency is a foreign key into shared.currencies. */
    if (minorUnit === undefined) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: an obligation in an unknown currency',
      });
    }
    assertMinorUnitScale(input.amount, obligation.currencyCode, minorUnit, 'body.amount');

    const entity: Entity = { type: 'sal.refund_obligation', id: obligation.id };
    if (obligation.state !== 'open') {
      refuse(
        entity,
        'path.obligationId',
        REFUND_RULES.obligationNotOpen,
        `Refund obligation ${obligation.id} is "${obligation.state}"; only an open obligation is paid back.`
      );
    }
    if (await this.repository.findLiveRequest(db, obligation)) {
      refuse(
        entity,
        'path.obligationId',
        REFUND_RULES.liveExists,
        `Refund obligation ${obligation.id} already has a request waiting for a decision or for its payout.`
      );
    }
    if (!(await this.repository.fitsWithinObligation(db, obligation, input.amount))) {
      refuse(
        entity,
        'body.amount',
        REFUND_RULES.exceedsObligation,
        'The refund is more than is still owed on the obligation.'
      );
    }
    const method = await this.repository.findTenantMethod(db, input.paymentMethodId);
    if (method === null || !method.active) {
      refuse(
        entity,
        'body.paymentMethodId',
        REFUND_RULES.methodUnavailable,
        'The payment method is not an active method of this organisation.'
      );
    }

    let requestId: string;
    try {
      requestId = await this.repository.requestRefund(db, {
        obligationId: obligation.id,
        amount: input.amount,
        paymentMethodId: input.paymentMethodId,
        reason,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    } catch (error) {
      const token = refundRefusalToken(error);
      if (
        token === REFUND_RULES.liveExists ||
        (isSqlState(error, SQLSTATE.uniqueViolation) &&
          violatedConstraint(error) === LIVE_REQUEST_INDEX)
      ) {
        refuse(
          entity,
          'path.obligationId',
          REFUND_RULES.liveExists,
          `Refund obligation ${obligation.id} already has a request waiting for a decision or for its payout.`,
          error
        );
      }
      if (token === REFUND_RULES.obligationNotOpen) {
        refuse(entity, 'path.obligationId', token, 'Only an open obligation is paid back.', error);
      }
      if (token === REFUND_RULES.exceedsObligation) {
        refuse(entity, 'body.amount', token, 'The refund is more than is still owed.', error);
      }
      if (token === REFUND_RULES.methodUnavailable) {
        refuse(entity, 'body.paymentMethodId', token, 'The payment method is not active.', error);
      }
      if (token === REFUND_RULES.requestPermissionMissing) {
        permissionRefused(
          error,
          'Requesting a refund',
          REFUND_PERMISSIONS.request,
          obligation.branchId
        );
      }
      if (token === 'refund_request_reason_required') {
        fieldError('body.reason', 'too_small', 'A reason is required', error);
      }
      if (token === REFUND_RULES.minorUnit) {
        fieldError(
          'body.amount',
          'minor_unit_scale',
          'The amount is finer than the currency',
          error
        );
      }
      if (token === 'refund_request_idempotency_reused') {
        throw new AppFailure('ERR-INT-001', {
          message: 'That idempotency key already raised a refund request on another obligation.',
          cause: error,
        });
      }
      toDomainFailure(error, 'Requesting a refund');
    }

    const created = await this.mustFind(db, requestId);
    await appendAudit(db, {
      action: 'sal.refund_request.requested',
      entityType: 'sal.refund_request',
      entityId: created.id,
      companyId: created.companyId,
      branchId: created.branchId,
      requestRef: 'sal.refund-request',
      details: [
        { field: 'approvalState', classification: 'internal', value: created.approvalState },
        { field: 'obligationId', classification: 'internal', value: created.obligationId },
        { field: 'invoiceId', classification: 'internal', value: created.invoiceId },
        { field: 'paymentMethodId', classification: 'internal', value: created.paymentMethodId },
        { field: 'currency', classification: 'public', value: created.currencyCode },
        { field: 'reason', classification: 'internal', value: created.reason },
        { field: 'amount', classification: 'restricted', value: created.amount },
      ],
    });
    return this.result(db, created, false);
  }

  // -------------------------------------------------------------------------
  // `sal.refund-approve`
  // -------------------------------------------------------------------------

  /**
   * A different person holding `sal.refund.approve` in the obligation's company and
   * branch approves a pending request. Pays nothing: the payout is a separate step.
   * `If-Match` carries the REQUEST's version. A request already approved under the
   * version the caller read answers `replayed: true` with no second record.
   */
  public async approveRefund(
    db: DbHandle,
    requestId: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<RefundRequestResult> {
    const request = await this.lockRequest(db, requestId, expectedVersion, authorizeScope);
    const entity: Entity = { type: 'sal.refund_request', id: request.id };
    if (request.approvalState === 'approved' && request.executedAt === null) {
      return this.result(db, request, true);
    }
    if (request.approvalState !== 'pending') {
      refuse(
        entity,
        'path.requestId',
        request.executedAt === null ? REFUND_RULES.decided : REFUND_RULES.alreadyExecuted,
        `Refund request ${request.id} is decided; its decision is frozen.`
      );
    }
    if (request.requestedBy === db.context.principal.userId) {
      refuse(
        entity,
        'path.requestId',
        REFUND_RULES.selfApproval,
        'The approver of a refund must differ from the person who requested it.'
      );
    }
    try {
      await this.repository.approveRequest(db, request.id);
    } catch (error) {
      this.refuseDecisionFailure(error, entity, 'Approving a refund', request.branchId, 'approve');
    }
    const approved = await this.mustFind(db, request.id);
    await appendAudit(db, {
      action: 'sal.refund_request.approved',
      entityType: 'sal.refund_request',
      entityId: approved.id,
      companyId: approved.companyId,
      branchId: approved.branchId,
      requestRef: 'sal.refund-approve',
      details: [
        {
          field: 'approvalState',
          classification: 'internal',
          previousValue: request.approvalState,
          value: approved.approvalState,
        },
        { field: 'obligationId', classification: 'internal', value: approved.obligationId },
        { field: 'currency', classification: 'public', value: approved.currencyCode },
        { field: 'amount', classification: 'restricted', value: approved.amount },
      ],
    });
    return this.result(db, approved, false);
  }

  // -------------------------------------------------------------------------
  // `sal.refund-reject`
  // -------------------------------------------------------------------------

  /**
   * A different person holding `sal.refund.approve` rejects a pending request, stating
   * why. The obligation stays owed and a corrected request may follow. `If-Match`
   * carries the REQUEST's version.
   */
  public async rejectRefund(
    db: DbHandle,
    requestId: string,
    input: { readonly reason: string },
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<RefundRequestResult> {
    const reason = requireText(input.reason, MAX_REFUND_REASON, 'body.reason', 'A reason');
    const request = await this.lockRequest(db, requestId, expectedVersion, authorizeScope);
    const entity: Entity = { type: 'sal.refund_request', id: request.id };
    if (request.requestedBy === db.context.principal.userId) {
      refuse(
        entity,
        'path.requestId',
        REFUND_RULES.selfRejection,
        'A refund request is rejected by someone other than the person who requested it; ' +
          'the requester withdraws it instead.'
      );
    }
    if (request.approvalState === 'rejected') return this.result(db, request, true);
    if (request.approvalState !== 'pending') {
      refuse(
        entity,
        'path.requestId',
        request.executedAt === null ? REFUND_RULES.decided : REFUND_RULES.alreadyExecuted,
        `Refund request ${request.id} is decided; its decision is frozen.`
      );
    }
    try {
      await this.repository.rejectRequest(db, request.id, reason);
    } catch (error) {
      this.refuseDecisionFailure(error, entity, 'Rejecting a refund', request.branchId, 'reject');
    }
    const rejected = await this.mustFind(db, request.id);
    await appendAudit(db, {
      action: 'sal.refund_request.rejected',
      entityType: 'sal.refund_request',
      entityId: rejected.id,
      companyId: rejected.companyId,
      branchId: rejected.branchId,
      requestRef: 'sal.refund-reject',
      details: [
        {
          field: 'approvalState',
          classification: 'internal',
          previousValue: request.approvalState,
          value: rejected.approvalState,
        },
        { field: 'obligationId', classification: 'internal', value: rejected.obligationId },
        { field: 'decisionReason', classification: 'internal', value: rejected.decisionReason },
        { field: 'currency', classification: 'public', value: rejected.currencyCode },
        { field: 'amount', classification: 'restricted', value: rejected.amount },
      ],
    });
    return this.result(db, rejected, false);
  }

  // -------------------------------------------------------------------------
  // `sal.refund-withdraw`
  // -------------------------------------------------------------------------

  /** The requester withdraws their own pending request. `If-Match` carries its version. */
  public async withdrawRefund(
    db: DbHandle,
    requestId: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<RefundRequestResult> {
    const request = await this.lockRequest(db, requestId, expectedVersion, authorizeScope);
    const entity: Entity = { type: 'sal.refund_request', id: request.id };
    if (request.requestedBy !== db.context.principal.userId) {
      refuse(
        entity,
        'path.requestId',
        REFUND_RULES.notRequester,
        'A refund request can be withdrawn only by the person who requested it.'
      );
    }
    if (request.approvalState === 'withdrawn') return this.result(db, request, true);
    if (request.approvalState !== 'pending') {
      refuse(
        entity,
        'path.requestId',
        request.executedAt === null ? REFUND_RULES.decided : REFUND_RULES.alreadyExecuted,
        `Refund request ${request.id} is decided; its decision is frozen.`
      );
    }
    try {
      await this.repository.withdrawRequest(db, request.id);
    } catch (error) {
      this.refuseDecisionFailure(error, entity, 'Withdrawing a refund', request.branchId, null);
    }
    const withdrawn = await this.mustFind(db, request.id);
    await appendAudit(db, {
      action: 'sal.refund_request.withdrawn',
      entityType: 'sal.refund_request',
      entityId: withdrawn.id,
      companyId: withdrawn.companyId,
      branchId: withdrawn.branchId,
      requestRef: 'sal.refund-withdraw',
      details: [
        {
          field: 'approvalState',
          classification: 'internal',
          previousValue: request.approvalState,
          value: withdrawn.approvalState,
        },
        { field: 'obligationId', classification: 'internal', value: withdrawn.obligationId },
        { field: 'currency', classification: 'public', value: withdrawn.currencyCode },
        { field: 'amount', classification: 'restricted', value: withdrawn.amount },
      ],
    });
    return this.result(db, withdrawn, false);
  }

  // -------------------------------------------------------------------------
  // `sal.refund-execute`
  // -------------------------------------------------------------------------

  /**
   * A payment recorder records the payout of an approved request, once: the
   * reference, the day it was made and the approved method. The database writes
   * the `refund_executed` financial event — an operational fact, not an accounting
   * entry — and settles the obligation when what has been paid out reaches its
   * amount, in this transaction with the audit record. A repeat under the key the
   * payout was recorded with answers it (`replayed: true`) before the version is
   * compared, because the payout itself moved the version; any other repeat is
   * refused (`refund_already_executed`).
   */
  public async executeRefund(
    db: DbHandle,
    requestId: string,
    input: {
      readonly paymentMethodId: string;
      readonly payoutReference: string;
      readonly payoutDate: string;
      readonly idempotencyKey?: string | undefined;
    },
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<RefundRequestResult> {
    const reference = requireText(
      input.payoutReference,
      MAX_PAYOUT_REFERENCE,
      'body.payoutReference',
      'A payout reference'
    );
    const located = await this.repository.findRequest(db, requestId);
    if (!located) {
      throw new AppFailure('ERR-RES-001', { message: `Refund request ${requestId} was not found` });
    }
    const obligation = await this.lockObligation(db, located.obligationId);
    const request = await this.repository.findRequest(db, requestId, true);
    /* c8 ignore next 3 -- the request was found above and rows are never deleted. */
    if (!request) {
      throw new AppFailure('ERR-RES-001', { message: `Refund request ${requestId} was not found` });
    }
    await authorizeScope({ companyId: request.companyId, branchId: request.branchId });
    const entity: Entity = { type: 'sal.refund_request', id: request.id };

    if (request.executedAt !== null) {
      if (
        input.idempotencyKey !== undefined &&
        request.executionIdempotencyKey === input.idempotencyKey
      ) {
        return this.result(db, request, true);
      }
      refuse(
        entity,
        'path.requestId',
        REFUND_RULES.alreadyExecuted,
        `Refund request ${request.id} was paid out already.`
      );
    }
    if (request.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The refund request has changed since it was read; re-read it and retry',
      });
    }
    if (request.approvalState !== 'approved') {
      refuse(
        entity,
        'path.requestId',
        REFUND_RULES.notApproved,
        `Refund request ${request.id} is "${request.approvalState}"; it is paid out only once approved.`
      );
    }
    if (input.paymentMethodId !== request.paymentMethodId) {
      refuse(
        entity,
        'body.paymentMethodId',
        REFUND_RULES.payoutMethodMismatch,
        'A refund is paid out by the method it was approved with.'
      );
    }
    if (input.payoutDate > (await this.repository.today(db))) {
      fieldError(
        'body.payoutDate',
        REFUND_RULES.payoutDateInvalid,
        'A payout states the day it was made, which is not in the future'
      );
    }
    try {
      await this.repository.executeRequest(db, request.id, {
        paymentMethodId: input.paymentMethodId,
        payoutReference: reference,
        payoutDate: input.payoutDate,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: db.context.correlationId,
      });
    } catch (error) {
      const token = refundRefusalToken(error);
      if (token === REFUND_RULES.payoutDateInvalid) {
        fieldError('body.payoutDate', token, 'A payout date is not in the future', error);
      }
      if (token === 'refund_payout_reference_required') {
        fieldError('body.payoutReference', 'too_small', 'A payout reference is required', error);
      }
      if (token === REFUND_RULES.executePermissionMissing) {
        permissionRefused(
          error,
          'Recording a payout',
          REFUND_PERMISSIONS.execute,
          request.branchId
        );
      }
      if (
        token === REFUND_RULES.alreadyExecuted ||
        token === REFUND_RULES.notApproved ||
        token === REFUND_RULES.exceedsObligation ||
        token === REFUND_RULES.payoutMethodMismatch
      ) {
        refuse(
          entity,
          'path.requestId',
          token,
          `Recording the payout was refused by ${token}`,
          error
        );
      }
      toDomainFailure(error, 'Recording a payout');
    }
    const executed = await this.mustFind(db, request.id);
    await appendAudit(db, {
      action: 'sal.refund_request.executed',
      entityType: 'sal.refund_request',
      entityId: executed.id,
      companyId: executed.companyId,
      branchId: executed.branchId,
      requestRef: 'sal.refund-execute',
      details: [
        { field: 'obligationId', classification: 'internal', value: executed.obligationId },
        { field: 'paymentMethodId', classification: 'internal', value: executed.paymentMethodId },
        { field: 'payoutReference', classification: 'internal', value: executed.payoutReference },
        { field: 'payoutDate', classification: 'internal', value: executed.payoutDate },
        { field: 'currency', classification: 'public', value: executed.currencyCode },
        { field: 'amount', classification: 'restricted', value: executed.amount },
      ],
    });
    const after = await this.repository.findObligation(db, obligation.id);
    if (after !== null && after.state !== obligation.state) {
      await appendAudit(db, {
        action: 'sal.refund_obligation.settled',
        entityType: 'sal.refund_obligation',
        entityId: after.id,
        companyId: after.companyId,
        branchId: after.branchId,
        requestRef: 'sal.refund-execute',
        details: [
          {
            field: 'state',
            classification: 'internal',
            previousValue: obligation.state,
            value: after.state,
          },
          { field: 'currencyCode', classification: 'internal', value: after.currencyCode },
          { field: 'amount', classification: 'restricted', value: after.amount },
        ],
      });
    }
    return this.result(db, executed, false);
  }

  // -------------------------------------------------------------------------
  // `sal.refund-request-list` and `sal.refund-request-detail`
  // -------------------------------------------------------------------------

  /**
   * One branch's refund requests, newest first, by customer, invoice, obligation and
   * state. The branch is re-authorized before any row is fetched; RLS narrows again
   * underneath and removes every row from a caller without `sal.finance.view`.
   */
  public async listRefundRequests(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly partnerId?: string | undefined;
      readonly invoiceId?: string | undefined;
      readonly obligationId?: string | undefined;
      readonly state?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<RefundRequestView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listRequests(
      db,
      filter,
      pageRequest(REFUND_REQUEST_ORDER, page)
    );
    const units = await this.repository.minorUnitsFor(
      db,
      result.items.map((row) => row.currencyCode)
    );
    const methods = await this.repository.methodsById(
      db,
      result.items.map((row) => row.paymentMethodId)
    );
    return {
      ...result,
      items: result.items.map((row) => toRefundRequestView(row, units, methods)),
    };
  }

  /** One refund request by id, with its obligation's position and the people on it. */
  public async readRefundRequest(
    db: DbHandle,
    requestId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<RefundRequestDetailView> {
    const request = await this.repository.findRequest(db, requestId);
    if (!request) {
      throw new AppFailure('ERR-RES-001', { message: `Refund request ${requestId} was not found` });
    }
    await authorizeScope({ companyId: request.companyId, branchId: request.branchId });
    const obligation = await this.repository.findObligation(db, request.obligationId);
    /* c8 ignore next 5 -- the obligation is a foreign key of the request, in its scope. */
    if (!obligation) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: a refund request whose obligation is not readable',
      });
    }
    const units = await this.repository.minorUnitsFor(db, [request.currencyCode]);
    const methods = await this.repository.methodsById(db, [request.paymentMethodId]);
    const view = toRefundRequestView(request, units, methods);
    const people = [view.requestedBy, view.decidedBy, view.executedBy].filter(
      (id): id is string => id !== null
    );
    const names = await iamDirectory().directory.resolveDisplayIdentities(db, [...new Set(people)]);
    const nameOf = (id: string | null): string | null =>
      id === null ? null : (names.get(id)?.displayName ?? null);
    return {
      ...view,
      requestedByName: nameOf(view.requestedBy),
      decidedByName: nameOf(view.decidedBy),
      executedByName: nameOf(view.executedBy),
      obligation: toObligationPosition(obligation, units),
    };
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  private async lockObligation(
    db: DbHandle,
    obligationId: string
  ): Promise<RefundObligationHeadRow> {
    const obligation = await this.repository.findObligation(db, obligationId, true);
    if (!obligation) {
      throw new AppFailure('ERR-RES-001', {
        message: `Refund obligation ${obligationId} was not found`,
      });
    }
    return obligation;
  }

  /**
   * Locks the obligation, then the request — the primitives' order — authorizes the
   * request's own scope and compares the caller's `If-Match` with the LOCKED row.
   */
  private async lockRequest(
    db: DbHandle,
    requestId: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<RefundRequestRow> {
    const located = await this.repository.findRequest(db, requestId);
    if (!located) {
      throw new AppFailure('ERR-RES-001', { message: `Refund request ${requestId} was not found` });
    }
    await this.lockObligation(db, located.obligationId);
    const request = await this.repository.findRequest(db, requestId, true);
    /* c8 ignore next 3 -- the request was found above and rows are never deleted. */
    if (!request) {
      throw new AppFailure('ERR-RES-001', { message: `Refund request ${requestId} was not found` });
    }
    await authorizeScope({ companyId: request.companyId, branchId: request.branchId });
    if (request.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The refund request has changed since it was read; re-read it and retry',
      });
    }
    return request;
  }

  /**
   * Translates a refusal a decision primitive or its guard raised. The checks above
   * answer every rule first; a token reaching here means the row moved between the
   * two, and is translated and recorded the same way. A refusal for want of the
   * deciding code is a PERMISSION refusal the database decided (D12 extension).
   */
  private refuseDecisionFailure(
    error: unknown,
    entity: Entity,
    what: string,
    branchId: string,
    deciding: 'approve' | 'reject' | null
  ): never {
    const token = refundRefusalToken(error);
    if (token === 'refund_reject_reason_required') {
      fieldError('body.reason', 'too_small', 'A rejection states why', error);
    }
    if (
      token === REFUND_RULES.selfApproval ||
      token === REFUND_RULES.selfRejection ||
      token === REFUND_RULES.notRequester ||
      token === REFUND_RULES.decided ||
      token === REFUND_RULES.alreadyExecuted
    ) {
      refuse(entity, 'path.requestId', token, `${what} was refused by the rule ${token}`, error);
    }
    if (
      deciding !== null &&
      (token === REFUND_RULES.approvePermissionMissing ||
        token === REFUND_RULES.rejectPermissionMissing ||
        isSqlState(error, SQLSTATE.insufficientPrivilege))
    ) {
      permissionRefused(error, what, REFUND_PERMISSIONS.decide, branchId);
    }
    toDomainFailure(error, what);
  }

  private async mustFind(db: DbHandle, requestId: string): Promise<RefundRequestRow> {
    const row = await this.repository.findRequest(db, requestId);
    /* c8 ignore next 3 -- the row was written or locked in this transaction. */
    if (!row) {
      throw new AppFailure('ERR-SYS-001', { message: 'Refund request vanished after a write' });
    }
    return row;
  }

  private async result(
    db: DbHandle,
    row: RefundRequestRow,
    replayed: boolean
  ): Promise<RefundRequestResult> {
    const units = await this.repository.minorUnitsFor(db, [row.currencyCode]);
    const methods = await this.repository.methodsById(db, [row.paymentMethodId]);
    const obligation = await this.repository.findObligation(db, row.obligationId);
    /* c8 ignore next 5 -- the obligation is a foreign key of the request, in its scope. */
    if (!obligation) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'billing: a refund request whose obligation is not readable',
      });
    }
    return {
      refundRequest: toRefundRequestView(row, units, methods),
      obligation: toObligationPosition(obligation, units),
      replayed,
    };
  }
}

/** The view of a stored request, its method named when the tenant's row is readable. */
export function toRefundRequestView(
  row: RefundRequestRow,
  units: ReadonlyMap<string, number>,
  methods: ReadonlyMap<string, RefundMethodRow>
): RefundRequestView {
  const approved = row.approvalState === 'approved';
  const method = methods.get(row.paymentMethodId);
  return {
    id: row.id,
    obligationId: row.obligationId,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    workOrderId: row.workOrderId,
    companyId: row.companyId,
    branchId: row.branchId,
    payeePartnerId: row.payeePartnerId,
    state: refundRequestState(row.approvalState, row.executedAt),
    amount: moneyView(row.amount, row.currencyCode, units),
    paymentMethod:
      method === undefined
        ? METHOD_UNREADABLE
        : { id: method.id, kind: method.kind, displayName: method.displayName },
    reason: row.reason,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    decidedBy: approved ? row.approvedBy : row.decidedBy,
    decidedAt: (approved ? row.approvedAt : row.decidedAt)?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    executedBy: row.executedBy,
    executedAt: row.executedAt?.toISOString() ?? null,
    payoutReference: row.payoutReference,
    payoutDate: row.payoutDate,
    recordVersion: row.recordVersion,
  };
}

/** Where an obligation stands, in its currency. */
export function toObligationPosition(
  row: RefundObligationHeadRow,
  units: ReadonlyMap<string, number>
): RefundObligationPositionView {
  return {
    id: row.id,
    state: row.state,
    amount: moneyView(row.amount, row.currencyCode, units),
    paidOut: moneyView(row.paidOut, row.currencyCode, units),
    stillOwed: moneyView(row.stillOwed, row.currencyCode, units),
    recordVersion: row.recordVersion,
  };
}
