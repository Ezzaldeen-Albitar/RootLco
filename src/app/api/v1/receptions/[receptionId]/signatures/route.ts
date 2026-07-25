/**
 * POST /api/v1/receptions/{receptionId}/signatures (Phase 1-18, P1-18-BE-016).
 *
 * Records that a named party signed for something specific — custody acceptance,
 * the recorded condition, an authorization. `rec.signatures` is INSERT and SELECT
 * only, so a signature is never edited or withdrawn; a change of mind is a refusal
 * or a later signature, both of which are their own rows.
 *
 * Only the document and its exact version are stored, never the drawn bytes: the
 * media contract keeps deciding who may open the image, and `rec` holds a reference.
 * `rec.guard_signature_version` is the authority on the version belonging to the
 * document.
 *
 * A separate route and permission from condition evidence on purpose: capturing what
 * a vehicle looked like and capturing what a person put their name to are different
 * authorities.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  SIGNATURE_CAPTURE_METHODS,
  SIGNATURE_PURPOSES,
  SIGNER_ROLES,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deliberately looser than the real limit. The exact 64-byte bound and the
 * lowercase-hex form belong to the module, which reports both as named 422s; this
 * only stops an unbounded string reaching the decoder, and restating the bound here
 * would give the same rule two owners that can disagree.
 */
const MAX_SIGNATURE_HASH_INPUT = 256;

const Params = z.object({ receptionId: schemas.uuid });
const Body = z
  .object({
    signerRole: z.enum(SIGNER_ROLES),
    signerPartnerId: schemas.uuid.nullable().optional(),
    signatureDocumentId: schemas.uuid,
    signatureDocumentVersionId: schemas.uuid,
    captureMethod: z.enum(SIGNATURE_CAPTURE_METHODS),
    purpose: z.enum(SIGNATURE_PURPOSES),
    signatureHash: z.string().max(MAX_SIGNATURE_HASH_INPUT).nullable().optional(),
  })
  .strict();

export const RECEPTION_SIGNATURE_OPERATION = defineOperation({
  id: 'rec.reception-signature',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/signatures',
  summary: 'Record a party signature against a reception visit.',
  permissions: ['rec.reception.signature.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.signature_recorded',
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
    RECEPTION_SIGNATURE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await receptionModule().receptionEvidence.recordSignature(
        db,
        params.receptionId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
