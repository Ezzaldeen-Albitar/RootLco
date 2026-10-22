/**
 * /api/v1/items/{itemId}/sale-prices — what the tenant sells an item for
 * (P1-32-PRE-105, P1-32-PRE-106).
 *
 * `GET` lists the configured prices, most specific first; `POST` sets the price for
 * one (item, company, branch) signature.
 *
 * ## Why this surface exists
 *
 * `svc.price_rules` prices a SERVICE — `fk_price_rules_service` targets
 * `svc.services` and `svc.resolve_price` takes a service id — so nothing in the
 * schema could say what a PART costs a customer. A counter sale needs exactly that,
 * and the alternatives were both wrong: accept an amount from the client, which the
 * invoice surface has refused since P1-11, or default to zero, which sells stock
 * for nothing.
 *
 * ## This is a selling price, not a cost
 *
 * `inv.item_cost_details` and `inv.item_cost_layers` hold what the part cost the
 * tenant to buy and stay gated by `inv.cost.view` in the database. Nothing here
 * reads or writes either, and neither gate is involved: a shelf price is shown to
 * the customer who pays it.
 *
 * ## Narrowing, and who may set it
 *
 * A row may name a company, or a company and a branch, or neither. Neither means
 * every branch of every company, so a tenant-wide price requires `inv.item.manage`
 * held tenant-wide; a narrowed one is authorized against the company and branch it
 * names. Exactly one live row exists per signature
 * (`uq_item_sale_prices_signature`), so `POST` sets rather than appends and a
 * repeated call changes nothing.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ itemId: schemas.uuid }).strict();

export const ITEM_SALE_PRICE_LIST_OPERATION = defineOperation({
  id: 'inv.item-sale-price-list',
  module: 'inventory',
  method: 'GET',
  path: '/items/{itemId}/sale-prices',
  summary: "List an item's configured selling prices, most specific first.",
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ itemId: string }> }
): Promise<Response> {
  const params = await route.params;
  return handleOperation(
    ITEM_SALE_PRICE_LIST_OPERATION,
    request,
    async ({ db }) => {
      const { itemId } = parseOrFail(Params, params, 'path');
      return { body: await inventoryModule().catalog.listSalePrices(db, itemId) };
    },
    { params }
  );
}

/**
 * The price is a decimal STRING at scale 4, never a JSON number.
 *
 * `numeric(18,4)` cannot be carried by IEEE-754 without changing the value, and a
 * price that changes in transit is a price nobody agreed to.
 */
const MoneyString = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, 'must be a decimal string of at most 4 places');

export const SetBody = z
  .object({
    /** Omitted, the price applies to every company of the tenant. */
    companyId: schemas.uuid.optional(),
    /** Omitted, the price applies to every branch of the named company. */
    branchId: schemas.uuid.optional(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter ISO 4217 code'),
    unitPrice: MoneyString,
    /** A company's tax class; a tenant-wide price may not name one. */
    taxClassId: schemas.uuid.optional(),
  })
  .strict();

export const ITEM_SALE_PRICE_SET_OPERATION = defineOperation({
  id: 'inv.item-sale-price-set',
  module: 'inventory',
  method: 'POST',
  path: '/items/{itemId}/sale-prices',
  summary: 'Set the selling price of an item for a tenant, a company or a branch.',
  permissions: ['inv.item.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.item_sale_price.set',
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
    ITEM_SALE_PRICE_SET_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { itemId } = parseOrFail(Params, params, 'path');
      const parsed = parseOrFail(SetBody, body, 'body');
      const price = await inventoryModule().catalog.setSalePrice(
        db,
        itemId,
        {
          ...(parsed.companyId === undefined ? {} : { companyId: parsed.companyId }),
          ...(parsed.branchId === undefined ? {} : { branchId: parsed.branchId }),
          currencyCode: parsed.currencyCode,
          unitPrice: parsed.unitPrice,
          ...(parsed.taxClassId === undefined ? {} : { taxClassId: parsed.taxClassId }),
        },
        authorizeScope
      );
      return { body: price, recordVersion: price.recordVersion };
    },
    { params, body }
  );
}
