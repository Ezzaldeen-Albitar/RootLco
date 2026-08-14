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
  query,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ReadState,
} from '@/lib/api/read-operation';
import {
  AUTHORIZATION_CHANNELS,
  AUTHORIZATION_DECISIONS,
  AUTHORIZING_ROLES,
  COMPLAINT_CATEGORIES,
  COMPLAINT_SEVERITIES,
  DAMAGE_MARK_TYPES,
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  LEAK_TYPES,
  MAX_ASSIGNMENT_SOURCE,
  MAX_CLOSURE_REASON,
  MAX_COMPLAINT_TEXT,
  MAX_CONTENT_QUANTITY,
  MAX_COORD,
  MAX_DECLARED_VALUE,
  MAX_ITEM_DESCRIPTION,
  MAX_LOCATION,
  MAX_MAP_TYPE,
  MAX_NOTE,
  MAX_SIGNATURE_HASH_INPUT,
  MAX_SOC_PERCENT,
  MAX_WALK_IN_NOTE,
  MAX_ZONE,
  MIN_COORD,
  MIN_SOC_PERCENT,
  RECEPTION_PARTY_ROLES,
  REFUSAL_TYPES,
  SIGNATURE_CAPTURE_METHODS,
  SIGNATURE_PURPOSES,
  SIGNER_ROLES,
  WARNING_LIGHT_STATES,
  type AuthorizationEntry,
  type AuthorizationInput,
  type AuthorizationRecorded,
  type CloseReceptionInput,
  type ConditionEvidenceEntry,
  type ConditionEvidenceInput,
  type ConditionEvidenceRecorded,
  type PartyRoleAssigned,
  type PartyRoleEntry,
  type PartyRoleInput,
  type ReceptionApproved,
  type ReceptionClosed,
  type ReceptionConverted,
  type ReceptionCreateInput,
  type ReceptionCreated,
  type ReceptionDetail,
  type ReceptionListCriteria,
  type ReceptionListEntry,
  type RefusalInput,
  type RefusalRecorded,
  type SignatureInput,
  type SignatureRecorded,
  type EvidenceKind,
} from './receptions-contract';

/**
 * Reception adapters (P1-28, Wave A).
 *
 * Reads follow the vehicle precedent; the board list carries its mandatory
 * `companyId`/`branchId` pair through `branchTargetQuery` (a resource
 * selector, `P1-18-A-01`), and the per-visit reads take only what each
 * `.strict()` schema names. Writes follow the P1-27 order — validate, session,
 * send, map — set no `Idempotency-Key` of their own, and the four guarded
 * commands (`approve`, `convert-to-work-order`, `close-without-work`,
 * `refuse`) take `ifMatch` as a REQUIRED parameter because the backend answers
 * 428 `ERR-CON-002` without it.
 *
 * Success states carry NO `messageKey`: outcome copy belongs to the screens.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

function visitPath(receptionId: string, tail = ''): string {
  return `/api/v1/receptions/${encodeURIComponent(receptionId)}${tail}`;
}

/* ------------------------------------------------------------------ *
 * Schemas — field-for-field mirrors of the route schemas
 * ------------------------------------------------------------------ */

const uuid = z.string().uuid();

const originSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('appointment'), appointmentId: uuid }).strict(),
  z
    .object({
      kind: z.literal('walk_in'),
      requesterPartnerId: uuid.nullable().optional(),
      note: z.string().min(1).max(MAX_WALK_IN_NOTE).nullable().optional(),
    })
    .strict(),
]);

const createSchema = z
  .object({
    companyId: uuid,
    branchId: uuid,
    vehicleId: uuid,
    receivingEmployeeId: uuid,
    serviceRequesterPartnerId: uuid,
    origin: originSchema,
    odometerReadingId: uuid.nullable().optional(),
    fuelLevelId: uuid.nullable().optional(),
    evSocPercent: z.number().min(MIN_SOC_PERCENT).max(MAX_SOC_PERCENT).nullable().optional(),
  })
  .strict();

