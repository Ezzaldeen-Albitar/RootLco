/**
 * /api/v1/stock-counts.
 *
 * `POST` opens a stock count of one location; `GET` lists a branch's counts
 * (P1-32-PRE-047, BE-049).
 *
 * Opening snapshots the on-hand quantity of every item the location holds. The
 * ledger is NOT frozen: the branch keeps issuing and receiving while the shelf is
 * counted, and reconciliation folds those movements back in. At most one count may
 * be in progress per location (`uq_stock_counts_open_location`); a second is refused
 * with `ERR-INT-001`, because two open counts of one shelf would each raise
 * adjustments for the other's findings.
 *
 * Every row of the list carries `varianceLineCount` and `absoluteVarianceQty`, so a
 * discrepancy is visible without opening each count.
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
import { MAX_DESCRIPTION, STOCK_COUNT_STATES, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(STOCK_COUNT_STATES).optional(),
    locationId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const STOCK_COUNT_LIST_OPERATION = defineOperation({
  id: 'inv.stock-count-list',
  module: 'inventory',
  method: 'GET',
  path: '/stock-counts',
  summary: "List a branch's stock counts with their discrepancy figures, newest first.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    STOCK_COUNT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().counts.list(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.status === undefined ? {} : { status: query.status }),
            ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    scopeTargetOption(raw)
  );
}

export const OpenBody = z
  .object({
    locationId: schemas.uuid,
    notes: z.string().trim().min(1).max(MAX_DESCRIPTION).optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const STOCK_COUNT_OPEN_OPERATION = defineOperation({
  id: 'inv.stock-count-open',
  module: 'inventory',
  method: 'POST',
  // `status: x.replayed ? 200 : 201`: a create, and the replay of one.
  successStatus: 201,
  replayStatus: 200,
  path: '/stock-counts',
  summary: 'Open a stock count of one location, snapshotting what it holds.',
  permissions: ['inv.stock.operate'],
  // `branch`, with the concrete target resolved from the location's own company
  // and branch — the body names a location, not a branch.
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_count.opened',
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
    STOCK_COUNT_OPEN_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(OpenBody, body, 'body');
      const count = await inventoryModule().counts.open(
        db,
        {
          locationId: parsed.locationId,
          ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
          ...(parsed.idempotencyKey === undefined ? {} : { idempotencyKey: parsed.idempotencyKey }),
        },
        authorizeScope
      );
      return {
        status: count.replayed ? 200 : 201,
        body: count,
        recordVersion: count.recordVersion,
      };
    },
    { body }
  );
}
