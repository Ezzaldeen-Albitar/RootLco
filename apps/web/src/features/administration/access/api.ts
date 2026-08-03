'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailureKind } from '@/lib/api/client';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage, ServerPageStatus } from '../shared/use-server-table';
import { query, type CursorPage } from '../shared/api';

/**
 * Reads for roles, permissions and approval limits.
 *
 * Three shapes, and the difference matters to the table:
 *
 *   `GET /iam/roles`             — cursor-paginated, no count
 *   `GET /iam/permissions`       — a complete catalogue, `{items}`, no paging
 *   `GET /iam/approval-limits`   — a complete filtered list, `{items}`, no paging
 *
 * The last two return a whole set, so their `total` is the set's own length and
 * the table pages it client-side. That is honest: paging a *complete* set is
 * arithmetic. What the table must never do is page a window and call it a set,
 * which is why the cursor-paginated roles list reports `total: null` instead.
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

export interface RoleRow {
  readonly id: string;
  readonly roleCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly recordVersion: number;
}

export async function listRoles(
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<RoleRow>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const result = await client.get<CursorPage<RoleRow>>(
    '/api/v1/iam/roles' + query({ cursor, limit: request.pageSize })
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

/** Every role, for a picker. Bounded at the contract's own maximum page size. */
export async function allRoles(): Promise<readonly RoleRow[]> {
  const client = await authorizedClient();
  if (!client) return [];
  const result = await client.get<CursorPage<RoleRow>>('/api/v1/iam/roles?limit=100');
  return result.ok ? result.data.items : [];
}

export interface PermissionRow {
  readonly id: string;
  readonly code: string;
  readonly domain: string;
  readonly riskLevel: string;
  readonly description: string;
}

export interface RolePermissionRow {
  readonly id: string;
  readonly permissionCode?: string;
  readonly code?: string;
  readonly effect: 'allow' | 'deny';
  readonly recordVersion?: number;
}

export interface PermissionCatalogue {
  readonly status: ServerPageStatus;
  readonly permissions: readonly PermissionRow[];
  readonly mappings: readonly RolePermissionRow[];
  readonly correlationId: string | null;
}

/**
 * The platform catalogue, and one role's mappings over it.
 *
 * Both reads need `iam.role.read`. The mapping read is skipped entirely when no
 * role is selected rather than called with a placeholder identifier — a request
 * for a role that does not exist is a 404 in someone's log for no reason.
 */
export async function readPermissionCatalogue(roleId: string | null): Promise<PermissionCatalogue> {
  const client = await authorizedClient();
  if (!client) {
    return { status: 'expired', permissions: [], mappings: [], correlationId: null };
  }

  const catalogue = await client.get<{ items: readonly PermissionRow[] }>(
    '/api/v1/iam/permissions'
  );
  if (!catalogue.ok) {
    return {
      status: STATUS_BY_KIND[catalogue.kind],
      permissions: [],
      mappings: [],
      correlationId: catalogue.correlationId,
    };
  }

  if (roleId === null) {
    return {
      status: 'ok',
      permissions: catalogue.data.items,
      mappings: [],
      correlationId: catalogue.correlationId,
    };
  }

  const mappings = await client.get<{ items: readonly RolePermissionRow[] }>(
    `/api/v1/iam/roles/${encodeURIComponent(roleId)}/permissions`
  );
  return {
    status: 'ok',
    permissions: catalogue.data.items,
    mappings: mappings.ok ? mappings.data.items : [],
    correlationId: catalogue.correlationId,
  };
}

export interface ApprovalLimitRow {
  readonly id: string;
  readonly companyId: string;
  readonly roleId: string | null;
  readonly userId: string | null;
  readonly limitType: string;
  readonly amount: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordVersion: number;
}

/**
 * Approval limits.
 *
 * The operation takes `companyId` and `userId` filters and **no cursor** — it
 * returns the complete list for those filters. So `total` is the list's own
 * length and `hasMore` is false: this is a whole set, and the screen says so.
 */
export async function listApprovalLimits(
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<ApprovalLimitRow>> {
  // The operation takes no cursor. The parameter exists because every loader
  // shares one signature; ignoring it is stated here rather than left to a
  // reader wondering whether it was forgotten.
  void cursor;
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null, total: null };

  const companyId = request.filters.find((filter) => filter.key === 'companyId')?.value;
  const result = await client.get<{ items: readonly ApprovalLimitRow[] }>(
    '/api/v1/iam/approval-limits' + query({ companyId })
  );
  if (!result.ok) {
    return {
      ...EMPTY,
      status: STATUS_BY_KIND[result.kind],
      correlationId: result.correlationId,
      total: null,
    };
  }

  const all = result.data.items;
  const start = (request.page - 1) * request.pageSize;
  return {
    status: 'ok',
    rows: all.slice(start, start + request.pageSize),
    nextCursor: null,
    hasMore: start + request.pageSize < all.length,
    total: all.length,
    correlationId: result.correlationId,
  };
}
