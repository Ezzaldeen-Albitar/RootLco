/**
 * POST /api/v1/receptions/{receptionId}/refusals (Phase 1-18, P1-18-BE-017).
 *
 * Records that a party declined something — an inspection item, a signature, an
 * intake step, an authorization. A refusal is evidence in its own right: without it
 * a missing signature is indistinguishable from a step nobody performed, and the
 * distinction is exactly what a later dispute turns on.
 *
 * The reason is a governed code rather than free text, so declining to sign leaves a
 * record with no personal narrative in it, and `rec.guard_refusal_reason` refuses an
 * archived code. `rec.refusals` is INSERT and SELECT only: a refusal is superseded by
 * a later fact, never erased.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { REFUSAL_TYPES, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });
export const Body = z
  .object({
    refusalType: z.enum(REFUSAL_TYPES),
    refusalReasonId: schemas.uuid.nullable().optional(),
    refusingPartnerId: schemas.uuid.nullable().optional(),
    witnessEmployeeId: schemas.uuid.nullable().optional(),
    evidenceDocumentId: schemas.uuid.nullable().optional(),
    // The EXACT version of the supporting media (Owner decision FE-019).
    // Optional by default: refusal is not globally media-dependent, and a live
    // capture-policy rule for this branch and refusal type is the only thing
    // that makes it — and its acceptance — mandatory.
    evidenceDocumentVersionId: schemas.uuid.nullable().optional(),
  })
  .strict();

export const RECEPTION_REFUSAL_OPERATION = defineOperation({
  id: 'rec.reception-refusal',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/refusals',
  summary: 'Record that a party refused a reception step.',
  permissions: ['rec.reception.signature.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.refusal_recorded',
  idempotent: true,
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
    RECEPTION_REFUSAL_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionEvidence.recordRefusal(
        db,
        params.receptionId,
        await parseJsonBody(raw, Body),
        // Re-authorized against the LOCKED visit's branch, not this request:
        // `scope: 'branch'` is inert without a target (P1-18-A-01).
        authorizeScope
      ),
    }),
    { params, body }
  );
}
