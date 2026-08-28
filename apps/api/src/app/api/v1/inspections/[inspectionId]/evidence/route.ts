/**
 * POST /api/v1/inspections/{inspectionId}/evidence (Phase 1-19, P1-19-BE-010).
 *
 * Binds one exact immutable document version to a diagnostic report as evidence.
 *
 * The contract is identical to `wo.customer_approval_evidence`, deliberately:
 * `dia.diagnostic_evidence` is append-only — `app_runtime` holds SELECT and INSERT and
 * nothing else — so a bound version can be neither substituted nor removed, and the
 * table has no `deleted_at` at all.
 *
 * The input is a document **VERSION**, never a document and never a storage key. A
 * document reference would let the underlying bytes change under a recorded photograph
 * of a worn brake disc; a storage key is a locator this API has no business accepting,
 * and there is no column for one. The Phase 1-15 attachment service is the only way
 * the version exists, and it is what resolves the version here — under RLS, so a
 * version in another tenant is a uniform 404.
 *
 * `accepted` is NOT required. P1-15 documented that acceptance is unreachable while no
 * application role may write `shared.file_scan_results`, so demanding it would make
 * diagnostic evidence impossible for every caller. What CAN be refused is a version
 * somebody rejected or quarantined, and that is what is refused.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_EVIDENCE_NOTE, MAX_EVIDENCE_TYPE, diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });

export const Body = z
  .object({
    documentVersionId: schemas.uuid,
    evidenceType: z.string().trim().min(1).max(MAX_EVIDENCE_TYPE),
    note: z.string().trim().min(1).max(MAX_EVIDENCE_NOTE).optional(),
  })
  .strict();

export const DIAGNOSTIC_EVIDENCE_OPERATION = defineOperation({
  id: 'dia.diagnostic-evidence-record',
  successStatus: 201,
  module: 'diagnostics',
  method: 'POST',
  path: '/inspections/{inspectionId}/evidence',
  summary: 'Bind an exact document version to a diagnostic report as evidence.',
  permissions: ['dia.diagnostic.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'dia.diagnostic.entry_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ inspectionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DIAGNOSTIC_EVIDENCE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const evidence = await diagnosticsModule().reports.recordEvidence(
        db,
        params.inspectionId,
        {
          documentVersionId: parsed.documentVersionId,
          evidenceType: parsed.evidenceType,
          note: parsed.note,
        },
        authorizeScope
      );
      return { status: 201, body: evidence };
    },
    { params: raw, body }
  );
}
