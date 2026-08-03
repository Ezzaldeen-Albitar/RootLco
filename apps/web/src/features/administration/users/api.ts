'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailureKind } from '@/lib/api/client';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage, ServerPageStatus } from '../shared/use-server-table';
import { query, type CursorPage } from '../shared/api';

/**
 * Reads for the Users screen.
 *
 * `GET /api/v1/iam/users` — `iam.user.read`, cursor-paginated, filters on
 * `status` and a free-text `search`. There is **no total count**, which is why
 * the shared table learned to render without one (`P1-26-F-001`).
 *
 * `search` is sent to the backend and never written to the address bar. The
 * table's URL policy keeps free text out of history, proxy logs and the
 * `Referer` header; this is the other half of that rule — the term is sent, and
 * it is sent as an encoded parameter of a POST-backed Server Action rather than
 * as part of a navigable URL.
 */

export interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: 'invited' | 'active' | 'locked' | 'archived';
  readonly mfaRequired: boolean;
  readonly createdAt: string;
  readonly recordVersion: number;
}

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

export async function listUsers(
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<UserRow>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const status = request.filters.find((filter) => filter.key === 'status')?.value;
  const path =
    '/api/v1/iam/users' +
    query({
      cursor,
      limit: request.pageSize,
      status,
      // Trimmed, and dropped entirely when empty — an empty `search=` parameter
      // is a different query from no search at all on some backends, and there
      // is no reason to find out which kind this is.
      search: request.search.trim() || undefined,
    });

  const result = await client.get<CursorPage<UserRow>>(path);
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

export interface UserGrantRow {
  readonly id: string;
  readonly roleId: string;
  readonly scopeMode: string;
  readonly status: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export interface UserSessionRow {
  readonly id: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string | null;
}

export interface UserDetailView extends UserRow {
  readonly grants: readonly UserGrantRow[];
}

export interface DetailResult {
  readonly status: ServerPageStatus;
  readonly user: UserDetailView | null;
  readonly sessions: readonly UserSessionRow[];
  readonly sessionsDenied: boolean;
  readonly correlationId: string | null;
}

/**
 * One user, with grants, and their sessions when the caller may see them.
 *
 * The two reads are separate permissions — `iam.user.read` and
 * `iam.session.view_all` — so a denial on the second is reported as a denial of
 * *that panel*, not of the screen. Collapsing them would hide a user's details
 * from anyone who may read users but not sessions, which is a common and
 * legitimate combination.
 */
export async function readUser(userId: string): Promise<DetailResult> {
  const client = await authorizedClient();
  if (!client) {
    return {
      status: 'expired',
      user: null,
      sessions: [],
      sessionsDenied: false,
      correlationId: null,
    };
  }

  const encoded = encodeURIComponent(userId);
  const detail = await client.get<UserDetailView>(`/api/v1/iam/users/${encoded}`);
  if (!detail.ok) {
    return {
      status: STATUS_BY_KIND[detail.kind],
      user: null,
      sessions: [],
      sessionsDenied: false,
      correlationId: detail.correlationId,
    };
  }

  const sessions = await client.get<{ items: readonly UserSessionRow[] }>(
    `/api/v1/iam/users/${encoded}/sessions`
  );

  return {
    status: 'ok',
    user: detail.data,
    sessions: sessions.ok ? sessions.data.items : [],
    sessionsDenied: !sessions.ok && sessions.kind === 'forbidden',
    correlationId: detail.correlationId,
  };
}

export interface RoleOption {
  readonly id: string;
  readonly roleCode: string;
  readonly name: string;
  readonly isSystem: boolean;
}

/**
 * The roles an invitation may grant.
 *
 * Read through `iam.role.read`. The list is a *convenience*: the backend refuses
 * a role the inviter cannot delegate and refuses a system role outright, so a
 * caller who submits one anyway is denied by the server rather than by this
 * list. Filtering system roles out here only stops an operator choosing
 * something that would certainly fail.
 */
export async function listGrantableRoles(): Promise<readonly RoleOption[]> {
  const client = await authorizedClient();
  if (!client) return [];
  const result = await client.get<CursorPage<RoleOption>>('/api/v1/iam/roles?limit=100');
  if (!result.ok) return [];
  return result.data.items.filter((role) => !role.isSystem);
}
