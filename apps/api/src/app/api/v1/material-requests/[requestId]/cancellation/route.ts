/**
 * /api/v1/material-requests/{requestId}/cancellation — cancel a material request
 * with a reason (P1-32-PRE-133).
 *
 * Only a request that issued nothing is cancelled; one that issued stock is closed
 * instead (`POST /material-requests/{requestId}/closure`), so what it issued stays
 * counted. Cancelling releases the request's active reservations by the same act and
 * gives its whole quantity back to the requirement's allowance. Cancelling a
 * cancelled request changes nothing and says so (`replayed: true`).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid }).strict();

export const RequestCancellationBody = z
  .object({ reason: z.string().trim().min(1).max(MAX_REASON) })
  .strict();

export const MATERIAL_REQUEST_CANCEL_OPERATION = defineOperation({
  id: 'inv.material-request-cancel',
  module: 'inventory',
  method: 'POST',
  path: '/material-requests/{requestId}/cancellation',
  summary: 'Cancel a material request that issued nothing and release what it holds.',
  permissions: ['inv.material.request'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.material_request.cancelled',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    MATERIAL_REQUEST_CANCEL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { requestId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RequestCancellationBody, body, 'body');
      const cancelled = await inventoryModule().materials.cancelRequest(
        db,
        requestId,
        { reason: parsed.reason },
        authorizeScope
      );
      return { body: cancelled, recordVersion: cancelled.recordVersion };
    },
    { params: raw, body }
  );
}
