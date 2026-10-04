/**
 * /api/v1/vehicle-fluid-specifications/{specificationId}/confirmation — confirm a
 * recorded service capacity (P1-32-PRE-126).
 *
 * Confirmation is the act that lets a capacity become an allowance, recorded with
 * who confirmed it and when. Two confirmed specifications with the same make, model,
 * engine variant, service condition and item family may not overlap in model year
 * (`ex_vehicle_fluid_specifications_confirmed_overlap`), so a vehicle never faces two
 * answers; the overlap is refused as a conflict. Confirming an already confirmed
 * specification changes nothing and says so (`replayed: true`).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ specificationId: schemas.uuid }).strict();

export const VEHICLE_SPECIFICATION_CONFIRM_OPERATION = defineOperation({
  id: 'inv.vehicle-specification-confirm',
  module: 'inventory',
  method: 'POST',
  path: '/vehicle-fluid-specifications/{specificationId}/confirmation',
  summary: 'Confirm a recorded vehicle service capacity so it can supply an allowance.',
  permissions: ['inv.specification.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.vehicle_specification.confirmed',
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
    VEHICLE_SPECIFICATION_CONFIRM_OPERATION,
    request,
    async ({ db }) => {
      const { specificationId } = parseOrFail(Params, raw, 'path');
      const confirmed = await inventoryModule().referenceData.confirmSpecification(
        db,
        specificationId
      );
      return { body: confirmed, recordVersion: confirmed.recordVersion };
    },
    { params: raw }
  );
}
