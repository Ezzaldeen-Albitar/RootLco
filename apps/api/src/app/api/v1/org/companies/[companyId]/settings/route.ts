/**
 * GET / POST /api/v1/org/companies/{companyId}/settings (P1-14).
 *
 * Company settings are **append-only versioned rows**: every column of
 * `org.company_settings` is immutable on UPDATE and only INSERT is granted, so
 * writing a setting inserts the next `version` for that key and the current
 * value is the highest version. That is the schema's versioning design, not a
 * workaround for a missing grant — which is why DBCR-P1-14-001 recorded this
 * table as needing nothing.
 *
 * A `sensitive` setting's **value is withheld** from readers without
 * `iam.sensitive.view` — withheld, not partially masked, because a masked value
 * still discloses its shape and length. The key and its `isSensitive` flag are
 * still returned, which is what an administrator needs to know it is configured.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ companyId: schemas.uuid });
export const SettingBody = z
  .object({
    /** Matches `ck_company_settings_key_format`. */
    settingKey: z.string().regex(/^[a-z][a-z0-9_.]{1,126}$/),
    settingValue: z.unknown(),
    valueType: z.enum(['string', 'number', 'boolean', 'json']),
    isSensitive: z.boolean().optional(),
  })
  .strict();

export const COMPANY_SETTINGS_READ_OPERATION = defineOperation({
  id: 'iam.company-settings-read',
  module: 'iam',
  method: 'GET',
  path: '/org/companies/{companyId}/settings',
  summary: 'Read the current settings of a company.',
  permissions: ['org.company.read'],
  scope: 'company',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const COMPANY_SETTINGS_WRITE_OPERATION = defineOperation({
  id: 'iam.company-settings-write',
  module: 'iam',
  method: 'POST',
  path: '/org/companies/{companyId}/settings',
  summary: 'Write the next version of a company setting.',
  permissions: ['org.settings.manage'],
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'org.company.settings_updated',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ companyId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    COMPANY_SETTINGS_READ_OPERATION,
    request,
    async ({ db }) => ({
      body: { items: await iamModule().organization.listCompanySettings(db, params.companyId) },
    }),
    // The company is a *claim* checked against the caller's resolved scope, never
    // the scope itself: `narrowScope()` rejects one the caller does not hold.
    { params, authorizationTarget: { companyId: params.companyId } }
  );
}

export async function POST(
  request: Request,
  route: { params: Promise<{ companyId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    COMPANY_SETTINGS_WRITE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await iamModule().organization.writeCompanySetting(
        db,
        params.companyId,
        await parseJsonBody(raw, SettingBody)
      ),
    }),
    { params, body, authorizationTarget: { companyId: params.companyId } }
  );
}
