/**
 * /api/v1/material-requirements/{requirementId}/exceptions — ask for more than an
 * approved allowance (P1-32-PRE-129).
 *
 * An exception is a FINITE additional quantity, in the requirement unit, with a
 * mandatory reason. It adds nothing until a different person approves it under
 * `inv.material.exception.approve` on `POST /material-exceptions/{exceptionId}/decision`.
 * There is no global numeric ceiling on an exception: `iam.approval_limits` is a
 * monetary limit, and a quantity of litres has no currency.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, QUANTITY_MAX, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requirementId: schemas.uuid }).strict();

export const ExceptionBody = z
  .object({
    additionalQuantity: z
      .string()
      .regex(
        /^\d{1,9}(\.\d{1,3})?$/,
        `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
      ),
    reason: z.string().trim().min(1).max(MAX_REASON),
  })
  .strict();

export const MATERIAL_EXCEPTION_CREATE_OPERATION = defineOperation({
  id: 'inv.material-exception-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/material-requirements/{requirementId}/exceptions',
  summary: 'Ask for a finite quantity beyond an approved material allowance, with a reason.',
  permissions: ['inv.material.request'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.material_exception.requested',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ requirementId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    MATERIAL_EXCEPTION_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { requirementId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(ExceptionBody, body, 'body');
      const created = await inventoryModule().materials.requestException(
        db,
        requirementId,
        { additionalQuantity: parsed.additionalQuantity, reason: parsed.reason },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params: raw, body }
  );
}
