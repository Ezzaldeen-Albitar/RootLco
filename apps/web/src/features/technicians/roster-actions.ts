'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import { issueKeysByField } from '@/features/authentication/schemas/credentials';
import type {
  TechnicianAvailabilityRecordBody,
  TechnicianCertificationDetailRecordBody,
  TechnicianCertificationUpdateBody,
  TechnicianCreateBody,
  TechnicianSkillSetBody,
  TechnicianUpdateBody,
} from '@/lib/contracts/technician-contract';

/**
 * The technician roster's writes (`P1-32-PRE-OD-ADM2B`).
 *
 * Every write takes `tech.technician.manage`; the certificate number takes
 * `iam.sensitive.view` as well. The screens check the same rules first and mark
 * each field; the check here is the one that decides before anything is sent,
 * and the server's is the one that decides after. A refusal comes back keyed by
 * the same field names the forms use.
 *
 * ## Versions come from the record the operator was looking at
 *
 * `tech.technician-update`, `tech.technician-availability-withdraw` and
 * `tech.technician-certification-update` are version-guarded. Each takes the
 * `recordVersion` the detail read published for that record and sends it as
 * `If-Match`; a stale one is a conflict, said as one, and nothing here re-reads
 * and resubmits on the operator's behalf.
 *
 * The three creates (`tech.technician-create`, `-availability-record`) carry an
 * idempotency key, which the client adds from the published contract.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** An instant with its offset — the one form `DateTimeField` emits and the route accepts. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const EXPIRED: ActionState = { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };
const NOT_FOUND: ActionState = {
  status: 'invalid',
  messageKey: 'state.notFound.message',
  attempt: 1,
};

function profilePath(technicianProfileId: string): string {
  return `/api/v1/technicians/${encodeURIComponent(technicianProfileId)}`;
}

function text(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function versionOk(recordVersion: number): boolean {
  return Number.isInteger(recordVersion) && recordVersion >= 1;
}

const createSchema = z.object({
  userId: z.string().regex(UUID, 'technicians.roster.personRequired'),
  companyId: z.string().regex(UUID, 'state.notFound.message'),
  branchId: z.string().regex(UUID, 'state.notFound.message'),
  trade: z.string().max(64, 'field.tooLong').optional(),
  employmentRef: z.string().max(64, 'field.tooLong').optional(),
});

/** Puts a person on the branch's technician roster. */
export async function createTechnician(input: {
  readonly userId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly trade: string;
  readonly employmentRef: string;
}): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    userId: input.userId,
    companyId: input.companyId,
    branchId: input.branchId,
    trade: text(input.trade),
    employmentRef: text(input.employmentRef),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), 1);

  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const { trade, employmentRef, ...required } = parsed.data;
  const body: TechnicianCreateBody = {
    ...required,
    ...(trade === undefined ? {} : { trade }),
    ...(employmentRef === undefined ? {} : { employmentRef }),
  };
  const result = await client.send('POST', '/api/v1/technicians', body);
  if (!result.ok) return fromFailure(result, 1);
  return success('technicians.roster.created', 1);
}

const updateSchema = z.object({
  trade: z.string().max(64, 'field.tooLong').nullable(),
  employmentRef: z.string().max(64, 'field.tooLong').nullable(),
});

/**
 * Changes the trade and the employment reference. A cleared box clears the
 * value (`null`); only what changed is sent, so a save with nothing changed is
 * refused here rather than sent.
 */
export async function updateTechnicianDetails(
  technicianProfileId: string,
  recordVersion: number,
  input: {
    readonly trade: string;
    readonly employmentRef: string;
    readonly previousTrade: string | null;
    readonly previousEmploymentRef: string | null;
  }
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId) || !versionOk(recordVersion)) return NOT_FOUND;
  const parsed = updateSchema.safeParse({
    trade: text(input.trade) ?? null,
    employmentRef: text(input.employmentRef) ?? null,
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), 1);
  const body: TechnicianUpdateBody = {
    ...(parsed.data.trade === input.previousTrade ? {} : { trade: parsed.data.trade }),
    ...(parsed.data.employmentRef === input.previousEmploymentRef
      ? {}
      : { employmentRef: parsed.data.employmentRef }),
  };
  if (Object.keys(body).length === 0) {
    return invalid({}, 1, 'form.violation.empty_update');
  }
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send('PATCH', profilePath(technicianProfileId), body, {
    ifMatch: recordVersion,
  });
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

/** Makes the technician active or inactive. An inactive technician cannot be given work. */
export async function setTechnicianActive(
  technicianProfileId: string,
  recordVersion: number,
  isActive: boolean
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId) || !versionOk(recordVersion)) return NOT_FOUND;
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const body: TechnicianUpdateBody = { isActive };
  const result = await client.send('PATCH', profilePath(technicianProfileId), body, {
    ifMatch: recordVersion,
  });
  if (!result.ok) return fromFailure(result, 1);
  return success(isActive ? 'technicians.profile.activated' : 'technicians.profile.deactivated', 1);
}

/**
 * Takes the technician off the roster. A soft delete: the record of the work
 * they did stays, and the person may be put on a roster again.
 */
export async function retireTechnician(
  technicianProfileId: string,
  recordVersion: number
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId) || !versionOk(recordVersion)) return NOT_FOUND;
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const body: TechnicianUpdateBody = { retire: true };
  const result = await client.send('PATCH', profilePath(technicianProfileId), body, {
    ifMatch: recordVersion,
  });
  if (!result.ok) return fromFailure(result, 1);
  return success('technicians.profile.retired', 1);
}

