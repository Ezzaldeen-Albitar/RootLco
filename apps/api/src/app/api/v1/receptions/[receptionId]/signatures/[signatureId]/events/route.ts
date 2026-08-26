/**
 * POST /api/v1/receptions/{receptionId}/signatures/{signatureId}/events
 * (Owner decision FE-018).
 *
 * The signature lifecycle, as an append-only ledger with two events.
 *
 * ## `finalized` is what makes a signature evidence
 *
 * Recording a signature binds it to a document version. Finalizing it asserts
 * that the party's acknowledgement is complete — and that assertion is refused
 * while the bound version is anything other than ACCEPTED. A version that is
 * still pending has not been scanned and accepted by the platform, so
 * finalizing one would record that somebody signed something the platform has
 * not yet agreed to hold. `rec.guard_signature_event()` owns that rule, along
 * with the requirement that the version sit in the `reception_signature`
 * category and be linked to this very visit.
 *
 * ## `repudiated` never erases anything
 *
 * It is a second row, not an edit. `rec.signatures` has no UPDATE and no DELETE
 * grant at all, so historical signature evidence cannot be overwritten by any
 * path — and a correction is a NEW signature naming the one it supersedes
 * (`replacesSignatureId` on the capture route), which leaves both readable.
 *
 * Ordering — finalize once, repudiate only what was finalized, never finalize
 * what was repudiated — lives in the guard and in two partial unique indexes,
 * where a second code path cannot avoid it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  MAX_REPUDIATION_REASON,
  SIGNATURE_EVENT_TYPES,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid, signatureId: schemas.uuid });

/**
 * `reason` is optional in the SHAPE and conditional in the RULE: mandatory for a
 * repudiation, refused for a finalization. The module decides, because
 * `ck_signature_event_reason` states the same pairing and one owner is enough.
 */
export const Body = z
  .object({
    eventType: z.enum(SIGNATURE_EVENT_TYPES),
    reason: z.string().min(1).max(MAX_REPUDIATION_REASON).nullable().optional(),
  })
  .strict();

export const RECEPTION_SIGNATURE_EVENT_OPERATION = defineOperation({
  id: 'rec.reception-signature-event',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/signatures/{signatureId}/events',
  summary: 'Finalize or repudiate a reception signature.',
  permissions: ['rec.reception.signature.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.signature_lifecycle_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ receptionId: string; signatureId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEPTION_SIGNATURE_EVENT_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionCapture.recordSignatureEvent(
        db,
        params.receptionId,
        params.signatureId,
        await parseJsonBody(raw, Body),
        authorizeScope
      ),
    }),
    { params, body }
  );
}
