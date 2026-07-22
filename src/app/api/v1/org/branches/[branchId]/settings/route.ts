/**
 * GET / POST /api/v1/org/branches/{branchId}/settings (P1-14).
 *
 * Same append-only versioned shape as company settings.
 *
 * The branch's **company is resolved from the database**, never taken from the
 * request. That matters: `org.branch_settings` is keyed on
 * `(tenant, company, branch)`, and letting a caller assert which company a
 * branch belongs to would let them write a branch's settings under a company
 * they hold — which is a containment bypass the composite foreign key would
 * catch, but only after the scope check had already passed on the wrong value.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ branchId: schemas.uuid });
const SettingBody = z
  .object({
    settingKey: z.string().regex(/^[a-z][a-z0-9_.]{1,126}$/),
    settingValue: z.unknown(),
    valueType: z.enum(['string', 'number', 'boolean', 'json']),
    isSensitive: z.boolean().optional(),
  })
  .strict();

export const BRANCH_SETTINGS_READ_OPERATION = defineOperation({
  id: 'iam.branch-settings-read',
  module: 'iam',
  method: 'GET',
  path: '/org/branches/{branchId}/settings',
  summary: 'Read the current settings of a branch.',
  permissions: ['org.branch.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const BRANCH_SETTINGS_WRITE_OPERATION = defineOperation({
  id: 'iam.branch-settings-write',
  module: 'iam',
  method: 'POST',
  path: '/org/branches/{branchId}/settings',
  summary: 'Write the next version of a branch setting.',
  permissions: ['org.settings.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'org.branch.settings_updated',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ branchId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    BRANCH_SETTINGS_READ_OPERATION,
    request,
    async ({ db }) => ({
      body: { items: await iamModule().organization.listBranchSettings(db, params.branchId) },
    }),
    { params, authorizationTarget: { branchId: params.branchId } }
  );
}

export async function POST(
  request: Request,
  route: { params: Promise<{ branchId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    BRANCH_SETTINGS_WRITE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await iamModule().organization.writeBranchSetting(
        db,
        params.branchId,
        await parseJsonBody(raw, SettingBody)
      ),
    }),
    { params, body, authorizationTarget: { branchId: params.branchId } }
  );
}
