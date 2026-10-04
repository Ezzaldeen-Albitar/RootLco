/**
 * /api/v1/barcodes/{value} — resolve a scanned code to one item (P1-32-PRE-104).
 *
 * The scanned value is normalised by `inv.normalize_item_identifier`, the same SQL
 * function that generates the stored `normalized_value`, so spaces, hyphens, case and
 * Arabic-Indic digits never decide whether a code matches. Only LIVE identifiers
 * match. The answer names the item, the identifier kind, and the unit and pack
 * quantity one scan represents.
 *
 * ## Refusals
 *
 * - `404` when no live identifier carries the code.
 * - `409` when the code is live under more than one item. The resolver does not
 *   choose: picking either would put a part on a bill in exactly the case the
 *   operator cannot see.
 *
 * ## A scan resolves to the item, never to a unit
 *
 * Also for a serialised item. No serial-unit table exists.
 *
 * ## Availability
 *
 * `companyId` and `branchId` together (and optionally `locationId`) ask for the item's
 * stock at that branch as well. They are the `authorizationTarget`, and the service
 * additionally requires `inv.stock.read` at that concrete branch — holding
 * `inv.item.read` is not authority to read stock.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_IDENTIFIER_VALUE, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ value: z.string().trim().min(1).max(MAX_IDENTIFIER_VALUE) }).strict();

const Query = z
  .object({
    companyId: schemas.uuid.optional(),
    branchId: schemas.uuid.optional(),
    locationId: schemas.uuid.optional(),
  })
  .strict();

export const BARCODE_RESOLVE_OPERATION = defineOperation({
  id: 'inv.barcode-resolve',
  module: 'inventory',
  method: 'GET',
  path: '/barcodes/{value}',
  summary: 'Resolve a scanned barcode to its item, optionally with branch availability.',
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ value: string }> }
): Promise<Response> {
  const params = await route.params;
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    BARCODE_RESOLVE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { value } = parseOrFail(Params, params, 'path');
      const query = parseOrFail(Query, raw, 'query');
      if ((query.companyId === undefined) !== (query.branchId === undefined)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'companyId and branchId must be given together',
          safeDetails: { violations: [{ path: 'query.branchId', rule: 'custom' }] },
        });
      }
      if (query.locationId !== undefined && query.branchId === undefined) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'locationId requires companyId and branchId',
          safeDetails: { violations: [{ path: 'query.locationId', rule: 'custom' }] },
        });
      }
      const at =
        query.companyId !== undefined && query.branchId !== undefined
          ? {
              companyId: query.companyId,
              branchId: query.branchId,
              ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
            }
          : null;
      return {
        body: await inventoryModule().identifiers.resolve(db, value, at, authorizeScope),
      };
    },
    { params, ...scopeTargetOption(raw) }
  );
}
