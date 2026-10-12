import { authorizedClient } from '@/lib/api/server-client';
import { readOperation, type ReadState } from '@/lib/api/read-operation';
import type { ReferenceValues } from './types';

/**
 * `GET /api/v1/org/reference-values` — `org.reference-values-read`, on
 * `org.tenant.read` (P1-32-PRE-OD-REF).
 *
 * The currencies, time zones and languages the organisation screens offer as
 * selects: the company base currency, the branch time zone, and the tenant's
 * default language and time zone.
 *
 * ## SERVER-ONLY, deliberately without the Server Action directive
 *
 * `api.ts` beside this file carries the directive, and a read exported from it
 * would become a browser-callable endpoint, reachable without the page gate
 * that decides whether it is made. This module is imported only by the
 * organisation and languages pages, both Server Components, and
 * `authorizedClient()` reads the
 * `httpOnly` session cookie through `next/headers`, which does not exist in a
 * client bundle.
 *
 * Any outcome but a successful read answers `null`: the screens then fall back
 * to the values already in use (the enabled currency codes, the zones the
 * tenant and its branches already use) and never to free text.
 */
export async function readReferenceValues(): Promise<ReferenceValues | null> {
  const client = await authorizedClient();
  if (!client) return null;
  const result = await client.get<ReferenceValues>('/api/v1/org/reference-values');
  return result.ok ? result.data : null;
}

/**
 * The same read, keeping HOW it did not answer (P1-32-PRE-OD-ADM5).
 *
 * The Currencies screen shows the platform's currency list itself, so "could
 * not be read" is not enough there: a refusal, an ended session and an outage
 * are different states with different ways forward, and only an outage is
 * offered Try again. Same path, same permission, same server-only rule as
 * `readReferenceValues` above.
 */
export async function readReferenceValuesState(): Promise<ReadState<ReferenceValues>> {
  return readOperation<ReferenceValues>('/api/v1/org/reference-values');
}
