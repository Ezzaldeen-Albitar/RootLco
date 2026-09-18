import { authorizedClient } from '@/lib/api/server-client';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { STATUS_BY_KIND, type CursorPage, type ReadState } from '@/lib/api/read-operation';
import type {
  OrganizationDetail,
  OrganizationRow,
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
 *
 * ## SERVER-ONLY, and why the directive was removed (P1-32-PRE-068)
 *
 * This module declared the Server Action directive, which made every read below
 * a browser-callable endpoint: anyone with a session cookie could invoke the
 * cross-organisation reads directly, bypassing the `holds(...)` checks the
 * console layout and pages apply before rendering. The gate is on the backend
 * operation, so this was never an authority hole — but a read reachable without
 * the page that guards it is a surface nobody chose to publish.
 *
 * It is a server-only module now, in the same way as
 * `features/platform/api/session.ts`: no directive, and `authorizedClient()`
 * reads the `httpOnly` cookie through `next/headers`, which does not exist in a
 * client bundle. Every caller is a Server Component or a server module, and
 * `tests/platform-console-writes.test.ts` fails when this module carries the
 * directive or when any client module reaches it, directly or through plain
 * modules. The `server-only` package is not a dependency of this repository.
 *
 * The two reads a client data table drives, the organisation list and the
 * activity search, are Server Actions in `table-reads.ts`. That is a decided
 * exception, recorded there with its reasons: it is the established pattern for
 * an interactive paged table, a search term may not travel in the address, and
 * the authority boundary is the backend operation. The same test fails when any
 * other platform read is exported from a Server Action module.
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

/**
 * One page of a cursor-paged platform read.
 *
 * Exported for `table-reads.ts`, which holds the two paged reads a client data
 * table drives and therefore cannot share this file's server-only home.
 */
export async function readPage<Row>(path: string): Promise<ServerPage<Row>> {
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

/**
 * `platform.organization-read` — one page of organisations, for the overview.
 *
 * The statistics read publishes how MANY subscriptions expire inside each
 * window; it does not say which organisations they belong to, and a count an
 * operator cannot act on is a number rather than a warning. This is the same
 * list the organisations screen drives, read once for the overview so each
 * expiring organisation can be named and linked to.
 *
 * It is a PAGE, and the screen says so. Asking for everything to guarantee no
 * organisation is missed would turn an overview into an unbounded read; the
 * page's own `hasMore` is stated beside the table instead, so a reader knows
 * exactly what was examined.
 */
export async function readOrganizationsPage(
  limit = 100
): Promise<ReadState<CursorPage<OrganizationRow>>> {
  return read<CursorPage<OrganizationRow>>(`/api/v1/platform/organizations?limit=${limit}`);
}
