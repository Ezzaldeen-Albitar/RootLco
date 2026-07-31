/**
 * POST /api/v1/attachments/documents/{documentId}/retention-evaluations (P1-23).
 *
 * Evaluates whether a document could be disposed of. **Evaluates only** — this
 * phase implements no destructive retention path at all, which is why the
 * response carries `deletionPerformed: false` as a literal rather than a flag
 * the caller can flip.
 *
 * Retention durations are an open decision, so nothing here invents one. The
 * verdict comes from `shared.document_deletion_eligibility`, a protected
 * read-only function that already owns the rule: legal hold always wins, active
 * links block, retention is measured against the class definition.
 *
 * A POST rather than a GET because it writes an audit record — knowing which
 * records are near the end of their retention is information about the
 * business, and the operation exists to inform a future destructive decision.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DOCUMENT_RETENTION_EVALUATE_OPERATION = defineOperation({
  id: 'shared.document-retention-evaluate',
  module: 'shared-services',
  method: 'POST',
  path: '/attachments/documents/{documentId}/retention-evaluations',
  summary: 'Evaluate retention disposition for one document. Never deletes.',
  permissions: ['shared.document.archive'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'shared.document.retention_evaluated',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
): Promise<Response> {
  const { documentId } = await context.params;
  return handleOperation(DOCUMENT_RETENTION_EVALUATE_OPERATION, request, async ({ db }) => {
    const id = parseOrFail(schemas.uuid, documentId, 'path.documentId');
    return { body: await sharedServicesModule().documentReads.evaluateRetention(db, id) };
  });
}
