/**
 * POST /api/v1/reception-catalogue/refusal-reasons/{refusalReasonId}/status
 * (P1-27 remediation executed by P1-18, `P1-27-INT-018`).
 *
 * Retires or restores one tenant refusal reason. This is the ONLY removal
 * affordance, and it is deliberate in both directions.
 *
 * ## There is no delete, and there cannot be
 *
 * `app_runtime` holds no DELETE grant on `rec.refusal_reasons` and no DELETE policy
 * exists, so a hard removal is refused by the database however it is asked for.
 * That is the property that matters: a refusal is preserved as its own fact and keeps naming its reason, and a catalogue entry
 * that could vanish would break every record referencing it. Retiring sets
 * `status = 'inactive'`, which the picker read filters out — the entry stops
 * being offered in the refusal pickers while every existing reference stays
 * satisfied.
 *
 * ## Why it restores as well as retires
 *
 * `uq_refusal_reasons_tenant_code` is `(tenant_id, code)
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

const Params = z.object({ refusalReasonId: schemas.uuid });
const Body = z.object({ status: z.enum(CATALOGUE_STATUSES) }).strict();

export const REFUSAL_REASON_STATUS_OPERATION = defineOperation({
  id: 'rec.catalogue-refusal-reason-status-set',
  module: 'reception',
  method: 'POST',
  path: '/reception-catalogue/refusal-reasons/{refusalReasonId}/status',
  summary: 'Retire or restore a refusal reason in the caller tenant catalogue.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.refusal_reason.status_changed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ refusalReasonId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REFUSAL_REASON_STATUS_OPERATION,
    request,
    async ({ db, request: req, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await receptionModule().intakeCatalogues.setStatus(
        db,
        'refusal_reasons',
        params.refusalReasonId,
        expectedVersion,
        input.status
      );
      return { body: changed, recordVersion: changed.recordVersion };
    },
    { params: raw, body }
  );
}
