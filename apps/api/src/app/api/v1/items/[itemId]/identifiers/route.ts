/**
 * /api/v1/items/{itemId}/identifiers — an item's barcodes and packaging identifiers
 * (P1-32-PRE-100, P1-32-PRE-101).
 *
 * `GET` lists them, live first; `POST` attaches a code a user entered.
 *
 * ## Tenant-wide, like the item
 *
 * `inv.item_master` has no company or branch column, and a code resolves its item in
 * every branch, so both operations are `scope: 'tenant'`. The write additionally
 * requires `inv.item.manage` granted TENANT-WIDE, checked by the service — a grant in
 * one branch must not be able to redirect a scan in all of them.
 *
 * ## What the database decides
 *
 * The normalised value (GENERATED), the retail check digit (a CHECK), and uniqueness
 * of a live code per kind (a partial unique index). `internal` is not an accepted
 * kind here: an internal code is allocated by `POST /items/{itemId}/internal-barcode`.
 *
 * ## Duplicate scans
 *
 * `idempotent: true`. A client that attaches a code from a scan derives its
 * `Idempotency-Key` once per user confirmation, so a doubled scanner frame replays
 * the first write instead of being refused as a duplicate code.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  ENTERABLE_IDENTIFIER_KINDS,
  MAX_IDENTIFIER_VALUE,
  QUANTITY_MAX,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ itemId: schemas.uuid }).strict();

const ListQuery = z
  .object({
    includeRetired: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const ITEM_IDENTIFIER_LIST_OPERATION = defineOperation({
  id: 'inv.item-identifier-list',
  module: 'inventory',
  method: 'GET',
  path: '/items/{itemId}/identifiers',
  summary: "List an item's barcodes and packaging identifiers.",
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ itemId: string }> }
): Promise<Response> {
  const params = await route.params;
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    ITEM_IDENTIFIER_LIST_OPERATION,
    request,
    async ({ db }) => {
      const { itemId } = parseOrFail(Params, params, 'path');
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().identifiers.list(db, itemId, {
          includeRetired: query.includeRetired === 'true',
        }),
      };
    },
    { params }
  );
}

/** Quantity is a decimal STRING — see `POST /stock-reservations`. */
const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

export const AddBody = z
  .object({
    kind: z.enum(ENTERABLE_IDENTIFIER_KINDS),
    value: z.string().trim().min(1).max(MAX_IDENTIFIER_VALUE),
    unitId: schemas.uuid.optional(),
    packQuantity: QuantityString.optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const ITEM_IDENTIFIER_ADD_OPERATION = defineOperation({
  id: 'inv.item-identifier-add',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/items/{itemId}/identifiers',
  summary: 'Attach a barcode or packaging identifier to an item.',
  permissions: ['inv.item.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.item_identifier.added',
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
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ITEM_IDENTIFIER_ADD_OPERATION,
    request,
    async ({ db }) => {
      const { itemId } = parseOrFail(Params, params, 'path');
      const parsed = parseOrFail(AddBody, body, 'body');
      const created = await inventoryModule().identifiers.add(db, itemId, {
        kind: parsed.kind,
        value: parsed.value,
        ...(parsed.unitId === undefined ? {} : { unitId: parsed.unitId }),
        ...(parsed.packQuantity === undefined ? {} : { packQuantity: parsed.packQuantity }),
        ...(parsed.isPrimary === undefined ? {} : { isPrimary: parsed.isPrimary }),
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params, body }
  );
}
