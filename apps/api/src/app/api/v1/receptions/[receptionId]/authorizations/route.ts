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
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import {
  AUTHORIZATION_CHANNELS,
  AUTHORIZATION_DECISIONS,
  AUTHORIZING_ROLES,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });
export const Body = z
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

// ---------------------------------------------------------------------------
// GET — the authorization decisions AND authorization refusals of one visit
// (P1-27 remediation executed by P1-18, `P1-27-INT-016`). The standing state
// was previously discoverable only by attempting approve and reading the 409.
// The two-table UNION is mandatory: an `authorization`-type refusal is a
// second, cheaper way to say no, and reading only `rec.authorizations` would
// report a withdrawn approval as consent. `isStanding` marks each partner's
// CURRENT decision across both tables.
// ---------------------------------------------------------------------------

const ListQuery = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const RECEPTION_AUTHORIZATION_LIST_OPERATION = defineOperation({
  id: 'rec.reception-authorization-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/authorizations',
  summary: 'List the authorization decisions and authorization refusals on a reception visit.',
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
    RECEPTION_AUTHORIZATION_LIST_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const path = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(
        ListQuery,
        searchParamsToObject(new URL(req.url).searchParams),
        'query'
      );
      return {
        body: await receptionModule().receptionRead.listAuthorizations(
          db,
          path.receptionId,
          query,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
