/**
 * GET / POST /api/v1/item-categories (P1-30 corrective slice).
 *
 * `inv.item_master.item_category_id` is NOT NULL with a composite foreign key
 * into `inv.item_categories`, so an item cannot exist without a category — and
 * until this route no operation created one. The list exists for the same
 * reason the service-category list does: a picker cannot offer what nothing
 * publishes, and `inv.item-search` filters by `categoryId` without any way to
 * learn one.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { AppFailure } from '@/server/errors/app-failure';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  CATEGORY_CODE_FORMAT,
  MAX_DESCRIPTION,
  MAX_NAME,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    status: z.enum(['active', 'inactive']).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

/**
 * `id` and `status` are refused: the tenant does not choose a primary key, and
 * a category created `inactive` is one nothing may be filed under. `code` is
 * the lower-snake internal code `ck_item_categories_code_format` enforces.
 */
export const CreateBody = z
  .object({
    code: z.string().regex(CATEGORY_CODE_FORMAT, 'must be a lower-snake internal code'),
    name: z.string().min(1).max(MAX_NAME),
    description: z.string().min(1).max(MAX_DESCRIPTION).optional(),
    parentCategoryId: schemas.uuid.optional(),
  })
  .strict();

export const ITEM_CATEGORY_LIST_OPERATION = defineOperation({
  id: 'inv.item-category-list',
  module: 'inventory',
  method: 'GET',
  path: '/item-categories',
  summary: 'List the tenant item categories by code.',
  // The catalogue read, not the write: choosing a category to file an item
  // under, or to filter a search by, is reading the catalogue.
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const ITEM_CATEGORY_CREATE_OPERATION = defineOperation({
  id: 'inv.item-category-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/item-categories',
  summary: 'Create an item category in the tenant catalogue.',
  // "Manage item master, categories, UoM" — the code names categories by name.
  permissions: ['inv.item.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.item_category.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(ITEM_CATEGORY_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const query = parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query');
    return {
      body: await inventoryModule().catalog.listCategories(
        db,
        { ...(query.status === undefined ? {} : { status: query.status }) },
        {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        }
      ),
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ITEM_CATEGORY_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      // Tenant-wide reference data, so tenant-wide authority — the control
      // `svc.service-category-create` applies for the same reason (P1-18-A-01):
      // the row has no company or branch, the pre-handler check degrades to the
      // scope-blind `iam.has_permission`, and an actor holding `inv.item.manage`
      // in one branch must not be able to write every branch's catalogue.
      if (!(await callerHoldsPermissionTenantWide(db, 'inv.item.manage'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'An item category is tenant-wide catalogue reference data, so creating one ' +
            'requires inv.item.manage granted tenant-wide.',
        });
      }
      const created = await inventoryModule().catalog.createCategory(db, {
        code: parsed.code,
        name: parsed.name,
        ...(parsed.description === undefined ? {} : { description: parsed.description }),
        ...(parsed.parentCategoryId === undefined
          ? {}
          : { parentCategoryId: parsed.parentCategoryId }),
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
