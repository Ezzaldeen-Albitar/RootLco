'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiResult } from '@/lib/api/client';
import {
  STATUS_BY_KIND,
  query,
  readOperation,
  type CursorPage,
  type ReadFailureStatus,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';

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

/* ------------------------------------------------------------------ *
 * The setup surface — the appointment setup screen (Owner decision 2026-09-29)
 * ------------------------------------------------------------------ *
 *
 * | operation                                          | method | path                                                              |
 * | -------------------------------------------------- | ------ | ----------------------------------------------------------------- |
 * | `apt.catalogue-appointment-type-management-list`   | GET    | `/appointment-catalogue/management/appointment-types`             |
 * | `apt.catalogue-appointment-type-create`            | POST   | `/appointment-catalogue/appointment-types`                        |
 * | `apt.catalogue-appointment-type-update`            | PATCH  | `/appointment-catalogue/appointment-types/{appointmentTypeId}`    |
 * | `apt.catalogue-appointment-type-status-set`        | POST   | `/appointment-catalogue/appointment-types/{appointmentTypeId}/status` |
 *
 * and the same four for `source-channels` and `cancellation-reasons`. All twelve
 * are `apt.catalogue.manage`, tenant-scoped: an entry created here is always the
 * organisation's own, and a shared platform entry answers 403 to a change. The
 * rename and the status change are version-guarded: `ifMatch` is the version the
 * screen was shown — from the management list, or held by the edit form — never a
 * number the screen made up, and a stale one is the server's conflict.
 *
 * Nothing is seeded, here or anywhere: an empty list is the organisation that has
 * not entered its own entries yet, and the screen says so.
 */

/** One entry as the setup screen sees it: every entry, retired included. */
export interface ManagedCatalogueEntry {
  readonly id: string;
  /** `tenant` for the organisation's own entry; `platform` for a shared one it cannot change. */
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  /** `active` or `inactive`. */
  readonly status: string;
  readonly recordVersion: number;
}

/** What a create sends — exactly the two fields the routes accept. */
export interface CatalogueEntryDraft {
  readonly code: string;
  readonly name: string;
}

/** A catalogue status the status routes accept. */
export type CatalogueEntryStatus = 'active' | 'inactive';

/** The server's own code rule (`CATALOGUE_CODE_PATTERN`), mirrored so a refusal is local. */
const CODE_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;
/** The server's own name bound (`MAX_CATALOGUE_NAME`). */
const MAX_NAME = 200;
const EXPIRED: ActionState = { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/*
 * Path helpers are FUNCTION declarations, not arrows: `check-p1-28-access`
 * resolves only `function`-declared helpers when it derives an operation's path
 * from a call site.
 */
function appointmentTypePath(appointmentTypeId: string, tail = ''): string {
  return `/api/v1/appointment-catalogue/appointment-types/${encodeURIComponent(appointmentTypeId)}${tail}`;
}
function sourceChannelPath(sourceChannelId: string, tail = ''): string {
  return `/api/v1/appointment-catalogue/source-channels/${encodeURIComponent(sourceChannelId)}${tail}`;
}
function cancellationReasonPath(cancellationReasonId: string, tail = ''): string {
  return `/api/v1/appointment-catalogue/cancellation-reasons/${encodeURIComponent(cancellationReasonId)}${tail}`;
}

/** The field complaints a draft earns before anything is sent, keyed by field. */
function draftProblems(draft: CatalogueEntryDraft): Record<string, string> {
  const found: Record<string, string> = {};
  const code = draft.code.trim();
  const name = draft.name.trim();
  if (code.length === 0) found['code'] = 'field.required';
  else if (!CODE_PATTERN.test(code)) found['code'] = 'appointmentSetup.codeInvalid';
  if (name.length === 0) found['name'] = 'field.required';
  else if (name.length > MAX_NAME) found['name'] = 'field.tooLong';
  return found;
}

/** The complaint a name earns before anything is sent, or none. */
function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'field.required';
  if (trimmed.length > MAX_NAME) return 'field.tooLong';
  return null;
}

/** One page of a management list — one request, so the grid pages on the server's cursor. */
async function readManaged(
  path: string,
  limit: number,
  cursor: string | null
): Promise<ReadState<CursorPage<ManagedCatalogueEntry>>> {
  return readOperation<CursorPage<ManagedCatalogueEntry>>(path + query({ cursor, limit }));
}

/**
 * A create, with the one refusal worth naming on its field: the code is taken
 * (`ERR-RES-002`) — by an entry the organisation retired, perhaps, which it can
 * restore instead. The refusal stays what the shared mapping says it is (a
 * blocked conflict, which re-reading does not cure); it only gains the field it
 * is about, so the form marks the short reference rather than the whole form.
 */
async function createEntry(
  method: 'POST',
  path: string,
  draft: CatalogueEntryDraft
): Promise<ActionState> {
  const found = draftProblems(draft);
  if (Object.keys(found).length > 0) return invalid(found, 1);
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<ManagedCatalogueEntry>(method, path, {
    code: draft.code.trim(),
    name: draft.name.trim(),
  });
  if (!result.ok) {
    const refused = fromFailure(result, 1);
    if (result.problem?.code === 'ERR-RES-002') {
      return { ...refused, fieldErrors: { code: 'appointmentSetup.codeTaken' } };
    }
    return refused;
  }
  return {
    status: 'success',
    messageKey: 'appointmentSetup.created',
    correlationId: result.correlationId,
    attempt: 1,
  };
}

/**
 * What a guarded change answered, as the screen reads it. The send itself is
 * written out in each adapter, with its method and its path, so every gate that
 * attributes a version-guarded request can see which operation it is.
 */
function settled(result: ApiResult<ManagedCatalogueEntry>, messageKey: string): ActionState {
  if (!result.ok) return fromFailure(result, 1);
  return { status: 'success', messageKey, correlationId: result.correlationId, attempt: 1 };
}

function badTarget(id: string, ifMatch: number): boolean {
  return !UUID.test(id) || !Number.isInteger(ifMatch) || ifMatch < 1;
}

/* --- appointment types --- */

/** `apt.catalogue-appointment-type-management-list` — every type, retired included. */
export async function listManagedAppointmentTypes(
  limit: number,
  cursor: string | null
): Promise<ReadState<CursorPage<ManagedCatalogueEntry>>> {
  return readManaged('/api/v1/appointment-catalogue/management/appointment-types', limit, cursor);
}

/** `apt.catalogue-appointment-type-create`. */
export async function createAppointmentType(draft: CatalogueEntryDraft): Promise<ActionState> {
  return createEntry('POST', '/api/v1/appointment-catalogue/appointment-types', draft);
}

/** `apt.catalogue-appointment-type-update` — the name only; the code never changes. */
export async function renameAppointmentType(
  appointmentTypeId: string,
  ifMatch: number,
  name: string
): Promise<ActionState> {
  const problem = nameProblem(name);
  if (problem) return invalid({ name: problem }, 1);
  if (badTarget(appointmentTypeId, ifMatch)) return invalid({}, 1, 'state.notFound.message');
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<ManagedCatalogueEntry>(
    'PATCH',
    appointmentTypePath(appointmentTypeId),
    { name: name.trim() },
    { ifMatch }
  );
  return settled(result, 'appointmentSetup.renamed');
}

/** `apt.catalogue-appointment-type-status-set` — retire, or restore. */
export async function setAppointmentTypeStatus(
  appointmentTypeId: string,
  ifMatch: number,
  status: CatalogueEntryStatus
): Promise<ActionState> {
  if (badTarget(appointmentTypeId, ifMatch)) return invalid({}, 1, 'state.notFound.message');
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<ManagedCatalogueEntry>(
    'POST',
    appointmentTypePath(appointmentTypeId, '/status'),
    { status },
    { ifMatch }
  );
  return settled(
    result,
    status === 'active' ? 'appointmentSetup.restored' : 'appointmentSetup.retired'
  );
}

/* --- source (booking) channels --- */

/** `apt.catalogue-source-channel-management-list` — every channel, retired included. */
export async function listManagedSourceChannels(
  limit: number,
  cursor: string | null
): Promise<ReadState<CursorPage<ManagedCatalogueEntry>>> {
  return readManaged('/api/v1/appointment-catalogue/management/source-channels', limit, cursor);
}

/** `apt.catalogue-source-channel-create`. */
export async function createSourceChannel(draft: CatalogueEntryDraft): Promise<ActionState> {
  return createEntry('POST', '/api/v1/appointment-catalogue/source-channels', draft);
}

/** `apt.catalogue-source-channel-update` — the name only; the code never changes. */
export async function renameSourceChannel(
  sourceChannelId: string,
  ifMatch: number,
  name: string
): Promise<ActionState> {
  const problem = nameProblem(name);
  if (problem) return invalid({ name: problem }, 1);
  if (badTarget(sourceChannelId, ifMatch)) return invalid({}, 1, 'state.notFound.message');
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<ManagedCatalogueEntry>(
    'PATCH',
    sourceChannelPath(sourceChannelId),
    { name: name.trim() },
    { ifMatch }
  );
  return settled(result, 'appointmentSetup.renamed');
}

/** `apt.catalogue-source-channel-status-set` — retire, or restore. */
export async function setSourceChannelStatus(
  sourceChannelId: string,
  ifMatch: number,
  status: CatalogueEntryStatus
): Promise<ActionState> {
  if (badTarget(sourceChannelId, ifMatch)) return invalid({}, 1, 'state.notFound.message');
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<ManagedCatalogueEntry>(
    'POST',
    sourceChannelPath(sourceChannelId, '/status'),
    { status },
    { ifMatch }
  );
  return settled(
    result,
    status === 'active' ? 'appointmentSetup.restored' : 'appointmentSetup.retired'
  );
}

/* --- cancellation reasons --- */

/** `apt.catalogue-cancellation-reason-management-list` — every reason, retired included. */
export async function listManagedCancellationReasons(
  limit: number,
  cursor: string | null
): Promise<ReadState<CursorPage<ManagedCatalogueEntry>>> {
  return readManaged(
    '/api/v1/appointment-catalogue/management/cancellation-reasons',
    limit,
    cursor
  );
}

/** `apt.catalogue-cancellation-reason-create`. */
export async function createCancellationReason(draft: CatalogueEntryDraft): Promise<ActionState> {
  return createEntry('POST', '/api/v1/appointment-catalogue/cancellation-reasons', draft);
}

/** `apt.catalogue-cancellation-reason-update` — the name only; the code never changes. */
export async function renameCancellationReason(
  cancellationReasonId: string,
  ifMatch: number,
  name: string
): Promise<ActionState> {
  const problem = nameProblem(name);
  if (problem) return invalid({ name: problem }, 1);
  if (badTarget(cancellationReasonId, ifMatch)) return invalid({}, 1, 'state.notFound.message');
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<ManagedCatalogueEntry>(
    'PATCH',
    cancellationReasonPath(cancellationReasonId),
    { name: name.trim() },
    { ifMatch }
  );
  return settled(result, 'appointmentSetup.renamed');
}

/** `apt.catalogue-cancellation-reason-status-set` — retire, or restore. */
export async function setCancellationReasonStatus(
  cancellationReasonId: string,
  ifMatch: number,
  status: CatalogueEntryStatus
): Promise<ActionState> {
  if (badTarget(cancellationReasonId, ifMatch)) return invalid({}, 1, 'state.notFound.message');
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<ManagedCatalogueEntry>(
    'POST',
    cancellationReasonPath(cancellationReasonId, '/status'),
    { status },
    { ifMatch }
  );
  return settled(
    result,
    status === 'active' ? 'appointmentSetup.restored' : 'appointmentSetup.retired'
  );
}
