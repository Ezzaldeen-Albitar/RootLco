/**
 * POST /api/v1/receptions/{receptionId}/evidence-bindings/{bindingId}/finalization
 * (Owner decision FE-018, applied to capture).
 *
 * Declares one binding sufficient. This is the ONLY act that makes captured
 * media count toward a requirement, and it is refused unless the bound document
 * version has been ACCEPTED — enforced by
 * `rec.guard_reception_evidence_binding()`, not by a predicate in this process,
 * so no other code path can reach around it.
 *
 * The separation is the point. A single insert that both recorded and counted
 * would mean a visit reads complete while its images are still pending a scan,
 * and a rejected or quarantined version could never be distinguished from an
 * accepted one after the fact.
 *
 * There is no body. Finalization carries no operator input: the binding names
 * the version, the version names its own state, and the actor and the time come
 * from the context. A body would only offer somewhere to put a claim the
 * platform would then have to ignore.
 *
 * Not `versionGuarded`: `rec.reception_evidence_bindings` carries no
 * `record_version`, because the only mutation it permits is this one and it is
 * guarded by `finalized_at IS NULL` in both the row policy and the statement. A
 * second finalization is reported as a conflict rather than silently accepted.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid, bindingId: schemas.uuid });

export const RECEPTION_EVIDENCE_BINDING_FINALIZE_OPERATION = defineOperation({
  id: 'rec.reception-evidence-binding-finalize',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/evidence-bindings/{bindingId}/finalization',
  summary: 'Finalize a reception evidence binding once its document version is accepted.',
  permissions: ['rec.reception.evidence.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.capture_evidence_finalized',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ receptionId: string; bindingId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    RECEPTION_EVIDENCE_BINDING_FINALIZE_OPERATION,
    request,
    async ({ db, authorizeScope }) => ({
      body: await receptionModule().receptionCapture.finalizeEvidenceBinding(
        db,
        params.receptionId,
        params.bindingId,
        authorizeScope
      ),
    }),
    { params }
  );
}