const partyRoleSchema = z
  .object({
    partnerId: uuid,
    relationshipRole: z.enum(RECEPTION_PARTY_ROLES),
    assignmentSource: z.string().max(MAX_ASSIGNMENT_SOURCE).nullable().optional(),
    supersede: z.boolean().optional(),
  })
  .strict();

const authorizationSchema = z
  .object({
    authorizingRole: z.enum(AUTHORIZING_ROLES),
    partnerId: uuid,
    decision: z.enum(AUTHORIZATION_DECISIONS),
    channel: z.enum(AUTHORIZATION_CHANNELS).optional(),
    authorizedScope: z.record(z.string(), z.unknown()).nullable().optional(),
    evidenceDocumentId: uuid.nullable().optional(),
  })
  .strict();

const evidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('complaint'),
      category: z.enum(COMPLAINT_CATEGORIES),
      severity: z.enum(COMPLAINT_SEVERITIES).optional(),
      complaintText: z.string().min(1).max(MAX_COMPLAINT_TEXT),
      reportedByPartnerId: uuid.nullable().optional(),
      evidenceDocumentId: uuid.nullable().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('inspection'), inspectorId: uuid }).strict(),
  z
    .object({
      kind: z.literal('condition_item'),
      inspectionId: uuid,
      findingCategory: z.enum(FINDING_CATEGORIES),
      vehicleZone: z.string().min(1).max(MAX_ZONE),
      severity: z.enum(FINDING_SEVERITIES).optional(),
      findingNote: z.string().min(1).max(MAX_NOTE).nullable().optional(),
      evidenceDocumentId: uuid.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('damage_map'),
      documentId: uuid,
      documentVersionId: uuid,
      mapType: z.string().min(1).max(MAX_MAP_TYPE),
      perspective: z.string().min(1).max(MAX_MAP_TYPE).nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('damage_mark'),
      damageMapId: uuid,
      markType: z.enum(DAMAGE_MARK_TYPES),
      vehicleZone: z.string().min(1).max(MAX_ZONE),
      coordX: z.number().min(MIN_COORD).max(MAX_COORD),
      coordY: z.number().min(MIN_COORD).max(MAX_COORD),
      note: z.string().min(1).max(MAX_NOTE).nullable().optional(),
      evidenceDocumentId: uuid.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('contents'),
      itemDescription: z.string().min(1).max(MAX_ITEM_DESCRIPTION),
      quantity: z.number().int().positive().max(MAX_CONTENT_QUANTITY).optional(),
      location: z.string().min(1).max(MAX_LOCATION).nullable().optional(),
      declaredValue: z.number().nonnegative().max(MAX_DECLARED_VALUE).nullable().optional(),
      declaredCurrency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable()
        .optional(),
      declaredByPartnerId: uuid.nullable().optional(),
      witnessedByEmployeeId: uuid.nullable().optional(),
      evidenceDocumentId: uuid.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('warning_light'),
      warningLightCodeId: uuid,
      // The three states the database CHECK admits, not a bounded free string.
      // A free string here let a value the platform refuses reach the wire and
      // come back 422 `incoherent_reference`; the mirror now refuses it first.
      observedState: z.enum(WARNING_LIGHT_STATES).optional(),
      note: z.string().min(1).max(MAX_NOTE).nullable().optional(),
      evidenceDocumentId: uuid.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('leak'),
      // The seven types the database CHECK admits, not a bounded free string.
      // The field is REQUIRED, so a free string here meant every leak an
      // operator described in their own words reached the wire and came back
      // 422; the mirror refuses it first, beside the field that offers them.
      leakType: z.enum(LEAK_TYPES),
      vehicleZone: z.string().min(1).max(MAX_ZONE),
      severity: z.enum(FINDING_SEVERITIES).optional(),
      note: z.string().min(1).max(MAX_NOTE).nullable().optional(),
      evidenceDocumentId: uuid.nullable().optional(),
    })
    .strict(),
]);

