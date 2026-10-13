/**
 * /api/v1/vehicle-fluid-specifications/{specificationId}/retirement — retire a
 * service capacity (P1-32-PRE-126).
 *
 * A retired specification no longer resolves. A change of capacity is a new record,
 * confirmed in turn, and the old one is retired rather than edited — so a requirement
 * that was derived from it keeps pointing at the figure it was approved with.
 * Retiring an already retired specification changes nothing (`replayed: true`).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ specificationId: schemas.uuid }).strict();

export const VEHICLE_SPECIFICATION_RETIRE_OPERATION = defineOperation({
  id: 'inv.vehicle-specification-retire',
  module: 'inventory',
  method: 'POST',
  path: '/vehicle-fluid-specifications/{specificationId}/retirement',
  summary: 'Retire a vehicle service capacity so it no longer supplies an allowance.',
  permissions: ['inv.specification.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.vehicle_specification.retired',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ specificationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    VEHICLE_SPECIFICATION_RETIRE_OPERATION,
    request,
    async ({ db }) => {
      const { specificationId } = parseOrFail(Params, raw, 'path');
      const retired = await inventoryModule().referenceData.retireSpecification(
        db,
        specificationId
      );
      return { body: retired, recordVersion: retired.recordVersion };
    },
    { params: raw }
  );
}
