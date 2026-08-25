/**
 * GET /api/v1/technicians/me/queue (PRE-P1-29-BR-01).
 *
 * The signed-in caller's own assigned-job queue, with the technician profile
 * resolved SERVER-SIDE and never named by the client in either direction.
 *
 * ## The hole this closes
 *
 * `tech.technician-queue` is `GET /technicians/{technicianProfileId}/queue`, and
 * the id is a path parameter. `GET /auth/session` returns no profile reference,
 * so a signed-in technician had no legitimate way to learn the id that endpoint
 * demands — leaving only illegitimate ones: matching on a display name, which
 * collides, or walking profile ids against the queue endpoint, which is an
 * enumeration oracle over staff assignments (`T-11`). That is finding `INS-04`,
 * one of the phase's three CRITICAL items, and it blocks the whole technician
 * persona.
 *
 * ## Why the identifier is not in the response either
 *
 * The existing endpoint's envelope carries `technicianProfileId` because the
 * caller supplied it. Here nobody did, and returning it would hand the client the
 * very identifier this operation exists to withhold — the next screen would then
 * be tempted to send it back, re-creating the client-asserted-identity shape.
 * The body is `{items}` alone.
 *
 * ## Why the company/branch pair is REQUIRED even though the subject is the caller
 *
 * `scope: 'branch'` is inert without a target: `requiresScopedEvaluation` returns
 * false on an empty one whatever the declaration says, and `app.branch_ids` is the
 * permission-blind union of every active grant (P1-18-A-01), so RLS cannot
 * compensate. Omitting the pair here because "it is only me" would reintroduce
 * exactly the hole every other collection route closes. It is a resource selector
 * — *which* branch's queue — never a privilege the caller is claiming.
 *
 * ## Three different "no" answers, one indistinguishable response
 *
 * No profile in this tenant, a profile in a branch the caller did not name, and a
 * soft-deleted or inactive profile all answer `200 {items: []}`. Not `404`, and
 * not a distinct code: `ERR-RES-001` would tell an unauthorised prober that some
 * OTHER caller is a technician, which is the same oracle in a new place. The
 * frontend renders "you have no assigned work", which is also the right message
 * for a technician whose queue is genuinely empty.
 *
 * ## Route collision
 *
 * `me` and `{technicianProfileId}` occupy the same segment. Next.js resolves the
 * static segment first, so this file wins; and the dynamic route's `Params` is
 * `schemas.uuid`, so the literal `me` can never reach that handler either way.
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
import { technicianModule } from '@/modules/technician';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exported because `BR-08`'s payload-parity gate can only read a schema that is
 * exported, and a route whose schema is private is invisible to it.
 *
 * `.strict()` is load-bearing rather than habitual here: a client that "helpfully"
 * sends `technicianProfileId` must be REFUSED, not silently ignored. Ignoring it
 * would let a caller believe they had selected a subject and be served their own
 * queue instead — the confusion this operation exists to make impossible.
 */
export const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    limit: schemas.limit.optional(),
  })
  .strict();

export const TECHNICIAN_ME_QUEUE_OPERATION = defineOperation({
  id: 'tech.technician-me-queue',
  module: 'technician',
  method: 'GET',
  path: '/technicians/me/queue',
  summary: "Read the signed-in caller's own assigned-job queue.",
  permissions: ['tech.technician.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    TECHNICIAN_ME_QUEUE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(Query, raw, 'query');
      const scope = { companyId: query.companyId, branchId: query.branchId };

      // Resolved from `context.principal.userId`, which the request wrapper set
      // from the session inside this transaction. Nothing here reads a caller
      // field naming a technician, because the schema has no such field.
      const technicianProfileId = await technicianModule().roster.ownProfileIdInScope(db, scope);
      if (technicianProfileId === null) {
        // The three "no" cases converge here, byte-identical. See the header.
        return { body: { items: [] } };
      }

      return {
        body: {
          items: await workOrderModule().jobAssignments.queue(
            db,
            technicianProfileId,
            authorizeScope
          ),
        },
      };
    },
    scopeTargetOption(raw)
  );
}