const signatureSchema = z
  .object({
    signerRole: z.enum(SIGNER_ROLES),
    signerPartnerId: uuid.nullable().optional(),
    signatureDocumentId: uuid,
    signatureDocumentVersionId: uuid,
    captureMethod: z.enum(SIGNATURE_CAPTURE_METHODS),
    purpose: z.enum(SIGNATURE_PURPOSES),
    signatureHash: z.string().max(MAX_SIGNATURE_HASH_INPUT).nullable().optional(),
  })
  .strict();

const refusalSchema = z
  .object({
    refusalType: z.enum(REFUSAL_TYPES),
    refusalReasonId: uuid.nullable().optional(),
    refusingPartnerId: uuid.nullable().optional(),
    witnessEmployeeId: uuid.nullable().optional(),
    evidenceDocumentId: uuid.nullable().optional(),
  })
  .strict()
  .superRefine((data, context) => {
    // Mirror of `assertRefusalAttributable`: an authorization refusal becomes
    // the party's STANDING decision, so it must name the party — refused here,
    // beside the field, rather than as the module's 422.
    if (data.refusalType === 'authorization' && (data.refusingPartnerId ?? null) === null) {
      context.addIssue({
        code: 'custom',
        path: ['refusingPartnerId'],
        message: 'field.required',
      });
    }
  });

const closeSchema = z.object({ reason: z.string().trim().min(1).max(MAX_CLOSURE_REASON) }).strict();

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * The branch reception board (`rec.reception-list`), most recently received
 * first. `retries: 0` — `expensive-read`, and the table offers Retry.
 */
