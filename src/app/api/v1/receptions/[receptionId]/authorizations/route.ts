/**
 * POST /api/v1/receptions/{receptionId}/authorizations (Phase 1-18, P1-18-BE-010).
 *
 * Records one party's decision to approve or decline work. `rec.authorizations` is
 * INSERT and SELECT only, so a decision is superseded by a later row and never
 * edited; both outcomes are recorded, because a decline is evidence too.
 *
 * The authorizing role is the narrower set — `vehicle_user` and `payer` are absent,
 * since driving a vehicle or paying for it is not authority to approve work on it —
 * and `rec.guard_authorization_authority` is the authority on whether this partner
 * actually holds such a role on this visit. Nothing here anticipates that verdict.
 *
 * Audit class `approval`, not `privileged`: this is the act a later approval and
 * conversion depend on, and it belongs in the approval trail.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  AUTHORIZATION_CHANNELS,
  AUTHORIZATION_DECISIONS,
  AUTHORIZING_ROLES,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });
const Body = z
  .object({
    authorizingRole: z.enum(AUTHORIZING_ROLES),
    partnerId: schemas.uuid,
    decision: z.enum(AUTHORIZATION_DECISIONS),
    channel: z.enum(AUTHORIZATION_CHANNELS).optional(),
    /** `ck_authorizations_scope_object` accepts a JSON object or nothing at all. */
    authorizedScope: z.record(z.string(), z.unknown()).nullable().optional(),
    evidenceDocumentId: schemas.uuid.nullable().optional(),
  })
  .strict();

export const RECEPTION_AUTHORIZATION_OPERATION = defineOperation({
  id: 'rec.reception-authorization',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/authorizations',
  summary: 'Record an authorizing party decision on a reception visit.',
  permissions: ['rec.reception.authorization.verify'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'rec.reception.authorization_recorded',
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
    RECEPTION_AUTHORIZATION_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptions.recordAuthorization(
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
