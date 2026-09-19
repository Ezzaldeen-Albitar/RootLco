'use server';

import { authorizedClient } from '@/lib/api/server-client';
import {
  branchTargetQuery,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ReadState,
} from '@/lib/api/read-operation';
import type {
  CounterSaleCreateBody,
  InvoiceCancelBody,
  InvoiceCreateBody,
} from '@/lib/contracts/billing-contract';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type {
  CreatedInvoice,
  Invoice,
  InvoiceDetail,
  InvoicePreview,
  InvoiceStatus,
  IssuedInvoice,
  Outstanding,
  VoidedInvoice,
  WorkOrderInvoice,
} from './billing-contract';

/**
 * The invoice adapters (P1-30, `W6`, FE-014/015/019/020).
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application. This file turns operations into view states and does
 * no arithmetic: every amount is passed through as the string the server sent.
 *
 * ## Every read names its subject in the path
 *
 * The four reads take a work order or an invoice in the path and no query at
 * all; the parent row is the authorization target, re-checked server-side.
 * There is no invoice list to page.
 *
 * ## The two guarded writes
 *
 * `issueInvoice` and `cancelInvoice` REQUIRE `ifMatch`: the INVOICE's
 * `recordVersion` as `sal.invoice-detail` published it — never a line's, never
 * defaulted, never cached across a write. A stale version is a 409 the screen
 * renders as "changed since it was read" before re-reading; a missing one is a
 * 428 the pipeline refuses before the handler runs. Both are idempotent, so the
 * transport attaches the header key. Under the CURRENT version, issuing an
 * already-issued invoice and cancelling an already-cancelled one echo
 * `replayed: true`; every other off-draft state is refused (409). Issue sends
 * no body. After either, the screen re-reads — the echo carries the new
 * version, but the detail is the record.
 */

/** A write that creates or returns something the screen must then hold on to. */
export type CreateOutcome<T> = {
  readonly state: ActionState;
  /** The row on success, `null` on any other outcome. */
  readonly created: T | null;
};

const expired = (attempt: number): ActionState => ({
  status: 'expired',
  messageKey: 'state.expired.title',
  attempt,
});

const workOrderPath = (workOrderId: string, suffix: string) =>
  `/api/v1/work-orders/${encodeURIComponent(workOrderId)}${suffix}`;
const invoicePath = (invoiceId: string, suffix = '') =>
  `/api/v1/invoices/${encodeURIComponent(invoiceId)}${suffix}`;

/** The live invoice of a work order, or `null` when it has none (`sal.work-order-invoice-read`). */
export async function readWorkOrderInvoice(
  workOrderId: string
): Promise<ReadState<WorkOrderInvoice>> {
  return readOperation<WorkOrderInvoice>(workOrderPath(workOrderId, '/invoice'));
}

/**
 * What the accepted quotation revision would bill (`sal.invoice-preview`).
 * Money-bearing: the route requires `sal.finance.view`. A work order with no
 * accepted revision answers 404, which the screen states as that, never as an
 * empty preview.
 */
export async function readInvoicePreview(workOrderId: string): Promise<ReadState<InvoicePreview>> {
  return readOperation<InvoicePreview>(workOrderPath(workOrderId, '/invoice-preview'));
}

/** The invoice and its lines (`sal.invoice-detail`); `recordVersion` is what issue and cancel carry. */
export async function readInvoice(invoiceId: string): Promise<ReadState<InvoiceDetail>> {
  return readOperation<InvoiceDetail>(invoicePath(invoiceId));
}