export async function listReceptions(
  target: BranchTarget,
  criteria: ReceptionListCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<ReceptionListEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/receptions' +
    branchTargetQuery(target, {
      status: criteria.status,
      vehicleId: criteria.vehicleId,
      cursor,
      limit: request.pageSize,
    });

  const result = await client.get<CursorPage<ReceptionListEntry>>(path, { retries: 0 });
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

/**
 * One visit (`rec.reception-detail`). The returned `recordVersion` is the
 * `If-Match` the four guarded commands demand — the read that ended the
 * "reachable in exactly one unbroken session" era (`P1-27-INT-010`).
 */
export async function readReception(receptionId: string): Promise<ReadState<ReceptionDetail>> {
  return readOperation<ReceptionDetail>(visitPath(receptionId));
}

/** One keyset page of a per-visit sub-list. */
async function readVisitPage<T>(
  receptionId: string,
  tail: string,
  request: TableRequest,
  cursor: string | null,
  extra: Record<string, string | undefined> = {}
): Promise<ServerPage<T>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path = visitPath(receptionId, tail) + query({ ...extra, cursor, limit: request.pageSize });
  const result = await client.get<CursorPage<T>>(path, { retries: 0 });
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

/**
 * The dated party roles of one visit (`rec.reception-party-role-list`).
 * `status` filters `active` (open interval) or `ended`; absent means both.
 */
export async function listPartyRoles(
  receptionId: string,
  status: 'active' | 'ended' | undefined,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<PartyRoleEntry>> {
  return readVisitPage<PartyRoleEntry>(receptionId, '/party-roles', request, cursor, { status });
}

/**
 * The authorization decisions AND refusals of one visit, as one list
 * (`rec.reception-authorization-list`) — `isStanding` marks each partner's
 * CURRENT decision across both tables, which is what approve/convert actually
 * depend on.
 */
export async function listAuthorizations(
  receptionId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<AuthorizationEntry>> {
  return readVisitPage<AuthorizationEntry>(receptionId, '/authorizations', request, cursor);
}

/**
 * The pre-service condition evidence of one visit
 * (`rec.reception-condition-evidence-list`), optionally narrowed to one of the
 * eight kinds the POST accepts.
 */
export async function listConditionEvidence(
  receptionId: string,
  kind: EvidenceKind | undefined,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<ConditionEvidenceEntry>> {
  return readVisitPage<ConditionEvidenceEntry>(
    receptionId,
    '/condition-evidence',
    request,
    cursor,
    { kind }
  );
}

/*
 * `listReceptionHistory` is gone (`P1-28-F9`).
 *
 * It called `GET /receptions/{id}/history` — `rec.reception-history`, the
 * visit's status and custody ledgers — and had ZERO production consumers: a
 * repository-wide search over `apps/web/src` returned its own definition line
 * and nothing else. No canonical P1-28 task binds that operation; the only
 * `*-history` binding in the whole 35-task matrix is
 * `veh.vehicle-odometer-history`, on `FE-013`, which is wired.
 *
 * Wiring it would have meant building a visit-ledger panel no task asks for,
 * so the choice was between an unreachable adapter and an unbound screen. The
 * precedent is `crm/customers/identity-api.ts`, where `listHistory` — the same
 * shape, on the same kind of operation — was deleted one phase earlier under
 * `P1-27-QA-002` rather than given coverage that would have tested an
 * unreachable read.
 *
 * The operation itself is untouched and still published; what is recorded now
 * is that no screen reaches it (`contract-archaeology.md`, row B9-B10).
 */

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export interface ReceptionCreateState extends ActionState {
  readonly created?: ReceptionCreated;
}

/**
 * Check a vehicle in (`rec.reception-create`). One origin, appointment XOR
 * walk-in; for an appointment origin the scope and vehicle MUST be the
 * appointment's own (422 `incoherent_reference`), only a `confirmed`
 * appointment checks in (409 `ERR-TRN-001`), and both "this vehicle already
 * has an open visit" and "this origin was already consumed" arrive as the
 * SAME 409 `ERR-RES-002` — the copy must not guess which.
 */
export async function createReception(
  input: ReceptionCreateInput,
  attempt = 1
): Promise<ReceptionCreateState> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<ReceptionCreated>('POST', '/api/v1/receptions', parsed.data);
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, created: result.data };
}

export interface PartyRoleState extends ActionState {
  readonly assigned?: PartyRoleAssigned;
}

/** Assign a dated party role (`rec.reception-party-role`). Appends, never edits. */
export async function assignPartyRole(
  receptionId: string,
  input: PartyRoleInput,
  attempt = 1
): Promise<PartyRoleState> {
  const parsed = partyRoleSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<PartyRoleAssigned>(
    'POST',
    visitPath(receptionId, '/party-roles'),
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, assigned: result.data };
}

export interface AuthorizationState extends ActionState {
  readonly recorded?: AuthorizationRecorded;
}

/**
 * Record an authorizing party's decision (`rec.reception-authorization`).
 * Whether the partner actually holds an authorizing role is the database
 * guard's verdict, and role-not-held is a deliberately non-disclosing 409
 * `ERR-TRN-001` (anti-probing) — nothing here anticipates it.
 */
export async function recordAuthorization(
  receptionId: string,
  input: AuthorizationInput,
  attempt = 1
): Promise<AuthorizationState> {
  const parsed = authorizationSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<AuthorizationRecorded>(
    'POST',
    visitPath(receptionId, '/authorizations'),
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, recorded: result.data };
}

export interface ConditionEvidenceState extends ActionState {
  readonly recorded?: ConditionEvidenceRecorded;
}

/** Append one piece of condition evidence (`rec.reception-condition-evidence`). */
export async function recordConditionEvidence(
  receptionId: string,
  input: ConditionEvidenceInput,
  attempt = 1
): Promise<ConditionEvidenceState> {
  const parsed = evidenceSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<ConditionEvidenceRecorded>(
    'POST',
    visitPath(receptionId, '/condition-evidence'),
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, recorded: result.data };
}

export interface SignatureState extends ActionState {
  readonly recorded?: SignatureRecorded;
}

/**
 * Record a signature reference (`rec.reception-signature`). Only the document
 * and its exact version travel — never drawn bytes.
 */
export async function recordSignature(
  receptionId: string,
  input: SignatureInput,
  attempt = 1
): Promise<SignatureState> {
  const parsed = signatureSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<SignatureRecorded>(
    'POST',
    visitPath(receptionId, '/signatures'),
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, recorded: result.data };
}

export interface RefusalState extends ActionState {
  readonly recorded?: RefusalRecorded;
}

/**
 * Record refusal EVIDENCE (`rec.reception-refusal`) — a party declined a step.
 * Never changes `receptionStatus`; ending the visit is `refuseReception`.
 */
export async function recordRefusal(
  receptionId: string,
  input: RefusalInput,
  attempt = 1
): Promise<RefusalState> {
  const parsed = refusalSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<RefusalRecorded>(
    'POST',
    visitPath(receptionId, '/refusals'),
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, recorded: result.data };
}

export interface ReceptionApproveState extends ActionState {
  readonly approved?: ReceptionApproved;
}

/**
 * Advance to `authorized` (`rec.reception-approve`). Empty body; may walk two
 * edges in one transaction, so the RESPONSE's `recordVersion` — not
 * `ifMatch + 1` — is what the conversion that follows must present. A re-run
 * on an authorized visit is 409 `ERR-TRN-001`, not idempotent success.
 */
export async function approveReception(
  receptionId: string,
  ifMatch: number,
  attempt = 1
): Promise<ReceptionApproveState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<ReceptionApproved>(
    'POST',
    visitPath(receptionId, '/approve'),
    undefined,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, approved: result.data };
}

export interface ReceptionConvertState extends ActionState {
  readonly converted?: ReceptionConverted;
}

/**
 * Convert to one minimal work order (`rec.reception-convert-to-work-order`).
 * Empty body; the response carries NO ETag, and a replay on a converted visit
 * answers 200 with `alreadyConverted: true` — SUCCESS, which the screen must
 * render as the work order it names, never as an error.
 */
export async function convertReceptionToWorkOrder(
  receptionId: string,
  ifMatch: number,
  attempt = 1
): Promise<ReceptionConvertState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<ReceptionConverted>(
    'POST',
    visitPath(receptionId, '/convert-to-work-order'),
    undefined,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    correlationId: result.correlationId,
    attempt,
    converted: result.data,
  };
}

