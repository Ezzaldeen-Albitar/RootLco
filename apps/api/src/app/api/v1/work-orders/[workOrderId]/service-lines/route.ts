/**
 * Work-order service lines (Phase 1-19, P1-19-BE-020).
 *
 * `POST` records one; `GET` lists them. A line says WHAT work is on the order — it
 * does not price it: nothing here reads a price list, because pricing and quotation
 * are Phase 1-20.
 *
 * `serviceRef` is optional and, when given, must resolve.
 * `fk_work_order_service_lines_service` foreign-keys `service_ref` to
 * `svc.services (tenant_id, id)` — added by migration 20260723097000, after the
 * Phase 1-9 table comment that still calls it an unconstrained forward reference. An
 * unknown reference is therefore a 404, not a 500.
 *
 * `quantity` crosses the boundary as a decimal STRING, never a JavaScript number:
 * the column is `numeric(12,3)` and IEEE-754 cannot represent every value it holds.
 * That is the same rule `schemas.money` states for money, applied to a quantity for
 * the same reason.
 *
 * `jobId` is optional and, when given, must belong to THIS work order. The composite
 * foreign key cannot express that on its own — a job in the same branch under a
 * different order satisfies it — so the service checks it explicitly.
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
    // Matches `ck_work_order_service_lines_quantity` (> 0) and the column's scale.
    quantity: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,3})?$/, 'must be a positive decimal with at most 3 places')
      .refine((value) => Number(value) > 0, 'must be greater than zero'),
    unit: z.string().trim().min(1).max(MAX_LINE_UNIT).optional(),
    serviceRef: schemas.uuid.optional(),
  })
  .strict();

export const SERVICE_LINE_RECORD_OPERATION = defineOperation({
  id: 'wo.service-line-record',
  module: 'work-order',
  method: 'POST',
  path: '/work-orders/{workOrderId}/service-lines',
  summary: 'Record a service or labour line on a work order.',
  permissions: ['wo.work_order.line.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.work_order.service_line_recorded',
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
    SERVICE_LINE_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const line = await workOrderModule().workOrders.recordLine(
        db,
        'service',
        params.workOrderId,
        {
          jobId: parsed.jobId,
          description: parsed.description,
          quantity: parsed.quantity,
          unit: parsed.unit,
          reference: parsed.serviceRef,
        },
        authorizeScope
      );
      return { status: 201, body: line, recordVersion: line.recordVersion };
    },
    { params: raw, body }
  );
}

export const SERVICE_LINE_LIST_OPERATION = defineOperation({
  id: 'wo.service-line-list',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders/{workOrderId}/service-lines',
  summary: 'List the service lines of a work order.',
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
    SERVICE_LINE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await workOrderModule().workOrders.lines(
            db,
            'service',
            params.workOrderId,
            authorizeScope
          ),
        },
      };
    },
    { params: raw }
  );
}
