'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailureKind } from '@/lib/api/client';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage, ServerPageStatus } from '../shared/use-server-table';
import { query, type CursorPage } from '../shared/api';
import type { AuditDetail, AuditFilters, AuditRow } from './types';

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
 *
 * ## Why the criteria arrive as an argument and not in `request.filters`
 *
 * A `TableRequest` filter is URL state: a registered key plus a value drawn from
 * a declared option set, written to browser history, proxy logs and the
 * `Referer` header of every outbound request from the page
 * (`components/data-table/table-state.ts`). None of the three criteria below has
 * a declared option set — the action vocabulary lives in the backend's audit
 * action registry, an entity type is free text, and an actor is an identifier —
 * so serialising them would put an operator's typed value in exactly the places
 * that module forbids. They travel to the API instead, which is one hop, and the
 * screen holds them in memory.
 *
 * The earlier reading of `request.filters` for `action` had no control anywhere
 * that could populate it: the table renders only chips for filters ALREADY
 * applied, so the parameter was unreachable. It is replaced rather than kept
 * beside the argument, because two sources for one criterion is a screen whose
 * chip and whose field can disagree.
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
  range: { readonly from: string; readonly to: string },
  filters: AuditFilters
): Promise<ServerPage<AuditRow>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  // `query` drops an empty value, so an unfilled criterion is absent from the
  // request rather than sent as a blank the backend would have to interpret.
  const path =
    '/api/v1/audit-events' +
    query({
      from: range.from,
      to: range.to,
      cursor,
      limit: request.pageSize,
      action: filters.action,
      entityType: filters.entityType,
      actorId: filters.actorId,
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
