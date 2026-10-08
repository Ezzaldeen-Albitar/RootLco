'use server';

import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ReadState,
} from '@/lib/api/read-operation';
import type {
  CounterSaleCreateBody,
  CreditNoteCreateBody,
  CreditNoteRejectBody,
  InvoiceCancelBody,
  InvoiceCreateBody,
  RefundExecuteBody,
  RefundRejectBody,
  RefundRequestBody,
} from '@/lib/contracts/billing-contract';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type {
  CreatedInvoice,
  CreditNote,
  CreditNoteDetail,
  CreditNoteEcho,
  CreditNoteState,
  Invoice,
  InvoiceDetail,
  InvoiceListEntry,
  InvoicePreview,
  InvoiceStatus,
  IssuedInvoice,
  Outstanding,
  RefundObligation,
  RefundRequest,
  RefundRequestDetail,
  RefundRequestEcho,
  RefundRequestState,
  SaleKind,
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
 * ## Every read names its subject in the path — except the branch list
 *
 * The four reads take a work order or an invoice in the path and no query at
 * all; the parent row is the authorization target, re-checked server-side.
 * `listInvoices` is the one exception: it names a company AND a branch in the
 * query, which the server takes as the authorization target (Owner directive,
 * `P1-32-PRE-OD-UX`).
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
  messageKey: 'state.expired.message',
  attempt,
});

const workOrderPath = (workOrderId: string, suffix: string) =>
  `/api/v1/work-orders/${encodeURIComponent(workOrderId)}${suffix}`;
const invoicePath = (invoiceId: string, suffix = '') =>
  `/api/v1/invoices/${encodeURIComponent(invoiceId)}${suffix}`;

/**
 * The live invoices of a work order (`sal.work-order-invoice-read`): the one to act
 * on (`null` when it has none), every live one, and whether approved work remains
 * to invoice (ADR-023 D5/D15).
 */
export async function readWorkOrderInvoice(
  workOrderId: string
): Promise<ReadState<WorkOrderInvoice>> {
  return readOperation<WorkOrderInvoice>(workOrderPath(workOrderId, '/invoice'));
}

/**
 * What a new invoice would bill now (`sal.invoice-preview`): the approved
 * quotation lines no live invoice holds yet, each at what remains of it, and every
 * other line of the revision with why it is left off (ADR-023 D5/D15).
 * Money-bearing: the route requires `sal.finance.view`. A work order with no
 * approved line answers 404, which the screen states as that, never as an
 * empty preview.
 */
/**
 * A preview read, carrying the rule a refused one names (P1-32-PRE-OD-FRX).
 *
 * `rule` is the FIRST violation's rule token of a refusal, or `null`. A 409 on
 * the preview is never an outage: the work order cannot be invoiced as it
 * stands, and the rule says why (`invoice_source_ambiguous` for two quotations
 * with approved work, `invoice_nothing_to_bill` when nothing remains on any of
 * them). The screen turns a known rule into its own sentence.
 */
export type InvoicePreviewRead = ReadState<InvoicePreview> & { readonly rule?: string | null };

export async function readInvoicePreview(workOrderId: string): Promise<InvoicePreviewRead> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };
  const result = await client.get<InvoicePreview>(workOrderPath(workOrderId, '/invoice-preview'));
  if (result.ok) {
    return { status: 'ok', data: result.data, correlationId: result.correlationId };
  }
  return {
    status: STATUS_BY_KIND[result.kind],
    correlationId: result.correlationId,
    rule: result.kind === 'conflict' ? refusalRuleOf(result.problem) : null,
  };
}

