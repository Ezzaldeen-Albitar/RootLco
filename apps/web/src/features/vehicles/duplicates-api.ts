'use server';

import { z } from 'zod';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import {
  MAX_REVIEW_REASON,
  MIN_REVIEW_REASON,
  VEHICLE_DUPLICATE_DECISIONS,
  type VehicleDuplicateCandidate,
  type VehicleHistoryEntry,
} from './duplicates-contract';

/**
 * Vehicle duplicate review (`FE-028`) and history (`FE-029`).
 *
 * ## Two operations are deliberately absent from this file
 *
 * **`veh.vehicle-duplicate-scan`** — reads like a query, is a privileged audited
 * WRITE that creates candidate rows, throttled at 30/min. Never called to
 * populate or refresh a screen.
 *
 * **`veh.vehicle-merge`** — blocked by `P1-OD-017`, an open Owner decision. The
 * canonical plan requires the affordance to be absent, and an unused action that
 * can POST an irreversible merge is one edit away from being wired up.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function listVehicleDuplicates(
  status: string | null,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<VehicleDuplicateCandidate>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path = '/api/v1/vehicle-duplicates' + query({ status, cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<VehicleDuplicateCandidate>>(path, { retries: 0 });
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
 * `FE-029` — the vehicle attribute-change ledger.
 *
 * Named `listAttributeHistory` rather than `listTimeline`, because that is what
 * it is: field-level changes to the vehicle master. There is no
 * `veh.timeline_events` table and this does not pretend to aggregate one.
 *
 * The cursor is microsecond-safe as of `P1-27-INT-008` — and this was the acute
 * case, since attribute-history rows are written by a trigger inside the
 * transaction that changed the vehicle, so every row from one update shares
 * `occurred_at` to the microsecond.
 */
export async function listAttributeHistory(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<VehicleHistoryEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/history` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<VehicleHistoryEntry>>(path, { retries: 0 });
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
    decision: z.enum(VEHICLE_DUPLICATE_DECISIONS),
    reason: z.string().trim().min(MIN_REVIEW_REASON, 'field.tooShort').max(MAX_REVIEW_REASON),
  })
  .strict();

/**
 * `FE-028` — dismiss a vehicle duplicate candidate.
 * `veh.vehicle.duplicate.review`, idempotent, `auditClass: privileged`.
 */
export async function reviewVehicleDuplicateAction(
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
    `/api/v1/vehicle-duplicates/${encodeURIComponent(candidateId)}/review`,
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
