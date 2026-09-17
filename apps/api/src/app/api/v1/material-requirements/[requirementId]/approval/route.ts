/**
 * /api/v1/material-requirements/{requirementId}/approval — decide a requirement
 * someone else asked for (P1-32-PRE-127).
 *
 * `decision: approved` lets reservations and issues for the work order draw on the
 * allowance; `decision: rejected` closes it with a reason, and the requirement still
 * governs the item — nothing may be drawn on a rejected requirement. The person who
 * asked may not decide: the service refuses it readably and
 * `ck_material_requirements_separation` refuses it whatever reaches the database.
 *
 * A requirement that is `approval_required` is not decidable at all. Its
 * specification or its unit conversion does not exist yet, so there is no allowance
 * to approve.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { ADJUSTMENT_DECISIONS, MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requirementId: schemas.uuid }).strict();

export const DecisionBody = z
  .object({
    decision: z.enum(ADJUSTMENT_DECISIONS),
    /** Required for a rejection. */
    reason: z.string().trim().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const MATERIAL_REQUIREMENT_APPROVE_OPERATION = defineOperation({
  id: 'inv.material-requirement-approve',
  module: 'inventory',
  method: 'POST',
  path: '/material-requirements/{requirementId}/approval',
  summary: 'Approve or reject a material requirement asked for by someone else.',
  permissions: ['inv.material.approve'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'inv.material_requirement.approved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ requirementId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    MATERIAL_REQUIREMENT_APPROVE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { requirementId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(DecisionBody, body, 'body');
      const decided = await inventoryModule().materials.decide(
        db,
        requirementId,
        {
          decision: parsed.decision,
          ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
        },
        authorizeScope
      );
      return { body: decided, recordVersion: decided.recordVersion };
    },
    { params: raw, body }
  );
}
