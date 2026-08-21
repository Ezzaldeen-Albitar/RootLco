'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
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
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

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
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

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
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

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
