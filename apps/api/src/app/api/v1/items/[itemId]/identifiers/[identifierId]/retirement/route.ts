/**
 * /api/v1/items/{itemId}/identifiers/{identifierId}/retirement — retire an item
 * identifier (P1-32-PRE-102).
 *
 * Retirement keeps the row as history and frees its value for a new identifier. The
 * row is never deleted: a label carrying the code may still be on a shelf, and the
 * record of which item it once named is what explains a scan that no longer
 * resolves. Retiring an already-retired identifier changes nothing and answers with
 * `replayed: true`.
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

const Params = z.object({ itemId: schemas.uuid, identifierId: schemas.uuid }).strict();

export const ITEM_IDENTIFIER_RETIRE_OPERATION = defineOperation({
  id: 'inv.item-identifier-retire',
  module: 'inventory',
  method: 'POST',
  path: '/items/{itemId}/identifiers/{identifierId}/retirement',
  summary: 'Retire an item identifier, keeping it as history.',
  permissions: ['inv.item.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.item_identifier.retired',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ itemId: string; identifierId: string }> }
): Promise<Response> {
  const params = await route.params;
  return handleOperation(
    ITEM_IDENTIFIER_RETIRE_OPERATION,
    request,
    async ({ db }) => {
      const { itemId, identifierId } = parseOrFail(Params, params, 'path');
      const retired = await inventoryModule().identifiers.retire(db, itemId, identifierId);
      return { body: retired, recordVersion: retired.recordVersion };
    },
    { params }
  );
}
