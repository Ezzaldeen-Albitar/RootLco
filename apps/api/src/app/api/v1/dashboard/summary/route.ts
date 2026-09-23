/**
 * /api/v1/dashboard/summary — what the workshop looks like right now.
 *
 * The authoritative server-side aggregate behind the tenant overview. Every
 * figure is computed in the database, one SQL aggregate per question, inside the
 * RLS-bound transaction — never assembled in a browser out of paged lists, which
 * is how a dashboard comes to disagree with the screens it links to.
 *
 * ## The entitlement is `wo.work_order.read`, and every SECTION is gated again
 *
 * The reporting module's datasets all sit behind `rpt.report.read`, which a
 * service advisor or a foreman has no reason to hold; entitling the first screen
 * of the product on it would make it the one screen ordinary staff cannot open.
 * So the operation is entitled by the code anyone working on the shop floor
 * already holds, and the service then puts each section to
 * `iam.has_permission_in_scope` for the read code of the module whose data it
 * is. A section the caller may not see comes back `unauthorized` rather than at
 * zero: a zero would be a false statement about the workshop instead of a true
 * one about the caller.
 *
 * ## `branchId` is optional, and its absence is RESOLVED rather than assumed
 *
 * Naming a branch makes the pair the `authorizationTarget`, so
 * `iam.has_permission_in_scope` decides against the branch actually read and an
 * unauthorized one is refused with the uniform `ERR-IAM-001`.
 *
 * Omitting it cannot be left to RLS. `app.branch_ids` is the union of every
 * active grant regardless of which permission carries it (P1-18-A-01), so a
 * caller holding `wo.work_order.read` in one branch and any grant at all in a
 * second would otherwise be answered for both. The service therefore resolves
 * the set through the handler's `authorizedBranches` seam — the one the
 * work-order board resolves its own all-branches page with, which puts each
 * candidate branch to `iam.has_permission_in_scope` for the declared code —
 * and counts only those, refusing outright when none passes rather than
 * answering an unauthorized caller with zeros. A caller with no branch
 * narrowing is answered for the company's LIVE branches, as the board is.
 *
 * ## The period is a calendar period in the branch's own zone
 *
 * `today`, `yesterday` and `last7` are resolved against the local day measured
 * on the DATABASE clock in `org.branches.timezone_name`; `custom` takes two ISO
 * days, refuses an inverted range and refuses more than a quarter. The zone
 * travels in the response, because a multi-branch total across two zones cannot
 * be right for both and saying which boundary was used beats picking one
 * silently.
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
import { overviewModule, DASHBOARD_PERIOD_KINDS } from '@/modules/overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A calendar day, `YYYY-MM-DD`.
 *
 * A day and not an instant, deliberately: the boundary between two days is
 * decided by the branch's timezone, which the caller does not have and must not
 * have to guess. Sending an instant would let a client choose a boundary the
 * workshop does not use.
 */
const CalendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid.optional(),
    period: z.enum(DASHBOARD_PERIOD_KINDS),
    from: CalendarDay.optional(),
    to: CalendarDay.optional(),
  })
  .strict();

export const DASHBOARD_SUMMARY_OPERATION = defineOperation({
  id: 'ovw.dashboard-summary-read',
  module: 'overview',
  method: 'GET',
  path: '/dashboard/summary',
  summary: 'Read the operations overview for a company, or for one of its branches.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    DASHBOARD_SUMMARY_OPERATION,
    request,
    async ({ db, authorizeScope, authorizedBranches }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await overviewModule().dashboard.summary(
          db,
          {
            companyId: query.companyId,
            ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
            period: query.period,
            ...(query.from === undefined ? {} : { from: query.from }),
            ...(query.to === undefined ? {} : { to: query.to }),
          },
          authorizeScope,
          authorizedBranches
        ),
      };
    },
    // Only present when the caller named a branch. With no branch there is no
    // pair to evaluate, and inventing one here would be this route deciding a
    // scope the service is about to resolve properly.
    scopeTargetOption(raw)
  );
}
