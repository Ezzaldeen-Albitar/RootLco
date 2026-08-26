/**
 * GET / POST /api/v1/receptions/{receptionId}/evidence-bindings (Owner decisions
 * FE-012, FE-018, FE-019).
 *
 * ## What the POST binds
 *
 * One capture requirement of a visit to ONE EXACT immutable document version.
 * Not the document — the version: a document id is mutable in the sense that it
 * accumulates versions, and evidence that a vehicle arrived scratched must name
 * the image that was taken, not whatever image the document holds today.
 *
 * The binding is created UNFINALIZED, always. Recording what was captured and
 * declaring it sufficient are two acts with two audit records, and the second
 * one is refused unless the version has been ACCEPTED — see
 * `.../evidence-bindings/{bindingId}/finalization`.
 *
 * ## What the GET answers
 *
 * "What does this visit still owe?" — the resolved capture policy for the
 * visit's branch, every binding with its version state and server-owned
 * checksum, every override, and the damage-map templates the visit may still be
 * bound to. `satisfied` counts FINALIZED bindings only, so a screen cannot
 * report a visit complete on the strength of versions that are still pending.
 *
 * `expensive-read`, not `low-risk-metadata`: it joins four relations and answers
 * per visit rather than per tenant.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  CAPTURE_QUALITY_STATUSES,
  CAPTURE_REQUIREMENTS,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });

/**
 * `deviceCapturedAt` is bounded but not parsed here. The module reports a
 * malformed instant as a named 422; restating the grammar in the route would
 * give one rule two owners that can disagree.
 */
export const CreateBody = z
  .object({
    requirementCode: z.enum(CAPTURE_REQUIREMENTS),
    documentId: schemas.uuid,
    documentVersionId: schemas.uuid,
    deviceCapturedAt: z.string().min(1).max(64).nullable().optional(),
    qualityStatus: z.enum(CAPTURE_QUALITY_STATUSES).optional(),
  })
  .strict();

export const RECEPTION_EVIDENCE_BINDING_LIST_OPERATION = defineOperation({
  id: 'rec.reception-evidence-binding-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/evidence-bindings',
  summary: 'Read the capture contract of a reception visit and the evidence bound to it.',
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
    RECEPTION_EVIDENCE_BINDING_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await receptionModule().receptionCapture.readCaptureContract(
          db,
          params.receptionId,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}

export const RECEPTION_EVIDENCE_BINDING_OPERATION = defineOperation({
  id: 'rec.reception-evidence-binding',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/evidence-bindings',
  summary: 'Bind an exact document version to a capture requirement of a reception visit.',
  permissions: ['rec.reception.evidence.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.capture_evidence_bound',
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
    RECEPTION_EVIDENCE_BINDING_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionCapture.recordEvidenceBinding(
        db,
        params.receptionId,
        await parseJsonBody(raw, CreateBody),
        // Re-authorized against the LOCKED visit's branch, not this request:
        // `scope: 'branch'` is inert without a target (P1-18-A-01).
        authorizeScope
      ),
    }),
    { params, body }
  );
}
