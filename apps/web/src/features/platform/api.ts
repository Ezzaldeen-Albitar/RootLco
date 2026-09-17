'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { query, STATUS_BY_KIND, type CursorPage, type ReadState } from '@/lib/api/read-operation';
import type {
  OrganizationDetail,
  OrganizationRow,
  PlatformAuditCriteria,
  PlatformAuditEvent,
  PlatformStatistics,
  SubscriptionCharge,
  SubscriptionPlan,
} from './types';

/**
 * Reads for the Platform Owner Console (P1-32-PRE-063).
 *
 * Each goes through one published platform operation and returns a status
 * union, never a thrown error: a denial, an ended session and an outage are
 * ordinary outcomes a screen must draw.
 *
 *   - `platform.organization-read`   GET /platform/organizations
 *   - `platform.organization-detail` GET /platform/organizations/{tenantId}
 *   - `platform.plan-list`           GET /platform/plans
 *   - `platform.charge-list`         GET /platform/organizations/{tenantId}/charges
 *   - `platform.statistics-read`     GET /platform/statistics
 *   - `platform.audit-search`        GET /platform/audit-events
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function read<T>(path: string): Promise<ReadState<T>> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };
  const result = await client.get<T>(path);
  if (result.ok) return { status: 'ok', data: result.data, correlationId: result.correlationId };
  return { status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
}

async function readPage<Row>(path: string): Promise<ServerPage<Row>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };
  const result = await client.get<CursorPage<Row>>(path);
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

/** One page of organisations, searched by `q` and narrowed by status. */
export async function listOrganizations(
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<OrganizationRow>> {
  const status = request.filters.find((filter) => filter.key === 'status')?.value;
  const q = request.search.trim();
  return readPage<OrganizationRow>(
    '/api/v1/platform/organizations' +
      query({
        q: q.length > 0 ? q.slice(0, 100) : undefined,
        status,
        cursor,
        limit: request.pageSize,
      })
  );
}

/** Organisations for a filter choice: the first hundred, by the server's order. */
export async function listOrganizationChoices(): Promise<readonly OrganizationRow[]> {
  const client = await authorizedClient();
  if (!client) return [];
  const result = await client.get<CursorPage<OrganizationRow>>(
    '/api/v1/platform/organizations?limit=100'
  );
  return result.ok ? result.data.items : [];
}

export async function readOrganization(tenantId: string): Promise<ReadState<OrganizationDetail>> {
  if (!UUID.test(tenantId)) return { status: 'not-found', correlationId: null };
  return read<OrganizationDetail>(`/api/v1/platform/organizations/${encodeURIComponent(tenantId)}`);
}

export async function listPlans(): Promise<
  ReadState<{ readonly items: readonly SubscriptionPlan[] }>
> {
  return read<{ readonly items: readonly SubscriptionPlan[] }>('/api/v1/platform/plans');
}

/** An organisation's charges with their receipts: the first page the server returns. */
export async function listCharges(
  tenantId: string
): Promise<ReadState<CursorPage<SubscriptionCharge>>> {
  if (!UUID.test(tenantId)) return { status: 'not-found', correlationId: null };
  return read<CursorPage<SubscriptionCharge>>(
    `/api/v1/platform/organizations/${encodeURIComponent(tenantId)}/charges?limit=100`
  );
}

export async function readStatistics(): Promise<ReadState<PlatformStatistics>> {
  return read<PlatformStatistics>('/api/v1/platform/statistics');
}

/** One page of the platform operator's audit trail within a bounded window. */
export async function searchPlatformAudit(
  criteria: PlatformAuditCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<PlatformAuditEvent>> {
  const organizationId =
    criteria.organizationId && UUID.test(criteria.organizationId)
      ? criteria.organizationId
      : undefined;
  return readPage<PlatformAuditEvent>(
    '/api/v1/platform/audit-events' +
      query({
        from: criteria.from,
        to: criteria.to,
        action: criteria.action || undefined,
        targetTenantId: organizationId,
        cursor,
        limit: request.pageSize,
      })
  );
}
