/**
 * Organization types, paths and pure helpers.
 *
 * Separate from `api.ts` and `actions.ts` because both are `'use server'`, and a
 * Server Action module may export **only async functions**. A constant, a type
 * re-export or a sync helper beside them rejects the whole module — and the
 * build error names the symptom ("the module has no exports at all") rather than
 * the cause.
 */

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json';

export interface SettingView {
  readonly settingKey: string;
  readonly valueType: SettingValueType;
  readonly isSensitive: boolean;
  readonly version: number;
  readonly effectiveFrom: string;
  /** Absent when the setting is sensitive and the caller may not read those. */
  readonly settingValue?: unknown;
}

export interface TenantView {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly recordVersion: number;
}

export interface BranchStatusView {
  readonly status?: string;
  readonly current?: string;
  readonly available?: readonly string[];
  readonly recordVersion: number;
}

export type ReadStatus = 'ok' | 'denied' | 'expired' | 'unavailable' | 'error' | 'not-found';

export interface Read<T> {
  readonly status: ReadStatus;
  readonly data: T | null;
  readonly correlationId: string | null;
}

export type SettingsScope = 'company' | 'branch';

/** The approved settings path for a scope. Identifiers are always encoded. */
export function settingsPath(scope: SettingsScope, id: string): string {
  return scope === 'company'
    ? `/api/v1/org/companies/${encodeURIComponent(id)}/settings`
    : `/api/v1/org/branches/${encodeURIComponent(id)}/settings`;
}

/**
 * Turns typed text into the value its declared type requires.
 *
 * `number` is validated as a decimal literal and parsed with `JSON.parse`, not
 * `parseFloat`: the latter reads `'12abc'` as 12, which would store a value the
 * operator never typed. A rejected value is **reported**, never coerced —
 * guessing what someone meant is how a setting acquires a value nobody chose.
 *
 * A `string` passes through untrimmed, because for a string the whitespace may
 * be the value.
 */
export function coerce(
  type: SettingValueType,
  raw: string
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  const text = raw.trim();
  if (type === 'string') return { ok: true, value: raw };
  if (type === 'boolean') {
    if (text === 'true') return { ok: true, value: true };
    if (text === 'false') return { ok: true, value: false };
    return { ok: false };
  }
  if (type === 'number') {
    if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false };
    return { ok: true, value: JSON.parse(text) as number };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
