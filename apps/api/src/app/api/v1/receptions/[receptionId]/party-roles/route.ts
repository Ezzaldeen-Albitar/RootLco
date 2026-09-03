/**
 * POST /api/v1/receptions/{receptionId}/party-roles (Phase 1-18, P1-18-BE-009).
 *
 * Assigns one dated party role on a visit. The identity columns of
 * `rec.reception_party_roles` are immutable, so a role never changes in place: the
 * open interval is closed and a replacement is appended. `supersede` asks for that
 * explicitly, because doing it implicitly would silently re-date history whenever a
 * caller repeated an assignment by accident.
 *
 * It is a POST that appends a row rather than a PUT that replaces one, and it is
 * its own route rather than a field on check-in, because who a party is to a
 * vehicle — owner, driver, payer, approver — is a distinct business fact with its
 * own permission and its own dated history.
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
import { RECEPTION_PARTY_ROLES, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `assignment_source` carries only a non-blank CHECK, so the module publishes no
 * bound for it. It is bounded here as the short provenance label it is ("front
 * desk", "portal") so an unbounded string never reaches an unbounded column.
 */
const MAX_ASSIGNMENT_SOURCE = 120;

const Params = z.object({ receptionId: schemas.uuid });
export const Body = z
  .object({
    partnerId: schemas.uuid,
    relationshipRole: z.enum(RECEPTION_PARTY_ROLES),
    assignmentSource: z.string().max(MAX_ASSIGNMENT_SOURCE).nullable().optional(),
    supersede: z.boolean().optional(),
  })
  .strict();

export const RECEPTION_PARTY_ROLE_OPERATION = defineOperation({
  id: 'rec.reception-party-role',
  successStatus: 201,
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/party-roles',
  summary: 'Assign a dated party role on a reception visit.',
  permissions: ['rec.reception.party.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.party_role_assigned',
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
    RECEPTION_PARTY_ROLE_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptions.assignPartyRole(
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
// GET — the dated party roles of one visit (P1-27 remediation executed by
// P1-18, `P1-27-INT-015`). Read-back of who is present and in what role, with
// `validTo IS NULL` marking the active interval; without it a resumed visit
// could not tell whose instruction the workshop may act on.
// ---------------------------------------------------------------------------

const ListQuery = z
  .object({
    status: z.enum(['active', 'ended']).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const RECEPTION_PARTY_ROLE_LIST_OPERATION = defineOperation({
  id: 'rec.reception-party-role-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/party-roles',
  summary: 'List the dated party roles recorded on a reception visit.',
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
    RECEPTION_PARTY_ROLE_LIST_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const path = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(
        ListQuery,
        searchParamsToObject(new URL(req.url).searchParams),
        'query'
      );
      return {
        body: await receptionModule().receptionRead.listPartyRoles(
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
