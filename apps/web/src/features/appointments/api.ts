'use server';

import { z } from 'zod';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { fieldErrorsFrom } from '@/lib/forms/field-errors';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ReadState,
} from '@/lib/api/read-operation';
import {
  MAX_INSTANT_LENGTH,
  hasExplicitUtcOffset,
  type AppointmentCancelInput,
  type AppointmentChanged,
  type AppointmentCreateInput,
  type AppointmentCreated,
  type AppointmentDetail,
  type AppointmentListCriteria,
  type AppointmentListEntry,
  type AppointmentRescheduleInput,
} from './appointments-contract';

/**
 * Appointment adapters (P1-28, Wave A).
 *
 * Reads follow the vehicle-search shape; the list is a BRANCH CALENDAR, so the
 * mandatory `companyId`/`branchId` pair travels through `branchTargetQuery` —
 * the one door `lib/api` opens for a branch resource selector — and never as a
 * loose filter. Writes follow the P1-27 write-adapter order: validate, then
 * session, then send, then map. No adapter sets an `Idempotency-Key` (the
 * contract-derived client authority does), and the three guarded lifecycle
 * commands pass the record version the CALLER read — `ifMatch` is a required
 * parameter here precisely because the backend refuses the request without it
 * (428 `ERR-CON-002`).
 *
 * Success states carry NO `messageKey`: copy belongs to the screen that renders
 * the outcome, and a key invented here would ship untranslated.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/**
 * An instant the routes accept: bounded, and carrying an explicit UTC offset.
 * The offset rule is checked HERE, where the field is, so the operator hears
 * "this needs a timezone" beside the input rather than an opaque 422 — the
 * mirror of `domain/appointment.ts:119`, not a second opinion on it.
 */
const Instant = z
  .string()
  .trim()
  .min(1)
  .max(MAX_INSTANT_LENGTH)
  .refine(hasExplicitUtcOffset, { message: 'field.instantNeedsOffset' })
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'field.invalid' });

const createSchema = z
  .object({
    companyId: z.string().uuid(),
    branchId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    requesterPartnerId: z.string().uuid(),
    appointmentTypeId: z.string().uuid(),
    sourceChannelId: z.string().uuid().nullable().optional(),
    requestedFrom: Instant,
    requestedTo: Instant,
  })
  .strict()
  // Mirrors `ck_appointments_requested_window`: STRICTLY after, compared as
  // instants — a lexical comparison is wrong across mixed offsets.
  .refine((data) => Date.parse(data.requestedTo) > Date.parse(data.requestedFrom), {
    message: 'field.windowEndsBeforeStart',
    path: ['requestedTo'],
  });

const rescheduleSchema = z
  .object({ confirmedFrom: Instant, confirmedTo: Instant })
  .strict()
  .refine((data) => Date.parse(data.confirmedTo) > Date.parse(data.confirmedFrom), {
    message: 'field.windowEndsBeforeStart',
    path: ['confirmedTo'],
  });

const cancelSchema = z.object({ cancellationReasonId: z.string().uuid() }).strict();

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * The branch calendar (`apt.appointment-list`), soonest effective window
 * first. `target` names WHICH branch's calendar — a resource selector the
 * `.strict()` schema requires, not a scope assertion. `retries: 0`: the
 * operation is `expensive-read` and the table offers Retry.
 */
export async function listAppointments(
  target: BranchTarget,
  criteria: AppointmentListCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<AppointmentListEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/appointments' +
    branchTargetQuery(target, {
      status: criteria.status,
      vehicleId: criteria.vehicleId,
      from: criteria.from,
      to: criteria.to,
      cursor,
      limit: request.pageSize,
    });

  const result = await client.get<CursorPage<AppointmentListEntry>>(path, { retries: 0 });
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
 * One appointment (`apt.appointment-detail`). The returned `recordVersion` is
 * the `If-Match` every guarded lifecycle command demands — this read is how an
 * operator arriving by URL becomes able to act at all.
 */
export async function readAppointment(
  appointmentId: string
): Promise<ReadState<AppointmentDetail>> {
  return readOperation<AppointmentDetail>(
    `/api/v1/appointments/${encodeURIComponent(appointmentId)}`
  );
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export interface AppointmentCreateState extends ActionState {
  readonly created?: AppointmentCreated;
}

export interface AppointmentChangeState extends ActionState {
  readonly changed?: AppointmentChanged;
}

/**
 * Book an appointment (`apt.appointment-create`). Always lands `requested`
 * with the REQUESTED window only — there is no way to create a confirmed
 * booking, and this adapter does not pretend otherwise.
 */
export async function createAppointment(
  input: AppointmentCreateInput,
  attempt = 1
): Promise<AppointmentCreateState> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<AppointmentCreated>('POST', '/api/v1/appointments', parsed.data);
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, created: result.data };
}

/**
 * Confirm or reschedule (`apt.appointment-reschedule`) — ONE operation, per
 * UC-APT-001: setting a firm window IS confirming. `ifMatch` is the record
 * version the caller last saw; the loser of a race is told (409 `ERR-CON-001`)
 * rather than silently overwritten.
 *
 * A server-side window violation arrives with path `body.confirmedFrom` even
 * when `confirmedTo` is the bad half (`appointment-service.ts:184`), so render
 * window errors against the window as a whole.
 */
export async function rescheduleAppointment(
  appointmentId: string,
  ifMatch: number,
  input: AppointmentRescheduleInput,
  attempt = 1
): Promise<AppointmentChangeState> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<AppointmentChanged>(
    'POST',
    `/api/v1/appointments/${encodeURIComponent(appointmentId)}/reschedule`,
    parsed.data,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, changed: result.data };
}

/**
 * Cancel (`apt.appointment-cancel`). The reason is mandatory and CATALOGUED —
 * `ck_appointments_cancellation_pairing` — so the picker behind this is the
 * cancellation-reason catalogue read, never a free-text box.
 */
export async function cancelAppointment(
  appointmentId: string,
  ifMatch: number,
  input: AppointmentCancelInput,
  attempt = 1
): Promise<AppointmentChangeState> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<AppointmentChanged>(
    'POST',
    `/api/v1/appointments/${encodeURIComponent(appointmentId)}/cancel`,
    parsed.data,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, changed: result.data };
}

/**
 * Record a no-show (`apt.appointment-no-show`). No body — the fact is the
 * appointment's identity plus the actor the session names — and legal from
 * `confirmed` only; anything else is 409 `ERR-TRN-001`, which re-reading does
 * not cure.
 */
export async function recordAppointmentNoShow(
  appointmentId: string,
  ifMatch: number,
  attempt = 1
): Promise<AppointmentChangeState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<AppointmentChanged>(
    'POST',
    `/api/v1/appointments/${encodeURIComponent(appointmentId)}/no-show`,
    undefined,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, changed: result.data };
}
