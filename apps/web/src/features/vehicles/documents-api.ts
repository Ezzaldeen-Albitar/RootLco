'use server';

import { authorizedClient } from '@/lib/api/server-client';
import { STATUS_BY_KIND } from '@/lib/api/read-operation';
import type { VehicleDocuments } from './documents-contract';

/**
 * The vehicle document list (`FE-026`).
 *
 * One operation, no pagination, ids only — see `documents-contract.ts`.
 *
 * `not-found` is kept as its own state rather than folded into an error. Unlike
 * the EV profile, this operation checks the vehicle explicitly and 404s a
 * cross-tenant or unknown id, so a 404 here means the vehicle, not the absence
 * of documents — the service's own comment says it answers 404 "rather than an
 * empty list that cannot be told apart from linked to nothing".
 */

export type DocumentsState =
  | { readonly status: 'ok'; readonly documentIds: readonly string[] }
  | { readonly status: 'not-found' }
  | {
      readonly status: 'denied' | 'expired' | 'error' | 'unavailable';
      readonly correlationId: string | null;
    };

export async function listVehicleDocuments(vehicleId: string): Promise<DocumentsState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };

  // No cursor, no limit. The operation accepts neither, and sending one would
  // be a 422 from a `.strict()` schema.
  const result = await client.get<VehicleDocuments>(
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/documents`,
    { retries: 0 }
  );

  if (result.ok) return { status: 'ok', documentIds: result.data.documentIds };
  if (result.kind === 'not-found') return { status: 'not-found' };

  const mapped = STATUS_BY_KIND[result.kind];
  return {
    status: mapped === 'not-found' ? 'error' : mapped,
    correlationId: result.correlationId,
  };
}
