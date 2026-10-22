/**
 * /api/v1/material-requests/{requestId}/closure — close a material request
 * (P1-32-PRE-133).
 *
 * A material request is opened by a governed reservation or issue for a work order
 * (`materialRequestId` on either response). Closing it keeps what it issued counted
 * against the requirement and stops counting what it still asks for or holds: its
 * active reservations are released by the same act, through
 * `inv.finish_material_request`, and each release is audited and published exactly
 * as `POST /stock-reservations/{reservationId}/release` records one. Closing a closed
 * request changes nothing and says so (`replayed: true`).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid }).strict();

export const RequestClosureBody = z
  .object({
    /** Optional: why the request is closed before everything it asked for was issued. */
    reason: z.string().trim().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const MATERIAL_REQUEST_CLOSE_OPERATION = defineOperation({
  id: 'inv.material-request-close',
  module: 'inventory',
  method: 'POST',
  path: '/material-requests/{requestId}/closure',
  summary: 'Close a material request and release what it still holds.',
  permissions: ['inv.material.request'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.material_request.closed',
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
    MATERIAL_REQUEST_CLOSE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { requestId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RequestClosureBody, body, 'body');
      const closed = await inventoryModule().materials.closeRequest(
        db,
        requestId,
        parsed.reason === undefined ? {} : { reason: parsed.reason },
        authorizeScope
      );
      return { body: closed, recordVersion: closed.recordVersion };
    },
    { params: raw, body }
  );
}
