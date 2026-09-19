/**
 * /api/v1/material-requirements/{requirementId} — where one allowance stands
 * (P1-32-PRE-127).
 *
 * The allowance, the approved exceptions, and the quantity requested, reserved,
 * issued and returned against it, all as exact decimal strings in the requirement
 * unit, with what remains — and, while nothing can be approved, the reason why.
 * The figures are what `inv.material_requirement_usage` reports at the time of the
 * read; they bind only when a draw reads them under the requirement lock.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requirementId: schemas.uuid }).strict();

export const MATERIAL_REQUIREMENT_READ_OPERATION = defineOperation({
  id: 'inv.material-requirement-read',
  module: 'inventory',
  method: 'GET',
  path: '/material-requirements/{requirementId}',
  summary: 'Read a material requirement: allowance, requested, reserved, issued, remaining.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ requirementId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    MATERIAL_REQUIREMENT_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { requirementId } = parseOrFail(Params, raw, 'path');
      const requirement = await inventoryModule().materials.read(db, requirementId, authorizeScope);
      return { body: requirement, recordVersion: requirement.recordVersion };
    },
    { params: raw }
  );
}
