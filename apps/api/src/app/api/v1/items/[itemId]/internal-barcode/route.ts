/**
 * /api/v1/items/{itemId}/internal-barcode — allocate an item's internal barcode
 * (P1-32-PRE-103).
 *
 * For an item that arrived with no printed code. The code is `RL`, a nine-digit
 * per-tenant counter and a mod-10 check digit, allocated by
 * `inv.assign_internal_barcode` under a per-tenant advisory lock, and it becomes the
 * item's primary code when the item has none. A number is never reused, including
 * after the code is retired. No manufacturer identifier is ever derived here.
 *
 * Once per item: a second call returns the live code with `replayed: true` and
 * `200`, and consumes no number; a fresh allocation answers `201`.
 *
 * Requires `inv.item.manage` granted tenant-wide, for the reason recorded on
 * `POST /items/{itemId}/identifiers`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ itemId: schemas.uuid }).strict();

export const ITEM_BARCODE_ASSIGN_OPERATION = defineOperation({
  id: 'inv.item-barcode-assign',
  module: 'inventory',
  method: 'POST',
  path: '/items/{itemId}/internal-barcode',
  summary: "Allocate an item's internal barcode, once per item.",
  permissions: ['inv.item.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.item_barcode.assigned',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ itemId: string }> }
): Promise<Response> {
  const params = await route.params;
  return handleOperation(
    ITEM_BARCODE_ASSIGN_OPERATION,
    request,
    async ({ db }) => {
      const { itemId } = parseOrFail(Params, params, 'path');
      const assigned = await inventoryModule().identifiers.assignInternal(db, itemId);
      return {
        status: assigned.replayed ? 200 : 201,
        body: assigned,
        recordVersion: assigned.recordVersion,
      };
    },
    { params }
  );
}
