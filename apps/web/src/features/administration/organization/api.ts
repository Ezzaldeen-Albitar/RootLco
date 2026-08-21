'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailureKind } from '@/lib/api/client';
import {
  settingsPath,
  type BranchStatusView,
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
