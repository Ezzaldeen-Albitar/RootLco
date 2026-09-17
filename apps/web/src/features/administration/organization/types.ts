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

// --- organisation structure ----------------------------------------------------

/** A legal company as `org.company-list` publishes it. */
export interface CompanyView {
  readonly id: string;
  readonly companyCode: string;
  readonly legalName: string;
  readonly status: string;
}

/** A branch as `org.branch-list` publishes it. */
export interface BranchView {
  readonly id: string;
  readonly companyId: string;
  readonly branchCode: string;
  readonly name: string;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly timezoneName: string;
  readonly status: string;
}

/** One allowance. `limit` is null when the plan declares no ceiling. */
export interface CapacityAllowance {
  readonly used: number;
  readonly limit: number | null;
}

export type CapacityKind = 'companies' | 'branches' | 'users';

/** `org.capacity-read`: the allowances and the subscription behind them. */
export interface CapacityView {
  readonly capacity: Readonly<Record<CapacityKind, CapacityAllowance>>;
  readonly subscription: {
    readonly planCode: string;
    readonly displayName: string;
    readonly status: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
  } | null;
}

/** The share of warning: at or above this many percent the bar says so. */
export const CAPACITY_WARNING_PERCENT = 90;

/**
 * Whole percent of an allowance in use, or null when it is unlimited.
 *
 * Integer arithmetic on counts, never money. A limit of zero is 100 percent,
 * because nothing more may be added.
 */
export function capacityPercent(allowance: CapacityAllowance): number | null {
  if (allowance.limit === null) return null;
  if (allowance.limit <= 0) return 100;
  return Math.min(100, Math.floor((allowance.used * 100) / allowance.limit));
}

/** True when the allowance has no room for one more. Unlimited is never full. */
export function isCapacityFull(allowance: CapacityAllowance | undefined): boolean {
  if (allowance === undefined || allowance.limit === null) return false;
  return allowance.used >= allowance.limit;
}

/** True when the allowance is at or above the warning share. */
export function isCapacityNear(allowance: CapacityAllowance): boolean {
  const percent = capacityPercent(allowance);
  return percent !== null && percent >= CAPACITY_WARNING_PERCENT;
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
