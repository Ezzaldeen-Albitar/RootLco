'use server';

import { z } from 'zod';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import {
  AUTHORIZED_ACTIONS,
  EV_KINDS,
  type EvProfile,
  type VehicleRelationship,
} from './relations-contract';

/**
 * EV profile (`FE-024`) and vehicle-customer relationships (`FE-025`).
 *
 * ## `evProfileState` distinguishes the two meanings of a 404
 *
 * `GET /vehicles/{id}/ev-profile` answers 404 both when the vehicle is missing
 * and when it simply has no profile. Returning `'none'` for that case rather
 * than an error is only defensible because the caller reaches this from a
 * vehicle it has already read — the missing-vehicle half was decided upstream.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export type EvProfileState =
  | { readonly status: 'ok'; readonly profile: EvProfile }
  /** The vehicle has no EV profile. For an ICE vehicle this is expected. */
  | { readonly status: 'none' }
  | {
      readonly status: 'denied' | 'expired' | 'error' | 'unavailable';
      readonly correlationId: string | null;
    };

export async function readEvProfile(vehicleId: string): Promise<EvProfileState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };

  const result = await client.get<EvProfile>(
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/ev-profile`,
    { retries: 0 }
  );

  if (result.ok) return { status: 'ok', profile: result.data };

  if (result.kind === 'not-found') {
    // NOT an error. The operation returns 404 for "no profile" as well as "no
    // vehicle", and the vehicle's existence was already established by the page.
    return { status: 'none' };
  }

  const mapped = STATUS_BY_KIND[result.kind];
  return {
    status: mapped === 'not-found' ? 'error' : mapped,
    correlationId: result.correlationId,
  };
}

export async function listRelationships(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<VehicleRelationship>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/relationships` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<VehicleRelationship>>(path, { retries: 0 });
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
  };
}

const evProfileSchema = z
  .object({
    evKind: z.enum(EV_KINDS),
    // `numeric` on the column, a NUMBER in the request — the route's Zod schema
    // types it `z.number()`, so a form's string would be a 422.
    usableCapacityKwh: z.number().positive().nullable().optional(),
    chargePortType: z.string().trim().min(1).max(60).nullable().optional(),
    highVoltageWarning: z.boolean().optional(),
  })
  .strict();

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/**
 * `FE-024` — set the EV profile. `veh.vehicle.manage`, idempotent.
 *
 * A **replace**, not a patch: the operation is "set (create or replace)", so
 * every field is sent every time and an omitted one is cleared. The form is
 * therefore pre-filled from the current profile rather than left blank, or
 * saving one field would silently erase the others.
 */
export async function setEvProfileAction(
  vehicleId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const capacityRaw = String(form.get('usableCapacityKwh') ?? '').trim();
  const portRaw = String(form.get('chargePortType') ?? '').trim();

  const parsed = evProfileSchema.safeParse({
    evKind: String(form.get('evKind') ?? ''),
    // Empty means "not recorded" — an explicit null, which this replace accepts
    // and which is different from omitting the key.
    usableCapacityKwh: capacityRaw === '' ? null : Number(capacityRaw),
    chargePortType: portRaw === '' ? null : portRaw,
    highVoltageWarning: form.get('highVoltageWarning') !== null,
  });
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send(
    'POST',
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/ev-profile`,
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: 'vehicles.ev.saved',
    correlationId: result.correlationId,
    attempt,
  };
}

const authorizeSchema = z
  .object({
    partnerId: z.string().uuid('field.required'),
    // Non-empty, duplicate-free, and a subset of the six —
    // `veh.valid_authorization_scope` enforces all three.
    allowedActions: z.array(z.enum(AUTHORIZED_ACTIONS)).min(1, 'vehicles.relationships.scopeEmpty'),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'field.required')
      .optional(),
  })
  .strict();

/**
 * `FE-025` — authorize a customer as a scoped party.
 * **`veh.vehicle.relationship.manage`**, not `veh.vehicle.manage`.
 *
 * `effectiveDate` is sent as the `YYYY-MM-DD` string the operator chose, never
 * derived from a `Date`. Omitting it lets the DATABASE SERVER's calendar decide
 * the start day, which is a different day from the operator's in most of the
 * world — so an unset date is sent as absent deliberately, and the screen says
 * what that means.
 */
export async function authorizePartyAction(
  vehicleId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const effective = String(form.get('effectiveDate') ?? '').trim();
  const parsed = authorizeSchema.safeParse({
    partnerId: String(form.get('partnerId') ?? '').trim(),
    allowedActions: form.getAll('allowedActions').map(String),
    ...(effective === '' ? {} : { effectiveDate: effective }),
  });
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send(
    'POST',
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/authorized-parties`,
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: 'vehicles.relationships.authorized',
    correlationId: result.correlationId,
    attempt,
  };
}

/**
 * `FE-025` — retire an authorized party by closing its interval.
 *
 * A retirement, not a deletion. The relationship stays in the history with a
 * `valid_to`, which is what makes "who was authorized last March" answerable.
 */
export async function retirePartyAction(
  vehicleId: string,
  relationshipId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const effective = String(form.get('effectiveDate') ?? '').trim();
  if (effective !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    return invalid({ effectiveDate: 'field.required' }, attempt);
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send(
    'POST',
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/authorized-parties/${encodeURIComponent(relationshipId)}/retirement`,
    effective === '' ? {} : { effectiveDate: effective }
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: 'vehicles.relationships.retired',
    correlationId: result.correlationId,
    attempt,
  };
}
