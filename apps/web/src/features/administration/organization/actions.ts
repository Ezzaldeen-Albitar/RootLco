'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailure } from '@/lib/api/client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import { issueKeysByField } from '@/features/authentication/schemas/credentials';
import { coerce, settingsPath, type SettingValueType, type SettingsScope } from './types';

/**
 * Writes to the tenant record and to the settings store.
 *
 * ## Nothing here supplies a default
 *
 * The backend's own settings service says it plainly: it writes exactly the key
 * and value the caller supplies, validates the value against its declared type,
 * and supplies no defaults of its own — "what a given key *means* is a decision
 * for the phase that owns it". This phase does not change that. No country, no
 * tax rate, no currency, no retention period acquires a value here because a
 * form had to be filled in with something.
 *
 * ## Conflicts are reported, never retried
 *
 * A settings write that loses the race for a version number produces
 * `ERR-CON-001`, and the tenant update is `If-Match`-guarded. Both surface as a
 * conflict the operator is told about. Silently re-reading and re-submitting
 * would overwrite whatever the other writer just decided, which is the exact
 * outcome optimistic concurrency exists to prevent.
 */

const KEY = /^[a-z][a-z0-9_.]{1,126}$/;

const tenantSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  defaultLocale: z.string().trim().min(2).max(35).optional(),
  defaultTimezone: z.string().trim().min(3).max(64).optional(),
  recordVersion: z.coerce.number().int().min(1),
});

export async function updateTenantAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const parsed = tenantSchema.safeParse({
    displayName: text(form.get('displayName')),
    defaultLocale: text(form.get('defaultLocale')),
    defaultTimezone: text(form.get('defaultTimezone')),
    recordVersion: String(form.get('recordVersion') ?? ''),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const { recordVersion, ...changes } = parsed.data;
  if (Object.values(changes).every((value) => value === undefined)) {
    return invalid({ displayName: 'field.required' }, attempt);
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt };

  const result = await client.send('PATCH', '/api/v1/org/tenant', changes, {
    ifMatch: recordVersion,
  });
  if (!result.ok) {
    // `fk_tenants_default_locale` / `fk_tenants_default_timezone`: the value is
    // not a registered platform language or IANA zone. The Frontend does not
    // pre-validate against a list it does not have — there is no operation that
    // publishes either catalogue (`P1-26-F-006`) — so the backend's verdict is
    // surfaced with its own sentence.
    if (result.kind === 'validation') {
      return {
        status: 'invalid',
        messageKey: 'organization.error.unknownReference',
        correlationId: result.correlationId,
        attempt,
      };
    }
    return fromFailure(result, attempt);
  }
  return success('admin.saved', attempt);
}

const settingSchema = z.object({
  settingKey: z.string().trim().regex(KEY, 'organization.setting.keyHint'),
  valueType: z.enum(['string', 'number', 'boolean', 'json']),
  settingValue: z.string(),
  isSensitive: z.boolean(),
});

/**
 * Writes one setting.
 *
 * The value arrives from a text control as a string and is converted to the
 * shape its declared type requires — a number stays exact by going through
 * `JSON.parse` on a validated numeric literal rather than through
 * `parseFloat`, and `json` is parsed so a malformed document is refused here
 * instead of by a database CHECK the operator cannot read.
 */
export async function writeSettingAction(
  scope: SettingsScope,
  scopeId: string,
  input: {
    readonly settingKey: string;
    readonly valueType: SettingValueType;
    readonly settingValue: string;
    readonly isSensitive: boolean;
  }
): Promise<ActionState> {
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), 1);

  const coerced = coerce(parsed.data.valueType, parsed.data.settingValue);
  if (!coerced.ok) {
    return invalid({ settingValue: 'organization.setting.valueHint' }, 1);
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };

  const result = await client.send('POST', settingsPath(scope, scopeId), {
    settingKey: parsed.data.settingKey,
    settingValue: coerced.value,
    valueType: parsed.data.valueType,
    isSensitive: parsed.data.isSensitive,
  });

  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

