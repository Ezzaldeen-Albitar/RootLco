'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { query } from '@/lib/api/read-operation';
import { readPage } from './api';
import type { OrganizationRow, PlatformAuditCriteria, PlatformAuditEvent } from './types';

/**
 * The two Platform Owner Console reads a client data table drives
 * (P1-32-PRE-068).
 *
 * ## Why these two are Server Actions, and nothing else is
 *
 * The organisation list and the activity search are paged and searched after
 * the page has rendered, by `useServerTable` in a client component. The
 * coordinator decided they stay Server Actions, for three reasons:
 *
 *   1. It is the repository's established pattern for an interactive paged
 *      table: `features/administration/users/api.ts` is a Server Action module
 *      and its `listUsers` is driven by the same table hook.
 *   2. The alternative, carrying the search term in the address, is not allowed:
 *      free text stays out of history, proxy logs and the `Referer` header
 *      (SEC-002, NFR-PRV-001). A Server Action sends it in a POST body.
 *   3. The authority boundary is the API, not this function. Each call reaches
 *      one published operation, which refuses a caller without its platform
 *      code: `platform.organization.read` for the list and
 *      `platform.audit.read` for the search.
 *
 * This module holds exactly these two exports. Every other console read is
 * server-only, in `api.ts`, and `actions.ts` holds only the writes.
 * `tests/platform-console-writes.test.ts` fails when any other platform read is
 * exported from a Server Action module.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `platform.organization-read` — one page of organisations, searched and filtered. */
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

/** `platform.audit-search` — one page of the operator's own trail in a bounded window. */
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
