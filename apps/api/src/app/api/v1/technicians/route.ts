/**
 * GET / POST /api/v1/technicians (PRE-P1-29-BR-03).
 *
 * The roster surface. Before this slice a production tenant had zero technicians
 * and no supported means of acquiring any — the only code that inserted a
 * profile was test scaffolding — so `tech.technician-available` returned
 * candidates from a table nothing could populate.
 *
 * ## Company and branch are the authorization target, on both verbs
 *
 * `scope: 'branch'` is inert without a target: `requiresScopedEvaluation`
 * returns false on an empty one whatever the declaration says, and
 * `app.branch_ids` is the permission-blind union of every active grant
 * (P1-18-A-01), so RLS cannot compensate. The list names the pair in its query
 * and the create names it in its body, and in both cases it is a RESOURCE
 * SELECTOR — "whose roster" — evaluated by `iam.has_permission_in_scope`, never
 * a privilege the caller is claiming.
 *
 * ## Why create is the only operation that trusts the body for scope
 *
 * There is no row yet. Every other roster operation resolves the profile first
 * and re-decides against the profile's OWN company and branch, so a caller
 * cannot reach another branch by naming it. Create has nothing to resolve, which
 * is exactly why the permission is evaluated against the named pair BEFORE the
 * insert and `ins_technician_profiles_scope` is the backstop behind it.
 *
 * ## What the body may not carry
 *
 * `isActive` is absent: a created profile is active. Offering it would let an
 * administrator create a roster row that is inert on arrival, which is a state
 * with no stated purpose. The schema is `.strict()`, so sending it is a 422
 * rather than a silent drop — a caller who believes they created a deactivated
 * technician should be told they did not.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { MAX_EMPLOYMENT_REF, MAX_TRADE, technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    isActive: z.enum(['true', 'false']).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const Body = z
  .object({
    userId: schemas.uuid,
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    /** Opaque operational label. Never a name, a contact detail or an identifier. */
    trade: z.string().trim().min(1).max(MAX_TRADE).optional(),
    /** Opaque non-PII link to an employment record held elsewhere. */
    employmentRef: z.string().trim().min(1).max(MAX_EMPLOYMENT_REF).optional(),
  })
  .strict();

/**
 * Each declaration sits immediately before ITS OWN handler, and that placement
 * is load-bearing rather than stylistic.
 *
 * `scripts/p1-19-endpoint-inventory.mjs` decides whether a `scope: 'branch'`
 * claim is enforced by reading the text BETWEEN one `defineOperation` and the
 * next. With both declarations stacked at the top, the first one's "handler" is
 * the second declaration — empty of handler code — so its scope check read as
 * inert while the second was credited with both handlers at once. That is a
 * false alarm and a false clearance from the same layout, so the layout changed.
 */
export const TECHNICIAN_LIST_OPERATION = defineOperation({
  id: 'tech.technician-list',
  module: 'technician',
  method: 'GET',
  path: '/technicians',
  summary: "List a branch's technician roster.",
  permissions: ['tech.technician.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    TECHNICIAN_LIST_OPERATION,
    request,
    async ({ db }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await technicianModule().roster.listProfiles(db, {
          companyId: query.companyId,
          branchId: query.branchId,
          isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
          cursor: query.cursor,
          limit: query.limit,
        }),
      };
    },
    scopeTargetOption(raw)
  );
}

export const TECHNICIAN_CREATE_OPERATION = defineOperation({
  id: 'tech.technician-create',
  module: 'technician',
  method: 'POST',
  path: '/technicians',
  summary: "Put a user on a branch's technician roster.",
  permissions: ['tech.technician.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.profile_created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TECHNICIAN_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(Body, body, 'body');
      const created = await technicianModule().roster.createProfile(
        db,
        {
          userId: parsed.userId,
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          trade: parsed.trade,
          employmentRef: parsed.employmentRef,
        },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    // Both halves, on the `apt.appointment-create` / `rec.reception-create`
    // precedent. `scopeTargetOption` narrows the PRE-handler check to the named
    // pair, and the service re-decides the same pair before the insert; the two
    // are not redundant, because the pre-handler check runs before the body has
    // been schema-validated and the service's runs after. Neither alone is the
    // whole control: without the target the pre-handler check is scope-blind,
    // and without the service call a body that is malformed in exactly the way
    // `scopeTargetOption` tolerates would reach the insert unnarrowed.
    { body, ...scopeTargetOption(body) }
  );
}
