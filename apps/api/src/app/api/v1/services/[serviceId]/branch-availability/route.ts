/**
 * POST /api/v1/services/{serviceId}/branch-availability
 * (Phase 1-20, P1-20-BE-002).
 *
 * Records whether one branch offers one service.
 *
 * ## This is a state change, not an addition to a history
 *
 * `uq_branch_service_availability_service` permits exactly ONE live row per
 * `(tenant, company, branch, service)`, and the table has no effective-date columns,
 * so overlap is structurally impossible and there is nothing to schedule
 * (P1-20-A-01). The endpoint is therefore a POST that sets the current state rather
 * than a collection append, and the transition is preserved only in the audit
 * record's `previousValue` — which is why that detail is written.
 *
 * ## The one catalog write that is genuinely branch-scoped
 *
 * Every other service-catalog mutation touches a table with no company and no
 * branch, so it is a tenant-wide act needing tenant-wide authority. This row carries
 * both columns, so `scope: 'branch'` is real here: the pair arrives in the body and
 * is authorized as a concrete target before it is written.
 *
 * That ordering matters. `iam.allowed_branch_ids()` is the permission-BLIND union of
 * every active grant, so RLS alone would let an actor holding an unrelated
 * permission in branch A1 write A1's availability. Only the scoped permission check
 * refuses that (P1-18-A-01), and a declared branch scope with no `authorizeScope`
 * call would have been inert.
 *
 * `svc.guard_branch_availability_service_active` refuses making an ARCHIVED service
 * available; withdrawing availability from one stays possible, which is the
 * operation an operator retiring a service actually needs.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { ACTIVATION_STATES, serviceCatalogModule } from '@/modules/service-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ serviceId: schemas.uuid });

/**
 * `isAvailable` and `status` are two different facts and both are kept.
 *
 * `is_available` is the commercial answer — does this branch offer the service — and
 * `status` is the row's own lifecycle. `svc.branch_service_availability` carries
 * both, `isSellableAt` requires `is_available AND status = 'active'`, and collapsing
 * them here would make one of the two unreachable through the API.
 */
const Body = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    isAvailable: z.boolean(),
    status: z.enum(ACTIVATION_STATES).optional(),
  })
  .strict();

export const BRANCH_AVAILABILITY_SET_OPERATION = defineOperation({
  id: 'svc.branch-availability-set',
  module: 'service-catalog',
  method: 'POST',
  path: '/services/{serviceId}/branch-availability',
  summary: 'Set whether a branch offers a service.',
  permissions: ['svc.service.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'svc.branch_availability.changed',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ serviceId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    BRANCH_AVAILABILITY_SET_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      /**
       * Authorize the pair BEFORE the row is written.
       *
       * The company and branch are the row's own scope columns, so this is the concrete
       * target `scope: 'branch'` needs. There is no wildcard case to fall through to —
       * both fields are required, so `authorizeScope` is never called with an empty
       * target and never fails closed on one.
       *
       * The pair's COHERENCE is checked inside the application service rather than
       * here: `iam.has_permission_in_scope` is disjunctive across grant rows, so a
       * caller pairing their own branch with another company's id satisfies this check
       * on the branch row alone, and the service refuses the mismatch with a 422 naming
       * the field.
       */
      await authorizeScope({ companyId: parsed.companyId, branchId: parsed.branchId });
      const availability = await serviceCatalogModule().catalogWrites.setAvailability(
        db,
        params.serviceId,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          isAvailable: parsed.isAvailable,
          status: parsed.status,
        }
      );
      return { status: 200, body: availability, recordVersion: availability.recordVersion };
    },
    { params: raw, body }
  );
}
