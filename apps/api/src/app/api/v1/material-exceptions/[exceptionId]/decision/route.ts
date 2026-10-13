/**
 * /api/v1/material-exceptions/{exceptionId}/decision — decide an exception someone
 * else asked for (P1-32-PRE-129).
 *
 * An approval records the resulting allowance on the exception — the allowance plus
 * every approved exception, this one included — and later draws are measured against
 * it. `inv.material.exception.approve` is a stronger authority than approving the
 * allowance itself, and the requester of an exception can never decide it
 * (`ck_material_requirement_exceptions_separation`).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { ADJUSTMENT_DECISIONS, MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ exceptionId: schemas.uuid }).strict();

export const ExceptionDecisionBody = z
  .object({
    decision: z.enum(ADJUSTMENT_DECISIONS),
    note: z.string().trim().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const MATERIAL_EXCEPTION_DECIDE_OPERATION = defineOperation({
  id: 'inv.material-exception-decide',
  module: 'inventory',
  method: 'POST',
  path: '/material-exceptions/{exceptionId}/decision',
  summary: 'Approve or reject a material exception asked for by someone else.',
  permissions: ['inv.material.exception.approve'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'inv.material_exception.approved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ exceptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    MATERIAL_EXCEPTION_DECIDE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { exceptionId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(ExceptionDecisionBody, body, 'body');
      const decided = await inventoryModule().materials.decideException(
        db,
        exceptionId,
        {
          decision: parsed.decision,
          ...(parsed.note === undefined ? {} : { note: parsed.note }),
        },
        authorizeScope
      );
      return { body: decided, recordVersion: decided.recordVersion };
    },
    { params: raw, body }
  );
}