/** The open receivable as the database computes it (`sal.invoice-outstanding-read`; `sal.finance.view` alone). */
export async function readOutstanding(invoiceId: string): Promise<ReadState<Outstanding>> {
  return readOperation<Outstanding>(invoicePath(invoiceId, '/outstanding'));
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Create the draft invoice of a work order (`sal.invoice-create`). Not
 * version-guarded. `idempotencyKey` is the transport key for THIS attempt: the
 * form holds one per opened form, so pressing again after a lost answer
 * replays the stored answer (status 200, the same invoice) instead of being
 * refused as a second invoice. A stored replay carries `replayed: false`; the
 * server sets `replayed: true` only when the SAME key reaches the service
 * again and finds the invoice that key already created; a NEW key against a
 * work order with a live invoice is refused as a conflict (409), which the
 * screen answers by re-reading the order's invoice.
 */
export async function createInvoice(
  body: InvoiceCreateBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<CreatedInvoice>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<CreatedInvoice>('POST', '/api/v1/invoices', body, {
    idempotencyKey,
  });
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('invoices.create.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Issue a draft (`sal.invoice-issue`): allocates the number. No body; `ifMatch`
 * is the INVOICE's `recordVersion` from the detail read, required.
 */
export async function issueInvoice(
  invoiceId: string,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<IssuedInvoice>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<IssuedInvoice>(
    'POST',
    invoicePath(invoiceId, '/issuance'),
    undefined,
    {
      ifMatch,
    }
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('invoices.issue.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Void a draft before issue (`sal.invoice-cancel`). `ifMatch` is the INVOICE's
 * `recordVersion` from the detail read, required. Frees the work order for a
 * new invoice.
 */
export async function cancelInvoice(
  invoiceId: string,
  body: InvoiceCancelBody,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<VoidedInvoice>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<VoidedInvoice>(
    'POST',
    invoicePath(invoiceId, '/cancellation'),
    body,
    { ifMatch }
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('invoices.cancel.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/* ------------------------------------------------------------------ *
 * P1-32 — counter sales.
 *
 * A counter sale is an INVOICE with no work order, so it is listed, issued,
 * settled and credited through the surface above rather than a second one. Only
 * the two acts that are peculiar to it live here: listing a branch's counter
 * sales, and creating the draft. The screen that calls them is the inventory
 * feature's `CounterSalesScreen`, because what an operator is doing is selling
 * STOCK; `issueInvoice` and `cancelInvoice` above are the same functions the
 * work-order screen uses, and there is no second copy of either.
 * ------------------------------------------------------------------ */

/**
 * A branch's counter sales (`sal.counter-sale-list`), newest first.
 *
 * Branch-targeted: `companyId` and `branchId` are the read's TARGET, demanded by
 * the route and re-authorized server-side, so they travel through
 * `branchTargetQuery` rather than among the filters. One page of the route's own
 * maximum; the caller reads `hasMore` rather than assuming the branch fitted.
 */
export async function listCounterSales(
  target: BranchTarget,
  filter: { readonly status?: InvoiceStatus | undefined } = {}
): Promise<ReadState<CursorPage<Invoice>>> {
  return readOperation<CursorPage<Invoice>>(
    '/api/v1/counter-sales' +
      branchTargetQuery(target, { status: filter.status ?? null, limit: 50 })
  );
}

/**
 * Draft a counter sale (`sal.counter-sale-create`).
 *
 * The body names the buyer and the lines and NOTHING else — no price, no total,
 * no tax, no discount — because the route refuses a body carrying one rather
 * than dropping it, and every figure is computed inside the database from the
 * item's configured selling price. An item with no configured price refuses the
 * whole sale rather than selling at zero, which the screen states as that.
 *
 * `idempotencyKey` is the transport key for THIS confirmation: a counter runs on
 * scans, and a doubled frame or a lost answer must replay the first draft rather
 * than open a second one. A fresh draft answers 201, a replay 200 with
 * `replayed: true`; both are `ok` to the transport, and the screen tells them
 * apart from the body.
 *
 * Nothing moves yet. The stock leaves the shelf at ISSUANCE.
 */
export async function createCounterSale(
  body: CounterSaleCreateBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<CreatedInvoice>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<CreatedInvoice>('POST', '/api/v1/counter-sales', body, {
    idempotencyKey,
  });
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('invoices.counterSale.create.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}
