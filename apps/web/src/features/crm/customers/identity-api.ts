'use server';

import { z } from 'zod';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import {
  DUPLICATE_DECISIONS,
  MAX_APPROVAL_REF,
  MAX_MERGE_REASON,
  MIN_MERGE_REASON,
  type DuplicateCandidate,
  type HistoryEntry,
  type TimelineEntry,
} from './identity-contract';

/**
 * Timeline (`FE-015`) and duplicate review (`FE-016`) adapters.
 *
 * Both writes here are `idempotent: true` and both are `auditClass: privileged`
 * — a dismissal and a merge each leave a permanent audit record naming the
 * operator. Neither is ever triggered by anything but an explicit submit.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function listTimeline(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<TimelineEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/customers/${encodeURIComponent(customerId)}/timeline` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<TimelineEntry>>(path, { retries: 0 });
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

export async function listHistory(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<HistoryEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/customers/${encodeURIComponent(customerId)}/history` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<HistoryEntry>>(path, { retries: 0 });
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
 * The duplicate-candidate queue.
 *
 * `status` is a real filter the operation accepts, and it is the only one — no
 * sort, no score threshold, no free-text. Sending anything else is a 422 from
 * the `.strict()` query schema.
 */
export async function listDuplicates(
  status: string | null,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<DuplicateCandidate>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path = '/api/v1/customer-duplicates' + query({ status, cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<DuplicateCandidate>>(path, { retries: 0 });
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

const reviewSchema = z
  .object({
    // ONE decision. `merged` is a status a candidate reaches, not a decision
    // this endpoint accepts — that is `crm.customer-merge`, behind a different
    // permission.
    decision: z.enum(DUPLICATE_DECISIONS),
    reason: z.string().trim().min(MIN_MERGE_REASON, 'field.tooShort').max(MAX_MERGE_REASON),
  })
  .strict();

/**
 * `FE-016` — dismiss a candidate pair. `crm.customer.duplicate.review`.
 *
 * `auditClass: privileged`, so every dismissal is permanently attributed. The
 * reason is not paperwork: it is what the next reviewer reads when the same two
 * customers surface again.
 */
export async function reviewDuplicateAction(
  candidateId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const parsed = reviewSchema.safeParse({
    decision: String(form.get('decision') ?? ''),
    reason: String(form.get('reason') ?? ''),
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
    }
    return invalid(errors, attempt);
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send(
    'POST',
    `/api/v1/customer-duplicates/${encodeURIComponent(candidateId)}/review`,
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: 'crm.duplicates.dismissed',
    correlationId: result.correlationId,
    attempt,
  };
}

const mergeSchema = z
  .object({
    survivorId: z.string().uuid('field.required'),
    // REQUIRED, unlike a restriction's approval reference. A merge redirects one
    // real customer record into another; the authorisation for it is not
    // optional.
    approvalRef: z.string().trim().min(1, 'field.required').max(MAX_APPROVAL_REF),
  })
  .strict();

/**
 * `FE-016` — merge a customer into a survivor. **`crm.customer.merge`.**
 *
 * A different permission from the review above, and deliberately so: dismissing
 * a false pair is routine, and combining two real customer records is not.
 *
 * The DIRECTION matters and is easy to invert. `customerId` in the path is the
 * record that is merged **away**; `survivorId` in the body is the one that
 * remains. Swapping them destroys the wrong customer, and both are uuids so
 * nothing about the request would look wrong.
 */
export async function mergeCustomerAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const parsed = mergeSchema.safeParse({
    survivorId: String(form.get('survivorId') ?? ''),
    approvalRef: String(form.get('approvalRef') ?? ''),
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
    }
    return invalid(errors, attempt);
  }

  // A customer cannot survive itself. The backend rejects this, but catching it
  // here costs nothing and the failure mode it prevents — a request that reads
  // as "merge X into X" — is worth never sending.
  if (parsed.data.survivorId === customerId) {
    return invalid({ survivorId: 'crm.duplicates.survivorSameAsMerged' }, attempt);
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send(
    'POST',
    `/api/v1/customers/${encodeURIComponent(customerId)}/merge`,
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: 'crm.duplicates.merged',
    correlationId: result.correlationId,
    attempt,
  };
}
