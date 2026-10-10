/**
 * /api/v1/unit-conversions/{conversionId}/retirement — retire a unit conversion
 * (P1-32-PRE-125).
 *
 * A retired conversion answers nothing: a requirement or a draw that needs it is
 * refused as missing a conversion until another is stated. The row stays, so what a
 * past material request recorded remains attributable. Retiring an already retired
 * conversion changes nothing and says so (`replayed: true`).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ conversionId: schemas.uuid }).strict();

export const UNIT_CONVERSION_RETIRE_OPERATION = defineOperation({
  id: 'inv.unit-conversion-retire',
  module: 'inventory',
  method: 'POST',
  path: '/unit-conversions/{conversionId}/retirement',
  summary: 'Retire a unit conversion so it no longer answers.',
  permissions: ['inv.unit_conversion.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.unit_conversion.retired',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ conversionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    UNIT_CONVERSION_RETIRE_OPERATION,
    request,
    async ({ db }) => {
      const { conversionId } = parseOrFail(Params, raw, 'path');
      const retired = await inventoryModule().referenceData.retireConversion(db, conversionId);
      return { body: retired, recordVersion: retired.recordVersion };
    },
    { params: raw }
  );
}
