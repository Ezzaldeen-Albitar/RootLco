'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailureKind } from '@/lib/api/client';
import { readOperation, type ItemsOnly, type ReadState } from '@/lib/api/read-operation';
import {
  settingsPath,
  type BranchStatusView,
  type BranchView,
  type CapacityView,
  type CompanyView,
  type Read,
  type ReadStatus,
  type SettingView,
  type SettingsScope,
  type TenantView,
} from './types';

/**
 * Reads for every settings-backed screen.
 *
 * Three approved surfaces, and no others:
 *
 *   `GET /api/v1/org/tenant`                          — `org.tenant.read`
 *   `GET /api/v1/org/companies/{companyId}/settings`  — `org.company.read`
 *   `GET /api/v1/org/branches/{branchId}/settings`    — `org.branch.read`
 *
 * Settings are **append-only versioned rows**: a write inserts the next version
 * for that key and the current value is the highest version. Nothing is ever
 * mutated, so the history is the audit trail.
 *
 * A sensitive setting comes back with its **value withheld**, not masked in
 * place — returning a partially-redacted value still discloses its shape and
 * length. The caller learns the key exists and is configured, which is what an
 * administrator needs in order to know a value is set.
 *
 * `'use server'`, so it exports only async functions; types and `settingsPath`
 * live in `types.ts`.
 */

const STATUS_BY_KIND: Record<ApiFailureKind, ReadStatus> = {
  unauthenticated: 'expired',
  forbidden: 'denied',
  'not-found': 'not-found',
  conflict: 'error',
  validation: 'error',
  'rate-limited': 'unavailable',
  server: 'error',
  unavailable: 'unavailable',
  timeout: 'unavailable',
  cancelled: 'error',
  network: 'unavailable',
};

export async function readTenant(): Promise<Read<TenantView>> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', data: null, correlationId: null };
  const result = await client.get<TenantView>('/api/v1/org/tenant');
  if (!result.ok) {
    return { status: STATUS_BY_KIND[result.kind], data: null, correlationId: result.correlationId };
  }
  return { status: 'ok', data: result.data, correlationId: result.correlationId };
}

export async function readSettings(
  scope: SettingsScope,
  id: string
): Promise<Read<readonly SettingView[]>> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', data: null, correlationId: null };
  const result = await client.get<{ items: readonly SettingView[] }>(settingsPath(scope, id));
  if (!result.ok) {
    return { status: STATUS_BY_KIND[result.kind], data: null, correlationId: result.correlationId };
  }
  return { status: 'ok', data: result.data.items, correlationId: result.correlationId };
}

export async function readBranchStatus(branchId: string): Promise<Read<BranchStatusView>> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', data: null, correlationId: null };
  const result = await client.get<BranchStatusView>(
    `/api/v1/organization/branches/${encodeURIComponent(branchId)}/status`
  );
  if (!result.ok) {
    return { status: STATUS_BY_KIND[result.kind], data: null, correlationId: result.correlationId };
  }
  return { status: 'ok', data: result.data, correlationId: result.correlationId };
}

// --- organisation structure ----------------------------------------------------

/**
 * `GET /api/v1/org/capacity` — `org.tenant.read`.
 *
 * The same numbers the refusal is computed from, so the panel and a refused
 * creation can never disagree about how many are in use.
 */
export async function readCapacity(): Promise<ReadState<CapacityView>> {
  return readOperation<CapacityView>('/api/v1/org/capacity');
}

/** `GET /api/v1/org/companies` — `org.company.read`. The companies this session may reach. */
export async function listCompanies(): Promise<ReadState<readonly CompanyView[]>> {
  return unwrapItems(await readOperation<ItemsOnly<CompanyView>>('/api/v1/org/companies'));
}

/** `GET /api/v1/org/branches` — `org.branch.read`. The branches this session may reach. */
export async function listBranches(): Promise<ReadState<readonly BranchView[]>> {
  return unwrapItems(await readOperation<ItemsOnly<BranchView>>('/api/v1/org/branches'));
}

/**
 * The currency codes offered when a company is added.
 *
 * The platform publishes no currency catalogue read, so the choices are the
 * codes an administrator has already enabled on the Currencies screen
 * (`currency.enabled_codes`) for the companies this session can reach. Nothing
 * is invented: an organisation that has enabled none gets an empty list, and
 * the form then asks for the three-letter code directly.
 */
export async function readCurrencyChoices(
  companyIds: readonly string[]
): Promise<readonly string[]> {
  const codes = new Set<string>();
  for (const companyId of companyIds.slice(0, 20)) {
    const read = await readSettings('company', companyId);
    if (read.status !== 'ok' || read.data === null) continue;
    for (const setting of read.data) {
      if (setting.settingKey !== 'currency.enabled_codes') continue;
      const value = setting.settingValue;
      if (!Array.isArray(value)) continue;
      for (const code of value) {
        if (typeof code === 'string' && /^[A-Z]{3}$/.test(code)) codes.add(code);
      }
    }
  }
  return [...codes].sort();
}

async function unwrapItems<T>(read: ReadState<ItemsOnly<T>>): Promise<ReadState<readonly T[]>> {
  if (read.status !== 'ok') return read;
  return { status: 'ok', data: read.data.items, correlationId: read.correlationId };
}
