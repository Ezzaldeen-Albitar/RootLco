'use server';

import { z } from 'zod';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import {
  MAX_COLOR,
  MAX_DISPLAY_NUMBER,
  MAX_VIN_INPUT,
  MODEL_YEAR_MAX,
  MODEL_YEAR_MIN,
  POWERTRAIN_CATEGORIES,
  isEmptyCriteria,
  normalizeCriteria,
  type CreatedVehicle,
  type VehicleSearchCriteria,
  type VehicleSearchHit,
} from './contract';
import { fieldErrorsFrom } from '@/lib/forms/field-errors';

/**
 * Vehicle search (`FE-017`) and creation (`FE-018`) adapters.
 *
 * ## Search sends exactly the six parameters the schema names
 *
 * The query schema is `.strict()`, so an unknown parameter is a 422 for the
 * whole request rather than a silently ignored extra. There is no `sort`, no
 * `page`, no `total`, and nothing is added for convenience.
 *
 * `retries: 0`, because search is `expensive-read` — 30 requests per minute per
 * user. A transparent retry would spend a second slot of a small budget on a
 * request the operator did not make, and the screen already offers Retry.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function searchVehicles(
  criteria: VehicleSearchCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<VehicleSearchHit>> {
  // Refused rather than sent. An unfiltered search is a full scan against an
  // expensive-read budget, and the screen has no reason to ask for one.
  if (isEmptyCriteria(criteria)) {
    return { ...EMPTY, status: 'ok', correlationId: null };
  }

  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/vehicles' + query({ ...normalizeCriteria(criteria), cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<VehicleSearchHit>>(path, { retries: 0 });
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
    // No `total`. The operation publishes `hasMore` and nothing else.
  };
}

/**
 * The creation body, mirroring the route's Zod schema field for field.
 *
 * `.strict()` there too, so an extra key is a 422. Every field is optional
 * because a vehicle may be registered as a bare draft; `lifecycleStatus` is
 * absent because creation always lands `draft` and the route does not accept it.
 */
const createSchema = z
  .object({
    vin: z.string().trim().min(1).max(MAX_VIN_INPUT).optional(),
    makeId: z.string().uuid().optional(),
    modelId: z.string().uuid().optional(),
    trimId: z.string().uuid().optional(),
    bodyTypeId: z.string().uuid().optional(),
    powertrainTypeId: z.string().uuid().optional(),
    modelYear: z.number().int().min(MODEL_YEAR_MIN).max(MODEL_YEAR_MAX).optional(),
    powertrainCategory: z.enum(POWERTRAIN_CATEGORIES).optional(),
    color: z.string().trim().min(1).max(MAX_COLOR).optional(),
    displayNumber: z.string().trim().min(1).max(MAX_DISPLAY_NUMBER).optional(),
  })
  .strict();

/** Present-and-non-empty, or absent. Never `''`, which `.min(1)` rejects. */
function optional(form: FormData, key: string): string | undefined {
  const value = String(form.get(key) ?? '').trim();
  return value.length > 0 ? value : undefined;
}

export interface VehicleCreationState extends ActionState {
  readonly created?: CreatedVehicle;
}

/**
 * `FE-018` — create a draft vehicle. `veh.vehicle.manage`, **idempotent**.
 *
 * The `Idempotency-Key` comes from the shared contract-derived authority. This
 * action does not set one: a second idempotency authority in the codebase is the
 * shape of `P1-27-INT-003`, not its fix.
 *
 * ## The three server failures this cannot pre-empt
 *
 * - **409 `ERR-RES-002`** — a live vehicle in this tenant already has that VIN.
 * - **422 `unknown_reference`** — a catalogue id the tenant cannot see.
 * - **422 `incoherent_reference`** — make/model/trim that do not belong together.
 *
 * All three are surfaced as the backend's own message rather than reinterpreted,
 * because guessing which of the three a 422 was would sometimes be wrong.
 */
export async function createVehicleAction(
  previous: VehicleCreationState,
  form: FormData
): Promise<VehicleCreationState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const yearRaw = optional(form, 'modelYear');
  const parsed = createSchema.safeParse({
    ...(optional(form, 'vin') ? { vin: optional(form, 'vin') } : {}),
    ...(optional(form, 'makeId') ? { makeId: optional(form, 'makeId') } : {}),
    ...(optional(form, 'modelId') ? { modelId: optional(form, 'modelId') } : {}),
    ...(optional(form, 'trimId') ? { trimId: optional(form, 'trimId') } : {}),
    ...(optional(form, 'bodyTypeId') ? { bodyTypeId: optional(form, 'bodyTypeId') } : {}),
    ...(optional(form, 'powertrainTypeId')
      ? { powertrainTypeId: optional(form, 'powertrainTypeId') }
      : {}),
    // Sent as a NUMBER. `z.number()` rejects the string a form field yields, so
    // an unconverted value would be a 422 the operator could not act on.
    ...(yearRaw !== undefined && /^\d+$/.test(yearRaw) ? { modelYear: Number(yearRaw) } : {}),
    ...(optional(form, 'powertrainCategory')
      ? { powertrainCategory: optional(form, 'powertrainCategory') }
      : {}),
    ...(optional(form, 'color') ? { color: optional(form, 'color') } : {}),
    ...(optional(form, 'displayNumber') ? { displayNumber: optional(form, 'displayNumber') } : {}),
  });

  if (!parsed.success) {
    return invalid(fieldErrorsFrom(parsed.error), attempt);
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<CreatedVehicle>('POST', '/api/v1/vehicles', parsed.data);
  if (!result.ok) {
    const state = fromFailure(result, attempt);
    /*
     * A 409 from `POST /vehicles` is the ACTIVE-VIN COLLISION and nothing else.
     *
     * `vehicle-write-service.ts` `create()` reaches `mapWriteConflict` only from
     * the insert, and the single conflict it maps there is `23505` — "A live
     * vehicle with this VIN already exists in the tenant". The catalogue
     * refusals are 422s and the merge freeze belongs to `update`, not `create`.
     *
     * Without this, that 409 arrived as the generic conflict copy — "Someone
     * else changed this" — which is not what happened, does not mention the VIN
     * and is not something an operator can act on. `fieldErrorsOf` cannot help:
     * it returns `{}` unless `failure.kind === 'validation'`, so the error had
     * nowhere to land beside the field it is about. Named here, at the one call
     * site that knows what a 409 means on this path.
     */
    if (result.kind === 'conflict') {
      return {
        ...state,
        messageKey: 'vehicles.vin.duplicate',
        fieldErrors: { ...(state.fieldErrors ?? {}), vin: 'vehicles.vin.duplicate' },
      };
    }
    return state;
  }

  return {
    status: 'success',
    messageKey: 'vehicles.create.created',
    correlationId: result.correlationId,
    attempt,
    created: result.data,
  };
}
