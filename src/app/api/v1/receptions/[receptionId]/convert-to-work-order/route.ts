/**
 * POST /api/v1/receptions/{receptionId}/convert-to-work-order (Phase 1-18,
 * P1-18-BE-019).
 *
 * Turns an authorized reception into exactly one minimal work order. No job, service
 * line, part, or assignment is created: how work is organised is Phase 1-19's
 * contract, and answering it here would be this module deciding something nobody
 * asked it.
 *
 * Exactly-once is guarded twice. The application locks the visit, returns the work
 * order a previous attempt already created rather than making a second, and leaves
 * the visit in the terminal `converted` state — so a replay is answered, not
 * duplicated. Underneath it, `uq_work_orders_ordinary_origin` is a partial unique
 * INDEX on (tenant, company, branch, reception_visit_id) where `kind = 'ordinary'`
 * and the row is live: an index and not a constraint row, which is why an audit
 * that enumerated `pg_constraint` reported no uniqueness here at all.
 *
 * `If-Match` is mandatory. `wo.guard_work_order_refs` holds every precondition and
 * none of them is re-implemented above it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });

/**
 * The command carries no body: the work order inherits its scope, its vehicle and
 * its origin from the visit. The empty strict shape is still enforced so a caller
 * cannot appear to seed a state or a kind that this operation does not accept.
 */
const Body = z.object({}).strict().nullable();

export const RECEPTION_CONVERT_OPERATION = defineOperation({
  id: 'rec.reception-convert-to-work-order',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/convert-to-work-order',
  summary: 'Convert an authorized reception visit into one minimal work order.',
  permissions: ['rec.reception.convert'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.converted_to_work_order',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEPTION_CONVERT_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      return {
        status: 200,
        body: await receptionModule().receptionConversion.convertToWorkOrder(
          db,
          params.receptionId,
          expectedVersion
        ),
      };
    },
    { params, body }
  );
}
