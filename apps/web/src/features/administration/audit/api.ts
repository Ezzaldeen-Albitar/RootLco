'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailureKind } from '@/lib/api/client';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage, ServerPageStatus } from '../shared/use-server-table';
import { query, type CursorPage } from '../shared/api';
import type { AuditDetail, AuditRow } from './types';

/**
 * Reads for the audit log.
 *
 * `GET /api/v1/audit-events` requires `iam.audit.view`, takes a **mandatory**
 * `from`/`to` ISO range, and is cursor-paginated. Both audit operations are
 * themselves audited (`auditClass: 'security'`, action `iam.audit.viewed`):
 * reading the audit log is a recorded act, and the screen says so rather than
 * letting an operator discover it in their own trail later.
 *
 * This file is `'use server'`, so it exports **only async functions**. Types and
 * the default window live in `types.ts` beside it.
 */

const STATUS_BY_KIND: Record<ApiFailureKind, ServerPageStatus> = {
  unauthenticated: 'expired',
  forbidden: 'denied',
  'not-found': 'not-found',
  conflict: 'error',
  validation: 'error',
  'rate-limited': 'unavailable',
  server: 'error',
  unavailable: 'unavailable',
  timeout: 'unavailable',
  cancelled: 'error',
  network: 'unavailable',
};

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function listAuditEvents(
  request: TableRequest,
  cursor: string | null,
  range: { readonly from: string; readonly to: string }
): Promise<ServerPage<AuditRow>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const action = request.filters.find((filter) => filter.key === 'action')?.value;
  const path =
    '/api/v1/audit-events' +
    query({
      from: range.from,
      to: range.to,
      cursor,
      limit: request.pageSize,
      action,
    });

  const result = await client.get<CursorPage<AuditRow>>(path);
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

export async function readAuditEvent(recordId: string): Promise<{
  readonly status: ServerPageStatus;
  readonly record: AuditDetail | null;
  readonly correlationId: string | null;
}> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', record: null, correlationId: null };

  const result = await client.get<AuditDetail>(
    `/api/v1/audit-events/${encodeURIComponent(recordId)}`
  );
  if (!result.ok) {
    return {
      status: STATUS_BY_KIND[result.kind],
      record: null,
      correlationId: result.correlationId,
    };
  }
  return { status: 'ok', record: result.data, correlationId: result.correlationId };
}
