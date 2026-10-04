'use server';

import { readOperation, type ReadState } from '@/lib/api/read-operation';
import type { CapacityAlerts } from './attention-contract';

/**
 * The one adapter the Attention area owns.
 *
 * The four stock alerts are inventory reads and live with the other inventory
 * adapters, so the inventory screens and this one call the same functions and
 * cannot drift into two ways of asking the same question. What is left here is
 * the organisation's own allowance.
 *
 * `'use server'`, so this module exports async functions and nothing else — the
 * types and the link map are in `attention-contract.ts`.
 *
 * ## Reads only, and the module is the proof
 *
 * There is no `actions.ts` beside this file and no write in it. A card on this
 * surface has nothing to call that could post stock or money, which is a
 * stronger statement than a card choosing not to.
 */

/**
 * `org.capacity-alert-read` — the ceilings at, near or past their limit.
 *
 * Tenant-scoped: the allowance is tenant-wide by definition and has no target to
 * narrow by, so nothing is sent. `org.tenant.read` is the code, the same one
 * `GET /org/capacity` requires — an administrator who may see the allowance may
 * be warned about it.
 *
 * Never cached by the server, and nothing is cached here either: a stale
 * allowance is exactly the thing this read exists to prevent somebody acting on.
 */
export async function readCapacityAlerts(): Promise<ReadState<CapacityAlerts>> {
  return readOperation<CapacityAlerts>('/api/v1/org/capacity-alerts');
}
