/**
 * GET /api/v1/work-orders — the branch work-order board (Phase 1-19,
 * P1-19-BE-006).
 *
 * ## There is no POST here, and that is the phase boundary
 *
 * The execution brief asked for `POST /api/v1/work-orders`. Reception's conversion
 * (`POST /api/v1/receptions/{receptionId}/convert-to-work-order`, P1-18-BE-019)
 * already inserts `wo.work_orders`, holding the reception-visit lock and answering
 * a replay with the work order it already created, and
 * `uq_work_orders_ordinary_origin` is the database backstop designed around that
 * one path. A second insert here would not hold that lock, so two concurrent
 * callers using two different paths would race for the same partial unique index
 * and one would receive a raw `23505`. Creation therefore stays where it is; this
 * phase consumes the shell. The reconciliation is recorded in the phase
 * traceability matrix rather than left as an unexplained gap in the contract.
 *
 * ## Company and branch are required, for authorization rather than convenience
 *
 * `scope: 'branch'` is inert without a target: `requiresScopedEvaluation` returns
 * false on an empty one whatever the declaration says, so the check degrades to
 * scope-blind `iam.has_permission` — and RLS cannot compensate, because
 * `app.branch_ids` is the permission-blind union of every active grant
 * (P1-18-A-01). A caller holding `wo.work_order.read` in one branch and any grant
 * at all in another would see the second branch's board. Naming the pair in the
 * query lets it be passed as the `authorizationTarget`, so
 * `iam.has_permission_in_scope` decides against the branch actually read.
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
import { WORK_ORDER_KINDS, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `state` is an opaque catalog code, deliberately not a TypeScript enum:
 * `wo.work_order_states` is tenant-extensible, so an unknown code must return an
 * empty page rather than a 422 about a state the tenant may legitimately have
 * defined. `kind` IS a closed vocabulary — `ck_work_orders_kind` allows exactly
 * two values — so it is validated here.
 */
const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    state: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,62}$/, 'must be a lower-snake state code')
      .optional(),
    kind: z.enum(WORK_ORDER_KINDS).optional(),
    openedFrom: z.string().datetime({ offset: true }).optional(),
    openedTo: z.string().datetime({ offset: true }).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const WORK_ORDER_LIST_OPERATION = defineOperation({
  id: 'wo.work-order-list',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders',
  summary: 'List the work orders of one branch, newest opened first.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    WORK_ORDER_LIST_OPERATION,
    request,
    async ({ db }) => {
      // Parsed INSIDE the handler so a malformed query is rendered as the shared
      // problem document by the pipeline. Parsing it outside would let the
      // `AppFailure` escape the route function entirely, and the caller would see
      // an unhandled 500 instead of a 422 naming the field.
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await workOrderModule().workOrders.list(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            state: query.state,
            kind: query.kind,
            openedFrom: query.openedFrom === undefined ? undefined : new Date(query.openedFrom),
            openedTo: query.openedTo === undefined ? undefined : new Date(query.openedTo),
          },
          { cursor: query.cursor, limit: query.limit }
        ),
      };
    },
    // The pre-handler check is the one that must not be scope-blind, and it runs
    // before the schema. `scopeTargetOption` is the platform helper for exactly
    // that: it reads the pair out of not-yet-validated input and yields NO target
    // unless both are well-formed UUIDs — so it can only ever make authorization
    // stricter, and a malformed pair falls through to the schema refusal above.
    scopeTargetOption(raw)
  );
}
