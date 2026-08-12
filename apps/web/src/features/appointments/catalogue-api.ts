'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiResult } from '@/lib/api/client';
import {
  STATUS_BY_KIND,
  query,
  type CursorPage,
  type ReadFailureStatus,
} from '@/lib/api/read-operation';

/**
 * The three appointment intake-catalogue reads (P1-28, Wave A; backend R3).
 *
 * | operation                                 | path                                          |
 * | ----------------------------------------- | --------------------------------------------- |
 * | `apt.catalogue-appointment-type-list`     | `/appointment-catalogue/appointment-types`    |
 * | `apt.catalogue-source-channel-list`       | `/appointment-catalogue/source-channels`      |
 * | `apt.catalogue-cancellation-reason-list`  | `/appointment-catalogue/cancellation-reasons` |
 *
 * All `apt.appointment.read`, `auditClass: none`, `low-risk-metadata`
 * (600/min, keyed per tenant). Same page-walking shape as the vehicle
 * catalogue adapters and for the same reason: a picker that pages is a picker
 * nobody can use, so each call walks to the end — bounded at `MAX_PAGES` and
 * honest about `truncated` when the bound is hit.
 *
 * ## An empty catalogue is the catalogue WORKING
 *
 * Zero rows ship (the no-fake-data policy); population is a provisioning
 * decision, never a seed. A booking form must therefore treat an empty
 * appointment-type list as a real, renderable state — "no types are
 * configured" — not as a failure to retry. And the entry carries NO `status`
 * field, unlike the vehicle catalogue: these reads publish active rows only,
 * so there is nothing to filter client-side.
 */

/** Enough pages for a large tenant catalogue; small enough to stay bounded. */
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

/** One catalogue entry — the same four columns for all seven intake relations. */
export interface IntakeCatalogueOption {
  readonly id: string;
  /** `platform` or `tenant` — a screen may mark a tenant's own additions. */
  readonly scope: string;
  readonly code: string;
  readonly name: string;
}

export interface IntakeCatalogueResult {
  readonly status: ReadFailureStatus | 'ok';
  readonly options: readonly IntakeCatalogueOption[];
  /** True when `MAX_PAGES` was reached before the catalogue ended. */
  readonly truncated: boolean;
  readonly correlationId: string | null;
}

const FAILED = { options: [], truncated: false } as const;

/**
 * Walks one catalogue relation to the end, or to `MAX_PAGES`. `path` is built
 * by the exported functions from fixed segments; no caller supplies it.
 */
async function readCatalogue(path: string): Promise<IntakeCatalogueResult> {
  const client = await authorizedClient();
  if (!client) return { ...FAILED, status: 'expired', correlationId: null };

  const options: IntakeCatalogueOption[] = [];
  let cursor: string | null = null;
  let correlationId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Annotated, not inferred: `cursor` is reassigned from the result below,
    // and the inference cycle would widen to `any` (see the vehicle
    // catalogue adapter, which hit TS7022 first).
    const result: ApiResult<CursorPage<IntakeCatalogueOption>> = await client.get<
      CursorPage<IntakeCatalogueOption>
    >(path + query({ cursor, limit: PAGE_SIZE }), { retries: 0 });
    if (!result.ok) {
      return {
        ...FAILED,
        status: STATUS_BY_KIND[result.kind],
        correlationId: result.correlationId,
      };
    }
    correlationId = result.correlationId;
    options.push(...result.data.items);

    if (!result.data.hasMore || result.data.nextCursor === null) {
      return { status: 'ok', options, truncated: false, correlationId };
    }
    cursor = result.data.nextCursor;
  }

  return { status: 'ok', options, truncated: true, correlationId };
}

export async function listAppointmentTypes(): Promise<IntakeCatalogueResult> {
  return readCatalogue('/api/v1/appointment-catalogue/appointment-types');
}

export async function listSourceChannels(): Promise<IntakeCatalogueResult> {
  return readCatalogue('/api/v1/appointment-catalogue/source-channels');
}

/**
 * The cancellation reasons. `apt.appointment-cancel` REQUIRES one of these ids
 * — there is no free-text escape — so an empty catalogue means cancellation is
 * not yet operable for this tenant, and the dialog must say so rather than
 * submit a request that can only 422.
 */
export async function listCancellationReasons(): Promise<IntakeCatalogueResult> {
  return readCatalogue('/api/v1/appointment-catalogue/cancellation-reasons');
}