export interface ReceptionCloseState extends ActionState {
  readonly closed?: ReceptionClosed;
}

/**
 * Close without work (`rec.reception-close-without-work`) — the exit for a
 * visit that will not become a work order. The mandatory bounded-text reason
 * lands in the append-only status ledger, and closing releases the vehicle
 * from `uq_reception_visits_open_vehicle` so it can be received again.
 */
export async function closeReceptionWithoutWork(
  receptionId: string,
  ifMatch: number,
  input: CloseReceptionInput,
  attempt = 1
): Promise<ReceptionCloseState> {
  return closeVisit(receptionId, '/close-without-work', ifMatch, input, attempt);
}

/**
 * Refuse the visit (`rec.reception-refuse`) — ends it as `refused`. Distinct
 * from `recordRefusal`, which appends evidence and changes nothing.
 */
export async function refuseReception(
  receptionId: string,
  ifMatch: number,
  input: CloseReceptionInput,
  attempt = 1
): Promise<ReceptionCloseState> {
  return closeVisit(receptionId, '/refuse', ifMatch, input, attempt);
}

async function closeVisit(
  receptionId: string,
  tail: '/close-without-work' | '/refuse',
  ifMatch: number,
  input: CloseReceptionInput,
  attempt: number
): Promise<ReceptionCloseState> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<ReceptionClosed>(
    'POST',
    visitPath(receptionId, tail),
    parsed.data,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);

  return { status: 'success', correlationId: result.correlationId, attempt, closed: result.data };
}

/*
 * `conditionEvidenceKinds` is gone (`P1-28-F9`).
 *
 * It was an `async` re-export of the frozen `EVIDENCE_KINDS` constant, and its
 * docblock said it was "for the evidence list's filter control". There is no
 * filter control: `EvidencePanels` passes a FIXED kind per panel, and
 * `SummaryStep` and the acknowledgement page pass `undefined`. So the sentence
 * described a screen nobody built, and the function had zero consumers.
 *
 * It could not have earned coverage either — it issues no request, so there is
 * no path, no body and no failure mapping to drive, which is why the QA-001
 * drive corpus carried it as its one written exclusion. Anything that ever does
 * need the vocabulary imports `EVIDENCE_KINDS` from `receptions-contract.ts`,
 * where the contract test already holds it to the operation's own union.
 */
