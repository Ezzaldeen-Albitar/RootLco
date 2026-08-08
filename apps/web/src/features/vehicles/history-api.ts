'use server';

import { z } from 'zod';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import type { ActionState } from '@/lib/forms/action-result';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import { fieldErrorsOf, optionalField, vehicleBase, writeVehicle } from './write-support';
import {
  MAX_ODOMETER_VALUE,
  MAX_PLATE_RAW,
  ODOMETER_CAPTURE_METHODS,
  ODOMETER_UNITS,
  type OdometerReadingEntry,
  type OwnershipHistoryEntry,
  type PlateHistoryEntry,
} from './history-contract';

/**
 * Vehicle history reads (`FE-021`, `FE-022`, `FE-023`).
 *
 * ## These five sub-resource GETs never check that the vehicle exists
 *
 * An unknown, soft-deleted or cross-tenant `vehicleId` yields an **empty 200
 * page**, not a 404 — while `veh.vehicle-read` on the same id answers 404. The
 * two are inconsistent, and a screen that trusted either alone would be wrong
 * half the time.
 *
 * So every history section is rendered **beneath a vehicle already read by the
 * page**. The 404 is decided once, by the detail read, and an empty history
 * section below a vehicle that demonstrably exists means what it says: no rows.
 *
 * ## The cursors are microsecond-safe as of `P1-27-INT-008`
 *
 * All three of these operations minted their cursor from a JS `Date` until
 * PR #197. They now select `cursorTimestamp(...)`, so a page walk over rows
 * written in one transaction no longer skips the siblings of the row it stopped
 * on. Nothing here reconstructs a cursor from a published timestamp.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/**
 * One history list.
 *
 * `segment` comes from the three exported functions and never from a caller;
 * the vehicle id is encoded. A segment arriving from a URL could otherwise walk
 * to a different operation.
 */
async function listHistory<Row>(
  vehicleId: string,
  segment: 'ownerships' | 'plates' | 'odometer-readings',
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Row>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/${segment}` +
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
    // No `total`. These operations publish `hasMore` and nothing else.
  };
}

export async function listOwnerships(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<OwnershipHistoryEntry>> {
  return listHistory<OwnershipHistoryEntry>(vehicleId, 'ownerships', request, cursor);
}

export async function listPlates(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<PlateHistoryEntry>> {
  return listHistory<PlateHistoryEntry>(vehicleId, 'plates', request, cursor);
}

export async function listOdometerReadings(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<OdometerReadingEntry>> {
  return listHistory<OdometerReadingEntry>(vehicleId, 'odometer-readings', request, cursor);
}

/**
 * The two history WRITES (`FE-022` plate, `FE-023` odometer).
 *
 * Both operations were registered, permission-covered and reachable from no
 * screen: a registration plate could be entered nowhere in the product. The
 * phase's own traceability recorded them as "Not called", and the repository
 * records its deliberate absences separately — `veh.vehicle-merge` is marked
 * "Deliberately absent — P1-OD-017" — so these are oversights, not decisions.
 *
 * Neither sets `Idempotency-Key`. Both operations are `idempotent: true` and the
 * key comes from the contract-derived authority in the client; a second one here
 * would be the shape of the defect rather than the fix (`P1-27-INT-003`).
 */

const plateSchema = z
  .object({
    // 2–3 characters, matching the route. Uppercased ONLY when present.
    countryCode: z
      .string()
      .trim()
      .min(2, 'vehicles.plate.error.country')
      .max(3, 'vehicles.plate.error.country')
      .transform((value) => value.toUpperCase()),
    plateRaw: z.string().trim().min(1, 'field.required').max(MAX_PLATE_RAW),
    // `YYYY-MM-DD`, exactly ten characters. A `date` input produces this and
    // carries no time and no zone, so the calendar day cannot shift — which is
    // the same reason the read returns `valid_from`/`valid_to` as `::text`.
    effectiveDate: z.string().trim().length(10, 'vehicles.plate.error.date').optional(),
  })
  .strict();

/** `FE-022` — assign a registration plate. `veh.vehicle.manage`. */
export async function assignPlateAction(
  vehicleId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return writeVehicle(
    previous,
    () => {
      const parsed = plateSchema.safeParse({
        countryCode: String(form.get('countryCode') ?? ''),
        plateRaw: String(form.get('plateRaw') ?? ''),
        ...(optionalField(form, 'effectiveDate')
          ? { effectiveDate: optionalField(form, 'effectiveDate') }
          : {}),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsOf(parsed.error) };
    },
    `${vehicleBase(vehicleId)}/plates`,
    'vehicles.plate.assigned'
  );
}

const odometerSchema = z
  .object({
    // A number, not a string. The route's field is `z.number()`, and sending
    // `"120000"` would be a 422. `Number('')` is 0, so an empty box must fail as
    // required rather than silently record a zero reading.
    value: z.number({ message: 'field.required' }).min(0).max(MAX_ODOMETER_VALUE),
    unit: z.enum(ODOMETER_UNITS),
    observedAt: z.string().trim().min(16, 'vehicles.odometer.error.observedAt').max(40),
    captureMethod: z.enum(ODOMETER_CAPTURE_METHODS).optional(),
  })
  .strict();

/**
 * `FE-023` — record an odometer reading. `veh.vehicle.odometer.record`.
 *
 * No unit conversion happens here. The database keeps the canonical kilometre
 * equivalent and it stays the authority; converting client-side would put a
 * second answer in the product for "how far has this vehicle travelled".
 */
export async function recordOdometerAction(
  vehicleId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return writeVehicle(
    previous,
    () => {
      const raw = String(form.get('value') ?? '').trim();
      const parsed = odometerSchema.safeParse({
        value: raw.length === 0 ? undefined : Number(raw),
        unit: String(form.get('unit') ?? ''),
        observedAt: String(form.get('observedAt') ?? ''),
        ...(optionalField(form, 'captureMethod')
          ? { captureMethod: optionalField(form, 'captureMethod') }
          : {}),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsOf(parsed.error) };
    },
    `${vehicleBase(vehicleId)}/odometer-readings`,
    'vehicles.odometer.recorded'
  );
}
