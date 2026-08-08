'use server';

import { z } from 'zod';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import {
  DUPLICATE_DECISIONS,
  MAX_MERGE_REASON,
  MIN_MERGE_REASON,
  type DuplicateCandidate,
  type HistoryEntry,
  type TimelineEntry,
} from './identity-contract';
import { fieldErrorsFrom } from '@/lib/forms/field-errors';

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
    return invalid(fieldErrorsFrom(parsed.error), attempt);
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

/**
 * There is deliberately no `mergeCustomerAction` here.
 *
 * `crm.customer-merge` exists in the contract and is NOT called by this phase.
 * `P1-OD-017` — duplicate and merge rules — is an OPEN Owner decision, and the
 * canonical plan requires the merge affordance to be **absent** rather than
 * disabled: a disabled control says "this exists and you lack permission",
 * which is false.
 *
 * An earlier revision of this file exported a working merge action and the
 * panel shipped a form for it. That was a defect against §13 and against the
 * phase's own canonical plan; it is recorded in findings.md. The action is
 * removed rather than flagged, because dead code that can POST a privileged,
 * irreversible operation is one edit away from being wired up by somebody who
 * does not know the decision is still open.
 */
