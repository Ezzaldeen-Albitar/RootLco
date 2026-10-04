/**
 * /api/v1/unit-conversions — exact, attributable unit conversions (P1-32-PRE-125).
 *
 * `GET` lists the tenant's conversions, optionally narrowed to the ones that apply to
 * one item (its own rows and the tenant-wide ones). `POST` states a conversion.
 *
 * ## One factor, exact, one direction
 *
 * A row says "1 from-unit = factor to-units" and nothing else. There is no implied
 * reverse, because 1 / factor is not exact in general; a conversion the other way is
 * a row of its own. A conversion between different kinds of unit (a pack to litres)
 * must name its item; a tenant-wide row stays within one kind. Stating a conversion
 * whose signature is already live retires the old row in the same transaction, so a
 * changed factor is a new attributable fact and the old one remains readable.
 *
 * ## Tenant-wide authority
 *
 * A conversion holds in every branch, so `inv.unit_conversion.manage` must be held
 * tenant-wide; a grant confined to one branch is refused.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  CONVERSION_FACTOR_FORMAT,
  MAX_SOURCE_REFERENCE,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    itemId: schemas.uuid.optional(),
    includeRetired: z.enum(['true', 'false']).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const UNIT_CONVERSION_LIST_OPERATION = defineOperation({
  id: 'inv.unit-conversion-list',
  module: 'inventory',
  method: 'GET',
  path: '/unit-conversions',
  summary: "List the tenant's unit conversions, optionally those that apply to one item.",
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(UNIT_CONVERSION_LIST_OPERATION, request, async ({ db }) => {
    const query = parseOrFail(ListQuery, raw, 'query');
    return {
      body: await inventoryModule().referenceData.listConversions(
        db,
        {
          ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
          includeRetired: query.includeRetired === 'true',
        },
        {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        }
      ),
    };
  });
}

export const SetBody = z
  .object({
    /** Required when the two units measure different kinds of quantity. */
    itemId: schemas.uuid.optional(),
    fromUomId: schemas.uuid,
    toUomId: schemas.uuid,
    /** How many to-units ONE from-unit is, as an exact decimal string. */
    factor: z.string().regex(CONVERSION_FACTOR_FORMAT),
    sourceReference: z.string().trim().min(1).max(MAX_SOURCE_REFERENCE),
  })
  .strict();

export const UNIT_CONVERSION_SET_OPERATION = defineOperation({
  id: 'inv.unit-conversion-set',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/unit-conversions',
  summary: 'State an exact unit conversion with its source, retiring the one it replaces.',
  permissions: ['inv.unit_conversion.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.unit_conversion.set',
  idempotent: true,
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
    UNIT_CONVERSION_SET_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(SetBody, body, 'body');
      const created = await inventoryModule().referenceData.setConversion(db, {
        ...(parsed.itemId === undefined ? {} : { itemId: parsed.itemId }),
        fromUomId: parsed.fromUomId,
        toUomId: parsed.toUomId,
        factor: parsed.factor,
        sourceReference: parsed.sourceReference,
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
