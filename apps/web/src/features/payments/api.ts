'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type { PaymentAllocateBody, PaymentRecordBody } from '@/lib/contracts/payments-contract';
import type { BranchOption } from '@/features/services/services-contract';
import type { Outstanding } from '@/features/billing/billing-contract';
import type {
  Allocation,
  PaymentMethod,
  Receipt,
  ReceiptDetail,
  ReceiptStatus,
  RecordedReceipt,
} from './payments-contract';

/**
 * The payment adapters (P1-30, `W7`, FE-016/017/018/021).
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application. This file turns operations into view states and does no
 * arithmetic: every amount is passed through as the string the server sent, and
 * a receipt's remainder is READ BACK from the database, never derived by
 * subtracting an allocation from a total.
 *
 * ## The reads take a branch as their TARGET
 *
 * `sal.receipt-list` is `scope: 'branch'` and its route makes `companyId` and
 * `branchId` REQUIRED query fields: they are the read's target, re-authorized
 * server-side, and travel through `branchTargetQuery`. The route's docblock
 * names the reason — `iam.allowed_branch_ids()` is the permission-blind union
 * of every grant, so an optional pair would let finance view in one branch read
 * another branch's cash. `sal.receipt-detail` names its receipt in the path and
 * takes no query. `sal.payment-method-list` is tenant-wide and takes neither.
 *
 * ## Neither write is version-guarded, and no `If-Match` is ever sent
 *
 * `sal.payment-record` and `sal.payment-allocate` declare no version guard.
 * Nothing here sends `If-Match` — a present but malformed one would be refused
 * (428) even though the operation ignores a valid one. A refused allocation is
 * therefore a BOUND, not a stale version: the receipt's remainder and the
 * invoice's open balance are recomputed under row locks and compared exactly,
 * and exceeding either is a 409 the screen states as such.
 *
 * ## One transport key per opened form
 *
 * Both writes are idempotent, so the transport attaches the key this call
 * carries. A retry under the SAME key is answered by the transport with the
 * STORED body at status 200 — which means the flag inside it is the one first
 * written (`replayed: false`), and a screen must never read a replay from the
 * fact that it reused a key. The same key with a different body is refused
 * (409). `replayed` exists only on the record echo; an allocation has no such
 * field at all.
 */

/** A write that creates or returns something the screen must then hold on to. */
export type CreateOutcome<T> = {
  readonly state: ActionState;
  /** The row on success, `null` on any other outcome. */
  readonly created: T | null;
};

/** The filters `sal.receipt-list` accepts beyond its target. No date range exists. */
export interface ReceiptCriteria {
  readonly payerPartnerId: string | null;
  readonly status: ReceiptStatus | null;
  readonly invoiceId: string | null;
}

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

const expired = (attempt: number): ActionState => ({
  status: 'expired',
  messageKey: 'state.expired.title',
  attempt,
});

const receiptPath = (paymentId: string, suffix = '') =>
  `/api/v1/payments/${encodeURIComponent(paymentId)}${suffix}`;

/** The receipts of ONE branch (`sal.receipt-list`), newest received first. */
export async function listReceipts(
  target: BranchTarget,
  criteria: ReceiptCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Receipt>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };
  const result = await client.get<CursorPage<Receipt>>(
    '/api/v1/payments' +
      branchTargetQuery(target, {
        payerPartnerId: criteria.payerPartnerId,
        status: criteria.status,
        invoiceId: criteria.invoiceId,
        cursor,
        limit: request.pageSize,
      })
  );
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
  };
}

/**
 * One receipt and its allocation history (`sal.receipt-detail`). The history is
 * capped at a hundred rows by the read itself, which publishes
 * `allocationsTruncated` rather than pretending the list is whole; no route
 * pages past it.
 */
export async function readReceipt(paymentId: string): Promise<ReadState<ReceiptDetail>> {
  return readOperation<ReceiptDetail>(receiptPath(paymentId));
}

/**
 * The payment methods this tenant may cite (`sal.payment-method-list`).
 *
 * Gated by `sal.payment.record` — a WRITE code for a reference read, recorded
 * as a least-privilege gap in the P1-30 read-surface matrix — so a caller who
 * may see a receipt cannot necessarily resolve its method. Every platform row
 * arrives with `recordable: false`: a receipt's foreign key pairs the tenant
 * with the method, and a platform row has no tenant, so none can ever be cited.
 */
export async function listPaymentMethods(): Promise<ReadState<ItemsOnly<PaymentMethod>>> {
  return readOperation<ItemsOnly<PaymentMethod>>('/api/v1/payment-methods');
}

/**
 * The tenant's branches (`org.branch-list`), for the target picker; its refusal
 * is its own. A caller who may not read one types the pair instead — the screen
 * never renders an empty picker that would claim the tenant has no branches.
 */
export async function listBranches(): Promise<ReadState<ItemsOnly<BranchOption>>> {
  return readOperation<ItemsOnly<BranchOption>>('/api/v1/org/branches');
}

/**
 * The open balance of one invoice (`sal.invoice-outstanding-read`), read after
 * an allocation because the allocation's own echo does not carry it. Requires
 * `sal.finance.view` alone — the code this screen is already gated on — so a
 * cashier who may not open the invoice detail can still see what remains owed.
 */
export async function readOutstanding(invoiceId: string): Promise<ReadState<Outstanding>> {
  return readOperation<Outstanding>(
    `/api/v1/invoices/${encodeURIComponent(invoiceId)}/outstanding`
  );
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Record money received (`sal.payment-record`). Not version-guarded.
 * `idempotencyKey` is the transport key for THIS form: pressing again after a
 * lost answer replays the stored answer (status 200, the same receipt and its
 * same reference) instead of taking the money twice. The echo names the method
 * by id and carries no remainder — the screen re-reads the receipt for that.
 */
export async function recordPayment(
  body: PaymentRecordBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<RecordedReceipt>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<RecordedReceipt>('POST', '/api/v1/payments', body, {
    idempotencyKey,
  });
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('payments.record.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Apply part or all of a receipt to one issued invoice (`sal.payment-allocate`).
 * Not version-guarded and NOT reversible: the allocation table takes inserts
 * only and no route undoes a row. The echo carries the receipt's state after
 * the database re-summed it and the remainder it recomputed, but NOT the
 * invoice's new balance, which the screen reads separately.
 */
export async function allocatePayment(
  paymentId: string,
  body: PaymentAllocateBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<Allocation>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<Allocation>(
    'POST',
    receiptPath(paymentId, '/allocations'),
    body,
    { idempotencyKey }
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('payments.allocate.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}