export async function changeBranchStatusAction(
  branchId: string,
  to: 'active' | 'inactive',
  reasonText: string,
  recordVersion: number
): Promise<ActionState> {
  if (reasonText.trim().length === 0) {
    return invalid({ reason: 'overlay.reasonRequired' }, 1, 'overlay.reasonRequired');
  }
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };

  const result = await client.send(
    'POST',
    `/api/v1/organization/branches/${encodeURIComponent(branchId)}/status`,
    { to, reason: reasonText.trim() },
    { ifMatch: recordVersion }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

function text(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// --- organisation structure ----------------------------------------------------

const CODE = /^[a-z][a-z0-9_]{1,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const companySchema = z.object({
  code: z.string().regex(CODE, 'organization.structure.codeHint'),
  legalName: z.string().trim().min(1, 'field.required').max(200, 'field.tooLong'),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/, 'organization.company.currencyHint'),
  registrationNumber: z.string().trim().min(1).max(100, 'field.tooLong').optional(),
  taxRegistrationNumber: z.string().trim().min(1).max(100, 'field.tooLong').optional(),
});

/**
 * `POST /api/v1/org/companies` — `org.company-create`, `org.company.manage`.
 *
 * No capacity pre-check. The database decides under a per-organisation lock,
 * and its refusal (`ERR-CAP-001`) arrives through `fromFailure` naming the
 * ceiling and the numbers. A client-side "is there room" check would be a second
 * copy of the rule that is wrong the moment two administrators act at once.
 */
export async function createCompanyAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const parsed = companySchema.safeParse({
    code: String(form.get('code') ?? '').trim(),
    legalName: String(form.get('legalName') ?? ''),
    baseCurrency: String(form.get('baseCurrency') ?? '')
      .trim()
      .toUpperCase(),
    registrationNumber: text(form.get('registrationNumber')),
    taxRegistrationNumber: text(form.get('taxRegistrationNumber')),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt };

  const result = await client.send('POST', '/api/v1/org/companies', {
    code: parsed.data.code,
    legalName: parsed.data.legalName,
    baseCurrency: parsed.data.baseCurrency,
    ...(parsed.data.registrationNumber === undefined
      ? {}
      : { registrationNumber: parsed.data.registrationNumber }),
    ...(parsed.data.taxRegistrationNumber === undefined
      ? {}
      : { taxRegistrationNumber: parsed.data.taxRegistrationNumber }),
  });
  if (!result.ok) return duplicateOr(result, attempt, 'organization.company.duplicateCode');
  return success('organization.company.created', attempt);
}

/**
 * `ERR-RES-002` on these two creates means exactly one thing — the service
 * raises it only for the live-code unique index — so it gets its own sentence.
 * Every other failure, capacity included, goes through `fromFailure`.
 */
function duplicateOr(failure: ApiFailure, attempt: number, duplicateKey: string): ActionState {
  if (failure.kind === 'conflict' && failure.problem?.code === 'ERR-RES-002') {
    return {
      status: 'conflict',
      messageKey: duplicateKey,
      fieldErrors: { code: duplicateKey },
      correlationId: failure.correlationId,
      attempt,
    };
  }
  return fromFailure(failure, attempt);
}

/**
 * `POST /api/v1/org/companies/{companyId}/status` — `org.company-status-set`.
 *
 * Not version-guarded; the operation is idempotent and the client attaches the
 * key. The reason becomes the history row, so an empty one is refused here.
 */
export async function setCompanyStatusAction(
  companyId: string,
  status: 'active' | 'inactive',
  reasonText: string
): Promise<ActionState> {
  const reason = reasonText.trim();
  if (reason.length === 0) {
    return invalid({ reason: 'overlay.reasonRequired' }, 1, 'overlay.reasonRequired');
  }
  if (!UUID.test(companyId)) return invalid({}, 1, 'state.notFound.message');
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };

  const result = await client.send(
    'POST',
    `/api/v1/org/companies/${encodeURIComponent(companyId)}/status`,
    { status, reason: reason.slice(0, 512) }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

const branchSchema = z.object({
  companyId: z.string().regex(UUID, 'organization.branch.companyRequired'),
  code: z.string().regex(CODE, 'organization.structure.codeHint'),
  name: z.string().trim().min(1, 'field.required').max(200, 'field.tooLong'),
  timezone: z.string().trim().min(3, 'organization.branch.timezoneHint').max(64, 'field.tooLong'),
  city: z.string().trim().min(1).max(120, 'field.tooLong').optional(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, 'organization.branch.countryHint')
    .optional(),
});

/** `POST /api/v1/org/branches` — `org.branch-create`, `org.branch.manage`. */
export async function createBranchAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const country = text(form.get('countryCode'));
  const parsed = branchSchema.safeParse({
    companyId: String(form.get('companyId') ?? ''),
    code: String(form.get('code') ?? '').trim(),
    name: String(form.get('name') ?? ''),
    timezone: String(form.get('timezone') ?? ''),
    city: text(form.get('city')),
    countryCode: country === undefined ? undefined : country.toUpperCase(),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt };

  const result = await client.send('POST', '/api/v1/org/branches', {
    companyId: parsed.data.companyId,
    code: parsed.data.code,
    name: parsed.data.name,
    timezone: parsed.data.timezone,
    ...(parsed.data.city === undefined ? {} : { city: parsed.data.city }),
    ...(parsed.data.countryCode === undefined ? {} : { countryCode: parsed.data.countryCode }),
  });
  if (!result.ok) return duplicateOr(result, attempt, 'organization.branch.duplicateCode');
  return success('organization.branch.created', attempt);
}
