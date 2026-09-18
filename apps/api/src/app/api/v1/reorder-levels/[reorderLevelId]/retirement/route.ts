/**
 * /api/v1/reorder-levels/{reorderLevelId}/retirement — retire a reorder level.
 *
 * Retirement keeps the row and frees its signature for a replacement. The row is
 * never deleted: the record of what a branch once thought it needed is what
 * explains why an alert used to fire and no longer does.
 *
 * ## If-Match
 *
 * `versionGuarded` on the level's own `record_version`, because retiring is a
 * decision about a level somebody has read. Retiring an already-retired level
 * changes nothing and answers `replayed: true` without consulting the version —
 * the caller and the server already agree about the state.
 *
 * Authority follows the row's narrowing, exactly as setting it does: a level with
 * no company requires `inv.item.manage` across the organisation, a narrowed one is
 * authorized against the company and branch it names.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ reorderLevelId: schemas.uuid }).strict();

export const REORDER_LEVEL_RETIRE_OPERATION = defineOperation({
  id: 'inv.reorder-level-retire',
  module: 'inventory',
  method: 'POST',
  path: '/reorder-levels/{reorderLevelId}/retirement',
  summary: 'Retire a reorder level, keeping it as history.',
  permissions: ['inv.item.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.item_reorder_level.retired',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ reorderLevelId: string }> }
): Promise<Response> {
  const params = await route.params;
  return handleOperation(
    REORDER_LEVEL_RETIRE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const { reorderLevelId } = parseOrFail(Params, params, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const level = await inventoryModule().alerts.retireReorderLevel(
        db,
        reorderLevelId,
        expectedVersion,
        authorizeScope
      );
      return { body: level, recordVersion: level.recordVersion };
    },
    { params }
  );
}
