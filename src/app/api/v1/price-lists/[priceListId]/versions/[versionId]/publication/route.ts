/**
 * POST /api/v1/price-lists/{priceListId}/versions/{versionId}/publication
 * (Phase 1-20, P1-20-BE-004).
 *
 * Publishes a draft version, making its amounts the prices the tenant charges.
 *
 * ## Why this is a separate permission from creating the version
 *
 * `svc.price.manage` builds drafts, which nobody is charged against.
 * `svc.price.publish` is the act that makes a set of amounts real, and it is
 * effectively irreversible — `svc.guard_price_list_version_freeze` allows a
 * published version to move only to `archived`. The authority to draft a price is
 * not the authority to make it the price.
 *
 * ## What the database decides, and this route does not restate
 *
 * `svc.publish_price_list_version` locks the price list, refuses a non-draft
 * version, refuses an `effectiveFrom` at or before the currently open published
 * version's own start, closes that version's `effective_to` at the new date, and
 * publishes. Forward-only succession and the
 * `ex_price_list_versions_no_published_overlap` gist backstop are therefore the
 * database's, not a matrix reimplemented here.
 *
 * The one precondition the function does NOT enforce, and this route does: a
 * version with no active rules must not be published. The function would accept
 * it, and the result would be a published version that resolves no price for
 * anything — every quotation line against it would then fail far from here, with a
 * message that looks like missing data rather than a bad publication.
 *
 * It is a sub-resource noun (`/publication`), not `:publish`: the operation
 * registry's `PATH_PATTERN` accepts only lower-case literal or `{camelCase}`
 * segments, so a colon-action path cannot be registered at all.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { pricingModule } from '@/modules/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ priceListId: schemas.uuid, versionId: schemas.uuid });

/**
 * `effectiveFrom` is required rather than defaulted to today.
 *
 * Defaulting would make the succession boundary depend on when the request
 * happened to arrive, and that boundary decides which prices a quotation resolves
 * on a given day. The caller states it; the database validates it is after the
 * current published version's start.
 */
const Body = z
  .object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
  })
  .strict();

export const PRICE_LIST_VERSION_PUBLISH_OPERATION = defineOperation({
  id: 'svc.price-list-version-publish',
  module: 'pricing',
  method: 'POST',
  path: '/price-lists/{priceListId}/versions/{versionId}/publication',
  summary: 'Publish a draft price-list version, fixing its amounts from a date.',
  permissions: ['svc.price.publish'],
  scope: 'tenant',
  auditClass: 'financial',
  auditAction: 'svc.price_list_version.published',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ priceListId: string; versionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    PRICE_LIST_VERSION_PUBLISH_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const published = await pricingModule().priceLists.publishVersion(
        db,
        params.priceListId,
        params.versionId,
        { effectiveFrom: parsed.effectiveFrom, expectedVersion }
      );
      return { status: 200, body: published, recordVersion: published.recordVersion };
    },
    { params: raw, body }
  );
}
