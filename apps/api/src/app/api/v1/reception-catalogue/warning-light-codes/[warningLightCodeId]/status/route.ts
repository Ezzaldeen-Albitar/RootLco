/**
 * POST /api/v1/reception-catalogue/warning-light-codes/{warningLightCodeId}/status
 * (P1-27 remediation executed by P1-18, `P1-27-INT-018`).
 *
 * Retires or restores one tenant warning-light code. This is the ONLY removal
 * affordance, and it is deliberate in both directions.
 *
 * ## There is no delete, and there cannot be
 *
 * `app_runtime` holds no DELETE grant on `rec.warning_light_codes` and no DELETE policy
 * exists, so a hard removal is refused by the database however it is asked for.
 * That is the property that matters: pre-service condition evidence is permanent and names the code it observed, and a catalogue entry
 * that could vanish would break every record referencing it. Retiring sets
 * `status = 'inactive'`, which the picker read filters out — the entry stops
 * being offered in the condition-evidence pickers while every existing reference stays
 * satisfied.
 *
 * ## Why it restores as well as retires
 *
 * `uq_warning_light_codes_tenant_code` is `(tenant_id, code)
 * WHERE scope = 'tenant' AND deleted_at IS NULL`. The predicate names
 * `deleted_at`, NOT `status`, so a RETIRED row still holds its code and
 * re-adding that code is refused with a 23505. A retire-only command would
 * therefore burn the code for the tenant permanently. One bidirectional
 * lifecycle command instead — the `crm.customer-status-set` and
 * `shared.branch-status-change` precedent.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { CATALOGUE_STATUSES, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ warningLightCodeId: schemas.uuid });
const Body = z.object({ status: z.enum(CATALOGUE_STATUSES) }).strict();

export const WARNING_LIGHT_CODE_STATUS_OPERATION = defineOperation({
  id: 'rec.catalogue-warning-light-code-status-set',
  module: 'reception',
  method: 'POST',
  path: '/reception-catalogue/warning-light-codes/{warningLightCodeId}/status',
  summary: 'Retire or restore a warning-light code in the caller tenant catalogue.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.warning_light_code.status_changed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ warningLightCodeId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    WARNING_LIGHT_CODE_STATUS_OPERATION,
    request,
    async ({ db, request: req, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await receptionModule().intakeCatalogues.setStatus(
        db,
        'warning_light_codes',
        params.warningLightCodeId,
        expectedVersion,
        input.status
      );
      return { body: changed, recordVersion: changed.recordVersion };
    },
    { params: raw, body }
  );
}
