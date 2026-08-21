'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  query,
  readOperation,
  type CursorPage,
  type ReadState,
} from '@/lib/api/read-operation';
import type {
  Address,
  Alert,
  Consent,
  ContactPoint,
  CustomerDetail,
  Note,
  Preference,
  Restriction,
  Tag,
} from './profile-contract';

/**
 * Reads for the customer profile and its components (`FE-006`…`FE-014`).
 *
 * One adapter per published operation. Each is a thin translation from "call an
 * approved operation" to "a view state", and none of them interprets, combines
 * or supplements what the backend returned.
 *
 * ## Every component list is its own request
 *
 * The backend publishes nine separate reads, not one aggregate. Fetching them
 * together on the server would look tidier and would be wrong twice: a profile
 * would then be as slow as its slowest component, and a single denied component
 * would fail the whole page rather than one section of it.
 *
 * So each section reads independently and renders its own state. A caller
 * without `iam.sensitive.view` sees a shorter note list; that does not stop the
 * addresses loading.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/** The profile header. `null` data means the 404 every absent case shares. */
export async function readCustomer(customerId: string): Promise<ReadState<CustomerDetail>> {
  return readOperation<CustomerDetail>(`/api/v1/customers/${encodeURIComponent(customerId)}`);
}

/**
 * A component list.
 *
 * The path is built from a **fixed** segment list, never from caller input, and
 * the customer id is encoded. A component name reaching this function from a URL
 * could otherwise walk to a different operation.
 */
async function listComponent<Row>(
  customerId: string,
  segment: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Row>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/customers/${encodeURIComponent(customerId)}/${segment}` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<Row>>(path, { retries: 0 });
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
    // No `total`. The operations publish `hasMore` and no count.
  };
}

export async function listContacts(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<ContactPoint>> {
  return listComponent<ContactPoint>(customerId, 'contacts', request, cursor);
}

export async function listAddresses(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Address>> {
  return listComponent<Address>(customerId, 'addresses', request, cursor);
}

export async function listPreferences(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Preference>> {
  return listComponent<Preference>(customerId, 'preferences', request, cursor);
}

export async function listConsents(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Consent>> {
  return listComponent<Consent>(customerId, 'consents', request, cursor);
}

/**
 * Notes, plus whether the caller is seeing all of them.
 *
 * `sel_notes_tenant` hides `restricted` and `secret` notes from a caller without
 * `iam.sensitive.view`, and hides them SILENTLY — the list is simply shorter. So
 * the operation publishes `includesRestricted` alongside the page, and this is
 * the one component read that cannot go through `listComponent`: dropping the
 * flag would leave a screen stating "this customer has three notes" with no way
 * to know it is wrong.
 */
export async function listNotes(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Note> & { readonly includesRestricted: boolean }> {
  const client = await authorizedClient();
  if (!client) {
    return { ...EMPTY, status: 'expired', correlationId: null, includesRestricted: false };
  }

  const path =
    `/api/v1/customers/${encodeURIComponent(customerId)}/notes` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<Note> & { includesRestricted: boolean }>(path, {
    retries: 0,
  });
  if (!result.ok) {
    return {
      ...EMPTY,
      status: STATUS_BY_KIND[result.kind],
      correlationId: result.correlationId,
      // False on a failure, so a screen that could not read never claims the
      // caller was seeing everything.
      includesRestricted: false,
    };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
    includesRestricted: result.data.includesRestricted === true,
  };
}

export async function listAlerts(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Alert>> {
  return listComponent<Alert>(customerId, 'alerts', request, cursor);
}

export async function listTags(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Tag>> {
  return listComponent<Tag>(customerId, 'tags', request, cursor);
}

export async function listRestrictions(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Restriction>> {
  return listComponent<Restriction>(customerId, 'restrictions', request, cursor);
}