const availabilitySchema = z.object({
  from: z.string().regex(INSTANT, 'field.required'),
  to: z.string().regex(INSTANT, 'field.required'),
  availabilityKind: z.enum(['available', 'unavailable'], { message: 'field.required' }),
  reason: z.string().max(500, 'field.tooLong').optional(),
});

/** Records one availability or unavailability window. */
export async function recordAvailability(
  technicianProfileId: string,
  input: {
    readonly from: string;
    readonly to: string;
    readonly availabilityKind: string;
    readonly reason: string;
  }
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId)) return NOT_FOUND;
  const parsed = availabilitySchema.safeParse({
    from: input.from,
    to: input.to,
    availabilityKind: input.availabilityKind,
    reason: text(input.reason),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), 1);
  if (Date.parse(parsed.data.to) <= Date.parse(parsed.data.from)) {
    return invalid({ to: 'field.windowEndsBeforeStart' }, 1);
  }
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const { reason, ...required } = parsed.data;
  const body: TechnicianAvailabilityRecordBody = {
    ...required,
    ...(reason === undefined ? {} : { reason }),
  };
  const result = await client.send(
    'POST',
    `${profilePath(technicianProfileId)}/availability`,
    body
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('technicians.availability.recorded', 1);
}

/** Withdraws one window, freeing the time it held. */
export async function withdrawAvailability(
  technicianProfileId: string,
  availabilityId: string,
  recordVersion: number
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId) || !UUID.test(availabilityId) || !versionOk(recordVersion)) {
    return NOT_FOUND;
  }
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send(
    'DELETE',
    `${profilePath(technicianProfileId)}/availability/${encodeURIComponent(availabilityId)}`,
    undefined,
    { ifMatch: recordVersion }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('technicians.availability.withdrawn', 1);
}

/** Gives the technician a skill at a level, or moves the level of one they hold. */
export async function setTechnicianSkill(
  technicianProfileId: string,
  input: { readonly skillId: string; readonly skillLevelId: string }
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId)) return NOT_FOUND;
  const found: Record<string, string> = {};
  if (!UUID.test(input.skillId)) found['skillId'] = 'field.required';
  if (!UUID.test(input.skillLevelId)) found['skillLevelId'] = 'field.required';
  if (Object.keys(found).length > 0) return invalid(found, 1);
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const body: TechnicianSkillSetBody = { skillLevelId: input.skillLevelId };
  const result = await client.send(
    'PUT',
    `${profilePath(technicianProfileId)}/skills/${encodeURIComponent(input.skillId)}`,
    body
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('technicians.skills.saved', 1);
}

/** Withdraws a skill. Its history stays readable. */
export async function withdrawTechnicianSkill(
  technicianProfileId: string,
  skillId: string
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId) || !UUID.test(skillId)) return NOT_FOUND;
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send(
    'DELETE',
    `${profilePath(technicianProfileId)}/skills/${encodeURIComponent(skillId)}`
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('technicians.skills.withdrawn', 1);
}

/**
 * Changes a held certification's state or its expiry. A cleared expiry is sent
 * as `null` — a credential that no longer lapses. Only what changed is sent.
 */
export async function updateTechnicianCertification(
  technicianProfileId: string,
  certificationId: string,
  recordVersion: number,
  input: {
    readonly certStatus: string;
    readonly expiresOn: string;
    readonly previousStatus: string;
    readonly previousExpiresOn: string | null;
    readonly issuedOnDay: string;
  }
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId) || !UUID.test(certificationId) || !versionOk(recordVersion)) {
    return NOT_FOUND;
  }
  const found: Record<string, string> = {};
  const statusOk =
    input.certStatus === 'active' ||
    input.certStatus === 'expired' ||
    input.certStatus === 'revoked';
  if (!statusOk) found['certStatus'] = 'field.required';
  const expiresOn = input.expiresOn === '' ? null : input.expiresOn;
  if (expiresOn !== null && !DAY.test(expiresOn)) found['expiresOn'] = 'field.invalid';
  else if (expiresOn !== null && expiresOn < input.issuedOnDay) {
    found['expiresOn'] = 'form.violation.before-issued';
  }
  if (Object.keys(found).length > 0) return invalid(found, 1);
  const body: TechnicianCertificationUpdateBody = {
    ...(input.certStatus === input.previousStatus
      ? {}
      : { certStatus: input.certStatus as 'active' | 'expired' | 'revoked' }),
    ...(expiresOn === input.previousExpiresOn ? {} : { expiresOn }),
  };
  if (Object.keys(body).length === 0) return invalid({}, 1, 'form.violation.empty_update');
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send(
    'PATCH',
    `${profilePath(technicianProfileId)}/certifications/${encodeURIComponent(certificationId)}`,
    body,
    { ifMatch: recordVersion }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

/**
 * Records the restricted certificate number. It is sent once and never read
 * back: no operation answers it, and the screen never shows it.
 */
export async function recordCertificateNumber(
  technicianProfileId: string,
  certificationId: string,
  certificateNumber: string
): Promise<ActionState> {
  if (!UUID.test(technicianProfileId) || !UUID.test(certificationId)) return NOT_FOUND;
  const value = certificateNumber.trim();
  if (value.length === 0) return invalid({ certificateNumber: 'field.required' }, 1);
  if (value.length > 128) return invalid({ certificateNumber: 'field.tooLong' }, 1);
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const body: TechnicianCertificationDetailRecordBody = { certificateNumber: value };
  const result = await client.send(
    'PUT',
    `${profilePath(technicianProfileId)}/certifications/${encodeURIComponent(certificationId)}/detail`,
    body
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('technicians.certifications.numberRecorded', 1);
}