/** The first violation's rule token of a problem, or `null` when it names none. */
function refusalRuleOf(
  problem: { readonly violations?: readonly { readonly rule?: unknown }[] } | null | undefined
): string | null {
  const rule = problem?.violations?.[0]?.rule;
  return typeof rule === 'string' && rule.length > 0 ? rule : null;
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
 * work order with an open draft, or with nothing approved left to invoice, is
 * refused as a conflict (409), which the screen answers by re-reading the order's
 * invoices.
 */
export async function createInvoice(
  body: InvoiceCreateBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<CreatedInvoice> & { readonly rule?: string | null }> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<CreatedInvoice>('POST', '/api/v1/invoices', body, {
    idempotencyKey,
  });
  if (!result.ok) {
    // The rule a refused create names (P1-32-PRE-OD-FRX): the screen says it in
    // its own sentence instead of the generic re-read caption.
    return {
      state: fromFailure(result, attempt),
      created: null,
      rule: result.kind === 'conflict' ? refusalRuleOf(result.problem) : null,
    };
  }
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

/* ------------------------------------------------------------------ *
 * Credit notes (DEF-T-07).
 *
 * A credit note is raised by a customer return, which never names the invoice
 * it lands on, so the note has no parent screen a caller already holds. These
 * two reads are how it is reached at all — before them the approval operation
 * took an id no screen printed.
 * ------------------------------------------------------------------ */

/**
 * A branch's credit notes (`sal.credit-note-list`), newest first.
 *
 * Branch-targeted for the same reason the counter-sale list is: the branch is
 * the read's TARGET, demanded by the route and re-authorized server-side, so it
 * travels through `branchTargetQuery` rather than among the filters. One page of
 * the route's own maximum; the caller reads `hasMore` rather than assuming the
 * branch fitted.
 *
 * A caller without `sal.finance.view` is REFUSED rather than sent an empty page:
 * the whole row is gated, and an empty list would read as "this branch has
 * credited nothing". The screen renders that refusal as a refusal.
 */
export async function listCreditNotes(
  target: BranchTarget,
  filter: {
    readonly approvalState?: CreditNoteState | undefined;
    readonly invoiceId?: string | undefined;
  } = {},
  page: { readonly cursor?: string | null; readonly limit?: number } = {}
): Promise<ReadState<CursorPage<CreditNote>>> {
  return readOperation<CursorPage<CreditNote>>(
    '/api/v1/credit-notes' +
      branchTargetQuery(target, {
        approvalState: filter.approvalState ?? null,
        invoiceId: filter.invoiceId ?? null,
        // The screen walks the pages with the route's own cursor (`OperationalGrid`).
        cursor: page.cursor ?? null,
        limit: page.limit ?? 50,
      })
  );
}

/**
 * One credit note (`sal.credit-note-detail`) — what a second person is asked to
 * approve: the amount, the reason the requester gave, the approval state, and
 * what the note is traceable to — the invoice it reduces, the return that raised
 * it and the people on it, by name (DF-B4).
 */
export async function readCreditNote(creditNoteId: string): Promise<ReadState<CreditNoteDetail>> {
  return readOperation<CreditNoteDetail>(
    `/api/v1/credit-notes/${encodeURIComponent(creditNoteId)}`
  );
}

/**
 * Raise a credit note against an invoice (`sal.credit-note-create`).
 *
 * Born pending, and worth nothing until a second person approves it. The
 * transport key is the one the form holds for THIS attempt: pressing again
 * after a lost answer replays the stored request instead of raising a second
 * note, and the echo says so with `replayed`.
 *
 * A 409 here is the invoice refusing the amount — more than is still open, or
 * an invoice no longer open for credit — and the server names neither with a
 * token. Both are about the amount the operator typed against this invoice, so
 * the refusal is filed under the amount rather than left as the generic
 * "this record changed" banner, which would send the operator looking for an
 * edit nobody made.
 */
export async function requestCreditNote(
  invoiceId: string,
  body: CreditNoteCreateBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<CreditNoteEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<CreditNoteEcho>(
    'POST',
    invoicePath(invoiceId, '/credit-notes'),
    body,
    { idempotencyKey }
  );
  if (!result.ok) {
    const state = fromFailure(result, attempt);
    if (state.status === 'conflict' && (result.problem?.violations ?? []).length === 0) {
      return {
        state: {
          ...state,
          messageKey: 'form.formError',
          fieldErrors: { ...(state.fieldErrors ?? {}), amount: 'creditNotes.request.overOpen' },
        },
        created: null,
      };
    }
    return { state, created: null };
  }
  return {
    state: {
      ...success('creditNotes.request.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * Approve a pending credit note (`sal.credit-note-approve`) — the moment the
 * credit becomes real and the invoice's open receivable falls by its amount.
 *
 * No body: the approver is the session and the amount was fixed when the note
 * was raised. The server refuses the person who raised it with the named rule
 * `credit_note_self_approval`, which reaches the banner as its own sentence. Any
 * other 409 — a note already decided, or an invoice that no longer has that much
 * open — carries no token and is said as that, not as "someone changed it".
 */
export async function approveCreditNote(
  creditNoteId: string,
  attempt = 1
): Promise<CreateOutcome<CreditNoteEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<CreditNoteEcho>(
    'POST',
    `/api/v1/credit-notes/${encodeURIComponent(creditNoteId)}/approval`
  );
  if (!result.ok) {
    const state = fromFailure(result, attempt);
    if (state.status === 'conflict' && (result.problem?.violations ?? []).length === 0) {
      return { state: { ...state, messageKey: 'creditNotes.approve.conflict' }, created: null };
    }
    return { state, created: null };
  }
  return {
    state: {
      ...success('creditNotes.approve.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * A refused withdrawal or rejection, as the screen states it. A named rule keeps
 * its own sentence; a conflict with no rule is the version guard — the note
 * changed since it was read — and is said as that, not as a refusal of the step.
 */
function decisionFailure(result: Parameters<typeof fromFailure>[0], attempt: number): ActionState {
  const state = fromFailure(result, attempt);
  if (state.status === 'conflict' && (result.problem?.violations ?? []).length === 0) {
    return { ...state, messageKey: 'creditNotes.decision.conflict' };
  }
  return state;
}

/**
 * Withdraw your own pending credit note (`sal.credit-note-withdraw`, ADR-023 D3).
 *
 * No body: the requester is the session. `ifMatch` is the NOTE's
 * `recordVersion` from the detail read, required, never computed. The server
 * refuses anyone but the requester with the named rule
 * `credit_note_withdraw_not_requester`, and a decided note with
 * `credit_note_decision_frozen`; both reach the banner as their own sentences.
 * A stale version is a conflict the screen answers by reading the note again.
 */
export async function withdrawCreditNote(
  creditNoteId: string,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<CreditNoteEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<CreditNoteEcho>(
    'POST',
    `/api/v1/credit-notes/${encodeURIComponent(creditNoteId)}/withdrawal`,
    undefined,
    { ifMatch }
  );
  if (!result.ok) return { state: decisionFailure(result, attempt), created: null };
  return {
    state: {
      ...success('creditNotes.withdraw.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * Reject a pending credit note somebody else raised (`sal.credit-note-reject`,
 * ADR-023 D3), stating why.
 *
 * `ifMatch` is the NOTE's `recordVersion` from the detail read, required. A
 * blank reason is refused on the reason itself (`fieldErrors.reason`); the
 * requester is refused with `credit_note_self_rejection` and a decided note
 * with `credit_note_decision_frozen`.
 */
export async function rejectCreditNote(
  creditNoteId: string,
  body: CreditNoteRejectBody,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<CreditNoteEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<CreditNoteEcho>(
    'POST',
    `/api/v1/credit-notes/${encodeURIComponent(creditNoteId)}/rejection`,
    body,
    { ifMatch }
  );
  if (!result.ok) return { state: decisionFailure(result, attempt), created: null };
  return {
    state: {
      ...success('creditNotes.reject.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
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

/**
 * A branch's invoices, found by number, payer or vehicle (`sal.invoice-list`,
 * Owner directive `P1-32-PRE-OD-UX`).
 *
 * The term travels to the server and nowhere else: it is not written to the
 * browser's address, and the screen holds it in memory only. `status` narrows to
 * one state; `allocatable` narrows to the invoices money can still be applied to
 * — `issued` or `credited` with a balance still open, which the SERVER decides —
 * and is what the payment desk's allocation form asks for.
 */
export async function listInvoices(
  target: BranchTarget,
  filter: {
    readonly q?: string | undefined;
    readonly status?: InvoiceStatus | undefined;
    readonly allocatable?: boolean | undefined;
    /** One kind only — the counter lists its own issued sales (DF-B3). */
    readonly saleKind?: SaleKind | undefined;
  },
  cursor: string | null
): Promise<ReadState<CursorPage<InvoiceListEntry>>> {
  return readOperation<CursorPage<InvoiceListEntry>>(
    '/api/v1/invoices' +
      branchTargetQuery(target, {
        status: filter.status ?? null,
        allocatable: filter.allocatable === true ? 'true' : null,
        saleKind: filter.saleKind ?? null,
        q: filter.q ?? null,
        cursor,
        limit: 10,
      })
  );
}

/* ------------------------------------------------------------------ *
 * ADR-023 D2, part 2 (P1-32-PRE-OD-FD2B) — refunds: what a customer is owed
 * back, the requests to pay it back, their second-person decision and the
 * one-time record of the payout. Nothing here pays anything: the payout is
 * made outside the application and recorded here.
 * ------------------------------------------------------------------ */

/**
 * A branch's refund obligations (`sal.refund-obligation-list`), narrowed by invoice
 * and state — what each customer is owed back, what has been paid out and what is
 * still owed, in the server's figures. `sal.finance.view` alone.
 */
export async function listRefundObligations(
  target: BranchTarget,
  filter: {
    readonly invoiceId?: string | undefined;
    readonly partnerId?: string | undefined;
    readonly state?: string | undefined;
  } = {},
  page: { readonly cursor?: string | null; readonly limit?: number } = {}
): Promise<ReadState<CursorPage<RefundObligation>>> {
  return readOperation<CursorPage<RefundObligation>>(
    '/api/v1/refund-obligations' +
      branchTargetQuery(target, {
        invoiceId: filter.invoiceId ?? null,
        partnerId: filter.partnerId ?? null,
        state: filter.state ?? null,
        cursor: page.cursor ?? null,
        limit: page.limit ?? 50,
      })
  );
}

/**
 * A branch's refund requests, newest first (`sal.refund-request-list`), narrowed by
 * invoice, customer, obligation and state. `sal.finance.view` alone; a caller
 * without it is refused rather than shown an empty list.
 */
export async function listRefundRequests(
  target: BranchTarget,
  filter: {
    readonly invoiceId?: string | undefined;
    readonly partnerId?: string | undefined;
    readonly obligationId?: string | undefined;
    readonly state?: RefundRequestState | undefined;
  } = {},
  page: { readonly cursor?: string | null; readonly limit?: number } = {}
): Promise<ReadState<CursorPage<RefundRequest>>> {
  return readOperation<CursorPage<RefundRequest>>(
    '/api/v1/refund-requests' +
      branchTargetQuery(target, {
        invoiceId: filter.invoiceId ?? null,
        partnerId: filter.partnerId ?? null,
        obligationId: filter.obligationId ?? null,
        state: filter.state ?? null,
        cursor: page.cursor ?? null,
        limit: page.limit ?? 50,
      })
  );
}

/** One refund request (`sal.refund-request-detail`), its obligation and the people, by name. */
export async function readRefundRequest(
  requestId: string
): Promise<ReadState<RefundRequestDetail>> {
  return readOperation<RefundRequestDetail>(
    `/api/v1/refund-requests/${encodeURIComponent(requestId)}`
  );
}

/**
 * A refused refund step, as the screen states it. A named rule keeps its own
 * sentence (`form.violation.refund_*`); a conflict with no rule is the version
 * guard — the request changed since it was read — and is said as that.
 */
function refundFailure(result: Parameters<typeof fromFailure>[0], attempt: number): ActionState {
  const state = fromFailure(result, attempt);
  if (state.status === 'conflict' && (result.problem?.violations ?? []).length === 0) {
    return { ...state, messageKey: 'refunds.decision.conflict' };
  }
  return state;
}

/**
 * Ask for (part of) a refund obligation to be paid back (`sal.refund-request`):
 * the amount, the payment method and the reason. The transport key is the one the
 * form holds for THIS attempt, so pressing again after a lost answer replays the
 * stored request instead of raising a second one. Born pending; pays nothing.
 */
export async function requestRefund(
  obligationId: string,
  body: RefundRequestBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<RefundRequestEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<RefundRequestEcho>(
    'POST',
    `/api/v1/refund-obligations/${encodeURIComponent(obligationId)}/refund-requests`,
    body,
    { idempotencyKey }
  );
  if (!result.ok) return { state: refundFailure(result, attempt), created: null };
  return {
    state: { ...success('refunds.request.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Approve a pending refund request somebody else raised (`sal.refund-approve`). No
 * body; `ifMatch` is the REQUEST's `recordVersion` as the list published it. An
 * approval pays nothing: the payout is recorded separately.
 */
export async function approveRefund(
  requestId: string,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<RefundRequestEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<RefundRequestEcho>(
    'POST',
    `/api/v1/refund-requests/${encodeURIComponent(requestId)}/approval`,
    undefined,
    { ifMatch }
  );
  if (!result.ok) return { state: refundFailure(result, attempt), created: null };
  return {
    state: { ...success('refunds.approve.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/** Reject a pending refund request somebody else raised, stating why (`sal.refund-reject`). */
export async function rejectRefund(
  requestId: string,
  body: RefundRejectBody,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<RefundRequestEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<RefundRequestEcho>(
    'POST',
    `/api/v1/refund-requests/${encodeURIComponent(requestId)}/rejection`,
    body,
    { ifMatch }
  );
  if (!result.ok) return { state: refundFailure(result, attempt), created: null };
  return {
    state: { ...success('refunds.reject.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/** Withdraw your own pending refund request (`sal.refund-withdraw`). No body. */
export async function withdrawRefund(
  requestId: string,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<RefundRequestEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<RefundRequestEcho>(
    'POST',
    `/api/v1/refund-requests/${encodeURIComponent(requestId)}/withdrawal`,
    undefined,
    { ifMatch }
  );
  if (!result.ok) return { state: refundFailure(result, attempt), created: null };
  return {
    state: { ...success('refunds.withdraw.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Record, once, that an approved refund was paid out (`sal.refund-execute`): the
 * reference, the day and the approved method. `ifMatch` is the REQUEST's version;
 * the transport key is the one the form holds for THIS attempt.
 */
export async function executeRefund(
  requestId: string,
  body: RefundExecuteBody,
  ifMatch: number,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<RefundRequestEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<RefundRequestEcho>(
    'POST',
    `/api/v1/refund-requests/${encodeURIComponent(requestId)}/execution`,
    body,
    { ifMatch, idempotencyKey }
  );
  if (!result.ok) return { state: refundFailure(result, attempt), created: null };
  return {
    state: { ...success('refunds.execute.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}
