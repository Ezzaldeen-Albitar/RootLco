/**
 * Price lists (Phase 1-20, P1-20-BE-004).
 *
 * `GET` lists them; `POST` creates one.
 *
 * ## Why these are tenant-scoped
 *
 * `svc.price_lists` has no `company_id` and no `branch_id`. A list is tenant-wide
 * reference data, and it is `svc.price_list_assignments` that binds it to a
 * company, a branch or a customer class. So there is no branch to target here, and
 * declaring `scope: 'branch'` would be worse than useless: `authorizeScope` would
 * then have to be called with a concrete target on every path, and
 * `requireScopedPermissions` fails closed on an empty one, so every call would
 * 403.
 *
 * What makes these privileged is the permission, not the scope. `svc.price.read`
 * is `medium` risk rather than `low` because a price list exposes what the business
 * charges every customer segment, not only the customer in front of you.
 *
 * ## The currency is a one-way decision
 *
 * `tg_price_lists_immutable` freezes `currency_code`, so the code supplied at
 * creation denominates every amount ever attached to this list and there is no
 * conversion path afterwards. It is validated as an ISO 4217 shape and nothing
 * more — the platform ships no currency table and no jurisdiction default, so
 * which currency a tenant trades in is theirs to state.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { EXTERNAL_CODE, MAX_DESCRIPTION, MAX_NAME } from '@/modules/service-catalog';
import { pricingModule } from '@/modules/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    limit: schemas.limit.optional(),
  })
  .strict();

export const PRICE_LIST_LIST_OPERATION = defineOperation({
  id: 'svc.price-list-list',
  module: 'pricing',
  method: 'GET',
  path: '/price-lists',
  summary: 'List the tenant price lists.',
  permissions: ['svc.price.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(PRICE_LIST_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return { body: { items: await pricingModule().priceLists.list(db, query.limit ?? 50) } };
  });
}

/**
 * Create body.
 *
 * `.strict()` matters here beyond tidiness: it is what stops a caller inventing
 * an `amount` or `status` field and believing it took effect. Status is not
 * settable — a list is created `active` and its lifecycle is a separate concern.
 */
const CreateBody = z
  .object({
    priceListCode: z.string().regex(EXTERNAL_CODE, 'must be an external code'),
    name: z.string().min(1).max(MAX_NAME),
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code'),
    description: z.string().min(1).max(MAX_DESCRIPTION).optional(),
  })
  .strict();

export const PRICE_LIST_CREATE_OPERATION = defineOperation({
  id: 'svc.price-list-create',
  module: 'pricing',
  method: 'POST',
  path: '/price-lists',
  summary: 'Create a price list in a fixed currency.',
  permissions: ['svc.price.manage'],
  scope: 'tenant',
  auditClass: 'financial',
  auditAction: 'svc.price_list.created',
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
    PRICE_LIST_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const created = await pricingModule().priceLists.create(db, {
        priceListCode: parsed.priceListCode,
        name: parsed.name,
        currency: parsed.currency,
        description: parsed.description,
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
