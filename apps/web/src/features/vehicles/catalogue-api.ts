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
 * The five vehicle reference-catalogue reads (`P1-27-INT-007`, PR #197).
 *
 * | operation                             | path                                         |
 * | ------------------------------------- | -------------------------------------------- |
 * | `veh.catalogue-make-list`             | `/vehicle-catalogue/makes`                   |
 * | `veh.catalogue-model-list`            | `/vehicle-catalogue/makes/{makeId}/models`   |
 * | `veh.catalogue-trim-list`             | `/vehicle-catalogue/models/{modelId}/trims`  |
 * | `veh.catalogue-body-type-list`        | `/vehicle-catalogue/body-types`              |
 * | `veh.catalogue-powertrain-type-list`  | `/vehicle-catalogue/powertrain-types`        |
 *
 * All `veh.vehicle.read`, `auditClass: none`, `low-risk-metadata`.
 *
 * ## Why these are fetched whole rather than paged in the UI
 *
 * A catalogue is a picker, and a picker that pages is a picker nobody can use.
 * These adapters therefore walk every page to build the option list — bounded
 * hard at `MAX_PAGES`, because "walk until the cursor stops" is an unbounded
 * loop against a remote service and a malformed `hasMore` would hang the form.
 *
 * That bound is a real limit and it is reported: `truncated` says the list is
 * incomplete, and the selector says so on screen rather than presenting a
 * partial catalogue as the whole one.
 *
 * ## This is not a second authority
 *
 * Nothing is cached across requests and nothing is stored. Each call reads the
 * live operation; the result is the option list for one render. A module-level
 * cache here would become a second source of truth for what a tenant's catalogue
 * contains, and would go stale exactly when a tenant added a make.
 */

/** Enough pages for a large tenant catalogue; small enough to stay bounded. */
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

/** One catalogue entry, as the repository publishes it. */
export interface CatalogueOption {
  readonly id: string;
  /** `platform` or `tenant` — a screen may mark a tenant's own additions. */
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

export interface CatalogueResult {
  readonly status: ReadFailureStatus | 'ok';
  readonly options: readonly CatalogueOption[];
  /** True when `MAX_PAGES` was reached before the catalogue ended. */
  readonly truncated: boolean;
  readonly correlationId: string | null;
}

const FAILED = { options: [], truncated: false } as const;

/**
 * Walks one catalogue relation to the end, or to `MAX_PAGES`.
 *
 * `path` is built by the five exported functions from fixed segments; no caller
 * supplies it. Parent ids are encoded.
 */
async function readCatalogue(path: string): Promise<CatalogueResult> {
  const client = await authorizedClient();
  if (!client) return { ...FAILED, status: 'expired', correlationId: null };

  const options: CatalogueOption[] = [];
  let cursor: string | null = null;
  let correlationId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Annotated rather than inferred. `cursor` is reassigned from
    // `result.data.nextCursor` further down, so inference has to resolve
    // `result` through `cursor` and back — a circularity TypeScript reports as
    // TS7022 and then quietly widens to `any`, which would have made
    // `STATUS_BY_KIND[result.kind]` an unchecked index.
    const result: ApiResult<CursorPage<CatalogueOption>> = await client.get<
      CursorPage<CatalogueOption>
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

  // Reached the bound with more to come. Said out loud rather than silently
  // returning a partial catalogue that looks complete.
  return { status: 'ok', options, truncated: true, correlationId };
}

export async function listMakes(): Promise<CatalogueResult> {
  return readCatalogue('/api/v1/vehicle-catalogue/makes');
}

export async function listBodyTypes(): Promise<CatalogueResult> {
  return readCatalogue('/api/v1/vehicle-catalogue/body-types');
}

export async function listPowertrainTypes(): Promise<CatalogueResult> {
  return readCatalogue('/api/v1/vehicle-catalogue/powertrain-types');
}

/**
 * The models of one make.
 *
 * An unknown or invisible make returns an **empty list**, not an error — the
 * operation answers 200 with an empty page by design, so that it cannot be used
 * to probe another tenant's catalogue. The selector shows "no models" rather
 * than inventing a failure.
 */
export async function listModels(makeId: string): Promise<CatalogueResult> {
  return readCatalogue(`/api/v1/vehicle-catalogue/makes/${encodeURIComponent(makeId)}/models`);
}

export async function listTrims(modelId: string): Promise<CatalogueResult> {
  return readCatalogue(`/api/v1/vehicle-catalogue/models/${encodeURIComponent(modelId)}/trims`);
}
