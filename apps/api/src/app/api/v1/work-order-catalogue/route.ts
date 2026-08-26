/**
 * GET /api/v1/work-order-catalogue (PRE-P1-29-BR-06, `INS-06`).
 *
 * ## The service existed; the route did not
 *
 * `WorkOrderCatalogService` has shipped since P1-19 with `workOrderStates()`,
 * `jobStates()`, `workOrderTransitions()` and `jobTransitions()`, and it is
 * constructed in the module's composition root. It is **not** dead code —
 * `workOrderStates()` alone has fourteen internal call sites, three of them in
 * other modules. What never existed is an HTTP surface: a grep for either
 * full-graph reader across `apps/api/src/app` returned nothing, and no
 * `/work-order-catalogue` path appeared among the published paths.
 *
 * The consequence is the defect. The graphs are **tenant-overridable data**, so a
 * UI that hard-codes `['planned','in_progress','done']` is wrong for any tenant
 * that configured its own — and with no endpoint, hard-coding was the only option
 * available. This route removes the excuse.
 *
 * ## One route, not four
 *
 * A single screen needs the job graph and the work-order graph together — a board
 * renders job states while its detail pane renders work-order transitions. Four
 * routes would mean four round trips for data that changes at tenant-configuration
 * frequency, which is to say almost never.
 *
 * ## No `authorizeScope` call, and that is the sanctioned shape
 *
 * The precedent is `rec.catalogue-visit-reason-list`, and the transferable rule is
 * stated at `intake-catalogue-repository.ts:24-28`: a picker read is the one
 * statement deliberately permitted to trust RLS alone **because it is not
 * id-addressed**. There is no target row whose company/branch could be evaluated;
 * the response is the caller tenant's own configuration, and the repository query
 * already resolves the platform/tenant override correctly.
 *
 * ## `closureEligible` is published, and it is NOT a closure decision
 *
 * `wo.job_states` carries five flags, and the fifth is a trap (correction `C-02`).
 * `closure_eligible` is projected to consumers and **enforced by nothing**:
 * `wo.guard_work_order_closure` tests `js.is_terminal`, never `closure_eligible`,
 * and `ck_job_states_tenant_not_terminal` stops a tenant minting a *terminal*
 * state while saying nothing about this flag.
 *
 * Omitting a field the row carries would be its own defect, so it is published —
 * with the rule stated here, in the contract, and asserted by a test:
 *
 *   **Closure eligibility for a work order comes from
 *   `GET /work-orders/{id}/closure-eligibility` and from nothing else. No
 *   consumer may compute closure readiness from this flag.**
 *
 * A tenant state with `closure_eligible = true` and `is_terminal = false` does not
 * make a work order closable, and the suite proves it rather than asserting it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, searchParamsToObject } from '@/server/http/validation';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deliberately empty and `.strict()`.
 *
 * The catalogue is small, bounded by the tenant's own configuration, and unpaged
 * — nine work-order states and six job states on the platform seed. A `cursor` or
 * `limit` here would imply a page boundary that does not exist, and an unknown
 * parameter is a client defect worth naming rather than ignoring.
 */
export const WorkOrderCatalogueQuery = z.object({}).strict();

export const WORK_ORDER_CATALOGUE_OPERATION = defineOperation({
  id: 'wo.work-order-catalogue',
  module: 'work-order',
  method: 'GET',
  path: '/work-order-catalogue',
  summary: 'Read the work-order and job state graphs the caller tenant is configured with.',
  permissions: ['wo.work_order.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(WORK_ORDER_CATALOGUE_OPERATION, request, async ({ db, request: raw }) => {
    parseOrFail(
      WorkOrderCatalogueQuery,
      searchParamsToObject(new URL(raw.url).searchParams),
      'query'
    );
    const catalogue = workOrderModule().workOrderCatalog;
    // Four reads, one round trip from the caller's point of view. Issued
    // together rather than sequentially because none depends on another.
    const [workOrderStates, workOrderTransitions, jobStates, jobTransitions] = await Promise.all([
      catalogue.workOrderStates(db),
      catalogue.workOrderTransitions(db),
      catalogue.jobStates(db),
      catalogue.jobTransitions(db),
    ]);
    return { body: { workOrderStates, workOrderTransitions, jobStates, jobTransitions } };
  });
}
