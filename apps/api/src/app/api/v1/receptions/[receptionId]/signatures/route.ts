/**
 * GET / POST /api/v1/receptions/{receptionId}/signatures (Phase 1-18,
 * P1-18-BE-016; read-back and replacement per Owner decision FE-018).
 *
 * Records that a named party signed for something specific — custody acceptance,
 * the recorded condition, an authorization. `rec.signatures` is INSERT and SELECT
 * only, so a signature is never edited or withdrawn; a change of mind is a refusal
 * or a later signature, both of which are their own rows.
 *
 * Only the document and its exact version are stored, never the drawn bytes: the
 * media contract keeps deciding who may open the image, and `rec` holds a reference.
 * `rec.guard_signature_version` is the authority on the version belonging to the
 * document, and `rec.guard_signature_evidence` adds what FE-018 requires — a
 * rejected or quarantined version is never bindable, a governed
 * `reception_signature` document must be linked to the visit it signs, and a
 * replacement must belong to the same visit as the signature it supersedes.
 *
 * ## Replacement, not correction
 *
 * `replacesSignatureId` names the signature this one supersedes. It creates a
 * new row and leaves the old one exactly as it was recorded — no UPDATE and no
 * DELETE grant exists on the table, so that is a structural guarantee rather
 * than a convention. `uq_signatures_replaces` holds one successor per
 * predecessor, so the read-back can name it unambiguously.
 *
 * ## The GET is the FE-018 read-back
 *
 * Every signature of the visit, superseded and repudiated ones included, with
 * the exact version it bound, that version's state, the server-owned checksum,
 * the signer, the purpose, the capture method, the actor, and what became of it.
 * A signature counts only once it is FINALIZED
 * (`.../signatures/{signatureId}/events`), and this read is where that is
 * visible.
 *
 * A separate route and permission from condition evidence on purpose: capturing what
 * a vehicle looked like and capturing what a person put their name to are different
 * authorities. The read is separated again, behind `rec.reception.read`.
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
    replacesSignatureId: schemas.uuid.nullable().optional(),
  })
  .strict();

export const RECEPTION_SIGNATURE_LIST_OPERATION = defineOperation({
  id: 'rec.reception-signature-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/signatures',
  summary: 'Read every signature recorded against a reception visit and what became of it.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    RECEPTION_SIGNATURE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await receptionModule().receptionCapture.readSignatures(
          db,
          params.receptionId,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}

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
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionEvidence.recordSignature(
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
