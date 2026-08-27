/**
 * GET / PATCH /api/v1/org/tenant (P1-14).
 *
 * The caller's own tenant. There is no tenant identifier in the path or the
 * body: `sel_tenants_self` scopes the read to `iam.current_tenant_id()`, so
 * "which tenant" is not a question the API can be asked.
 *
 * PATCH accepts exactly three fields, matching the three columns `app_runtime`
 * may update. `tenant_code` is immutable and `status` is an owner/operator
 * capability (ADR-008) — neither is expressible here, and the database refuses
 * both independently at the privilege layer.
 *
 * No policy default is invented: the locale and timezone must already exist in
 * `shared.languages` / `shared.timezones`, and a value that does not is a
 * validation failure rather than a silently-created reference row.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PatchBody = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    defaultLocale: z.string().min(2).max(35).optional(),
    defaultTimezone: z.string().min(3).max(64).optional(),
  })
  .strict();

export const TENANT_READ_OPERATION = defineOperation({
  id: 'iam.tenant-settings-read',
  module: 'iam',
  method: 'GET',
  path: '/org/tenant',
  summary: 'Read the caller tenant settings.',
  permissions: ['org.tenant.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const TENANT_UPDATE_OPERATION = defineOperation({
  id: 'iam.tenant-settings-update',
  module: 'iam',
  method: 'PATCH',
  path: '/org/tenant',
  summary: 'Update the caller tenant display name, locale, or timezone.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.tenant.settings_updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(TENANT_READ_OPERATION, request, async ({ db }) => {
    const tenant = await iamModule().organization.readTenant(db);
    return { body: tenant, recordVersion: tenant.recordVersion };
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleOperation(
    TENANT_UPDATE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const body = await parseJsonBody(raw, PatchBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const tenant = await iamModule().organization.updateTenant(db, expectedVersion, body);
      return { body: tenant, recordVersion: tenant.recordVersion };
    }
  );
}
