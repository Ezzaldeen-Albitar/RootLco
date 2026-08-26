/**
 * POST /api/v1/price-lists/{priceListId}/versions (Phase 1-20, P1-20-BE-004).
 *
 * Creates the next DRAFT version of a price list. A draft is not a price anyone is
 * charged against: it is where rules are assembled before
 * `POST .../versions/{versionId}/publication` makes them real.
 *
 * `effectiveFrom` here is provisional. `svc.publish_price_list_version` overwrites
 * it at publication with the date supplied there, which is what makes forward-only
 * succession the database's decision rather than something a caller can pre-set and
 * then have honoured. The field exists because the column is NOT NULL, and the
 * comment says so rather than implying the value is load-bearing.
 *
 * `If-Match` carries the price list's `record_version`, so two callers racing to
 * add a version to the same list cannot both win — and the list is locked
 * `FOR UPDATE` before `MAX(version_no) + 1` is computed, with
 * `uq_price_list_versions_no` as the backstop.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_NOTES } from '@/modules/service-catalog';
import { pricingModule } from '@/modules/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ priceListId: schemas.uuid });

export const Body = z
  .object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
    notes: z.string().min(1).max(MAX_NOTES).optional(),
  })
  .strict();

export const PRICE_LIST_VERSION_CREATE_OPERATION = defineOperation({
  id: 'svc.price-list-version-create',
  module: 'pricing',
  method: 'POST',
  path: '/price-lists/{priceListId}/versions',
  summary: 'Create the next draft version of a price list.',
  permissions: ['svc.price.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'svc.price_list_version.created',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ priceListId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    PRICE_LIST_VERSION_CREATE_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const version = await pricingModule().priceLists.createVersion(db, params.priceListId, {
        effectiveFrom: parsed.effectiveFrom,
        notes: parsed.notes,
        expectedVersion,
      });
      return { status: 201, body: version, recordVersion: version.recordVersion };
    },
    { params: raw, body }
  );
}
