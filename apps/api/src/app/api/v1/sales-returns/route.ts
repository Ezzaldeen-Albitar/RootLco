/**
 * /api/v1/sales-returns — a part coming back (P1-32-PRE-112, P1-32-PRE-115).
 *
 * `POST` receives a return; `GET` lists a branch's returns.
 *
 * Two independent facts decide what happens. The SOURCE — the part issue it was
 * fitted from, or the counter-sale invoice line it was sold on — bounds how much
 * may come back and decides whether money moves. The CONDITION decides which shelf
 * it lands on: `restockable` goes back into sellable stock, `damaged` goes into a
 * quarantine location and is therefore unavailable because of where it sits.
 *
 * ## The ceiling counts both return tables
 *
 * `inv.guard_sales_return_ceiling` locks the source and counts the legacy
 * `inv.part_returns` rows as well as this table's, so `POST /stock-returns` and this
 * operation cannot each spend the same issued quantity.
 * `GET /returnable-quantities` reports the remainder before anything is offered.
 *
 * ## Why a financial permission
 *
 * A return against an issued counter sale raises a PENDING credit note, and both
 * the read of the line's amount and the insert of the note require
 * `sal.finance.view` in the database. The operation declares it rather than failing
 * inside a transaction for half its inputs. A purely internal return of a part
 * issued to a job — which raises no credit note — remains available through
 * `POST /stock-returns` on `inv.stock.operate` alone.
 *
 * ## Duplicate frames
 *
 * `idempotent: true`. A counter that scans a returned part may deliver the frame
 * twice; the client derives its `Idempotency-Key` once per user confirmation, so a
 * repeat replays the first receipt instead of taking the part back twice.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import {
  MAX_REASON,
  QUANTITY_MAX,
  RETURN_CONDITIONS,
  SALES_RETURN_SOURCE_KINDS,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    sourceKind: z.enum(SALES_RETURN_SOURCE_KINDS).optional(),
    sourceId: schemas.uuid.optional(),
    condition: z.enum(RETURN_CONDITIONS).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const SALES_RETURN_LIST_OPERATION = defineOperation({
  id: 'inv.sales-return-list',
  module: 'inventory',
  method: 'GET',
  path: '/sales-returns',
  summary: "List a branch's received returns, newest first.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    SALES_RETURN_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().salesReturns.list(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.sourceKind === undefined ? {} : { sourceKind: query.sourceKind }),
            ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
            ...(query.condition === undefined ? {} : { condition: query.condition }),
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
    sourceKind: z.enum(SALES_RETURN_SOURCE_KINDS),
    sourceId: schemas.uuid,
    quantity: QuantityString,
    condition: z.enum(RETURN_CONDITIONS),
    receivedLocationId: schemas.uuid,
    /** Required when the condition is `damaged`, refused when it is not. */
    quarantineLocationId: schemas.uuid.optional(),
    reason: z.string().trim().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const SALES_RETURN_CREATE_OPERATION = defineOperation({
  id: 'inv.sales-return-create',
  module: 'inventory',
  method: 'POST',
  // `status: x.replayed ? 200 : 201`: a create, and the replay of one.
  successStatus: 201,
  replayStatus: 200,
  path: '/sales-returns',
  summary: 'Receive a returned part, restock it or quarantine it, and credit a sale.',
  permissions: ['inv.stock.operate', 'sal.finance.view'],
  // `branch`, with the concrete target resolved by the service from the SOURCE:
  // a return is received in the branch that issued or sold the part, never in one
  // the body names.
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.sales_return.received',
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
    SALES_RETURN_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const received = await inventoryModule().salesReturns.receive(
        db,
        {
          sourceKind: parsed.sourceKind,
          sourceId: parsed.sourceId,
          quantity: parsed.quantity,
          condition: parsed.condition,
          receivedLocationId: parsed.receivedLocationId,
          ...(parsed.quarantineLocationId === undefined
            ? {}
            : { quarantineLocationId: parsed.quarantineLocationId }),
          ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return {
        status: received.replayed ? 200 : 201,
        body: received,
        recordVersion: received.recordVersion,
      };
    },
    // No `scopeTargetOption(body)`: the body names a source, not a branch. The real
    // check is the service's `authorizeScope` against the source's own company and
    // branch, resolved inside the transaction.
    { body }
  );
}
