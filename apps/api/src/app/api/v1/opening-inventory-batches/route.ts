/**
 * /api/v1/opening-inventory-batches — list and start an opening stock count
 * (P1-21-BE-002; the list is Phase 1-30, seam S-17).
 *
 * ## Opening balances are the only path that mints stock, so they are a batch
 *
 * A batch is created `draft` and no parameter offers anything else. Stock appears
 * only when `/opening-inventory-batches/{batchId}/approval` runs
 * `inv.approve_opening_batch`, which posts one immutable `opening` movement per
 * counted line and is subject to `ck_opening_inventory_batches_maker`
 * (approver ≠ counter, with `inv.guard_opening_batch_approval` freezing the row
 * once it is approved). This route therefore cannot create a balance — it creates
 * a counted intention that someone else must approve.
 *
 * That shape is the reason the API has no "set stock level" endpoint at all.
 * Overwriting `inv.stock_balances.on_hand_qty` directly is grantable — `app_runtime`
 * holds UPDATE — but `inv.guard_stock_balance_coherence` would reject it, because
 * `on_hand` must equal `Σ signed_qty` of the movement ledger. Stock without a
 * movement behind it is unrepresentable, and that is deliberate.
 *
 * ## Why a list had to exist for the maker-checker rule to be usable
 *
 * Until this list the batch was write-only on the wire: three POSTs and no GET.
 * The count screen could only render what the creating tab still held in memory,
 * so a reload, a sign-out, or the SECOND PERSON — the one the maker-checker rule
 * requires — had no way to reach a draft at all. The rule was satisfiable only by
 * swapping sessions inside one un-reloaded tab, which is a harness, not a product.
 * The list and the detail alongside it are what make the approval reachable.
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
import {
  LOCATION_CODE_FORMAT,
  MAX_DESCRIPTION,
  OPENING_BATCH_STATES,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `companyId` and `branchId` are REQUIRED and are the `authorizationTarget`.
 *
 * A branch-blind batch list would be a directory of which branches exist and what
 * they are counting, narrowed only by `app.branch_ids` — the permission-blind
 * union of every active grant (P1-18-A-01). The service re-authorizes the same
 * pair, so the check does not depend on the route option alone.
 */
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(OPENING_BATCH_STATES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const OPENING_BATCH_LIST_OPERATION = defineOperation({
  id: 'inv.opening-batch-list',
  module: 'inventory',
  method: 'GET',
  path: '/opening-inventory-batches',
  summary: "List a branch's opening-inventory batches, newest first.",
  // The count screen already gates on `inv.stock.read` and the 118-code catalogue
  // names no batch-specific read authority. This slice mints none (RES-05).
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    OPENING_BATCH_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().reads.listOpeningBatches(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.status === undefined ? {} : { status: query.status }),
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

/**
 * `.strict()` is load-bearing: it refuses `countedBy`.
 *
 * `counted_by` is NOT NULL and `ck_opening_inventory_batches_maker` forbids the
 * approver from equalling it, so the column is one half of the maker-checker rule.
 * If a caller could name the counter, one person could open a batch "counted by" a
 * colleague and approve it themselves — satisfying the CHECK while defeating the
 * separation it exists to create. The counter is the authenticated caller, full stop.
 */
export const CreateBody = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    // `ck_opening_inventory_batches_code_format`, unique per branch.
    batchCode: z.string().regex(LOCATION_CODE_FORMAT, 'must be an alphanumeric batch code'),
    // `as_of_date` is a `date`, so a plain ISO date — accepting a timestamp would
    // imply a precision the column does not have.
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
    notes: z.string().min(1).max(MAX_DESCRIPTION).optional(),
  })
  .strict();

export const OPENING_BATCH_CREATE_OPERATION = defineOperation({
  id: 'inv.opening-batch-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/opening-inventory-batches',
  summary: 'Open a draft opening-inventory batch for a branch.',
  permissions: ['inv.stock.operate'],
  // The body names the company and branch the batch belongs to, so
  // `scopeTargetOption` gives the pre-handler check a concrete target and evaluation
  // uses `iam.has_permission_in_scope`. The service re-authorizes the same pair.
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.opening_batch.created',
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
    OPENING_BATCH_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const batch = await inventoryModule().intake.openBatch(
        db,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          batchCode: parsed.batchCode,
          asOfDate: parsed.asOfDate,
          ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
        },
        authorizeScope
      );
      return { status: 201, body: batch, recordVersion: batch.recordVersion };
    },
    { body, ...scopeTargetOption(body) }
  );
}
