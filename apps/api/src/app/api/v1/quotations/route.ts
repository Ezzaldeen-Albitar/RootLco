/**
 * POST /api/v1/quotations (Phase 1-20, P1-20-BE-007).
 *
 * Creates a quotation with its first draft revision and priced lines.
 *
 * ## The client says WHAT to quote, never WHAT IT COSTS
 *
 * The body carries a work order, services, quantities and an optional discount.
 * It carries no unit price, no tax rate, no tax amount, no line total and no
 * document total — those are resolved from the protected price list and computed
 * by PostgreSQL in `numeric`.
 *
 * The schemas are `.strict()`, so a request that includes `unitPrice` or
 * `lineTotal` is **rejected** rather than ignored. Silently dropping such a field
 * would leave a caller believing it had set a price, which is a worse outcome than
 * a 422: they would ship a client that "works" and quietly disagrees with every
 * invoice.
 *
 * ## Scope comes from the work order
 *
 * `quo.quotations.work_order_id` is NOT NULL, so every quotation belongs to a work
 * order, and that order is the authority for company and branch. Nothing here
 * reads a company or branch from the request — a client-supplied branch would be an
 * authorization bypass. `requireWorkOrder` performs the deferred scoped
 * authorization against the row's own scope, which is what makes `scope: 'branch'`
 * real on a path that names no branch (P1-18-A-01).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { INTERNAL_CODE } from '@/modules/service-catalog';
import { MAX_ITEMS_PER_REVISION, MAX_ITEM_DESCRIPTION, quotationModule } from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One requested line.
 *
 * `quantity` is `numeric(12,3)` and `discount` is `numeric(18,4)`, both as decimal
 * STRINGS — a JSON number would lose values IEEE-754 cannot represent, and the
 * scale a caller may send is exactly the column's.
 */
const Line = z
  .object({
    serviceId: schemas.uuid,
    quantity: z
      .string()
      .regex(
        /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/,
        'must be a positive decimal with at most 3 decimal places'
      ),
    discount: z
      .string()
      .regex(
        /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/,
        'must be a non-negative decimal with at most 4 decimal places'
      )
      .optional(),
    description: z.string().min(1).max(MAX_ITEM_DESCRIPTION).optional(),
    sourceServiceLineRef: schemas.uuid.optional(),
  })
  .strict();

export const Body = z
  .object({
    workOrderId: schemas.uuid,
    payerPartnerRef: schemas.uuid.optional(),
    customerClass: z.string().regex(INTERNAL_CODE, 'must be a lower-snake class code').optional(),
    lines: z.array(Line).min(1).max(MAX_ITEMS_PER_REVISION),
    // There is no requester field. A discount that needs approval is recorded as a
    // request by the SIGNED-IN person and approved separately by somebody else
    // (`quo.discount-approval-decide`). The schema is `.strict()`, so a client that
    // still sends `discountRequestedBy` is refused with a 422 naming the key rather
    // than having it silently ignored (P1-32-PRE-OD-DISC-01).
  })
  .strict();

export const QUOTATION_CREATE_OPERATION = defineOperation({
  id: 'quo.quotation-create',
  successStatus: 201,
  module: 'quotation',
  method: 'POST',
  path: '/quotations',
  summary: 'Create a quotation with its first draft revision and priced lines.',
  // A CONJUNCTION, and both halves are load-bearing. Creating a quotation reads
  // the work order to derive its company and branch - that order is the scope
  // authority - so the create exercises a work-order read and declares its code.
  // Row security on wo.work_orders (sel_work_orders_scope) is scope-based, not
  // permission-based: it narrows by tenant and by the caller's company and
  // branch grant union, and never looks at a permission code. The work-order
  // half is therefore enforced by this declaration, not by the table.
  permissions: ['quo.quotation.manage', 'wo.work_order.read'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'quo.quotation.created',
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
    QUOTATION_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(Body, body, 'body');
      const created = await quotationModule().quotations.create(
        db,
        {
          workOrderId: parsed.workOrderId,
          payerPartnerRef: parsed.payerPartnerRef,
          customerClass: parsed.customerClass,
          lines: parsed.lines,
        },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
