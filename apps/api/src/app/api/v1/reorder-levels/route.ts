/**
 * /api/v1/reorder-levels — the quantity at or below which an item counts as low.
 *
 * `GET` lists what is configured; `POST` sets the level for one signature.
 *
 * ## Why this surface exists
 *
 * The `inv` schema could say what a branch HOLDS and could not say what it OUGHT
 * to hold, so "low stock" was not a fact the platform could state — only a number
 * a reader had to judge for themselves, differently each time. The level is data
 * rather than a constant in a query, because the level for a part at a busy branch
 * is not the level for the same part at a quiet one.
 *
 * ## Narrowing, and who may set it
 *
 * A row may name nothing, a company, a company and a branch, or a company, a
 * branch and a stock location. Nothing means every branch of every company, so a
 * level with no company requires `inv.item.manage` held across the organisation;
 * a narrowed one is authorized against the company and branch it names. Exactly
 * one ACTIVE row exists per signature (`uq_item_reorder_levels_signature`), so
 * `POST` sets rather than appends and a repeated call changes nothing.
 *
 * ## `inv.item.manage` to write, `inv.stock.read` to read
 *
 * The level is a property of the ITEM, in the same sense and with the same
 * narrowing rules as `inv.item_sale_prices`, which that code already governs.
 * `inv.stock.operate` would be wrong: nothing here moves stock, and an operator
 * who may issue parts should not thereby redefine what low means for the branch.
 * Reading takes `inv.stock.read` because a level is only meaningful beside the
 * balance it is compared against, and that is the code that governs the balance.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { QUANTITY_MAX, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    itemId: schemas.uuid.optional(),
    companyId: schemas.uuid.optional(),
    branchId: schemas.uuid.optional(),
    includeRetired: z.enum(['true', 'false']).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const REORDER_LEVEL_LIST_OPERATION = defineOperation({
  id: 'inv.reorder-level-list',
  module: 'inventory',
  method: 'GET',
  path: '/reorder-levels',
  summary: 'List the configured reorder levels, with their narrowing and order quantities.',
  permissions: ['inv.stock.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(REORDER_LEVEL_LIST_OPERATION, request, async ({ db }) => {
    const query = parseOrFail(Query, raw, 'query');
    return {
      body: await inventoryModule().alerts.listReorderLevels(
        db,
        {
          ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
          ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
          ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
          ...(query.includeRetired === undefined
            ? {}
            : { includeRetired: query.includeRetired === 'true' }),
        },
        {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        }
      ),
    };
  });
}

/**
 * Quantities are decimal STRINGS at scale 3, never JSON numbers.
 *
 * `numeric(12,3)` cannot be carried by IEEE-754 without changing the value, and a
 * threshold that changes in transit is a threshold nobody set. The level itself
 * may be zero — "tell me the moment this runs out" — while the preferred order
 * quantity may not, because an order of nothing is not an order.
 */
const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

export const SetBody = z
  .object({
    itemId: schemas.uuid,
    /** Omitted, the level applies to every company of the organisation. */
    companyId: schemas.uuid.optional(),
    /** Omitted, the level applies to every branch of the named company. */
    branchId: schemas.uuid.optional(),
    /** Omitted, the level is about the branch as a whole rather than one shelf. */
    locationId: schemas.uuid.optional(),
    reorderLevelQty: QuantityString,
    preferredOrderQty: QuantityString.optional(),
  })
  .strict();

export const REORDER_LEVEL_SET_OPERATION = defineOperation({
  id: 'inv.reorder-level-set',
  module: 'inventory',
  method: 'POST',
  path: '/reorder-levels',
  summary:
    'Set the reorder level of an item for the organisation, a company, a branch or a location.',
  permissions: ['inv.item.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.item_reorder_level.set',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REORDER_LEVEL_SET_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(SetBody, body, 'body');
      const level = await inventoryModule().alerts.setReorderLevel(
        db,
        {
          itemId: parsed.itemId,
          ...(parsed.companyId === undefined ? {} : { companyId: parsed.companyId }),
          ...(parsed.branchId === undefined ? {} : { branchId: parsed.branchId }),
          ...(parsed.locationId === undefined ? {} : { locationId: parsed.locationId }),
          reorderLevelQty: parsed.reorderLevelQty,
          ...(parsed.preferredOrderQty === undefined
            ? {}
            : { preferredOrderQty: parsed.preferredOrderQty }),
        },
        authorizeScope
      );
      return { body: level, recordVersion: level.recordVersion };
    },
    { body }
  );
}
