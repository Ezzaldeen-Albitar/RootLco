/**
 * /api/v1/material-requirements/{requirementId}/recheck — re-derive a requirement
 * once the fact it was missing exists (P1-32-PRE-133).
 *
 * A requirement stored as `approval_required` names what it lacks. When the
 * specification for the vehicle has since been confirmed, or the unit conversion for
 * the item has since been stated, this reads it again through
 * `inv.recheck_material_requirement`: the requirement takes the specification's
 * capacity and moves to `pending_approval`, or stays `approval_required` with the
 * reason that still holds. A requirement already awaiting a decision or approved has
 * nothing to re-check and is returned as it is, so a repeated call changes nothing.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requirementId: schemas.uuid }).strict();

export const MATERIAL_REQUIREMENT_RECHECK_OPERATION = defineOperation({
  id: 'inv.material-requirement-recheck',
  module: 'inventory',
  method: 'POST',
  path: '/material-requirements/{requirementId}/recheck',
  summary: 'Re-check a material requirement once its missing specification or conversion exists.',
  permissions: ['inv.material.request'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.material_requirement.rechecked',
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
  return handleOperation(
    MATERIAL_REQUIREMENT_RECHECK_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { requirementId } = parseOrFail(Params, raw, 'path');
      const rechecked = await inventoryModule().materials.recheck(
        db,
        requirementId,
        authorizeScope
      );
      return { body: rechecked, recordVersion: rechecked.recordVersion };
    },
    { params: raw }
  );
}
