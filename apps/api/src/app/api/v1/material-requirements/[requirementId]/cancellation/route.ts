/**
 * /api/v1/material-requirements/{requirementId}/cancellation — cancel a material
 * requirement with a reason (P1-32-PRE-133).
 *
 * A cancelled requirement allows no draw and still governs its item on the work
 * order. It is refused while the requirement has an open request, or while any
 * quantity is reserved, or issued and not returned, against it
 * (`material_requirement_committed`): what was drawn on a requirement stays accounted
 * to it. Close or cancel its requests and return what was issued first. Cancelling a
 * cancelled requirement changes nothing.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requirementId: schemas.uuid }).strict();

export const RequirementCancellationBody = z
  .object({ reason: z.string().trim().min(1).max(MAX_REASON) })
  .strict();

export const MATERIAL_REQUIREMENT_CANCEL_OPERATION = defineOperation({
  id: 'inv.material-requirement-cancel',
  module: 'inventory',
  method: 'POST',
  path: '/material-requirements/{requirementId}/cancellation',
  summary: 'Cancel a material requirement that has nothing committed against it.',
  permissions: ['inv.material.request'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.material_requirement.cancelled',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ requirementId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    MATERIAL_REQUIREMENT_CANCEL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { requirementId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RequirementCancellationBody, body, 'body');
      const cancelled = await inventoryModule().materials.cancel(
        db,
        requirementId,
        { reason: parsed.reason },
        authorizeScope
      );
      return { body: cancelled, recordVersion: cancelled.recordVersion };
    },
    { params: raw, body }
  );
}
