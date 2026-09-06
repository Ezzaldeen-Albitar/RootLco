/**
 * GET /api/v1/units-of-measure (P1-30 corrective slice).
 *
 * `inv.item_master.uom_id` is NOT NULL, so an item cannot be created without
 * naming a unit — and nothing published the units. The platform seeds twelve
 * (`supabase/seeds/07_inv_units_of_measure.sql`) and a tenant may hold its
 * own; `sel_units_of_measure_visible` is what decides which rows this returns.
 * Not paged: it is a closed reference list, the shape `sal.payment-method-list`
 * already uses for the same reason.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const UNIT_OF_MEASURE_LIST_OPERATION = defineOperation({
  id: 'inv.uom-list',
  module: 'inventory',
  method: 'GET',
  path: '/units-of-measure',
  summary: 'List the active units of measure visible to this tenant.',
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(UNIT_OF_MEASURE_LIST_OPERATION, request, async ({ db }) => ({
    body: { items: await inventoryModule().catalog.listUnitsOfMeasure(db) },
  }));
}
