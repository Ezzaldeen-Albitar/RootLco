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
 * The four reception intake-catalogue reads (P1-28, Wave A; backend R3).
 *
 * | operation                                | path                                        |
 * | ---------------------------------------- | ------------------------------------------- |
 * | `rec.catalogue-visit-reason-list`        | `/reception-catalogue/visit-reasons`        |
 * | `rec.catalogue-fuel-level-list`          | `/reception-catalogue/fuel-levels`          |
 * | `rec.catalogue-warning-light-code-list`  | `/reception-catalogue/warning-light-codes`  |
 * | `rec.catalogue-refusal-reason-list`      | `/reception-catalogue/refusal-reasons`      |
 *
 * All `rec.reception.read`, `auditClass: none`, `low-risk-metadata`. Same
 * page-walking shape as the appointment catalogue adapter beside this feature
 * — copied, not shared, because a feature may never import another feature and
 * `lib/` is for modules BOTH trees genuinely co-own, which forty lines of
 * catalogue paging is not (the `write-support.ts` reasoning).
 *
 * ## An empty catalogue is the catalogue WORKING
 *
 * Zero rows ship (the no-fake-data policy). `fuelLevelId` on check-in is
 * NULLABLE, so an empty fuel-level list degrades the form, not the operation;
 * `rec.refusal_reasons` ships zero rows AND `refusalReasonId` is optional,
 * which is exactly why the close/refuse commands take bounded TEXT instead of
 * a reference — a mandatory catalogue id would be dead on arrival.
 */

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

async function readCatalogue(path: string): Promise<IntakeCatalogueResult> {
  const client = await authorizedClient();
  if (!client) return { ...FAILED, status: 'expired', correlationId: null };

  const options: IntakeCatalogueOption[] = [];
  let cursor: string | null = null;
  let correlationId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
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

export async function listVisitReasons(): Promise<IntakeCatalogueResult> {
  return readCatalogue('/api/v1/reception-catalogue/visit-reasons');
}

export async function listFuelLevels(): Promise<IntakeCatalogueResult> {
  return readCatalogue('/api/v1/reception-catalogue/fuel-levels');
}

/** The warning-light codes the `warning_light` evidence kind references by id. */
export async function listWarningLightCodes(): Promise<IntakeCatalogueResult> {
  return readCatalogue('/api/v1/reception-catalogue/warning-light-codes');
}

export async function listRefusalReasons(): Promise<IntakeCatalogueResult> {
  return readCatalogue('/api/v1/reception-catalogue/refusal-reasons');
}
