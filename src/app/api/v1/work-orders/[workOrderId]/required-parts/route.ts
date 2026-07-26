/**
 * Required parts on a work order (Phase 1-19, P1-19-BE-020).
 *
 * ## This is DEMAND. It reserves nothing and issues nothing.
 *
 * Recording that a job needs two brake discs is not the same act as taking two discs
 * out of the store, and this phase performs only the first. No stock row is read or
 * written anywhere in P1-19, and `wo.work_orders.parts_forward_state` is documented
 * in the frozen schema as a forward contract with no reservation enforced.
 * Reservation and issue belong to Phase 1-21.
 *
 * `itemRef` is optional and, when given, must resolve: `fk_required_parts_item`
 * foreign-keys `item_ref` to `inv.item_master (tenant_id, id)`, added by migration
 * 20260723097000. That is a reference to the item CATALOG, not to stock — pointing at
 * a catalogued item neither reserves nor consumes any of it — and an unknown
 * reference is a 404 rather than a 500.
 *
 * That boundary is why closure blocker B3 is about unresolved ADDITIONAL WORK and
 * not about parts: the two conditions the brief called for — an active reservation
 * and an open part issue — cannot be evaluated against a schema that stores neither,
 * so the closure-eligibility endpoint reports them as `deferred` rather than
 * silently clear.
 *
 * `quantity` is a decimal STRING for the same reason money is: the column is
 * `numeric(12,3)`, and IEEE-754 cannot represent every value it can hold.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_LINE_DESCRIPTION, MAX_LINE_UNIT, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

const Body = z
  .object({
    jobId: schemas.uuid.optional(),
    description: z.string().trim().min(1).max(MAX_LINE_DESCRIPTION),
    quantity: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,3})?$/, 'must be a positive decimal with at most 3 places')
      .refine((value) => Number(value) > 0, 'must be greater than zero'),
    unit: z.string().trim().min(1).max(MAX_LINE_UNIT).optional(),
    itemRef: schemas.uuid.optional(),
  })
  .strict();

export const REQUIRED_PART_RECORD_OPERATION = defineOperation({
  id: 'wo.required-part-record',
  module: 'work-order',
  method: 'POST',
  path: '/work-orders/{workOrderId}/required-parts',
  summary: 'Record a part a work order needs. Reserves and issues nothing.',
  permissions: ['wo.work_order.line.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.work_order.required_part_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REQUIRED_PART_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const line = await workOrderModule().workOrders.recordLine(
        db,
        'part',
        params.workOrderId,
        {
          jobId: parsed.jobId,
          description: parsed.description,
          quantity: parsed.quantity,
          unit: parsed.unit,
          reference: parsed.itemRef,
        },
        authorizeScope
      );
      return { status: 201, body: line, recordVersion: line.recordVersion };
    },
    { params: raw, body }
  );
}

export const REQUIRED_PART_LIST_OPERATION = defineOperation({
  id: 'wo.required-part-list',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders/{workOrderId}/required-parts',
  summary: 'List the parts a work order needs.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REQUIRED_PART_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await workOrderModule().workOrders.lines(
            db,
            'part',
            params.workOrderId,
            authorizeScope
          ),
        },
      };
    },
    { params: raw }
  );
}
