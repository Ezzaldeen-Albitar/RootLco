/**
 * /api/v1/stock-transfers.
 *
 * `POST` dispatches a transfer (P1-32-PRE-040); `GET` lists a branch's transfers
 * (P1-32-PRE-042).
 *
 * A transfer is two paired postings separated in time. Dispatch moves the quantity
 * out of the source location and into the source branch's `transit` location, and
 * it stays there — excluded from available stock at both ends, reported as
 * `inTransitQty` by `GET /stock-availability` — until
 * `POST /stock-transfers/{transferId}/receipt` or `.../cancellation` settles it.
 *
 * ## Concurrency
 *
 * `inv.dispatch_transfer` takes the source balance-row lock and checks available
 * stock INSIDE it, so two dispatches racing for the last unit produce one winner
 * and one `ERR-TRN-001`. Availability is checked rather than freed: a transfer is a
 * choice, and destroying another work order's reservation to make room for it
 * would be the wrong answer.
 *
 * ## Idempotency
 *
 * `idempotent: true` requires an `Idempotency-Key` header, and the body's own
 * `idempotencyKey` is carried into `uq_stock_transfers_idempotency`, which spans
 * the transfer's whole lifetime — so a retry after the transfer was received still
 * resolves to it. The response is `200` with `replayed: true` on a replay and `201`
 * on a fresh dispatch.
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
import { MAX_REASON, QUANTITY_MAX, TRANSFER_STATES, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `companyId` and `branchId` are REQUIRED and are the `authorizationTarget`, for
 * the reason `inv.stock-movement-list` records. `direction` chooses whether the
 * branch is read as the sender or as the destination; it defaults to `outbound`.
 */
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    direction: z.enum(['outbound', 'inbound']).optional(),
    status: z.enum(TRANSFER_STATES).optional(),
    itemId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const STOCK_TRANSFER_LIST_OPERATION = defineOperation({
  id: 'inv.stock-transfer-list',
  module: 'inventory',
  method: 'GET',
  path: '/stock-transfers',
  summary: "List a branch's stock transfers, outbound or inbound, newest first.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    STOCK_TRANSFER_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().transfers.list(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            direction: query.direction ?? 'outbound',
            ...(query.status === undefined ? {} : { status: query.status }),
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
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

/** Quantity is a decimal STRING — see `POST /stock-reservations`. */
const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

export const CreateBody = z
  .object({
    itemId: schemas.uuid,
    fromLocationId: schemas.uuid,
    toLocationId: schemas.uuid,
    quantity: QuantityString,
    reason: z.string().trim().min(1).max(MAX_REASON).optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const STOCK_TRANSFER_CREATE_OPERATION = defineOperation({
  id: 'inv.stock-transfer-create',
  module: 'inventory',
  method: 'POST',
  // `status: x.replayed ? 200 : 201`: a create, and the replay of one.
  successStatus: 201,
  replayStatus: 200,
  path: '/stock-transfers',
  summary: 'Dispatch a stock transfer from one location into transit toward another.',
  permissions: ['inv.stock.operate'],
  // `branch`, with concrete targets resolved by the service from BOTH locations'
  // own company and branch — the body names locations, not a branch.
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_transfer.dispatched',
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
    STOCK_TRANSFER_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const transfer = await inventoryModule().transfers.dispatch(
        db,
        {
          itemId: parsed.itemId,
          fromLocationId: parsed.fromLocationId,
          toLocationId: parsed.toLocationId,
          quantity: parsed.quantity,
          ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
          ...(parsed.idempotencyKey === undefined ? {} : { idempotencyKey: parsed.idempotencyKey }),
        },
        authorizeScope
      );
      return {
        status: transfer.replayed ? 200 : 201,
        body: transfer,
        recordVersion: transfer.recordVersion,
      };
    },
    // No `scopeTargetOption(body)`: the body names locations, not a branch. The
    // real checks are the service's `authorizeScope` calls against each location's
    // own company and branch, resolved inside the transaction.
    { body }
  );
}
