/**
 * POST /api/v1/receptions/{receptionId}/refuse (P1-27 remediation executed by
 * P1-18, `P1-27-INT-014`).
 *
 * Moves the visit to the terminal `refused` — the exit for a visit the workshop
 * or the customer refuses to proceed with. Distinct from
 * `POST /receptions/{receptionId}/refusals`, which APPENDS a refusal evidence
 * record and never changes `receptionStatus`: that route records that a party
 * declined a step; this one ends the visit. Both `refused` and
 * `closed_without_work` are outside `uq_reception_visits_open_vehicle`'s status
 * list, so the vehicle stops being occupied and can be received again — the
 * INT-013 sibling this pair of commands closes.
 *
 * Same contract as close-without-work: mandatory bounded-text reason into the
 * append-only status ledger via the `app.status_reason` GUC, mandatory
 * `If-Match`, legal from any non-terminal state per the frozen graph.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_CLOSURE_REASON, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });

export const Body = z.object({ reason: z.string().trim().min(1).max(MAX_CLOSURE_REASON) }).strict();

export const RECEPTION_REFUSE_OPERATION = defineOperation({
  id: 'rec.reception-refuse',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/refuse',
  summary: 'Refuse a reception visit, ending it and releasing the vehicle for a later visit.',
  permissions: ['rec.reception.close'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.refused',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEPTION_REFUSE_OPERATION,
    request,
    async ({ db, request: req, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const closed = await receptionModule().receptions.close(
        db,
        params.receptionId,
        'refused',
        input.reason,
        expectedVersion,
        // Re-authorized against the LOCKED visit's branch, not this request:
        // `scope: 'branch'` is inert without a target (P1-18-A-01).
        authorizeScope
      );
      return { status: 200, body: closed, recordVersion: closed.recordVersion };
    },
    { params: raw, body }
  );
}
