/**
 * POST /api/v1/receptions/{receptionId}/approve (Phase 1-18, P1-18-BE-018,
 * P1-18-BE-008).
 *
 * Advances the visit to `authorized`, which is the state a work order may be created
 * from. `authorized` is reachable only from `inspecting`, so a visit still `opened`
 * walks both legal edges inside this one transaction; the row lock taken first is
 * what makes that safe and makes approval exactly-once.
 *
 * The preconditions — an active service requester and an approved authorization —
 * belong to `rec.guard_reception_transition` and are not re-checked here. Restating
 * them would create a second, softer opinion about a rule the database already
 * refuses to bend.
 *
 * `If-Match` is mandatory, and audit class is `approval` rather than `privileged`:
 * this is the decision that lets work begin on a customer's vehicle.
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
 * The command carries no body: approval is the visit's identity, the version the
 * caller saw, and the actor the session names. The empty strict shape is still
 * enforced so a caller who tries to smuggle a status alongside it gets a 422 rather
 * than the quiet impression that it was applied.
 */
export const Body = z.object({}).strict().nullable();

export const RECEPTION_APPROVE_OPERATION = defineOperation({
  id: 'rec.reception-approve',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/approve',
  summary: 'Advance a reception visit to authorized.',
  permissions: ['rec.reception.approve'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'rec.reception.approved',
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
    RECEPTION_APPROVE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const approved = await receptionModule().receptions.approve(
        db,
        params.receptionId,
        expectedVersion,
        // Re-authorized against the LOCKED visit's branch, not this request:
        // `scope: 'branch'` is inert without a target (P1-18-A-01).
        authorizeScope
      );
      // Approval can apply two edges, so the resulting version is not always
      // `expectedVersion + 1`. The ETag carries what the row actually holds, which
      // is what the conversion that follows must present.
      return { status: 200, body: approved, recordVersion: approved.recordVersion };
    },
    { params, body }
  );
}
