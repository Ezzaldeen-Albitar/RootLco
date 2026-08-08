'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { readOperation, type ReadState } from '@/lib/api/read-operation';
import {
  MAX_COLOR,
  MAX_DISPLAY_NUMBER,
  MAX_VIN_INPUT,
  MODEL_YEAR_MAX,
  MODEL_YEAR_MIN,
  POWERTRAIN_CATEGORIES,
  VEHICLE_LIFECYCLE_STATUSES,
  WORKSHOP_STATUSES,
} from './contract';
import type { VehicleDetail } from './profile-contract';
import { fieldErrorsFrom } from '@/lib/forms/field-errors';

/**
 * Vehicle profile reads and writes (`FE-019`).
 *
 * ## No `If-Match` is ever sent
 *
 * Neither vehicle PATCH is registered `versionGuarded: true`, so the header is
 * parsed and never compared. A well-formed one is ignored; a malformed one is a
 * 428 from `parseIfMatch` even though the operation is unguarded. Sending it
 * could only hurt. See `profile-contract.ts` and `P1-27-INT-009`.
 *
 * ## Two writes, two permissions
 *
 * `veh.vehicle-update` needs `veh.vehicle.manage`; `veh.vehicle-status-change`
 * needs `veh.vehicle.status.manage`. Describing a vehicle and changing where it
 * is in its lifecycle are separate authorities, and the screen gates them
 * separately rather than showing both to anyone who can edit.
 */

/** `null` data is the 404 that absent, deleted and cross-tenant all share. */
export async function readVehicle(vehicleId: string): Promise<ReadState<VehicleDetail>> {
  return readOperation<VehicleDetail>(`/api/v1/vehicles/${encodeURIComponent(vehicleId)}`);
}

/**
 * The PATCH body, mirroring the route's Zod schema.
 *
 * Every field is `.nullable().optional()` there: **absent leaves the column
 * untouched, and an explicit `null` CLEARS it.** Those are different requests,
 * so this schema keeps `null` distinct from `undefined` rather than collapsing
 * them — a form that sent `null` for every untouched field would wipe the
 * vehicle's description on the first edit.
 */
const updateSchema = z
  .object({
    vin: z.string().trim().min(1).max(MAX_VIN_INPUT).nullable().optional(),
    makeId: z.string().uuid().nullable().optional(),
    modelId: z.string().uuid().nullable().optional(),
    trimId: z.string().uuid().nullable().optional(),
    bodyTypeId: z.string().uuid().nullable().optional(),
    powertrainTypeId: z.string().uuid().nullable().optional(),
    modelYear: z.number().int().min(MODEL_YEAR_MIN).max(MODEL_YEAR_MAX).nullable().optional(),
    powertrainCategory: z.enum(POWERTRAIN_CATEGORIES).optional(),
    color: z.string().trim().min(1).max(MAX_COLOR).nullable().optional(),
    displayNumber: z.string().trim().min(1).max(MAX_DISPLAY_NUMBER).nullable().optional(),
  })
  .strict();

// The private copy stored Zod's own English sentence (`P1-27-FE-004`).
// `lib/forms/field-errors` is the one authority.

/**
 * `FE-019` — edit the descriptive master fields. `veh.vehicle.manage`.
 *
 * Only CHANGED fields are sent. `changed` is computed by the caller against the
 * values it read, so an edit of one field is a one-field PATCH rather than a
 * full overwrite — which matters because an absent field and a null field mean
 * different things to this route.
 */
export async function updateVehicleAction(
  vehicleId: string,
  changed: Record<string, string | number | null>,
  previous: ActionState
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  if (Object.keys(changed).length === 0) {
    return { status: 'idle', attempt };
  }

  const parsed = updateSchema.safeParse(changed);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send(
    'PATCH',
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}`,
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: 'vehicles.profile.saved',
    correlationId: result.correlationId,
    attempt,
  };
}

const statusSchema = z
  .object({
    lifecycleStatus: z.enum(VEHICLE_LIFECYCLE_STATUSES).optional(),
    workshopStatus: z.enum(WORKSHOP_STATUSES).optional(),
  })
  .strict();

/**
 * `FE-019` — change lifecycle and/or workshop status.
 * **`veh.vehicle.status.manage`**, a different permission from the edit above.
 *
 * `merged` is accepted by the enum but is never offered by this screen: a
 * vehicle becomes merged through `veh.vehicle-merge`, and letting an operator
 * declare it merged here would set the state without the merge that justifies
 * it — and without a survivor to point `mergedIntoId` at.
 */
export async function changeVehicleStatusAction(
  vehicleId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const lifecycle = String(form.get('lifecycleStatus') ?? '').trim();
  const workshop = String(form.get('workshopStatus') ?? '').trim();

  const parsed = statusSchema.safeParse({
    ...(lifecycle.length > 0 ? { lifecycleStatus: lifecycle } : {}),
    ...(workshop.length > 0 ? { workshopStatus: workshop } : {}),
  });
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  if (Object.keys(parsed.data).length === 0) {
    return invalid({ lifecycleStatus: 'vehicles.profile.chooseAStatus' }, attempt);
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send(
    'PATCH',
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/status`,
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: 'vehicles.profile.statusChanged',
    correlationId: result.correlationId,
    attempt,
  };
}

/**
 * `FE-020` — is this VIN already taken in the tenant?
 *
 * There is **no VIN-check operation**. The only honest way to ask is the search
 * this product already publishes: `veh.vehicle-search` matches `vin` against the
 * generated `vin_normalized` for equality, so a hit means a live vehicle in this
 * tenant already carries it.
 *
 * That is exactly the uniqueness the database enforces — `409 ERR-RES-002` comes
 * from a unique violation on the same normalised column — so this is a preview
 * of the server's own verdict rather than a second rule.
 *
 * It returns `unavailable` rather than `available` on any failure. A uniqueness
 * check that could not run must never read as a clean result.
 */
export async function checkVinAvailability(
  vin: string,
  excludeVehicleId: string | null
): Promise<{
  readonly verdict: 'duplicate' | 'available' | 'unavailable';
  readonly holderId: string | null;
}> {
  const client = await authorizedClient();
  if (!client) return { verdict: 'unavailable', holderId: null };

  const result = await client.get<{ items: readonly { id: string }[] }>(
    `/api/v1/vehicles?vin=${encodeURIComponent(vin.trim())}&limit=2`,
    { retries: 0 }
  );
  if (!result.ok) return { verdict: 'unavailable', holderId: null };

  // The vehicle being edited holds its own VIN, and that is not a conflict.
  const others = result.data.items.filter((item) => item.id !== excludeVehicleId);
  return others.length > 0
    ? { verdict: 'duplicate', holderId: others[0]?.id ?? null }
    : { verdict: 'available', holderId: null };
}
