/**
 * /api/v1/items — the inventory item catalog (Phase 1-21, P1-21-BE-001).
 *
 * Cursor-paginated, tenant-scoped, ordered by `(sku, id)` — a total order backed
 * by `uq_item_master_sku`, so a page is stable even when two items share a name.
 *
 * ## Why this is `scope: 'tenant'` and offers no branch filter
 *
 * `inv.item_master` has no `company_id` and no `branch_id`: an item is tenant-wide
 * catalog reference data. A branch filter here would be decorative — it would
 * narrow nothing — and declaring `scope: 'branch'` would be worse than useless,
 * because `requireScopedPermissions` fails closed on an empty target and an
 * unfiltered listing names no branch, so every caller would receive 403. Stock at a
 * branch is a different question, answered by `/stock-availability`.
 *
 * ## What this endpoint deliberately does not return
 *
 * **Cost.** `inv.item_cost_details` is a restricted 1:1 detail whose every RLS
 * policy is gated by `iam.has_permission('inv.cost.view')`, and no query behind
 * this route reads it. Bolting a standard cost onto the catalog read would leak
 * margin data to every holder of `inv.item.read`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  ITEM_LIFECYCLE_STATES,
  ITEM_TYPES,
  MAX_DESCRIPTION,
  MAX_NAME,
  SKU_FORMAT,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Query surface — a closed allow-list. */
const Query = z
  .object({
    categoryId: schemas.uuid.optional(),
    itemType: z.enum(ITEM_TYPES).optional(),
    lifecycleStatus: z.enum(ITEM_LIFECYCLE_STATES).optional(),
    stockTrackedOnly: z.enum(['true', 'false']).optional(),
    search: z.string().min(1).max(MAX_NAME).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const ITEM_SEARCH_OPERATION = defineOperation({
  id: 'inv.item-search',
  module: 'inventory',
  method: 'GET',
  path: '/items',
  summary: 'Search the tenant inventory item catalog.',
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(ITEM_SEARCH_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return {
      body: await inventoryModule().reads.searchItems(
        db,
        {
          ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
          ...(query.itemType === undefined ? {} : { itemType: query.itemType }),
          ...(query.lifecycleStatus === undefined
            ? {}
            : { lifecycleStatus: query.lifecycleStatus }),
          ...(query.stockTrackedOnly === undefined
            ? {}
            : { stockTrackedOnly: query.stockTrackedOnly === 'true' }),
          ...(query.search === undefined ? {} : { search: query.search }),
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
 * The item as the catalogue records it — identity, filing and tracking
 * flags. NO cost: `inv.item_cost_details` is the restricted 1:1 cost table
 * and valuation is an Owner decision this slice does not pre-empt. `id`,
 * `lifecycle_status` and `archived_at` are refused so a tenant cannot choose
 * a key or create an item already archived.
 */
export const CreateBody = z
  .object({
    itemCategoryId: schemas.uuid,
    sku: z.string().regex(SKU_FORMAT, 'must be an alphanumeric SKU'),
    name: z.string().min(1).max(MAX_NAME),
    description: z.string().min(1).max(MAX_DESCRIPTION).optional(),
    uomId: schemas.uuid,
    itemType: z.enum(ITEM_TYPES),
    isStockTracked: z.boolean().optional(),
    isSerialized: z.boolean().optional(),
  })
  .strict();

export const ITEM_CREATE_OPERATION = defineOperation({
  id: 'inv.item-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/items',
  summary: 'Create an item in the tenant inventory catalogue.',
  permissions: ['inv.item.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.item.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ITEM_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      // `inv.item_master` has no company or branch column: an item is
      // tenant-wide catalogue reference data, so the write needs tenant-wide
      // authority (P1-18-A-01) — see item-categories/route.ts.
      if (!(await callerHoldsPermissionTenantWide(db, 'inv.item.manage'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'An item is tenant-wide catalogue reference data, so creating one requires ' +
            'inv.item.manage granted tenant-wide.',
        });
      }
      const created = await inventoryModule().catalog.createItem(db, {
        itemCategoryId: parsed.itemCategoryId,
        sku: parsed.sku,
        name: parsed.name,
        ...(parsed.description === undefined ? {} : { description: parsed.description }),
        uomId: parsed.uomId,
        itemType: parsed.itemType,
        ...(parsed.isStockTracked === undefined ? {} : { isStockTracked: parsed.isStockTracked }),
        ...(parsed.isSerialized === undefined ? {} : { isSerialized: parsed.isSerialized }),
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
