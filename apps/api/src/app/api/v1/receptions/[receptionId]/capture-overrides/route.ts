/**
 * POST /api/v1/receptions/{receptionId}/capture-overrides (Owner decisions
 * FE-012, FE-018 — the attributable escape hatch).
 *
 * Records that a named actor decided one required capture would not be taken,
 * with a reason and a time.
 *
 * ## Why it is a separate permission
 *
 * `rec.reception.evidence.override` is declared here and named again by
 * `ins_capture_requirement_overrides`. Neither check can be reached around, and
 * the code is granted to nobody by default. Reusing
 * `rec.reception.evidence.manage` would have made "take the photograph" and
 * "record that no photograph was needed" the same authority — which is to say,
 * it would have made the requirement optional for everyone who could satisfy it.
 *
 * ## Why it is a record rather than a flag
 *
 * `rec.capture_requirement_overrides` has no UPDATE or DELETE grant, so a waiver
 * cannot be edited or withdrawn once written. `uq_capture_requirement_override_once`
 * holds one waiver per requirement per visit, so a second attempt is a conflict
 * rather than a second, contradictory reason for the same gap.
 *
 * The reason is the operator's own words about the vehicle in front of them, so
 * the audit detail records it INTERNAL rather than public.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  CAPTURE_REQUIREMENTS,
  MAX_CAPTURE_OVERRIDE_REASON,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });
const Body = z
  .object({
    requirementCode: z.enum(CAPTURE_REQUIREMENTS),
    reason: z.string().min(1).max(MAX_CAPTURE_OVERRIDE_REASON),
  })
  .strict();

export const RECEPTION_CAPTURE_OVERRIDE_OPERATION = defineOperation({
  id: 'rec.reception-capture-override',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/capture-overrides',
  summary: 'Record an attributable override of a required reception capture.',
  permissions: ['rec.reception.evidence.override'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.capture_requirement_overridden',
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
    RECEPTION_CAPTURE_OVERRIDE_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionCapture.overrideCaptureRequirement(
        db,
        params.receptionId,
        await parseJsonBody(raw, Body),
        authorizeScope
      ),
    }),
    { params, body }
  );
}
