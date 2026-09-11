/**
 * GET /api/v1/reports/{reportCode}/rows (P1-31 prerequisite P-11).
 *
 * RUNS a registered report over one branch and one calendar period, and returns
 * its columns, a keyset page of rows, and the GROUPS of the whole selection with
 * their measures — states and their counts for `work_orders_by_status`,
 * technicians and their recorded seconds for `technician_labor_time`. The
 * grouping is the dataset's; the envelope around it is the engine's and is the
 * same shape for every report.
 *
 * The envelope also echoes the filter context — the company and branch, beside
 * the period and the zone it was resolved in — because the Owner's D-17 requires
 * that a number never be readable without the selection that produced it.
 *
 * `countsByState` is still published and is still correct for
 * `work_orders_by_status`, derived from that dataset's own groups. It is
 * DEPRECATED: it named one dataset's grouping on a shared envelope, and `groups`
 * is its replacement. It is empty for every other dataset.
 *
 * ## Why `/rows` rather than the definition path
 *
 * `GET /reports/{reportCode}` reads the DEFINITION — the scope, the filter
 * allowlist, the export permission — and answers it for a draft or an archived
 * configuration too. Running a report is a different question with a different
 * cost and a different permission, and giving one path two meanings decided by a
 * query parameter would make the rate-limit policy and the cache category answer
 * for both at once.
 *
 * ## Company and branch are REQUIRED, for authorization rather than convenience
 *
 * `scope: 'branch'` is inert without a target: `requiresScopedEvaluation`
 * (`server/auth/authorization.ts:63`) returns false on an empty one whatever the
 * declaration says, so the check degrades to the scope-blind
 * `iam.has_permission`, and RLS cannot compensate because `app.branch_ids` is
 * the permission-blind union of every active grant (P1-18-A-01). Naming the pair
 * lets it be passed as the `authorizationTarget`, so `iam.has_permission_in_scope`
 * decides against the branch actually reported on — and it is the same pair the
 * service then evaluates the DATASET's own read code against.
 *
 * ## The period is half-open
 *
 * `from` is the first day included; `to` is the first day EXCLUDED — the day
 * after the last one reported. Both are calendar days resolved in the BRANCH's
 * timezone, not the server's. A closed upper bound over a day either swallows
 * the next day's first instant or drops the last one's final microsecond.
 *
 * `expensive-read` and `cacheCategory: 'never'` for the reason
 * `wo.work-order-list` carries them: the query is an aggregate over a branch's
 * whole history for a period, and its answer is different one second later.
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
import { reportingModule } from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The schema's own `ck_report_configurations_code` shape, enforced before any query. */
const ReportCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, 'report code must match ^[a-z][a-z0-9_]{1,62}$');

/**
 * `.strict()` so an unknown query parameter is refused rather than ignored: a
 * caller who mistypes a filter should be told, not silently served an
 * unfiltered — and therefore wrong — report.
 *
 * `from` and `to` are calendar DAYS and not instants. A timestamp here would
 * carry an offset the caller chose, which would silently override the branch
 * timezone the period is supposed to be expressed in.
 */
const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD calendar day'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD calendar day'),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const REPORT_RUN_OPERATION = defineOperation({
  id: 'rpt.report-run',
  module: 'reporting',
  method: 'GET',
  path: '/reports/{reportCode}/rows',
  summary: 'Run a registered report over one branch and one calendar period.',
  // The right to run reports at all. The right to see the ROWS a given report
  // returns is the dataset's own read code, evaluated in the service at this
  // operation's branch scope — a single declaration cannot be per-report.
  permissions: ['rpt.report.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  context: { params: Promise<{ reportCode: string }> }
): Promise<Response> {
  const { reportCode } = await context.params;
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    REPORT_RUN_OPERATION,
    request,
    async ({ db }) => {
      // Parsed INSIDE the handler so a malformed query is rendered as the shared
      // problem document; parsing it outside would let the `AppFailure` escape
      // the route function and answer an unhandled 500 instead of a 422.
      const code = parseOrFail(ReportCode, reportCode, 'path.reportCode');
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await reportingModule().runs.run(db, {
          reportCode: code,
          companyId: query.companyId,
          branchId: query.branchId,
          from: query.from,
          to: query.to,
          cursor: query.cursor,
          limit: query.limit,
        }),
      };
    },
    // The pre-handler check must not be scope-blind, and it runs before the
    // schema. `scopeTargetOption` reads the pair out of not-yet-validated input
    // and yields NO target unless both are well-formed UUIDs, so it can only make
    // authorization stricter and a malformed pair falls through to the refusal
    // above.
    scopeTargetOption(raw)
  );
}
