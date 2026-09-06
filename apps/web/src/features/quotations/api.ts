'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  query,
  readOperation,
  type CursorPage,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type {
  QuotationCreateBody,
  QuotationIssueBody,
  QuotationItemDecideBody,
  QuotationRevisionCreateBody,
  QuotationRevisionDecideBody,
} from '@/lib/contracts/quotations-contract';
import type {
  ItemDecisionEcho,
  QuotationDetail,
  QuotationRevision,
  QuotationRevisionHeader,
  QuotationSummary,
  RevisionDecisionEcho,
  RevisionDecisions,
} from './quotations-contract';

/**
 * The quotation adapters (P1-30, `W3`, FE-003/004/005/007).
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application. This file turns operations into view states and nothing
 * else — and it does no arithmetic: every total, price, quantity and rate is
 * passed through as the string the server sent.
 *
 * ## Quotations are reached from a work order
 *
 * `quo.quotation-list` is addressed to a work order and has no wider form: the
 * backend refuses a tenant-wide quotation list because a branch scope with no
 * target would be inert. So the list adapter takes the work order's id in the
 * path — the parent the backend re-authorizes — and the page that calls it
 * takes that id from its address.
 *
 * ## Where the concurrency token comes from
 *
 * `quo.quotation-issue` and `quo.quotation-revision-create` are
 * `versionGuarded: true` on the QUOTATION's `recordVersion` — the row the
 * service locks — while their own responses carry the REVISION's number. So
 * `ifMatch` on both adapters is the value from `quo.quotation-detail`, is
 * REQUIRED, and is never defaulted; the screen re-reads the detail afterwards.
 *
 * ## Approval limits are read through the administration adapter
 *
 * `iam.approval-limit-list` takes `companyId` as a resource selector, and
 * `companyFilterQuery` is pinned to exactly that one call site by
 * `p1-27-security.test.ts`. The detail screen therefore calls
 * `listApprovalLimits` from `features/administration/access/api` rather than
 * opening a second door here.
 */

/** A write that creates something the screen must then hold on to. */
export type CreateOutcome<T> = {
  readonly state: ActionState;
  /** The created row on success, `null` on any other outcome. */
  readonly created: T | null;
};

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

const quotationPath = (quotationId: string, suffix = ''): string =>
  `/api/v1/quotations/${encodeURIComponent(quotationId)}${suffix}`;

const revisionPath = (revisionId: string, suffix = ''): string =>
  `/api/v1/quotation-revisions/${encodeURIComponent(revisionId)}${suffix}`;

const expired = (attempt: number): ActionState => ({
  status: 'expired',
  messageKey: 'state.expired.title',
  attempt,
});

async function page<T>(
  path: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<T>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };
  const result = await client.get<CursorPage<T>>(path + query({ cursor, limit: request.pageSize }));
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

/** The quotations of one work order (`quo.quotation-list`), newest first, one page at a time. */
export async function listQuotations(
  workOrderId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<QuotationSummary>> {
  return page<QuotationSummary>(
    `/api/v1/work-orders/${encodeURIComponent(workOrderId)}/quotations`,
    request,
    cursor
  );
}

/**
 * One quotation with its current revision (`quo.quotation-detail`). The
 * response carries an ETag holding the QUOTATION's `recordVersion` — the
 * `If-Match` both guarded writes below need.
 */
export async function readQuotation(quotationId: string): Promise<ReadState<QuotationDetail>> {
  return readOperation<QuotationDetail>(quotationPath(quotationId));
}

/** The revision history of a quotation (`quo.quotation-revision-list`), headers only. */
export async function listRevisions(
  quotationId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<QuotationRevisionHeader>> {
  return page<QuotationRevisionHeader>(quotationPath(quotationId, '/revisions'), request, cursor);
}

/** One revision with its lines (`quo.quotation-revision-detail`), current or superseded. */
export async function readRevision(revisionId: string): Promise<ReadState<QuotationRevision>> {
  return readOperation<QuotationRevision>(revisionPath(revisionId));
}

/** The recorded decisions of one revision (`quo.quotation-revision-decisions-read`), bounded. */
export async function readRevisionDecisions(
  revisionId: string
): Promise<ReadState<RevisionDecisions>> {
  return readOperation<RevisionDecisions>(revisionPath(revisionId, '/decisions'));
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Create a quotation on a work order (`quo.quotation-create`). The server
 * prices every line, authorizes any discount against the company's policy and
 * the actor's approval limit, and refuses the whole document otherwise — that
 * refusal comes back as a denial and is rendered as one.
 */
export async function createQuotation(
  body: QuotationCreateBody,
  attempt = 1
): Promise<CreateOutcome<QuotationDetail>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<QuotationDetail>('POST', '/api/v1/quotations', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('quotations.create.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * Add a revision (`quo.quotation-revision-create`), `If-Match` REQUIRED and
 * guarding the QUOTATION's `recordVersion` — from the detail read, never from
 * a revision's answer.
 */
export async function createQuotationRevision(
  quotationId: string,
  body: QuotationRevisionCreateBody,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<QuotationRevision>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<QuotationRevision>(
    'POST',
    quotationPath(quotationId, '/revisions'),
    body,
    { ifMatch }
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('quotations.revision.created', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * Issue a draft revision to the customer (`quo.quotation-issue`), `If-Match`
 * REQUIRED and guarding the QUOTATION's `recordVersion`.
 */
export async function issueQuotation(
  quotationId: string,
  body: QuotationIssueBody,
  ifMatch: number,
  attempt = 1
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return expired(attempt);
  const result = await client.send<QuotationRevision>(
    'POST',
    quotationPath(quotationId, '/issue'),
    body,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);
  return { ...success('quotations.issue.success', attempt), correlationId: result.correlationId };
}

/** Record the customer's decision on every undecided line of a revision (`quo.quotation-revision-decide`). */
export async function decideRevision(
  revisionId: string,
  body: QuotationRevisionDecideBody,
  attempt = 1
): Promise<CreateOutcome<RevisionDecisionEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<RevisionDecisionEcho>(
    'POST',
    revisionPath(revisionId, '/decisions'),
    body
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('quotations.decision.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/** Record the customer's decision on one line (`quo.quotation-item-decide`). */
export async function decideItem(
  quotationItemId: string,
  body: QuotationItemDecideBody,
  attempt = 1
): Promise<CreateOutcome<ItemDecisionEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<ItemDecisionEcho>(
    'POST',
    `/api/v1/quotation-items/${encodeURIComponent(quotationItemId)}/decisions`,
    body
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('quotations.decision.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}
